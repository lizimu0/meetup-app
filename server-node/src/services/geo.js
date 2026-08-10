/**
 * 地理计算工具：Haversine 距离与加权质心。
 * 规范见 shared/ALGORITHM.md，Python 版（server-py/app/geo.py）需保持一致。
 */

const EARTH_RADIUS = 6371000; // 米

function toRad(deg) {
  return (deg * Math.PI) / 180;
}

/** Haversine 球面距离（米） */
function haversine(lat1, lng1, lat2, lng2) {
  const dLat = toRad(lat2 - lat1);
  const dLng = toRad(lng2 - lng1);
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLng / 2) ** 2;
  return 2 * EARTH_RADIUS * Math.asin(Math.sqrt(a));
}

/**
 * 加权质心。points: [{ lat, lng, weight? }]，weight 缺省为 1。
 * 返回 { lat, lng }；空输入返回 null。
 */
function centroid(points) {
  const valid = points.filter((p) => Number.isFinite(p.lat) && Number.isFinite(p.lng));
  if (valid.length === 0) return null;
  let latSum = 0;
  let lngSum = 0;
  let wSum = 0;
  for (const p of valid) {
    const w = Number.isFinite(p.weight) ? p.weight : 1;
    latSum += p.lat * w;
    lngSum += p.lng * w;
    wSum += w;
  }
  return { lat: latSum / wSum, lng: lngSum / wSum };
}

module.exports = { haversine, centroid };
