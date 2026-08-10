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
    locationStatus: 'idle', // idle | locating | active | error
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
      this.wsStatus = 'disconnected';
      this._pollFailCount = 0;
      const poll = async () => {
        if (!this.room) return;
        try {
          const snap = await api.roomSnapshot(this.room.id);
          this.members = snap.members;
          this.wsStatus = 'connected';
          this._pollFailCount = 0;
          if (snap.room.closed) this.room.closed = true;
        } catch {
          this.wsStatus = 'disconnected';
          this._pollFailCount = (this._pollFailCount || 0) + 1;
          if (
            this._pollFailCount >= 3 &&
            (!this._lastPollFailToast || Date.now() - this._lastPollFailToast > 60000)
          ) {
            this._lastPollFailToast = Date.now();
            uni.showToast({ title: '网络不稳定，正在重试', icon: 'none' });
          }
        }
      };
      poll();
      this.pollTimer = setInterval(poll, config.pollIntervalMs);
    },

    /* ---------- 位置上报 ---------- */

    /** 获取一次定位，统一输出 GCJ02 坐标 */
    _locate(cb, notifyOnFailure = false) {
      // 重入保护：上一次定位未返回时跳过，避免授权弹窗叠加
      if (this._locating) return;
      this._locating = true;
      const finish = () => {
        this._locating = false;
      };
      const fail = () => {
        finish();
        this.locationStatus = 'error';
        // 偶发定位失败（超时/信号波动）静默忽略；连续失败 3 次且 60 秒内未提示过才提醒
        this._locateFailCount = (this._locateFailCount || 0) + 1;
        if (notifyOnFailure) {
          this._showLocationPermissionGuide();
          return;
        }
        if (
          this._locateFailCount >= 3 &&
          (!this._lastLocateFailToast || Date.now() - this._lastLocateFailToast > 60000)
        ) {
          this._lastLocateFailToast = Date.now();
          uni.showToast({ title: '定位失败，请检查浏览器/小程序定位权限', icon: 'none' });
        }
      };
      // #ifdef H5
      // H5 端请求 gcj02 需要高德 JS API Key；改用浏览器原生 wgs84 定位 + 本地转换，零 Key 可用
      uni.getLocation({
        type: 'wgs84',
        success: (res) => {
          finish();
          this._locateFailCount = 0;
          this.locationStatus = 'active';
          const g = wgs84ToGcj02(res.latitude, res.longitude);
          cb(g.lat, g.lng);
        },
        fail,
      });
      // #endif
      // #ifndef H5
      // 小程序端原生支持 gcj02，无需 Key；不开强制高精度，避免弱网/室内频繁超时误报
      uni.getLocation({
        type: 'gcj02',
        success: (res) => {
          finish();
          this._locateFailCount = 0; // 成功后重置失败计数
          this.locationStatus = 'active';
          cb(res.latitude, res.longitude);
        },
        fail,
      });
      // #endif
    },

    _showLocationPermissionGuide() {
      // 弹窗防重：引导弹窗显示期间不再重复触发
      if (this._permissionGuideShowing) return;
      this._permissionGuideShowing = true;
      const closeGuide = () => {
        this._permissionGuideShowing = false;
      };
      // #ifdef MP-WEIXIN
      uni.showModal({
        title: '需要位置权限',
        content: '请允许获取位置，才能在房间中共享位置并推荐集合点。',
        confirmText: '去设置',
        success: (res) => {
          closeGuide();
          if (res.confirm) {
            uni.openSetting({
              success: (settings) => {
                if (!settings.authSetting['scope.userLocation']) return;
                if (this.room) this._startLocationReport();
                else this.requestInitialLocation(true);
              },
            });
          }
        },
        fail: () => closeGuide(),
      });
      // #endif
      // #ifndef MP-WEIXIN
      uni.showToast({ title: '定位失败，请允许浏览器访问位置', icon: 'none' });
      closeGuide();
      // #endif
    },

    /** 首次进入应用时触发系统定位授权，但尚未加入房间时不上传位置 */
    requestInitialLocation(force = false) {
      if (this.myLocation && !force) return;
      this.locationStatus = 'locating';
      this._locate((lat, lng) => {
        this.myLocation = { lat, lng };
      }, true);
    },

    retryLocation() {
      if (this.room) this._startLocationReport();
      else this.requestInitialLocation(true);
    },

    _startLocationReport() {
      this._stopLocationReport();
      this.locationStatus = 'locating';
      this._lastLocationPushAt = 0;
      const report = (lat, lng) => {
        if (!Number.isFinite(lat) || !Number.isFinite(lng)) return;
        this.locationStatus = 'active';
        this.myLocation = { lat, lng };
        const now = Date.now();
        if (now - this._lastLocationPushAt < config.locationIntervalMs) return;
        this._lastLocationPushAt = now;
        this._pushLocation(lat, lng);
      };
      // #ifdef MP-WEIXIN
      this._locationChangeHandler = (res) => report(res.latitude, res.longitude);
      uni.onLocationChange(this._locationChangeHandler);
      uni.startLocationUpdate({
        type: 'gcj02',
        success: () => this._locate(report),
        fail: () => {
          this._stopLocationReport();
          this.locationStatus = 'error';
          this._showLocationPermissionGuide();
        },
      });
      // #endif
      // #ifndef MP-WEIXIN
      // 递归调度：上一次定位发起后再安排下一次，配合 _locate 重入保护避免请求堆积
      const loop = () => {
        this._locate(report);
        this.locationTimer = setTimeout(loop, config.locationIntervalMs);
      };
      loop();
      // #endif
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
      // #ifdef MP-WEIXIN
      if (this._locationChangeHandler) {
        uni.offLocationChange(this._locationChangeHandler);
        this._locationChangeHandler = null;
      }
      uni.stopLocationUpdate({ fail: () => {} });
      // #endif
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
