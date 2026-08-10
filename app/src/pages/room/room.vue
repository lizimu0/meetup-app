<template>
  <view class="room-page">
    <!-- 地图 -->
    <map
      id="roomMap"
      class="map"
      :latitude="mapCenter.lat"
      :longitude="mapCenter.lng"
      :scale="14"
      :markers="markers"
      show-location
    />

    <!-- 顶部信息栏 -->
    <view class="top-bar">
      <view class="room-info">
        <text class="room-name">{{ roomStore.room ? roomStore.room.name : '房间' }}</text>
        <text class="room-code" @click="copyCode">邀请码 {{ roomStore.room ? roomStore.room.code : '' }}（点击复制）</text>
      </view>
      <view class="conn-badge" :class="{ connected: wsConnected }">
        <text>{{ statusText }}</text>
      </view>
    </view>

    <!-- 底部面板 -->
    <view class="bottom-panel">
      <!-- 成员列表 -->
      <scroll-view v-if="roomStore.members.length" class="member-list" scroll-x>
        <view v-for="m in roomStore.members" :key="m.id" class="member-item">
          <view class="avatar" :class="{ offline: !m.online }">
            <text class="avatar-text">{{ (m.nickname || '?').slice(0, 1) }}</text>
          </view>
          <text class="member-name" :class="{ offline: !m.online }">{{
            m.id === roomStore.memberId ? '我' : m.nickname
          }}</text>
          <text v-if="distText(m)" class="member-dist">{{ distText(m) }}</text>
        </view>
      </scroll-view>
      <view v-else class="empty-hint">
        <text class="empty-text">等待成员共享位置…</text>
      </view>

      <view class="actions">
        <button class="btn btn-recommend" @click="goRecommend">推荐集合点</button>
        <button class="btn btn-leave" @click="onLeave">退出房间</button>
      </view>
    </view>
  </view>
</template>

<script setup>
import { computed, onUnmounted, watch } from 'vue';
import { onShareAppMessage } from '@dcloudio/uni-app';
import { useRoomStore } from '../../store/room';
import { haversine } from '../../utils/geo';

const roomStore = useRoomStore();

const wsConnected = computed(() => {
  if (roomStore.room && roomStore.room.closed) return false;
  return roomStore.wsStatus === 'connected';
});
const statusText = computed(() => {
  if (roomStore.room && roomStore.room.closed) return '已关闭';
  return roomStore.wsStatus === 'connected' ? '实时连接中' : '连接中…';
});

/** 地图中心：优先自己位置，否则取第一个有位置的成员 */
const mapCenter = computed(() => {
  if (roomStore.myLocation) return roomStore.myLocation;
  const first = roomStore.locatedMembers[0];
  if (first) return { lat: first.lat, lng: first.lng };
  return { lat: 39.908823, lng: 116.39747 }; // 兜底：北京
});

/** 成员标记：按身份与在线状态选择图标 */
function markerIcon(m) {
  if (m.id === roomStore.memberId) return '/static/marker-self.png';
  return m.online ? '/static/marker-other.png' : '/static/marker-offline.png';
}

const markers = computed(() =>
  roomStore.locatedMembers.map((m, idx) => ({
    id: idx + 1,
    latitude: m.lat,
    longitude: m.lng,
    width: 30,
    height: 30,
    iconPath: markerIcon(m),
    callout: {
      content: m.id === roomStore.memberId ? '我' : m.nickname,
      color: m.online ? '#333333' : '#999999',
      fontSize: 13,
      borderRadius: 8,
      bgColor: '#ffffff',
      padding: 6,
      display: 'ALWAYS',
    },
  })),
);

/** 成员与我的距离 */
function distText(m) {
  if (m.id === roomStore.memberId || !roomStore.myLocation) return '';
  if (!Number.isFinite(m.lat) || !Number.isFinite(m.lng)) return '';
  const d = haversine(roomStore.myLocation.lat, roomStore.myLocation.lng, m.lat, m.lng);
  return d >= 1000 ? '距我 ' + (d / 1000).toFixed(1) + 'km' : '距我 ' + Math.round(d) + 'm';
}

/** 地图自动缩放包住所有成员（防抖 1s；H5 端不支持 includePoints 时静默降级） */
let fitTimer = null;
watch(
  () => roomStore.locatedMembers.length,
  () => {
    if (fitTimer) clearTimeout(fitTimer);
    fitTimer = setTimeout(() => {
      const points = roomStore.locatedMembers.map((m) => ({
        latitude: m.lat,
        longitude: m.lng,
      }));
      if (points.length < 1) return;
      try {
        const ctx = uni.createMapContext('roomMap');
        if (ctx && ctx.includePoints) {
          ctx.includePoints({ points, padding: [80, 80, 80, 80] });
        }
      } catch {
        /* H5 等不支持的平台静默降级 */
      }
    }, 1000);
  },
);

/** 微信分享卡片：携带邀请码，好友点开自动填充 */
onShareAppMessage(() => ({
  title: '我在「' + (roomStore.room ? roomStore.room.name : '房间') + '」共享位置，快来集合',
  path:
    '/pages/index/index?code=' +
    (roomStore.room ? roomStore.room.code : '') +
    '&room=' +
    encodeURIComponent(roomStore.room ? roomStore.room.name : ''),
}));

function copyCode() {
  if (!roomStore.room) return;
  uni.setClipboardData({
    data: roomStore.room.code,
    success: () => uni.showToast({ title: '邀请码已复制', icon: 'none' }),
  });
}

function goRecommend() {
  if (roomStore.locatedMembers.length < 2) {
    uni.showToast({ title: '需要至少 2 人上报位置', icon: 'none' });
    return;
  }
  uni.navigateTo({ url: '/pages/recommend/recommend' });
}

function onLeave() {
  uni.showModal({
    title: '退出房间',
    content: '退出后将停止共享位置',
    success: (res) => {
      if (res.confirm) {
        roomStore.leaveRoom();
        uni.navigateBack();
      }
    },
  });
}

onUnmounted(() => {
  // 页面销毁（如直接返回）时清理连接与定位
  roomStore.leaveRoom();
});
</script>

<style scoped>
.room-page {
  position: relative;
  width: 100%;
  height: 100vh;
}
.map {
  width: 100%;
  height: 100%;
}
.top-bar {
  position: absolute;
  top: calc(var(--status-bar-height, 25px) + 16rpx);
  left: 24rpx;
  right: 24rpx;
  display: flex;
  justify-content: space-between;
  align-items: center;
  background: rgba(255, 255, 255, 0.95);
  border-radius: 16rpx;
  padding: 18rpx 24rpx;
  box-shadow: 0 4rpx 16rpx rgba(0, 0, 0, 0.08);
}
.room-info {
  display: flex;
  flex-direction: column;
}
.room-name {
  font-size: 30rpx;
  font-weight: 600;
  color: #333;
}
.room-code {
  font-size: 24rpx;
  color: #1aad19;
  margin-top: 6rpx;
}
.conn-badge {
  font-size: 22rpx;
  padding: 6rpx 16rpx;
  border-radius: 20rpx;
  background: #f0f0f0;
  color: #999;
}
.conn-badge.connected {
  background: #e6f7e6;
  color: #1aad19;
}
.bottom-panel {
  position: absolute;
  left: 0;
  right: 0;
  bottom: 0;
  background: rgba(255, 255, 255, 0.97);
  border-radius: 24rpx 24rpx 0 0;
  padding: 24rpx 24rpx calc(24rpx + env(safe-area-inset-bottom));
  box-shadow: 0 -4rpx 24rpx rgba(0, 0, 0, 0.08);
}
.member-list {
  white-space: nowrap;
  margin-bottom: 20rpx;
}
.member-item {
  display: inline-flex;
  flex-direction: column;
  align-items: center;
  margin-right: 28rpx;
  width: 104rpx;
}
.avatar {
  width: 80rpx;
  height: 80rpx;
  border-radius: 50%;
  background: #3b82f6;
  display: flex;
  align-items: center;
  justify-content: center;
}
.member-item:first-child .avatar {
  background: #1aad19;
}
.avatar.offline {
  background: #cccccc;
}
.avatar-text {
  color: #fff;
  font-size: 32rpx;
  font-weight: 600;
}
.member-name {
  margin-top: 8rpx;
  font-size: 22rpx;
  color: #333;
  max-width: 104rpx;
  overflow: hidden;
  text-overflow: ellipsis;
}
.member-name.offline {
  color: #bbb;
}
.member-dist {
  font-size: 18rpx;
  color: #999;
  margin-top: 2rpx;
}
.empty-hint {
  padding: 24rpx 0;
  text-align: center;
}
.empty-text {
  font-size: 26rpx;
  color: #bbb;
}
.actions {
  display: flex;
  gap: 20rpx;
}
.btn {
  flex: 1;
  border-radius: 12rpx;
  font-size: 30rpx;
  margin: 0;
}
.btn-recommend {
  background: #1aad19;
  color: #fff;
}
.btn-leave {
  background: #fff;
  color: #e64340;
  border: 1rpx solid #e64340;
}
</style>
