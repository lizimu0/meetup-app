/**
 * 微信云开发云函数适配层：与 http.js 的 restApi 同接口。
 * config.mode = 'polling' 时由 http.js 导出本实现；仅微信小程序端可用。
 */
import { config } from '../config/index';

let inited = false;
function ensureInit() {
  // #ifdef MP-WEIXIN
  if (!inited) {
    wx.cloud.init({ env: config.cloudEnv, traceUser: true });
    inited = true;
  }
  // #endif
}

function call(action, params = {}) {
  return new Promise((resolve, reject) => {
    // #ifdef MP-WEIXIN
    ensureInit();
    wx.cloud.callFunction({
      name: 'meetup',
      data: { action, ...params },
      success: (res) => {
        const payload = res.result || {};
        if (payload.code === 0) {
          resolve(payload.data);
        } else {
          reject(new Error(payload.message || `请求失败(${payload.code})`));
        }
      },
      fail: (err) => reject(new Error(err.errMsg || '云函数调用失败')),
    });
    // #endif
    // #ifndef MP-WEIXIN
    reject(new Error('云函数模式仅支持微信小程序端'));
    // #endif
  });
}

export const cloudApi = {
  createRoom(name, nickname) {
    return call('create', { name, nickname });
  },
  joinRoom(code, nickname) {
    return call('join', { code, nickname });
  },
  roomSnapshot(roomId, memberId, token) {
    return call('snapshot', { roomId, memberId, token });
  },
  reportLocation(roomId, memberId, token, lat, lng) {
    return call('location', { roomId, memberId, token, lat, lng });
  },
  recommend(roomId, memberId, token, { optimize, radius, travelMode }) {
    return call('recommend', { roomId, memberId, token, optimize, radius, travelMode });
  },
  vote(roomId, memberId, token, poiId) {
    return call('vote', { roomId, memberId, token, poiId });
  },
};
