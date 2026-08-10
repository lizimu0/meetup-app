/**
 * REST 请求封装（uni.request Promise 化）。
 * config.mode 为 'polling' 时导出微信云函数适配层（同接口）。
 */
import { config } from '../config/index';
import { cloudApi } from './cloud';

function request(method, path, { body, headers } = {}) {
  return new Promise((resolve, reject) => {
    uni.request({
      url: config.baseUrl + path,
      method,
      data: body,
      header: { 'Content-Type': 'application/json', ...(headers || {}) },
      success: (res) => {
        const payload = res.data || {};
        if (payload.code === 0) {
          resolve(payload.data);
        } else {
          reject(new Error(payload.message || `请求失败(${payload.code})`));
        }
      },
      fail: (err) => reject(new Error(err.errMsg || '网络异常')),
    });
  });
}

const restApi = {
  createRoom(name, nickname) {
    return request('POST', '/api/rooms', { body: { name, nickname } });
  },
  joinRoom(code, nickname) {
    return request('POST', '/api/rooms/join', { body: { code, nickname } });
  },
  roomSnapshot(roomId) {
    return request('GET', `/api/rooms/${roomId}`);
  },
  reportLocation(roomId, memberId, token, lat, lng) {
    return request('POST', `/api/rooms/${roomId}/location`, {
      body: { lat, lng },
      headers: { 'X-Member-Id': memberId, 'X-Member-Token': token },
    });
  },
  recommend(roomId, memberId, token, { optimize, radius, travelMode }) {
    return request('POST', `/api/rooms/${roomId}/recommend`, {
      body: { optimize, radius, travelMode },
      headers: { 'X-Member-Id': memberId, 'X-Member-Token': token },
    });
  },
  vote(roomId, memberId, token, poiId) {
    return request('POST', `/api/rooms/${roomId}/vote`, {
      body: { poiId },
      headers: { 'X-Member-Id': memberId, 'X-Member-Token': token },
    });
  },
};

// 根据模式选择实现：ws 模式走 REST+WebSocket，polling 模式走微信云开发云函数
export const api = config.mode === 'polling' ? cloudApi : restApi;
