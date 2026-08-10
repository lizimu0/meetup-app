/**
 * Express 应用工厂（依赖注入，便于测试）。
 */
const express = require('express');
const cors = require('cors');
const { createRoomsRouter } = require('./routes/rooms');
const { createAmapRouter } = require('./routes/amapProxy');

function createApp({ store, hub, amap, backendName = 'node' }) {
  const app = express();
  app.use(cors());
  app.use(express.json());

  app.get('/health', (req, res) => {
    res.json({ code: 0, message: 'ok', data: { ok: true, backend: backendName } });
  });

  app.use('/api/rooms', createRoomsRouter({ store, hub, amap }));
  app.use('/api', createAmapRouter({ amap }));

  // 统一 404
  app.use((req, res) => {
    res.status(404).json({ code: 404, message: 'Not Found', data: null });
  });

  return app;
}

module.exports = { createApp };
