/**
 * 内存房间存储（Store 接口）。
 * 结构上预留适配层：未来可替换为 Redis 实现（保持同名方法签名即可）。
 * 可选 JSON 文件持久化（STORE_FILE），用于重启后恢复房间。
 */
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

const TRAVEL_MODES = ['driving', 'walking', 'transit'];

function uuid() {
  return crypto.randomUUID();
}

function inviteCode() {
  // 6 位数字邀请码
  return String(crypto.randomInt(0, 1_000_000)).padStart(6, '0');
}

class MemoryStore {
  constructor({ file = '' } = {}) {
    this.rooms = new Map(); // roomId -> room 对象（含 members Map 与 votes Map）
    this.codeIndex = new Map(); // inviteCode -> roomId
    this.file = file;
    if (this.file) this._load();
  }

  /* ---------- 房间 ---------- */

  createRoom(name) {
    const room = {
      id: uuid(),
      code: inviteCode(),
      name: name || '未命名房间',
      createdAt: Date.now(),
      closed: false,
      members: new Map(), // memberId -> member
      votes: new Map(), // poiId -> Set<memberId>
    };
    this.rooms.set(room.id, room);
    this.codeIndex.set(room.code, room.id);
    this._persist();
    return room;
  }

  getRoom(roomId) {
    return this.rooms.get(roomId) || null;
  }

  getRoomByCode(code) {
    const id = this.codeIndex.get(String(code));
    return id ? this.rooms.get(id) : null;
  }

  closeRoom(roomId) {
    const room = this.getRoom(roomId);
    if (!room) return false;
    room.closed = true;
    this._persist();
    return true;
  }

  /* ---------- 成员 ---------- */

  addMember(room, { nickname, avatar = '' }) {
    const member = {
      id: uuid(),
      token: crypto.randomBytes(16).toString('hex'),
      nickname: nickname || '匿名',
      avatar,
      lat: null,
      lng: null,
      updatedAt: 0,
      travelMode: 'transit',
      online: false,
    };
    room.members.set(member.id, member);
    this._persist();
    return member;
  }

  getMember(roomId, memberId) {
    const room = this.getRoom(roomId);
    return room ? room.members.get(memberId) || null : null;
  }

  updateLocation(roomId, memberId, lat, lng) {
    const member = this.getMember(roomId, memberId);
    if (!member) return null;
    const la = Number(lat);
    const ln = Number(lng);
    if (!Number.isFinite(la) || !Number.isFinite(ln)) return null;
    member.lat = la;
    member.lng = ln;
    member.updatedAt = Date.now();
    member.online = true;
    return member;
  }

  setTravelMode(roomId, memberId, mode) {
    const member = this.getMember(roomId, memberId);
    if (!member || !TRAVEL_MODES.includes(mode)) return null;
    member.travelMode = mode;
    return member;
  }

  setOnline(roomId, memberId, online) {
    const member = this.getMember(roomId, memberId);
    if (member) member.online = online;
    return member;
  }

  removeMember(roomId, memberId) {
    const room = this.getRoom(roomId);
    if (!room) return;
    room.members.delete(memberId);
    for (const voters of room.votes.values()) voters.delete(memberId);
    this._persist();
  }

  /* ---------- 投票 ---------- */

  vote(roomId, memberId, poiId) {
    const room = this.getRoom(roomId);
    if (!room || !room.members.has(memberId)) return null;
    // 一人一票：先移除旧票
    for (const voters of room.votes.values()) voters.delete(memberId);
    if (!room.votes.has(poiId)) room.votes.set(poiId, new Set());
    room.votes.get(poiId).add(memberId);
    this._persist();
    return { poiId, votes: room.votes.get(poiId).size, voters: [...room.votes.get(poiId)] };
  }

  /* ---------- 序列化 ---------- */

  /** 输出协议友好的房间视图（不含 token） */
  static roomView(room) {
    return {
      id: room.id,
      code: room.code,
      name: room.name,
      createdAt: room.createdAt,
      closed: room.closed,
    };
  }

  static memberView(member) {
    return {
      id: member.id,
      nickname: member.nickname,
      avatar: member.avatar,
      lat: member.lat,
      lng: member.lng,
      updatedAt: member.updatedAt,
      travelMode: member.travelMode,
      online: member.online,
    };
  }

  snapshot(room) {
    return {
      room: MemoryStore.roomView(room),
      members: [...room.members.values()].map(MemoryStore.memberView),
      votes: MemoryStore.votesView(room),
    };
  }

  /** 输出投票聚合视图：poiId -> 票数 */
  static votesView(room) {
    const votes = {};
    for (const [poiId, voters] of room.votes) votes[poiId] = voters.size;
    return votes;
  }

  _persist() {
    if (!this.file) return;
    const data = [...this.rooms.values()].map((room) => ({
      ...MemoryStore.roomView(room),
      members: [...room.members.values()],
      votes: Object.fromEntries([...room.votes].map(([k, s]) => [k, [...s]])),
    }));
    try {
      fs.mkdirSync(path.dirname(this.file), { recursive: true });
      fs.writeFileSync(this.file, JSON.stringify(data));
    } catch {
      /* 持久化失败不影响运行 */
    }
  }

  _load() {
    try {
      const raw = fs.readFileSync(this.file, 'utf-8');
      const data = JSON.parse(raw);
      for (const r of data) {
        // 直接按持久化的 id/code 重建 Map，避免 createRoom 生成新 id/code 造成键错位
        const room = {
          id: r.id,
          code: r.code,
          name: r.name || '未命名房间',
          createdAt: r.createdAt || Date.now(),
          closed: Boolean(r.closed),
          members: new Map(),
          votes: new Map(),
        };
        for (const m of r.members || []) {
          m.online = false; // 重启后统一离线，待重连再置在线
          room.members.set(m.id, m);
        }
        for (const [poiId, voters] of Object.entries(r.votes || {})) {
          room.votes.set(poiId, new Set(voters || []));
        }
        this.rooms.set(room.id, room);
        this.codeIndex.set(room.code, room.id);
      }
    } catch {
      /* 首次启动或文件损坏时忽略 */
    }
  }
}

module.exports = { MemoryStore };
