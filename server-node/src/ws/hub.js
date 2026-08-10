/**
 * WebSocket 连接中心：维护 roomId -> Set<ws> 的连接表，提供广播能力。
 * REST 路由（推荐、投票、关闭房间）也通过 Hub 广播事件，与 WS 层解耦。
 */

class Hub {
  constructor() {
    this.byRoom = new Map(); // roomId -> Set<ws>
  }

  join(roomId, ws) {
    if (!this.byRoom.has(roomId)) this.byRoom.set(roomId, new Set());
    this.byRoom.get(roomId).add(ws);
  }

  leave(roomId, ws) {
    const set = this.byRoom.get(roomId);
    if (!set) return;
    set.delete(ws);
    if (set.size === 0) this.byRoom.delete(roomId);
  }

  /** 向房间所有连接发送信封消息；exclude 为要排除的 ws（如发送者） */
  broadcast(roomId, event, data, { exclude } = {}) {
    const set = this.byRoom.get(roomId);
    if (!set) return;
    const payload = JSON.stringify({ event, data });
    for (const ws of set) {
      if (ws === exclude) continue;
      try {
        if (ws.readyState === 1 /* OPEN */) ws.send(payload);
      } catch {
        /* 单连接发送失败不影响整体广播 */
      }
    }
  }

}

module.exports = { Hub };
