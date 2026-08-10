require('dotenv').config();

module.exports = {
  port: Number(process.env.PORT || 3000),
  amapKey: process.env.AMAP_WEB_KEY || '',
  amapBaseUrl: process.env.AMAP_BASE_URL || 'https://restapi.amap.com',
  storeFile: process.env.STORE_FILE || '',
  // 离线判定阈值（ms）与扫描间隔（ms）
  offlineThresholdMs: 60_000,
  offlineScanIntervalMs: 10_000,
  // 位置上报节流（客户端约束，服务端再兜底一次）
  minLocationIntervalMs: 1_000,
};
