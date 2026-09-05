/**
 * 高德 API 代理路由（隐藏 Web Key）。
 * 协议标注为调试用:前端正式流程走已鉴权的 /api/rooms/:roomId/recommend。
 * 代理本身消耗服务端持有的 Web Key 配额,因此必须要求房间成员凭证,
 * 并按 IP 限流,防止公网部署后变成无鉴权的开放代理盗刷配额。
 */
const express = require('express');
const { createRateLimiter } = require('../rateLimit');

function createAmapRouter({ store, amap }) {
  const router = express.Router();
  const limited = createRateLimiter({ windowMs: 60_000, max: 60 });

  /** 代理接口共用门禁:成员凭证 + IP 限流 */
  function guardProxy(store2, req, res) {
    const roomId = req.header('X-Room-Id');
    const memberId = req.header('X-Member-Id');
    const token = req.header('X-Member-Token');
    const room = roomId ? store2.getRoom(roomId) : null;
    const member = room ? store2.getMember(roomId, memberId) : null;
    if (!member || member.token !== token) {
      res.status(401).json({ code: 4003, message: '鉴权失败(需房间成员凭证)', data: null });
      return false;
    }
    const ip = req.ip || 'unknown';
    if (limited(ip)) {
      res.status(429).json({ code: 4029, message: '请求过于频繁', data: null });
      return false;
    }
    return true;
  }

  // GET /api/poi/search?keywords=&location=lng,lat&radius=&types=&region=
  router.get('/poi/search', async (req, res) => {
    if (!amap.configured) {
      return res.status(400).json({ code: 5001, message: '高德 Web Key 未配置', data: null });
    }
    if (!guardProxy(store, req, res)) return;
    const { keywords, location, radius, types, region } = req.query;
    try {
      let pois;
      if (location) {
        pois = await amap.placeAround({
          location,
          radius: Number(radius || 2000),
          types: types || '',
          pageSize: 20,
        });
      } else {
        pois = await amap.placeText({ keywords, region, types: types || '', pageSize: 20 });
      }
      res.json({ code: 0, message: 'ok', data: { pois } });
    } catch (err) {
      res.status(502).json({ code: 5002, message: err.message, data: null });
    }
  });

  // GET /api/direction?mode=driving|walking|transit&origin=lng,lat&destination=lng,lat&city=
  router.get('/direction', async (req, res) => {
    if (!amap.configured) {
      return res.status(400).json({ code: 5001, message: '高德 Web Key 未配置', data: null });
    }
    if (!guardProxy(store, req, res)) return;
    const { mode, origin, destination, city } = req.query;
    if (!['driving', 'walking', 'transit'].includes(mode) || !origin || !destination) {
      return res
        .status(400)
        .json({ code: 4000, message: '参数无效：mode/origin/destination 必填', data: null });
    }
    const duration = await amap.directionDuration({ mode, origin, destination, city });
    res.json({ code: 0, message: 'ok', data: { duration } });
  });

  return router;
}

module.exports = { createAmapRouter };
