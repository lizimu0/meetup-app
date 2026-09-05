/**
 * 简单固定窗口 IP 限流（无外部依赖）。
 * 返回 limited(ip) => bool：true 表示超出阈值应拒绝。
 */
function createRateLimiter({ windowMs, max }) {
  const hits = new Map(); // ip -> { windowStart, count }
  const sweep = setInterval(() => {
    const now = Date.now();
    for (const [ip, h] of hits) {
      if (now - h.windowStart >= windowMs) hits.delete(ip);
    }
  }, windowMs);
  // 避免 sweep 定时器阻止进程退出（单测中频繁建 app 时尤其重要）
  sweep.unref?.();
  return function limited(ip) {
    const now = Date.now();
    let h = hits.get(ip);
    if (!h || now - h.windowStart >= windowMs) {
      h = { windowStart: now, count: 0 };
      hits.set(ip, h);
    }
    h.count += 1;
    return h.count > max;
  };
}

module.exports = { createRateLimiter };
