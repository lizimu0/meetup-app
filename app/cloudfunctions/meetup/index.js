/**
 * 聚哪儿 - 微信云开发云函数（无域名、免备案方案）。
 *
 * 与 server-node / server-py 业务逻辑等价（见 shared/PROTOCOL.md），区别：
 * - 云函数无法维持长连接，前端使用 5s 轮询（config.mode = 'polling'）；
 * - 在线状态按"60s 内有位置上报"计算。
 *
 * 数据存储：微信云数据库集合 meetup_rooms（首次使用前在云开发控制台创建）。
 * 调用方式：wx.cloud.callFunction({ name: 'meetup', data: { action, ...params } })
 */
const cloud = require('wx-server-sdk');
const axios = require('axios');

cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV });

// 高德 Web 服务 Key：优先读本地 config.local.js（不入库），其次读云函数环境变量
let AMAP_WEB_KEY = '';
try {
  AMAP_WEB_KEY = require('./config.local').AMAP_WEB_KEY || '';
} catch (e) {
  AMAP_WEB_KEY = process.env.AMAP_WEB_KEY || '';
}
const AMAP_BASE = 'https://restapi.amap.com';
const OFFLINE_THRESHOLD_MS = 60 * 1000;

const TRAVEL_MODES = ['driving', 'walking', 'transit'];
const POI_TYPES = [
  { code: '050500', label: '咖啡厅' },
  { code: '060100', label: '购物中心' },
  { code: '150500', label: '地铁站出入口' },
  { code: '050000', label: '餐饮' },
];

const db = cloud.database();
const _ = db.command;
const roomsCol = db.collection('meetup_rooms');

function ok(data) {
  return { code: 0, message: 'ok', data };
}
function fail(code, message) {
  return { code, message, data: null };
}
function uuid() {
  return require('crypto').randomUUID
    ? require('crypto').randomUUID()
    : require('crypto').randomBytes(16).toString('hex');
}

/** 视图转换：成员在线状态按最近上报时间计算 */
function memberView(m) {
  return {
    id: m.id,
    nickname: m.nickname,
    avatar: m.avatar || '',
    lat: m.lat == null ? null : m.lat,
    lng: m.lng == null ? null : m.lng,
    updatedAt: m.updatedAt || 0,
    travelMode: m.travelMode || 'transit',
    online: Date.now() - (m.updatedAt || 0) < OFFLINE_THRESHOLD_MS,
  };
}

function roomView(room) {
  return {
    id: room._id,
    code: room.code,
    name: room.name,
    createdAt: room.createdAt,
    closed: room.closed || false,
  };
}

/** 投票聚合视图：poiId -> 票数 */
function votesView(room) {
  const votes = {};
  for (const [poiId, voters] of Object.entries(room.votes || {})) {
    votes[poiId] = (voters || []).length;
  }
  return votes;
}

/** 归一化搜索半径（米）：夹在 [500, 50000]，非法值回退默认 2000 */
function normalizeRadius(radius) {
  const r = Number(radius);
  if (!Number.isFinite(r)) return 2000;
  return Math.min(50000, Math.max(500, r));
}

async function findRoom(roomId) {
  try {
    const res = await roomsCol.doc(roomId).get();
    return res.data || null;
  } catch (e) {
    return null;
  }
}

async function findRoomByCode(code) {
  const res = await roomsCol.where({ code: String(code) }).limit(1).get();
  return (res.data && res.data[0]) || null;
}

function authMember(room, memberId, token) {
  if (!room) return null;
  const member = (room.members || []).find((m) => m.id === memberId);
  if (!member || member.token !== token) return null;
  return member;
}

async function saveRoom(room) {
  const doc = { ...room };
  delete doc._id;
  await roomsCol.doc(room._id).update({ data: doc });
}

/* ---------- 地理与推荐（算法与 server-node 一致） ---------- */

function haversine(lat1, lng1, lat2, lng2) {
  const toRad = (d) => (d * Math.PI) / 180;
  const dLat = toRad(lat2 - lat1);
  const dLng = toRad(lng2 - lng1);
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLng / 2) ** 2;
  return 2 * 6371000 * Math.asin(Math.sqrt(a));
}

async function amapGet(pathname, params) {
  const res = await axios.get(AMAP_BASE + pathname, {
    params: { key: AMAP_WEB_KEY, ...params },
    timeout: 8000,
  });
  const body = res.data;
  if (!body || String(body.status) !== '1') {
    throw new Error((body && body.info) || '高德接口错误');
  }
  return body;
}

async function placeAround(location, radius, types) {
  const body = await amapGet('/v5/place/around', {
    location,
    radius,
    types,
    page_size: 20,
    show_fields: 'business',
  });
  return body.pois || [];
}

async function directionDuration(mode, origin, destination, city) {
  try {
    if (mode === 'transit') {
      const body = await amapGet('/v5/direction/transit/integrated', {
        origin,
        destination,
        city1: city,
        city2: city,
        show_fields: 'cost',
      });
      const cost = body.route && body.route.cost;
      return cost && cost.duration ? Number(cost.duration) : null;
    }
    const pathname = mode === 'driving' ? '/v5/direction/driving' : '/v5/direction/walking';
    const body = await amapGet(pathname, { origin, destination, show_fields: 'cost' });
    const p = body.route && body.route.paths && body.route.paths[0];
    return p && p.cost && p.cost.duration ? Number(p.cost.duration) : null;
  } catch (e) {
    return null;
  }
}

async function recommend(room, { optimize = 'distance', radius = 2000 }) {
  if (!AMAP_WEB_KEY) {
    throw { code: 5001, message: '高德 Web Key 未配置（云函数 index.js 顶部）' };
  }
  const located = (room.members || []).filter(
    (m) => Number.isFinite(m.lat) && Number.isFinite(m.lng),
  );
  if (located.length < 2) {
    throw { code: 4003, message: '至少需要 2 名成员上报位置才能推荐集合点' };
  }
  radius = normalizeRadius(radius);

  // 1. 质心
  const center = {
    lat: located.reduce((s, m) => s + m.lat, 0) / located.length,
    lng: located.reduce((s, m) => s + m.lng, 0) / located.length,
  };

  // 2. POI 召回
  const location = center.lng + ',' + center.lat;
  const seen = new Set();
  const candidates = [];
  for (const t of POI_TYPES) {
    const pois = await placeAround(location, radius, t.code);
    for (const p of pois) {
      if (!p || !p.id || seen.has(p.id) || !p.location) continue;
      seen.add(p.id);
      const parts = p.location.split(',');
      candidates.push({
        id: p.id,
        name: p.name,
        address: p.address || '',
        category: t.label,
        adcode: p.adcode || '',
        lng: Number(parts[0]),
        lat: Number(parts[1]),
      });
    }
  }
  if (candidates.length === 0) return { centroid: center, candidates: [] };

  // 3. 直线距离评分
  for (const c of candidates) {
    c.maxDist = Math.round(
      Math.max(...located.map((m) => haversine(c.lat, c.lng, m.lat, m.lng))),
    );
  }
  candidates.sort((a, b) => a.maxDist - b.maxDist);

  if (optimize === 'distance') {
    return {
      centroid: center,
      candidates: candidates.slice(0, 10).map((c) => ({
        id: c.id, name: c.name, address: c.address, category: c.category,
        lat: c.lat, lng: c.lng, maxDist: c.maxDist, score: c.maxDist,
      })),
    };
  }

  // 4. commute 模式：Top 5 精算耗时
  const results = [];
  for (const c of candidates.slice(0, 5)) {
    const destination = c.lng + ',' + c.lat;
    const durations = [];
    let estimated = false;
    for (const m of located) {
      let dur = await directionDuration(m.travelMode || 'transit', m.lng + ',' + m.lat, destination, c.adcode);
      if (!Number.isFinite(dur)) {
        dur = Math.round(haversine(c.lat, c.lng, m.lat, m.lng) / 1.4 / 1.2);
        estimated = true;
      }
      durations.push(Math.round(dur));
    }
    const maxDur = Math.max(...durations);
    const avgDur = durations.reduce((s, d) => s + d, 0) / durations.length;
    results.push({
      id: c.id, name: c.name, address: c.address, category: c.category,
      lat: c.lat, lng: c.lng, maxDist: c.maxDist, durations, estimated,
      score: Math.round(maxDur + 0.3 * avgDur),
    });
  }
  results.sort((a, b) => a.score - b.score);
  return { centroid: center, candidates: results };
}

/* ---------- action 路由 ---------- */

const actions = {
  async health() {
    return ok({ ok: true, backend: 'wxcloud' });
  },

  async create({ name = '', nickname = '' }) {
    const member = {
      id: uuid(),
      token: require('crypto').randomBytes(16).toString('hex'),
      nickname: nickname || '匿名',
      avatar: '',
      lat: null,
      lng: null,
      updatedAt: 0,
      travelMode: 'transit',
    };
    const room = {
      code: String(Math.floor(Math.random() * 1000000)).padStart(6, '0'),
      name: name || '未命名房间',
      createdAt: Date.now(),
      closed: false,
      members: [member],
      votes: {},
    };
    const res = await roomsCol.add({ data: room });
    return ok({ room: roomView({ ...room, _id: res._id || res.id }), memberId: member.id, token: member.token });
  },

  async join({ code, nickname = '' }) {
    const room = await findRoomByCode(code);
    if (!room) return fail(4001, '邀请码不存在');
    if (room.closed) return fail(4002, '房间已关闭');
    const member = {
      id: uuid(),
      token: require('crypto').randomBytes(16).toString('hex'),
      nickname: nickname || '匿名',
      avatar: '',
      lat: null,
      lng: null,
      updatedAt: 0,
      travelMode: 'transit',
    };
    room.members.push(member);
    // 原子追加成员，避免并发加入时整文档写回互相覆盖
    await roomsCol.doc(room._id).update({ data: { members: _.push([member]) } });
    return ok({
      room: roomView(room),
      members: room.members.map(memberView),
      votes: votesView(room),
      memberId: member.id,
      token: member.token,
    });
  },

  async snapshot({ roomId, memberId, token }) {
    const room = await findRoom(roomId);
    if (!room) return fail(4001, '房间不存在');
    // 快照返回全体成员实时位置,必须校验成员凭证,防止仅凭 roomId 追踪位置
    const member = authMember(room, memberId, token);
    if (!member) return fail(4003, '鉴权失败');
    return ok({
      room: roomView(room),
      members: room.members.map(memberView),
      votes: votesView(room),
    });
  },

  async location({ roomId, memberId, token, lat, lng }) {
    const room = await findRoom(roomId);
    const member = authMember(room, memberId, token);
    if (!member) return fail(4003, '鉴权失败');
    if (!Number.isFinite(Number(lat)) || !Number.isFinite(Number(lng))) {
      return fail(4000, '位置无效');
    }
    const idx = room.members.findIndex((m) => m.id === memberId);
    const ts = Date.now();
    // 定向更新该成员的数组元素，避免整文档写回覆盖其他成员的并发上报
    await roomsCol.doc(room._id).update({
      data: {
        [`members.${idx}.lat`]: Number(lat),
        [`members.${idx}.lng`]: Number(lng),
        [`members.${idx}.updatedAt`]: ts,
      },
    });
    return ok({ ts });
  },

  async recommend({ roomId, memberId, token, optimize = 'distance', radius = 2000, travelMode }) {
    const room = await findRoom(roomId);
    const member = authMember(room, memberId, token);
    if (!member) return fail(4003, '鉴权失败');
    if (!['distance', 'commute'].includes(optimize)) return fail(4000, 'optimize 参数无效');
    if (travelMode && TRAVEL_MODES.includes(travelMode)) member.travelMode = travelMode;
    await saveRoom(room);
    try {
      const result = await recommend(room, { optimize, radius });
      return ok({ ...result, optimize });
    } catch (err) {
      if (err && err.code) return fail(err.code, err.message);
      return fail(5000, '推荐服务异常');
    }
  },

  async vote({ roomId, memberId, token, poiId }) {
    const room = await findRoom(roomId);
    const member = authMember(room, memberId, token);
    if (!member || !poiId) return fail(4000, '参数缺失');
    // 一人一票：先移除旧票
    for (const key of Object.keys(room.votes || {})) {
      room.votes[key] = (room.votes[key] || []).filter((id) => id !== memberId);
    }
    room.votes = room.votes || {};
    room.votes[poiId] = [...(room.votes[poiId] || []), memberId];
    await saveRoom(room);
    return ok({ poiId, votes: room.votes[poiId].length, voters: room.votes[poiId] });
  },

  async close({ roomId, memberId, token }) {
    const room = await findRoom(roomId);
    const member = authMember(room, memberId, token);
    if (!member) return fail(4003, '鉴权失败');
    if (room.members[0].id !== memberId) return fail(4003, '仅房主可关闭房间');
    room.closed = true;
    await saveRoom(room);
    return ok({ closed: true });
  },
};

exports.main = async (event) => {
  const { action, ...params } = event || {};
  const handler = actions[action];
  if (!handler) return fail(404, '未知 action: ' + action);
  try {
    return await handler(params);
  } catch (err) {
    console.error('[meetup] action=' + action + ' error:', err);
    return fail(5000, '云函数内部错误');
  }
};
