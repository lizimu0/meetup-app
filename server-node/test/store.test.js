/**
 * MemoryStore 单元测试：位置上报校验与 JSON 文件持久化往返。
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { MemoryStore } from '../src/store/memory';

let tmpDir;
let file;

beforeEach(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'meetup-store-'));
  file = path.join(tmpDir, 'store.json');
});

afterEach(() => {
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

describe('MemoryStore.updateLocation', () => {
  it('非法 lat/lng 返回 null 且不修改成员', () => {
    const store = new MemoryStore();
    const room = store.createRoom('测试');
    const member = store.addMember(room, { nickname: '小明' });

    expect(store.updateLocation(room.id, member.id, 'abc', 121.47)).toBeNull();
    expect(store.updateLocation(room.id, member.id, 31.23, undefined)).toBeNull();
    expect(member.lat).toBeNull();
    expect(member.lng).toBeNull();
  });

  it('合法位置正常写入', () => {
    const store = new MemoryStore();
    const room = store.createRoom('测试');
    const member = store.addMember(room, { nickname: '小明' });
    const updated = store.updateLocation(room.id, member.id, 31.23, 121.47);
    expect(updated.lat).toBe(31.23);
    expect(updated.lng).toBe(121.47);
    expect(updated.online).toBe(true);
  });
});

describe('MemoryStore 持久化往返', () => {
  it('重启后按原 id/code 恢复房间、成员与投票', () => {
    const store = new MemoryStore({ file });
    const room = store.createRoom('聚餐');
    const m1 = store.addMember(room, { nickname: '小明' });
    const m2 = store.addMember(room, { nickname: '小红' });
    store.updateLocation(room.id, m1.id, 31.23, 121.47);
    store.vote(room.id, m1.id, 'p1');
    store.vote(room.id, m2.id, 'p1');

    // 用同一文件重建，模拟进程重启
    const restored = new MemoryStore({ file });
    const r = restored.getRoom(room.id);
    expect(r).toBeTruthy();
    expect(r.code).toBe(room.code);
    expect(r.members.size).toBe(2);
    expect(r.members.get(m1.id).nickname).toBe('小明');
    expect(r.members.get(m1.id).lat).toBe(31.23);
    expect(r.members.get(m1.id).online).toBe(false); // 重启后统一离线
    // 邀请码索引可用
    expect(restored.getRoomByCode(room.code).id).toBe(room.id);
    // 投票聚合正确
    expect(MemoryStore.votesView(r)).toEqual({ p1: 2 });
  });

  it('文件损坏时静默忽略，不抛异常', () => {
    fs.writeFileSync(file, '{ not valid json', 'utf-8');
    const store = new MemoryStore({ file });
    expect(store.rooms.size).toBe(0);
  });
});
