/**
 * 房间相关 REST 路由（协议见 shared/PROTOCOL.md）。
 * router 工厂注入依赖，便于测试替换 amap 客户端。
 */
const express = require('express');
const { MemoryStore } = require('../store/memory');
const { recommend, RecommendError } = require('../services/recommend');

const TRAVEL_MODES = ['driving', 'walking', 'transit'];

/** 从请求头解析并校验成员身份，失败返回 null */
function authMember(store, req) {
  const roomId = req.params.roomId;
  const memberId = req.header('X-Member-Id');
  const token = req.header('X-Member-Token');
  const member = store.getMember(roomId, memberId);
  if (!member || member.token !== token) return null;
  return { roomId, member };
}

function createRoomsRouter({ store, hub, amap }) {
  const router = express.Router();

  // POST /api/rooms 创建房间（创建者自动加入）
  router.post('/', (req, res) => {
    const { name, nickname, avatar } = req.body || {};
    const room = store.createRoom(name);
    const member = store.addMember(room, { nickname, avatar });
    res.json({
      code: 0,
      message: 'ok',
      data: { room: MemoryStore.roomView(room), memberId: member.id, token: member.token },
    });
  });

  // POST /api/rooms/join 邀请码加入
  router.post('/join', (req, res) => {
    const { code, nickname, avatar } = req.body || {};
    const room = store.getRoomByCode(code);
    if (!room) {
      return res.status(404).json({ code: 4001, message: '邀请码不存在', data: null });
    }
    if (room.closed) {
      return res.status(410).json({ code: 4002, message: '房间已关闭', data: null });
    }
    const member = store.addMember(room, { nickname, avatar });
    if (hub) hub.broadcast(room.id, 'member:join', { member: MemoryStore.memberView(member) });
    res.json({
      code: 0,
      message: 'ok',
      data: {
        room: MemoryStore.roomView(room),
        members: [...room.members.values()].map(MemoryStore.memberView),
        votes: MemoryStore.votesView(room),
        memberId: member.id,
        token: member.token,
      },
    });
  });

  // GET /api/rooms/:roomId 房间快照（断线恢复 / 轮询）
  router.get('/:roomId', (req, res) => {
    const room = store.getRoom(req.params.roomId);
    if (!room) {
      return res.status(404).json({ code: 4001, message: '房间不存在', data: null });
    }
    res.json({ code: 0, message: 'ok', data: store.snapshot(room) });
  });

  // POST /api/rooms/:roomId/location 位置上报（uniCloud 轮询降级模式使用）
  router.post('/:roomId/location', (req, res) => {
    const auth = authMember(store, req);
    if (!auth) return res.status(401).json({ code: 4003, message: '鉴权失败', data: null });
    const { lat, lng } = req.body || {};
    const updated = store.updateLocation(auth.roomId, auth.member.id, lat, lng);
    if (!updated) return res.status(400).json({ code: 4000, message: '位置无效', data: null });
    if (hub) {
      hub.broadcast(auth.roomId, 'location:update', {
        memberId: auth.member.id,
        lat: updated.lat,
        lng: updated.lng,
        ts: updated.updatedAt,
      });
    }
    res.json({ code: 0, message: 'ok', data: { ts: updated.updatedAt } });
  });

  // POST /api/rooms/:roomId/recommend 集合点推荐
  router.post('/:roomId/recommend', async (req, res) => {
    const auth = authMember(store, req);
    if (!auth) return res.status(401).json({ code: 4003, message: '鉴权失败', data: null });
    const room = store.getRoom(auth.roomId);
    const { optimize = 'distance', radius = 2000, travelMode } = req.body || {};
    if (!['distance', 'commute'].includes(optimize)) {
      return res.status(400).json({ code: 4000, message: 'optimize 参数无效', data: null });
    }
    // 携带自己的出行方式（每个成员发起推荐时更新自己的）
    if (travelMode && TRAVEL_MODES.includes(travelMode)) {
      store.setTravelMode(auth.roomId, auth.member.id, travelMode);
    }
    const members = [...room.members.values()];
    try {
      const result = await recommend({ members, optimize, radius, amap });
      const payload = { ...result, optimize };
      if (hub) hub.broadcast(auth.roomId, 'recommend:result', payload);
      res.json({ code: 0, message: 'ok', data: payload });
    } catch (err) {
      if (err instanceof RecommendError) {
        return res.status(400).json({ code: err.code, message: err.message, data: null });
      }
      console.error('recommend error:', err);
      res.status(500).json({ code: 5000, message: '推荐服务异常', data: null });
    }
  });

  // POST /api/rooms/:roomId/vote 投票
  router.post('/:roomId/vote', (req, res) => {
    const auth = authMember(store, req);
    if (!auth) return res.status(401).json({ code: 4003, message: '鉴权失败', data: null });
    const { poiId } = req.body || {};
    if (!poiId) return res.status(400).json({ code: 4000, message: 'poiId 缺失', data: null });
    const result = store.vote(auth.roomId, auth.member.id, String(poiId));
    if (hub) hub.broadcast(auth.roomId, 'vote:update', result);
    res.json({ code: 0, message: 'ok', data: result });
  });

  // POST /api/rooms/:roomId/close 关闭房间（仅首个成员）
  router.post('/:roomId/close', (req, res) => {
    const auth = authMember(store, req);
    if (!auth) return res.status(401).json({ code: 4003, message: '鉴权失败', data: null });
    const room = store.getRoom(auth.roomId);
    const firstMemberId = room.members.keys().next().value;
    if (firstMemberId !== auth.member.id) {
      return res.status(403).json({ code: 4003, message: '仅房主可关闭房间', data: null });
    }
    store.closeRoom(auth.roomId);
    if (hub) hub.broadcast(auth.roomId, 'room:closed', {});
    res.json({ code: 0, message: 'ok', data: { closed: true } });
  });

  return router;
}

module.exports = { createRoomsRouter };
