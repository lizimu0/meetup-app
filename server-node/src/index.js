/**
 * 服务入口：HTTP + WebSocket。
 */
const http = require('http');
const config = require('./config');
const { MemoryStore } = require('./store/memory');
const { AmapClient } = require('./amap/client');
const { Hub } = require('./ws/hub');
const { setupWebSocket } = require('./ws/server');
const { createApp } = require('./app');

const store = new MemoryStore({ file: config.storeFile });
const amap = new AmapClient({ key: config.amapKey, baseUrl: config.amapBaseUrl });
const hub = new Hub();

const app = createApp({ store, hub, amap });
const server = http.createServer(app);
setupWebSocket(server, { store, hub, config });

server.listen(config.port, () => {
  console.log(`[meetup-server-node] http://localhost:${config.port}`);
  if (!config.amapKey) {
    console.warn('[warn] 未配置 AMAP_WEB_KEY，集合点推荐功能将不可用');
  }
});

// 房间 24h 过期清理:启动时清一次(含持久化恢复的旧房间),此后每小时一轮
const ROOM_TTL_MS = 24 * 60 * 60 * 1000;
store.sweepExpiredRooms(ROOM_TTL_MS);
setInterval(() => {
  const removed = store.sweepExpiredRooms(ROOM_TTL_MS);
  if (removed) console.log(`[meetup-server-node] cleaned ${removed} expired room(s)`);
}, 60 * 60 * 1000).unref();
