/**
 * 高德 Web 服务 API 客户端。
 * 服务端统一代理，Web Key 不暴露给前端。
 */

class AmapError extends Error {
  constructor(message, info) {
    super(message);
    this.name = 'AmapError';
    this.info = info;
  }
}

class AmapClient {
  constructor({ key, baseUrl = 'https://restapi.amap.com' }) {
    this.key = key;
    this.baseUrl = baseUrl.replace(/\/$/, '');
    this._lastRequestAt = 0; // 限流：记录上次请求时间
  }

  /** 个人免费 Key QPS 有限（约 3 次/秒）：请求间强制间隔，命中 CUQPS 限制时自动重试 */
  async _throttledGet(pathname, params, retries = 3) {
    const MIN_INTERVAL_MS = 350;
    for (let attempt = 0; attempt <= retries; attempt++) {
      const wait = this._lastRequestAt + MIN_INTERVAL_MS - Date.now();
      if (wait > 0) await new Promise((r) => setTimeout(r, wait));
      this._lastRequestAt = Date.now();
      try {
        return await this._get(pathname, params);
      } catch (err) {
        const qpsLimited = err instanceof AmapError && String(err.info).includes('CUQPS');
        if (qpsLimited && attempt < retries) {
          await new Promise((r) => setTimeout(r, 600 * (attempt + 1))); // 退避重试
          continue;
        }
        throw err;
      }
    }
  }

  get configured() {
    return Boolean(this.key);
  }

  async _get(pathname, params) {
    const url = new URL(this.baseUrl + pathname);
    url.searchParams.set('key', this.key);
    for (const [k, v] of Object.entries(params)) {
      if (v !== undefined && v !== null && v !== '') url.searchParams.set(k, String(v));
    }
    const res = await fetch(url, { headers: { Accept: 'application/json' } });
    if (!res.ok) throw new AmapError(`高德接口 HTTP ${res.status}`);
    const body = await res.json();
    // v5 接口状态码：status '1' 成功；'0' 失败（info 给出原因）
    if (String(body.status) !== '1') {
      throw new AmapError(`高德接口错误: ${body.info || '未知'}`, body.info);
    }
    return body;
  }

  /**
   * 周边搜索 POI（v5/place/around）
   * @param {object} opts { location: 'lng,lat', radius, types, pageSize }
   */
  async placeAround({ location, radius = 2000, types = '', pageSize = 20 }) {
    const body = await this._throttledGet('/v5/place/around', {
      location,
      radius,
      types,
      page_size: pageSize,
      show_fields: 'business',
    });
    return body.pois || [];
  }

  /** 关键字搜索 POI（v5/place/text，供 /api/poi/search 调试代理） */
  async placeText({ keywords, region, types = '', pageSize = 20 }) {
    const body = await this._throttledGet('/v5/place/text', {
      keywords,
      region,
      types,
      page_size: pageSize,
    });
    return body.pois || [];
  }

  /**
   * 路径规划耗时（秒）。mode: driving | walking | transit。
   * origin/destination 格式 'lng,lat'。失败返回 null（由调用方兜底估算）。
   */
  async directionDuration({ mode, origin, destination, city }) {
    try {
      if (mode === 'transit') {
        const body = await this._throttledGet('/v5/direction/transit/integrated', {
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
      const body = await this._throttledGet(pathname, {
        origin,
        destination,
        show_fields: 'cost',
      });
      const p = body.route && body.route.paths && body.route.paths[0];
      return p && p.cost && p.cost.duration ? Number(p.cost.duration) : null;
    } catch {
      return null;
    }
  }
}

module.exports = { AmapClient, AmapError };
