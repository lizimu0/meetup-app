/**
 * 集合点推荐服务。
 * 规范见 shared/ALGORITHM.md：
 *  - distance 模式：质心 + POI 召回 + 最大直线距离排序，返回 Top 10
 *  - commute 模式：先粗筛 Top 5，再按成员出行方式精算通勤耗时评分
 */
const { haversine, centroid } = require('./geo');

// POI 召回分类（顺序与规范一致）
const POI_TYPES = [
  { code: '050500', label: '咖啡厅' },
  { code: '060100', label: '购物中心' },
  { code: '150500', label: '地铁站出入口' },
  { code: '050000', label: '餐饮' },
];

const DISTANCE_TOP = 10; // distance 模式返回数
const COMMUTE_TOP = 5; // commute 模式进入精算的候选数

class RecommendError extends Error {
  constructor(code, message) {
    super(message);
    this.name = 'RecommendError';
    this.code = code;
  }
}

/** 高德 POI location 字段 "lng,lat" → 数值 */
function parseLocation(loc) {
  const [lng, lat] = String(loc).split(',').map(Number);
  return { lat, lng };
}

/** 归一化搜索半径（米）：夹在 [500, 50000]，非法值回退默认 2000 */
function normalizeRadius(radius) {
  const r = Number(radius);
  if (!Number.isFinite(r)) return 2000;
  return Math.min(50000, Math.max(500, r));
}

/** 召回候选点：按分类顺序搜索，按 id 去重 */
async function fetchCandidates(amap, center, radius) {
  const location = `${center.lng},${center.lat}`;
  const seen = new Set();
  const candidates = [];
  for (const t of POI_TYPES) {
    const pois = await amap.placeAround({ location, radius, types: t.code, pageSize: 20 });
    for (const p of pois) {
      if (!p || !p.id || seen.has(p.id) || !p.location) continue;
      seen.add(p.id);
      const { lat, lng } = parseLocation(p.location);
      candidates.push({
        id: p.id,
        name: p.name,
        address: p.address || '',
        category: t.label,
        adcode: p.adcode || '',
        lat,
        lng,
      });
    }
  }
  return candidates;
}

/** 直线距离兜底估算：直线距离 / 1.4 绕行系数 / 1.2 m/s 步行速度 */
function fallbackDuration(distMeters) {
  return Math.round(distMeters / 1.4 / 1.2);
}

/**
 * 主入口。
 * @param {object} opts
 * @param {object[]} opts.members 已上报位置的成员（含 id, lat, lng, travelMode）
 * @param {string} opts.optimize 'distance' | 'commute'
 * @param {number} opts.radius 搜索半径（米）
 * @param {object} opts.amap AmapClient 实例（可注入 fake 用于测试）
 */
async function recommend({ members, optimize = 'distance', radius = 2000, amap }) {
  const located = members.filter((m) => Number.isFinite(m.lat) && Number.isFinite(m.lng));
  if (located.length < 2) {
    throw new RecommendError(4003, '至少需要 2 名成员上报位置才能推荐集合点');
  }
  if (!amap || !amap.configured) {
    throw new RecommendError(5001, '高德 Web Key 未配置，请设置 AMAP_WEB_KEY');
  }

  const center = centroid(located);
  const candidates = await fetchCandidates(amap, center, normalizeRadius(radius));
  if (candidates.length === 0) {
    return { centroid: center, candidates: [] };
  }

  // 直线距离评分：maxDist = 到全体成员直线距离的最大值
  for (const c of candidates) {
    let max = 0;
    for (const m of located) {
      const d = haversine(c.lat, c.lng, m.lat, m.lng);
      if (d > max) max = d;
    }
    c.maxDist = Math.round(max);
  }
  candidates.sort((a, b) => a.maxDist - b.maxDist);

  if (optimize === 'distance') {
    const top = candidates.slice(0, DISTANCE_TOP).map((c) => ({
      id: c.id,
      name: c.name,
      address: c.address,
      category: c.category,
      lat: c.lat,
      lng: c.lng,
      maxDist: c.maxDist,
      score: c.maxDist,
    }));
    return { centroid: center, candidates: top };
  }

  // commute 模式：粗筛 Top 5 后精算耗时
  const finalists = candidates.slice(0, COMMUTE_TOP);
  const results = [];
  for (const c of finalists) {
    const destination = `${c.lng},${c.lat}`;
    const durations = [];
    let estimated = false;
    for (const m of located) {
      const origin = `${m.lng},${m.lat}`;
      let dur = await amap.directionDuration({
        mode: m.travelMode || 'transit',
        origin,
        destination,
        city: c.adcode,
      });
      if (!Number.isFinite(dur)) {
        dur = fallbackDuration(haversine(c.lat, c.lng, m.lat, m.lng));
        estimated = true;
      }
      durations.push(Math.round(dur));
    }
    const maxDur = Math.max(...durations);
    const avgDur = durations.reduce((s, d) => s + d, 0) / durations.length;
    results.push({
      id: c.id,
      name: c.name,
      address: c.address,
      category: c.category,
      lat: c.lat,
      lng: c.lng,
      maxDist: c.maxDist,
      durations,
      estimated,
      score: Math.round(maxDur + 0.3 * avgDur),
    });
  }
  results.sort((a, b) => a.score - b.score);
  return { centroid: center, candidates: results };
}

module.exports = { recommend, RecommendError, POI_TYPES };
