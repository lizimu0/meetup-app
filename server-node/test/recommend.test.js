/**
 * 推荐算法测试：注入 fake amap 客户端，无需真实 Key。
 */
import { describe, it, expect } from 'vitest';
import { recommend } from '../src/services/recommend';

/** 构造 fake amap：返回固定 POI，direction 耗时按固定函数返回 */
function makeFakeAmap({ pois, durationFn } = {}) {
  return {
    configured: true,
    async placeAround({ types }) {
      return (pois || []).filter((p) => p._type === types);
    },
    async directionDuration({ mode, origin, destination }) {
      if (durationFn) return durationFn({ mode, origin, destination });
      return 600;
    },
  };
}

const MEMBERS = [
  { id: 'a', lat: 31.23, lng: 121.47, travelMode: 'transit' }, // 上海人民广场附近
  { id: 'b', lat: 31.25, lng: 121.49, travelMode: 'driving' }, // 陆家嘴附近
];

// 质心约 (31.24, 121.48)
const POIS = [
  { id: 'p1', name: '咖啡馆A', address: 'addr1', adcode: '310101', location: '121.480,31.240', _type: '050500' },
  { id: 'p2', name: '商场B', address: 'addr2', adcode: '310101', location: '121.485,31.245', _type: '060100' },
  { id: 'p3', name: '地铁口C', address: 'addr3', adcode: '310101', location: '121.479,31.241', _type: '150500' },
];

describe('recommend', () => {
  it('成员少于 2 人抛出 4003', async () => {
    await expect(
      recommend({ members: [MEMBERS[0]], amap: makeFakeAmap() }),
    ).rejects.toMatchObject({ code: 4003 });
  });

  it('未配置高德 Key 抛出 5001', async () => {
    await expect(
      recommend({ members: MEMBERS, amap: { configured: false } }),
    ).rejects.toMatchObject({ code: 5001 });
  });

  it('distance 模式按 maxDist 升序返回', async () => {
    const res = await recommend({
      members: MEMBERS,
      optimize: 'distance',
      amap: makeFakeAmap({ pois: POIS }),
    });
    expect(res.centroid.lat).toBeCloseTo(31.24, 5);
    expect(res.centroid.lng).toBeCloseTo(121.48, 5);
    expect(res.candidates).toHaveLength(3);
    // p1/p3 离质心更近，p2 最远
    expect(res.candidates[0].id).not.toBe('p2');
    expect(res.candidates[2].id).toBe('p2');
    // score == maxDist
    for (const c of res.candidates) expect(c.score).toBe(c.maxDist);
  });

  it('commute 模式评分公式 = max + 0.3 * avg', async () => {
    const res = await recommend({
      members: MEMBERS,
      optimize: 'commute',
      amap: makeFakeAmap({
        pois: POIS,
        durationFn: ({ destination }) => (destination.startsWith('121.48,') ? 1000 : 500),
      }),
    });
    // 所有候选 durations 长度与成员数一致
    for (const c of res.candidates) {
      expect(c.durations).toHaveLength(2);
      const maxD = Math.max(...c.durations);
      const avgD = c.durations.reduce((s, d) => s + d, 0) / c.durations.length;
      expect(c.score).toBe(Math.round(maxD + 0.3 * avgD));
    }
    // p1 耗时 1000/1000 → score 1300 排最后；p2、p3 耗时 500/500 → score 650 在前
    expect(res.candidates[2].id).toBe('p1');
    expect(res.candidates[2].score).toBeGreaterThan(res.candidates[0].score);
  });

  it('direction 失败时使用直线距离兜底估算', async () => {
    const res = await recommend({
      members: MEMBERS,
      optimize: 'commute',
      amap: makeFakeAmap({ pois: POIS, durationFn: () => null }),
    });
    expect(res.candidates[0].estimated).toBe(true);
    expect(res.candidates[0].durations.every((d) => d > 0)).toBe(true);
  });

  it('无候选点时返回空列表', async () => {
    const res = await recommend({ members: MEMBERS, amap: makeFakeAmap({ pois: [] }) });
    expect(res.candidates).toEqual([]);
  });
});
