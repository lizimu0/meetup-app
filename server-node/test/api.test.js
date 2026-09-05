/**
 * API 集成测试：房间生命周期 + 推荐/投票（注入 fake amap）。
 */
import { describe, it, expect } from 'vitest';
import request from 'supertest';
import { createApp } from '../src/app';
import { MemoryStore } from '../src/store/memory';
import { Hub } from '../src/ws/hub';

function makeFakeAmap() {
  return {
    configured: true,
    async placeAround() {
      return [
        { id: 'p1', name: '咖啡馆A', address: 'addr', adcode: '310101', location: '121.480,31.240' },
      ];
    },
    async directionDuration() {
      return 600;
    },
  };
}
function makeApp() {
  const store = new MemoryStore();
  const hub = new Hub();
  const app = createApp({ store, hub, amap: makeFakeAmap() });
  return { app, store };
}

describe('rooms API', () => {
  it('创建房间 → 返回邀请码与凭证', async () => {
    const { app } = makeApp();
    const res = await request(app)
      .post('/api/rooms')
      .send({ name: '测试房间', nickname: '小明' });
    expect(res.status).toBe(200);
    expect(res.body.code).toBe(0);
    expect(res.body.data.room.code).toMatch(/^\d{6}$/);
    expect(res.body.data.memberId).toBeTruthy();
    expect(res.body.data.token).toBeTruthy();
  });

  it('超长房间名与昵称被截断(广播字段防滥用)', async () => {
    const { app } = makeApp();
    const res = await request(app)
      .post('/api/rooms')
      .send({ name: 'x'.repeat(200), nickname: 'n'.repeat(100) });
    expect(res.body.data.room.name).toHaveLength(50);
    const join = await request(app)
      .post('/api/rooms/join')
      .send({ code: res.body.data.room.code, nickname: 'm'.repeat(100) });
    const joined = join.body.data.members.find((m) => m.nickname.startsWith('m'));
    expect(joined.nickname).toHaveLength(20);
  });

  it('邀请码加入 → 快照包含两名成员', async () => {
    const { app } = makeApp();
    const created = await request(app).post('/api/rooms').send({ nickname: '小明' });
    const { code } = created.body.data.room;
    const roomId = created.body.data.room.id;
    const m1 = { id: created.body.data.memberId, token: created.body.data.token };

    const joined = await request(app)
      .post('/api/rooms/join')
      .send({ code, nickname: '小红' });
    expect(joined.body.code).toBe(0);
    expect(joined.body.data.members).toHaveLength(2);

    const snap = await request(app)
      .get(`/api/rooms/${roomId}`)
      .set('X-Member-Id', m1.id)
      .set('X-Member-Token', m1.token);
    expect(snap.body.data.members).toHaveLength(2);
  });

  it('快照接口无成员凭证返回 401(位置隐私)', async () => {
    const { app } = makeApp();
    const created = await request(app).post('/api/rooms').send({ nickname: '小明' });
    const roomId = created.body.data.room.id;

    const res = await request(app).get(`/api/rooms/${roomId}`);
    expect(res.status).toBe(401);
    expect(res.body.code).toBe(4003);
  });

  it('快照接口伪造 token 返回 401', async () => {
    const { app } = makeApp();
    const created = await request(app).post('/api/rooms').send({ nickname: '小明' });
    const roomId = created.body.data.room.id;

    const res = await request(app)
      .get(`/api/rooms/${roomId}`)
      .set('X-Member-Id', created.body.data.memberId)
      .set('X-Member-Token', 'forged-token');
    expect(res.status).toBe(401);
  });

  it('join 连续失败超过限流阈值返回 429(防邀请码穷举)', async () => {
    const { app } = makeApp();
    let last;
    for (let i = 0; i < 12; i++) {
      last = await request(app).post('/api/rooms/join').send({ code: '000000' });
    }
    expect(last.status).toBe(429);
    expect(last.body.code).toBe(4029);
  });

  it('错误邀请码返回 4001', async () => {
    const { app } = makeApp();
    const res = await request(app).post('/api/rooms/join').send({ code: '000000' });
    expect(res.status).toBe(404);
    expect(res.body.code).toBe(4001);
  });

  it('加入房间响应携带已有投票', async () => {
    const { app } = makeApp();
    const created = await request(app).post('/api/rooms').send({ nickname: '小明' });
    const roomId = created.body.data.room.id;
    const m1 = { id: created.body.data.memberId, token: created.body.data.token };

    await request(app)
      .post(`/api/rooms/${roomId}/vote`)
      .set('X-Member-Id', m1.id)
      .set('X-Member-Token', m1.token)
      .send({ poiId: 'p1' });

    const joined = await request(app)
      .post('/api/rooms/join')
      .send({ code: created.body.data.room.code, nickname: '小红' });
    expect(joined.body.data.votes).toEqual({ p1: 1 });
  });

  it('位置上报 + 推荐 + 投票完整流程', async () => {
    const { app } = makeApp();
    const c1 = await request(app).post('/api/rooms').send({ nickname: '小明' });
    const roomId = c1.body.data.room.id;
    const { code } = c1.body.data.room;
    const m1 = { id: c1.body.data.memberId, token: c1.body.data.token };

    const c2 = await request(app).post('/api/rooms/join').send({ code, nickname: '小红' });
    const m2 = { id: c2.body.data.memberId, token: c2.body.data.token };

    // 两人上报位置
    await request(app)
      .post(`/api/rooms/${roomId}/location`)
      .set('X-Member-Id', m1.id)
      .set('X-Member-Token', m1.token)
      .send({ lat: 31.23, lng: 121.47 });
    await request(app)
      .post(`/api/rooms/${roomId}/location`)
      .set('X-Member-Id', m2.id)
      .set('X-Member-Token', m2.token)
      .send({ lat: 31.25, lng: 121.49 });

    // 推荐（携带出行方式）
    const rec = await request(app)
      .post(`/api/rooms/${roomId}/recommend`)
      .set('X-Member-Id', m1.id)
      .set('X-Member-Token', m1.token)
      .send({ optimize: 'distance', travelMode: 'transit' });
    expect(rec.body.code).toBe(0);
    expect(rec.body.data.candidates.length).toBeGreaterThan(0);
    expect(rec.body.data.centroid.lat).toBeCloseTo(31.24, 5);

    // 投票
    const poiId = rec.body.data.candidates[0].id;
    const vote = await request(app)
      .post(`/api/rooms/${roomId}/vote`)
      .set('X-Member-Id', m2.id)
      .set('X-Member-Token', m2.token)
      .send({ poiId });
    expect(vote.body.data.votes).toBe(1);

    // 关闭房间（房主）
    const close = await request(app)
      .post(`/api/rooms/${roomId}/close`)
      .set('X-Member-Id', m1.id)
      .set('X-Member-Token', m1.token);
    expect(close.body.code).toBe(0);

    // 关闭后无法加入
    const afterClose = await request(app)
      .post('/api/rooms/join')
      .send({ code, nickname: '小刚' });
    expect(afterClose.body.code).toBe(4002);
  });

  it('人数不足时推荐返回 4003', async () => {
    const { app } = makeApp();
    const c1 = await request(app).post('/api/rooms').send({ nickname: '小明' });
    const roomId = c1.body.data.room.id;
    const m1 = { id: c1.body.data.memberId, token: c1.body.data.token };
    await request(app)
      .post(`/api/rooms/${roomId}/location`)
      .set('X-Member-Id', m1.id)
      .set('X-Member-Token', m1.token)
      .send({ lat: 31.23, lng: 121.47 });
    const rec = await request(app)
      .post(`/api/rooms/${roomId}/recommend`)
      .set('X-Member-Id', m1.id)
      .set('X-Member-Token', m1.token)
      .send({});
    expect(rec.body.code).toBe(4003);
  });

  it('health 接口', async () => {
    const { app } = makeApp();
    const res = await request(app).get('/health');
    expect(res.body.data.backend).toBe('node');
  });

  it('direction 代理接口返回耗时(携带成员凭证)', async () => {
    const { app } = makeApp();
    const created = await request(app).post('/api/rooms').send({ nickname: '小明' });
    const roomData = created.body.data;
    const res = await request(app)
      .get('/api/direction')
      .set('X-Room-Id', roomData.room.id)
      .set('X-Member-Id', roomData.memberId)
      .set('X-Member-Token', roomData.token)
      .query({ mode: 'walking', origin: '121.47,31.23', destination: '121.48,31.24' });
    expect(res.body.code).toBe(0);
    expect(res.body.data.duration).toBe(600);
  });

  it('direction 代理无凭证返回 401(防止配额盗刷)', async () => {
    const { app } = makeApp();
    const res = await request(app)
      .get('/api/direction')
      .query({ mode: 'walking', origin: '121.47,31.23', destination: '121.48,31.24' });
    expect(res.status).toBe(401);
    expect(res.body.code).toBe(4003);
  });

  it('direction 代理参数校验', async () => {
    const { app } = makeApp();
    const created = await request(app).post('/api/rooms').send({ nickname: '小明' });
    const roomData = created.body.data;
    const res = await request(app)
      .get('/api/direction')
      .set('X-Room-Id', roomData.room.id)
      .set('X-Member-Id', roomData.memberId)
      .set('X-Member-Token', roomData.token)
      .query({ mode: 'flying' });
    expect(res.status).toBe(400);
    expect(res.body.code).toBe(4000);
  });
});
