/**
 * WebSocket 客户端（uni.connectSocket 封装，JSON 信封协议，见 shared/PROTOCOL.md）。
 * 支持自动重连与心跳。
 */

export class WsClient {
  constructor({ url, onEvent, onStatus }) {
    this.url = url;
    this.onEvent = onEvent || (() => {});
    this.onStatus = onStatus || (() => {});
    this.socket = null;
    this.closedByUser = false;
    this.retryCount = 0;
    this.heartbeatTimer = null;
    this.reconnectTimer = null;
  }

  connect() {
    this.closedByUser = false;
    // H5 端不传回调时 uni.connectSocket 返回 Promise，传 complete 保证三端都返回 SocketTask
    this.socket = uni.connectSocket({ url: this.url, complete: () => {} });

    this.socket.onOpen(() => {
      this.retryCount = 0;
      this.onStatus('connected');
      this._startHeartbeat();
    });

    this.socket.onMessage((res) => {
      let msg;
      try {
        msg = JSON.parse(res.data);
      } catch {
        return;
      }
      if (msg && msg.event) this.onEvent(msg.event, msg.data);
    });

    this.socket.onClose(() => {
      this._stopHeartbeat();
      this.onStatus('disconnected');
      this._scheduleReconnect();
    });

    this.socket.onError(() => {
      // 错误后一般会触发 onClose，统一在 onClose 处理重连
    });
  }

  send(event, data = {}) {
    if (!this.socket) return;
    try {
      this.socket.send({ data: JSON.stringify({ event, data }) });
    } catch {
      /* 连接异常时忽略 */
    }
  }

  close() {
    this.closedByUser = true;
    this._stopHeartbeat();
    if (this.reconnectTimer) clearTimeout(this.reconnectTimer);
    if (this.socket) {
      try {
        this.socket.close({});
      } catch {
        /* 忽略 */
      }
      this.socket = null;
    }
  }

  _startHeartbeat() {
    this._stopHeartbeat();
    this.heartbeatTimer = setInterval(() => this.send('ping'), 30000);
  }

  _stopHeartbeat() {
    if (this.heartbeatTimer) {
      clearInterval(this.heartbeatTimer);
      this.heartbeatTimer = null;
    }
  }

  _scheduleReconnect() {
    if (this.closedByUser || this.retryCount >= 10) return;
    this.retryCount += 1;
    const delay = Math.min(1000 * 2 ** this.retryCount, 15000);
    this.reconnectTimer = setTimeout(() => this.connect(), delay);
  }
}
