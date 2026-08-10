<template>
  <view class="container">
    <view class="hero">
      <text class="title">聚哪儿</text>
      <text class="subtitle">实时位置共享 · 智能推荐集合地点</text>
      <view class="features">
        <view class="feature">
          <text class="feature-dot dot-green"></text>
          <text class="feature-text">实时位置</text>
        </view>
        <view class="feature">
          <text class="feature-dot dot-blue"></text>
          <text class="feature-text">智能推荐</text>
        </view>
        <view class="feature">
          <text class="feature-dot dot-orange"></text>
          <text class="feature-text">投票决策</text>
        </view>
      </view>
    </view>

    <view v-if="inviteRoom" class="invite-banner">
      <text class="invite-text">好友邀请你加入「{{ inviteRoom }}」，输入昵称即可加入</text>
    </view>

    <view class="card">
      <view class="field">
        <text class="label">昵称</text>
        <input v-model="nickname" class="input" placeholder="输入你的昵称" maxlength="12" />
      </view>

      <template v-if="!inviteRoom">
        <view class="divider" />
        <view class="field">
          <text class="label">房间名称</text>
          <input v-model="roomName" class="input" placeholder="例如：周六聚餐" maxlength="20" />
        </view>
        <button class="btn btn-primary" :disabled="busy" @click="onCreate">创建房间</button>
        <view class="divider" />
      </template>

      <view class="field">
        <text class="label">邀请码</text>
        <input
          v-model="code"
          class="input code-input"
          :disabled="!!inviteRoom"
          type="number"
          placeholder="6 位邀请码"
          maxlength="6"
        />
      </view>
      <button class="btn" :class="{ 'btn-primary': !!inviteRoom }" :disabled="busy" @click="onJoin">
        {{ inviteRoom ? '立即加入' : '加入房间' }}
      </button>
    </view>

    <text class="tip">进入房间后将持续共享你的位置，退出房间即停止</text>
  </view>
</template>

<script setup>
import { ref } from 'vue';
import { onLoad, onShareAppMessage } from '@dcloudio/uni-app';
import { useRoomStore } from '../../store/room';

const roomStore = useRoomStore();
const nickname = ref('');
const roomName = ref('');
const code = ref('');
const busy = ref(false);
const inviteRoom = ref(''); // 分享落地：邀请方房间名

// 分享卡片落地：解析邀请码参数自动填充
onLoad((options) => {
  roomStore.requestInitialLocation();
  if (options && options.code && /^\d{6}$/.test(options.code)) {
    code.value = options.code;
    inviteRoom.value = options.room ? decodeURIComponent(options.room) : '好友的房间';
  }
});

onShareAppMessage(() => ({
  title: '聚哪儿 - 约见面再也不用纠结在哪集合',
  path: '/pages/index/index',
}));

function checkNickname() {
  if (!nickname.value.trim()) {
    uni.showToast({ title: '请先输入昵称', icon: 'none' });
    return false;
  }
  return true;
}

async function onCreate() {
  if (!checkNickname()) return;
  busy.value = true;
  try {
    await roomStore.createRoom(roomName.value.trim(), nickname.value.trim());
    uni.navigateTo({ url: '/pages/room/room' });
  } catch (err) {
    uni.showToast({ title: err.message, icon: 'none' });
  } finally {
    busy.value = false;
  }
}

async function onJoin() {
  if (!checkNickname()) return;
  if (!/^\d{6}$/.test(code.value)) {
    uni.showToast({ title: '请输入 6 位数字邀请码', icon: 'none' });
    return;
  }
  busy.value = true;
  try {
    await roomStore.joinRoom(code.value, nickname.value.trim());
    uni.navigateTo({ url: '/pages/room/room' });
  } catch (err) {
    uni.showToast({ title: err.message, icon: 'none' });
  } finally {
    busy.value = false;
  }
}
</script>

<style scoped>
.container {
  padding: 40rpx 32rpx;
  min-height: 100vh;
}
.hero {
  display: flex;
  flex-direction: column;
  align-items: center;
  padding: 56rpx 0 32rpx;
}
.title {
  font-size: 64rpx;
  font-weight: 700;
  color: #1aad19;
  letter-spacing: 8rpx;
}
.subtitle {
  margin-top: 12rpx;
  font-size: 26rpx;
  color: #999;
}
.features {
  display: flex;
  gap: 24rpx;
  margin-top: 32rpx;
}
.feature {
  display: flex;
  align-items: center;
  background: #fff;
  border-radius: 32rpx;
  padding: 12rpx 24rpx;
  box-shadow: 0 2rpx 12rpx rgba(0, 0, 0, 0.05);
}
.feature-dot {
  width: 14rpx;
  height: 14rpx;
  border-radius: 50%;
  margin-right: 10rpx;
}
.dot-green { background: #1aad19; }
.dot-blue { background: #3b82f6; }
.dot-orange { background: #f59e0b; }
.feature-text {
  font-size: 24rpx;
  color: #555;
}
.invite-banner {
  background: #fff8e6;
  border: 1rpx solid #ffd666;
  border-radius: 16rpx;
  padding: 20rpx 24rpx;
  margin-bottom: 24rpx;
}
.invite-text {
  font-size: 26rpx;
  color: #ad6800;
}
.card {
  background: #fff;
  border-radius: 24rpx;
  padding: 32rpx;
  box-shadow: 0 4rpx 24rpx rgba(0, 0, 0, 0.06);
}
.field {
  margin-bottom: 20rpx;
}
.label {
  font-size: 26rpx;
  color: #666;
  display: block;
  margin-bottom: 10rpx;
}
.input {
  background: #f5f6f8;
  border-radius: 12rpx;
  padding: 20rpx 24rpx;
  font-size: 30rpx;
}
.code-input {
  letter-spacing: 12rpx;
}
.divider {
  height: 1rpx;
  background: #eee;
  margin: 28rpx 0;
}
.btn {
  margin-top: 8rpx;
  border-radius: 12rpx;
  font-size: 30rpx;
}
.btn-primary {
  background: #1aad19;
  color: #fff;
}
.tip {
  display: block;
  text-align: center;
  margin-top: 32rpx;
  font-size: 24rpx;
  color: #bbb;
}
</style>
