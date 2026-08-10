import { localSecrets } from './local';

/**
 * 全局配置：后端地址与模式切换。
 * - mode: 'ws' 使用 Node 后端（WebSocket 实时，Web 端）
 *         'polling' 使用微信云开发云函数（5s 轮询，小程序端，免域名免备案）
 */
export const config = {
  // 微信小程序：polling 模式走微信云开发云函数（5s 轮询，免域名免备案）
  // #ifdef MP-WEIXIN
  mode: 'polling',
  // #endif
  // 其他端（Web/H5）：ws 模式连 Node/Python 后端（实时）
  // #ifndef MP-WEIXIN
  mode: 'ws',
  // #endif
  // 微信云开发环境 ID（云开发控制台 → 设置 → 环境 ID），polling 模式必填
  cloudEnv: localSecrets.cloudEnv,
  // Node 后端默认 3000；切换 Python 后端改为 http://localhost:8000
  baseUrl: 'http://localhost:3000',
  wsPath: '/ws',
  // 位置上报节流（ms），与协议约定一致
  locationIntervalMs: 3000,
  // 轮询模式间隔（ms）
  pollIntervalMs: 5000,
};

export function wsUrl(roomId, memberId, token) {
  const base = config.baseUrl.replace(/^http/, 'ws');
  return `${base}${config.wsPath}?roomId=${roomId}&memberId=${memberId}&token=${token}`;
}
