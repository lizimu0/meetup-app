/**
 * 房间 store：管理成员、位置、连接与推荐状态。
 * 同时支持 ws 模式（Node 后端，Web 端）与 polling 模式（微信云开发云函数，小程序端）。
 */
import { defineStore } from 'pinia';
import { api } from '../api/http';
import { WsClient } from '../api/ws';
import { config, wsUrl } from '../config/index';
import { wgs84ToGcj02 } from '../utils/geo';

export const useRoomStore = defineStore('room', {
  state: () => ({
    room: null, // { id, code, name, createdAt, closed }
    memberId: '',
    token: '',
    members: [], // Member[]
    wsStatus: 'disconnected',
    myLocation: null, // { lat, lng }
    centroid: null,
    candidates: [], // PoiCandidate[]
    votes: {}, // poiId -> votes 数
    travelMode: 'transit',
    loading: false,
  }),

  getters: {
    locatedMembers: (state) =>
      state.members.filter((m) => Number.isFinite(m.lat) && Number.isFinite(m.lng)),
  },

  actions: {
    /* ---------- 房间生命周期 ---------- */

    async createRoom(name, nickname) {
      const data = await api.createRoom(name, nickname);
      this._applyJoin(data);
      this._start();
    },

    async joinRoom(code, nickname) {
      const data = await api.joinRoom(code, nickname);
      this._applyJoin(data);
      this.members = data.members || [];
      this._start();
    },

    _applyJoin(data) {
      this.room = data.room;
      this.memberId = data.memberId;
      this.token = data.token;
      this.members = [{ id: data.memberId, nickname: '我', online: true }];
    },

    /** 根据配置模式启动实时通道 */
    _start() {
      if (config.mode === 'polling') {
        this._startPolling();
      } else {
        this._connectWs();
      }
      this._startLocationReport();
    },

    leaveRoom() {
      if (this.ws) {
        this.ws.close();
        this.ws = null;
      }
      if (this.pollTimer) {
        clearInterval(this.pollTimer);
        this.pollTimer = null;
      }
      this._stopLocationReport();
      this.$reset();
    },

    /* ---------- WebSocket 模式 ---------- */

    _connectWs() {
      if (this.ws) this.ws.close();
      this.ws = new WsClient({
        url: wsUrl(this.room.id, this.memberId, this.token),
        onStatus: (status) => {
          this.wsStatus = status;
        },
        onEvent: (event, data) => this._handleWsEvent(event, data),
      });
      this.ws.connect();
    },

    _handleWsEvent(event, data) {
      switch (event) {
        case 'welcome':
          this.members = data.members || [];
          break;
        case 'location:update': {
          const m = this.members.find((x) => x.id === data.memberId);
          if (m) {
            m.lat = data.lat;
            m.lng = data.lng;
            m.updatedAt = data.ts;
            m.online = true;
          }
          break;
        }
        case 'member:join':
          if (!this.members.find((x) => x.id === data.member.id)) {
            this.members.push(data.member);
          }
          break;
        case 'member:leave':
        case 'member:offline': {
          // 断连与超时离线表现一致：标记成员离线（仍保留在房间内）
          const m = this.members.find((x) => x.id === data.memberId);
          if (m) m.online = false;
          break;
        }
        case 'recommend:result':
          this.centroid = data.centroid;
          this.candidates = data.candidates || [];
          break;
        case 'vote:update':
          this.votes[data.poiId] = data.votes;
          break;
        case 'room:closed':
          if (this.room) this.room.closed = true;
          uni.showToast({ title: '房间已关闭', icon: 'none' });
          break;
        default:
          break;
      }
    },

    /* ---------- 轮询模式（微信云开发云函数） ---------- */

    _startPolling() {
      this.pollTimer = setInterval(async () => {
        if (!this.room) return;
        try {
          const snap = await api.roomSnapshot(this.room.id);
          this.members = snap.members;
          if (snap.room.closed) this.room.closed = true;
        } catch {
          /* 轮询失败静默重试 */
        }
      }, config.pollIntervalMs);
    },

    /* ---------- 位置上报 ---------- */

    /** 获取一次定位，统一输出 GCJ02 坐标 */
    _locate(cb) {
      const fail = () => {
        // 失败 Toast 节流：30 秒内只提示一次，避免刷屏
        if (!this._lastLocateFailToast || Date.now() - this._lastLocateFailToast > 30000) {
          this._lastLocateFailToast = Date.now();
          uni.showToast({ title: '定位失败，请检查浏览器/小程序定位权限', icon: 'none' });
        }
      };
      // #ifdef H5
      // H5 端请求 gcj02 需要高德 JS API Key；改用浏览器原生 wgs84 定位 + 本地转换，零 Key 可用
      uni.getLocation({
        type: 'wgs84',
        success: (res) => {
          const g = wgs84ToGcj02(res.latitude, res.longitude);
          cb(g.lat, g.lng);
        },
        fail,
      });
      // #endif
      // #ifndef H5
      // 小程序端原生支持 gcj02，无需 Key
      uni.getLocation({
        type: 'gcj02',
        isHighAccuracy: true,
        success: (res) => cb(res.latitude, res.longitude),
        fail,
      });
      // #endif
    },

    _startLocationReport() {
      this._stopLocationReport();
      const doLocate = () => {
        this._locate((lat, lng) => {
          this.myLocation = { lat, lng };
          this._pushLocation(lat, lng);
        });
      };
      this.locationTimer = setInterval(doLocate, config.locationIntervalMs);
      // 立即上报一次
      doLocate();
    },

    _pushLocation(lat, lng) {
      if (config.mode === 'polling') {
        api.reportLocation(this.room.id, this.memberId, this.token, lat, lng).catch(() => {});
      } else if (this.ws) {
        this.ws.send('location:update', { lat, lng });
      }
      // 本地立即反映自己位置
      const m = this.members.find((x) => x.id === this.memberId);
      if (m) {
        m.lat = lat;
        m.lng = lng;
        m.online = true;
      }
    },

    _stopLocationReport() {
      if (this.locationTimer) {
        clearInterval(this.locationTimer);
        this.locationTimer = null;
      }
    },

    /* ---------- 推荐与投票 ---------- */

    async requestRecommend(optimize) {
      this.loading = true;
      try {
        const data = await api.recommend(this.room.id, this.memberId, this.token, {
          optimize,
          travelMode: this.travelMode,
        });
        this.centroid = data.centroid;
        this.candidates = data.candidates || [];
        return data;
      } finally {
        this.loading = false;
      }
    },

    async vote(poiId) {
      const data = await api.vote(this.room.id, this.memberId, this.token, poiId);
      this.votes[data.poiId] = data.votes;
      return data;
    },
  },
});
