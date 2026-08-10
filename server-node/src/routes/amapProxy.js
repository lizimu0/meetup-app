/**
 * 高德 API 代理路由（隐藏 Web Key）。
 */
const express = require('express');

function createAmapRouter({ amap }) {
  const router = express.Router();

  // GET /api/poi/search?keywords=&location=lng,lat&radius=&types=&region=
  router.get('/poi/search', async (req, res) => {
    if (!amap.configured) {
      return res.status(400).json({ code: 5001, message: '高德 Web Key 未配置', data: null });
    }
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
