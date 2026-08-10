import { describe, it, expect } from 'vitest';
import { haversine, centroid } from '../src/services/geo';

describe('haversine', () => {
  it('北京(39.9042,116.4074) 到 上海(31.2304,121.4737) 约 1067km', () => {
    const d = haversine(39.9042, 116.4074, 31.2304, 121.4737);
    expect(d).toBeGreaterThan(1_050_000);
    expect(d).toBeLessThan(1_090_000);
  });

  it('相同点距离为 0', () => {
    expect(haversine(31.23, 121.47, 31.23, 121.47)).toBe(0);
  });
});

describe('centroid', () => {
  it('两点的质心为中点', () => {
    const c = centroid([
      { lat: 30, lng: 120 },
      { lat: 32, lng: 122 },
    ]);
    expect(c.lat).toBeCloseTo(31, 10);
    expect(c.lng).toBeCloseTo(121, 10);
  });

  it('支持加权', () => {
    const c = centroid([
      { lat: 30, lng: 120, weight: 3 },
      { lat: 34, lng: 124, weight: 1 },
    ]);
    expect(c.lat).toBeCloseTo(31, 10);
    expect(c.lng).toBeCloseTo(121, 10);
  });

  it('空输入返回 null', () => {
    expect(centroid([])).toBeNull();
    expect(centroid([{ lat: null, lng: null }])).toBeNull();
  });
});
