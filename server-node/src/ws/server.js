/**
 * WebSocket 服务（标准 ws 库，JSON 信封协议，见 shared/PROTOCOL.md）。
 * 连接地址：/ws?roomId=&memberId=&token=
 */
const { WebSocketServer } = require('ws');

function send(ws, event, data) {
  try {
    if (ws.readyState === 1) ws.send(JSON.stringify({ event, data }));
  } catch {
    /* 忽略已关闭连接 */
  }
}

/**
 * @param {import('http').Server} server
 * @param {object} deps { store, hub, config }
 */
function setupWebSocket(server, { store, hub, config }) {
  const wss = new WebSocketServer({ server, path: '/ws' });

  wss.on('connection', (ws, req) => {
    const url = new URL(req.url, 'http://localhost');
    const roomId = url.searchParams.get('roomId');
    const memberId = url.searchParams.get('memberId');
    const token = url.searchParams.get('token');

    const room = store.getRoom(roomId);
    const member = room ? store.getMember(roomId, memberId) : null;

    if (!room || room.closed) return ws.close(4001, '房间不存在或已关闭');
    if (!member || member.token !== token) return ws.close(4003, '鉴权失败');

    ws.roomId = roomId;
    ws.memberId = memberId;
    hub.join(roomId, ws);
    store.setOnline(roomId, memberId, true);

    // 连接成功立即下发房间快照
    send(ws, 'welcome', store.snapshot(room));

    ws.on('message', (raw) => {
      let msg;
      try {
        msg = JSON.parse(raw.toString());
      } catch {
        return;
      }
      const { event, data } = msg || {};
      if (event === 'ping') {
        return send(ws, 'pong', {});
      }
      if (event === 'location:update') {
        const lat = Number(data && data.lat);
        const lng = Number(data && data.lng);
        if (!Number.isFinite(lat) || !Number.isFinite(lng)) return;
        const cur = store.getMember(roomId, memberId);
        // 服务端节流兜底：小于 minLocationIntervalMs 的重复上报忽略
        if (cur && Date.now() - cur.updatedAt < config.minLocationIntervalMs && cur.updatedAt > 0) {
          return;
        }
        const updated = store.updateLocation(roomId, memberId, lat, lng);
        if (updated) {
          hub.broadcast(roomId, 'location:update', {
            memberId,
            lat: updated.lat,
            lng: updated.lng,
            ts: updated.updatedAt,
          });
        }
        return;
      }
      if (event === 'vote') {
        const poiId = data && data.poiId;
        if (!poiId) return;
        const result = store.vote(roomId, memberId, String(poiId));
        if (result) hub.broadcast(roomId, 'vote:update', result);
      }
    });

    ws.on('close', () => {
      hub.leave(roomId, ws);
      // 该成员无其他连接时标记离线
      const stillConnected = [...(hub.byRoom.get(roomId) || [])].some(
        (w) => w.memberId === memberId,
      );
      if (!stillConnected) {
        store.setOnline(roomId, memberId, false);
        hub.broadcast(roomId, 'member:leave', { memberId });
      }
    });
  });

  // 离线扫描：60s 无位置上报的在线成员标记离线
  const scanner = setInterval(() => {
    const now = Date.now();
    for (const room of store.rooms.values()) {
      if (room.closed) continue;
      for (const member of room.members.values()) {
        if (
          member.online &&
          member.updatedAt > 0 &&
          now - member.updatedAt > config.offlineThresholdMs
        ) {
          member.online = false;
          hub.broadcast(room.id, 'member:offline', { memberId: member.id });
        }
      }
    }
  }, config.offlineScanIntervalMs);
  scanner.unref();

  return wss;
}

module.exports = { setupWebSocket };
