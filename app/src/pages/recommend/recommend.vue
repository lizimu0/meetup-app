<template>
  <view class="recommend-page">
    <!-- 顶部地图：展示成员位置与候选点 -->
    <map
      class="map"
      :latitude="mapCenter.lat"
      :longitude="mapCenter.lng"
      :scale="13"
      :markers="markers"
    />

    <view class="panel">
      <!-- 出行方式与发起按钮 -->
      <view v-if="roomStore.candidates.length === 0 && !roomStore.loading" class="setup">
        <text class="section-title">选择你的出行方式</text>
        <view class="mode-row">
          <view
            v-for="mode in modes"
            :key="mode.value"
            class="mode-item"
            :class="{ active: roomStore.travelMode === mode.value }"
            @click="roomStore.travelMode = mode.value"
          >
            <text>{{ mode.label }}</text>
          </view>
        </view>

        <button class="btn btn-primary" @click="doRecommend('distance')">按距离推荐（快速）</button>
        <button class="btn btn-outline" @click="doRecommend('commute')">按通勤时间推荐（更精准）</button>
        <text class="hint">
          距离模式：取所有人地理中心附近的场所；通勤模式：结合各自出行方式估算耗时，选"最不折腾"的地点
        </text>
        <text v-if="tried && roomStore.candidates.length === 0" class="empty-tip">
          附近未找到合适的场所，可尝试让成员位置更集中后再推荐
        </text>
      </view>

      <!-- 加载中遮罩 -->
      <view v-if="roomStore.loading" class="loading-box">
        <view class="spinner"></view>
        <text class="loading-text"
          >正在为 {{ roomStore.locatedMembers.length }} 位成员找最合适的地点…</text
        >
      </view>

      <!-- 候选点列表 -->
      <view v-if="roomStore.candidates.length > 0 && !roomStore.loading" class="result">
        <view class="result-header">
          <text class="section-title">推荐集合点（共 {{ roomStore.candidates.length }} 个）</text>
          <text class="re-recommend" @click="reset">重新推荐</text>
        </view>
        <scroll-view class="candidate-list" scroll-y>
          <view
            v-for="(c, i) in roomStore.candidates"
            :key="c.id"
            class="candidate"
            :class="{ selected: selectedId === c.id }"
            @click="selectedId = c.id"
          >
            <view class="rank" :class="{ top: i < 3 }">{{ i + 1 }}</view>
            <view class="info">
              <view class="line-1">
                <text class="name">{{ c.name }}</text>
                <text class="category">{{ c.category }}</text>
                <text v-if="leaderId === c.id" class="leader-tag">领先</text>
              </view>
              <text class="address">{{ c.address }}</text>
              <view class="line-3">
                <text class="metric">最远成员 {{ formatDist(c.maxDist) }}</text>
                <text v-if="c.durations" class="metric">
                  通勤 {{ formatDur(Math.max(...c.durations)) }}{{ c.estimated ? '（估算）' : '' }}
                </text>
                <text class="votes">{{ roomStore.votes[c.id] || 0 }} 票</text>
              </view>
            </view>
            <view class="btn-col">
              <button
                class="vote-btn"
                :class="{ voted: myVoteId === c.id }"
                size="mini"
                @click.stop="doVote(c)"
              >
                {{ myVoteId === c.id ? '已投' : '投票' }}
              </button>
              <button class="nav-btn" size="mini" @click.stop="navigate(c)">导航</button>
            </view>
          </view>
        </scroll-view>
      </view>
    </view>
  </view>
</template>

<script setup>
import { computed, ref } from 'vue';
import { onShareAppMessage } from '@dcloudio/uni-app';
import { useRoomStore } from '../../store/room';

const roomStore = useRoomStore();
const selectedId = ref('');
const tried = ref(false); // 是否发起过推荐（用于空状态提示）
const myVoteId = ref(''); // 自己投过的候选点

const modes = [
  { value: 'transit', label: '公共交通' },
  { value: 'driving', label: '驾车' },
  { value: 'walking', label: '步行' },
];

/** 票数最高者（>0 票才显示领先） */
const leaderId = computed(() => {
  let best = '';
  let max = 0;
  for (const c of roomStore.candidates) {
    const v = roomStore.votes[c.id] || 0;
    if (v > max) {
      max = v;
      best = c.id;
    }
  }
  return best;
});

const mapCenter = computed(() => {
  if (roomStore.centroid) return roomStore.centroid;
  const first = roomStore.locatedMembers[0];
  if (first) return { lat: first.lat, lng: first.lng };
  return { lat: 39.908823, lng: 116.39747 };
});

/** 地图标记：成员（按身份着色）+ 候选点 */
const markers = computed(() => {
  const list = [];
  let id = 1;
  for (const m of roomStore.locatedMembers) {
    list.push({
      id: id++,
      latitude: m.lat,
      longitude: m.lng,
      width: 24,
      height: 24,
      iconPath: m.id === roomStore.memberId ? '/static/marker-self.png' : '/static/marker-other.png',
      callout: {
        content: m.id === roomStore.memberId ? '我' : m.nickname,
        fontSize: 12,
        bgColor: '#ffffff',
        padding: 4,
        borderRadius: 6,
        display: 'ALWAYS',
      },
    });
  }
  for (const c of roomStore.candidates) {
    list.push({
      id: id++,
      latitude: c.lat,
      longitude: c.lng,
      width: selectedId.value === c.id ? 34 : 26,
      height: selectedId.value === c.id ? 34 : 26,
      iconPath: c.id === leaderId.value ? '/static/marker-self.png' : '/static/marker-offline.png',
      callout: {
        content: c.name,
        fontSize: 12,
        bgColor: selectedId.value === c.id ? '#1aad19' : '#ffffff',
        color: selectedId.value === c.id ? '#ffffff' : '#333333',
        padding: 4,
        borderRadius: 6,
        display: 'ALWAYS',
      },
    });
  }
  return list;
});

/** 微信分享卡片：携带邀请码 */
onShareAppMessage(() => ({
  title: '我们在选集合点，快来一起投票',
  path:
    '/pages/index/index?code=' +
    (roomStore.room ? roomStore.room.code : '') +
    '&room=' +
    encodeURIComponent(roomStore.room ? roomStore.room.name : ''),
}));

async function doRecommend(optimize) {
  tried.value = true;
  try {
    await roomStore.requestRecommend(optimize);
    if (roomStore.candidates.length === 0) {
      uni.showToast({ title: '附近未找到合适的场所', icon: 'none' });
    }
  } catch (err) {
    uni.showToast({ title: err.message, icon: 'none' });
  }
}

async function doVote(candidate) {
  try {
    await roomStore.vote(candidate.id);
    myVoteId.value = candidate.id;
    uni.showToast({ title: '已投票', icon: 'success' });
  } catch (err) {
    uni.showToast({ title: err.message, icon: 'none' });
  }
}

/** 一键导航：调起内置地图 */
function navigate(candidate) {
  uni.openLocation({
    latitude: candidate.lat,
    longitude: candidate.lng,
    name: candidate.name,
    address: candidate.address || '',
    fail: () => uni.showToast({ title: '无法打开地图', icon: 'none' }),
  });
}

function reset() {
  roomStore.candidates = [];
  roomStore.centroid = null;
  tried.value = false;
  myVoteId.value = '';
}

function formatDist(meters) {
  return meters >= 1000 ? (meters / 1000).toFixed(1) + 'km' : meters + 'm';
}

function formatDur(seconds) {
  return seconds >= 3600
    ? Math.floor(seconds / 3600) + '小时' + Math.round((seconds % 3600) / 60) + '分'
    : Math.round(seconds / 60) + '分钟';
}
</script>

<style scoped>
.recommend-page {
  display: flex;
  flex-direction: column;
  height: 100vh;
}
.map {
  width: 100%;
  height: 44vh;
}
.panel {
  flex: 1;
  background: #fff;
  border-radius: 24rpx 24rpx 0 0;
  margin-top: -24rpx;
  padding: 28rpx;
  overflow: hidden;
}
.section-title {
  font-size: 30rpx;
  font-weight: 600;
  color: #333;
}
.mode-row {
  display: flex;
  gap: 16rpx;
  margin: 20rpx 0 28rpx;
}
.mode-item {
  flex: 1;
  text-align: center;
  padding: 18rpx 0;
  border-radius: 12rpx;
  background: #f5f6f8;
  font-size: 26rpx;
  color: #666;
}
.mode-item.active {
  background: #e6f7e6;
  color: #1aad19;
  font-weight: 600;
}
.btn {
  border-radius: 12rpx;
  font-size: 30rpx;
  margin-bottom: 20rpx;
}
.btn-primary {
  background: #1aad19;
  color: #fff;
}
.btn-outline {
  background: #fff;
  color: #1aad19;
  border: 1rpx solid #1aad19;
}
.hint {
  font-size: 22rpx;
  color: #bbb;
  line-height: 1.6;
}
.empty-tip {
  display: block;
  margin-top: 24rpx;
  font-size: 24rpx;
  color: #e64340;
  text-align: center;
}
.loading-box {
  display: flex;
  flex-direction: column;
  align-items: center;
  padding: 80rpx 0;
}
.spinner {
  width: 64rpx;
  height: 64rpx;
  border: 6rpx solid #e6f7e6;
  border-top-color: #1aad19;
  border-radius: 50%;
  animation: spin 0.9s linear infinite;
}
@keyframes spin {
  to {
    transform: rotate(360deg);
  }
}
.loading-text {
  margin-top: 24rpx;
  font-size: 26rpx;
  color: #666;
}
.result-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-bottom: 16rpx;
}
.re-recommend {
  font-size: 26rpx;
  color: #1aad19;
}
.candidate-list {
  height: calc(100% - 60rpx);
}
.candidate {
  display: flex;
  align-items: center;
  padding: 20rpx 16rpx;
  border-radius: 16rpx;
  border: 2rpx solid transparent;
  margin-bottom: 12rpx;
  background: #fafafa;
}
.candidate.selected {
  border-color: #1aad19;
  background: #f0faf0;
}
.rank {
  width: 48rpx;
  height: 48rpx;
  border-radius: 50%;
  background: #eee;
  color: #999;
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 26rpx;
  font-weight: 600;
  margin-right: 20rpx;
  flex-shrink: 0;
}
.rank.top {
  background: #1aad19;
  color: #fff;
}
.info {
  flex: 1;
  min-width: 0;
}
.line-1 {
  display: flex;
  align-items: center;
  gap: 12rpx;
}
.name {
  font-size: 28rpx;
  font-weight: 600;
  color: #333;
}
.category {
  font-size: 20rpx;
  color: #1aad19;
  background: #e6f7e6;
  padding: 2rpx 10rpx;
  border-radius: 6rpx;
}
.leader-tag {
  font-size: 20rpx;
  color: #fff;
  background: #f59e0b;
  padding: 2rpx 10rpx;
  border-radius: 6rpx;
}
.address {
  font-size: 24rpx;
  color: #999;
  margin-top: 6rpx;
  display: block;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.line-3 {
  display: flex;
  gap: 16rpx;
  margin-top: 6rpx;
  align-items: center;
}
.metric {
  font-size: 22rpx;
  color: #666;
}
.votes {
  font-size: 22rpx;
  color: #e64340;
}
.btn-col {
  display: flex;
  flex-direction: column;
  gap: 8rpx;
  flex-shrink: 0;
  margin-left: 12rpx;
}
.vote-btn {
  background: #1aad19;
  color: #fff;
  font-size: 24rpx;
  border-radius: 8rpx;
  margin: 0;
}
.vote-btn.voted {
  background: #e6f7e6;
  color: #1aad19;
}
.nav-btn {
  background: #fff;
  color: #3b82f6;
  border: 1rpx solid #3b82f6;
  font-size: 24rpx;
  border-radius: 8rpx;
  margin: 0;
}
</style>
