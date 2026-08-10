/**
 * WebSocket 负载测试（Spec 测试计划）：
 * 模拟 20 个成员同时连接并上报位置，验证广播覆盖率与延迟。
 *
 * 使用真实 HTTP 服务器（随机端口）与 ws 客户端，非 mock。
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import http from 'node:http';
import WebSocket from 'ws';
import { createApp } from '../src/app';
import { MemoryStore } from '../src/store/memory';
import { Hub } from '../src/ws/hub';
import { setupWebSocket } from '../src/ws/server';

const MEMBER_COUNT = 20;
const REPORTS_PER_MEMBER = 5;

const config = {
  offlineThresholdMs: 60_000,
  offlineScanIntervalMs: 600_000, // 测试期间不触发离线扫描
  minLocationIntervalMs: 0, // 负载测试不做服务端节流
};

let server;
let baseUrl;
let wsBase;

beforeAll(async () => {
  const store = new MemoryStore();
  const hub = new Hub();
  const app = createApp({ store, hub, amap: { configured: false } });
  server = http.createServer(app);
  setupWebSocket(server, { store, hub, config });
  await new Promise((resolve) => server.listen(0, resolve));
  const { port } = server.address();
  baseUrl = `http://127.0.0.1:${port}`;
  wsBase = `ws://127.0.0.1:${port}`;
});

afterAll(async () => {
  await new Promise((resolve) => server.close(resolve));
});

async function postJson(path, body, headers = {}) {
  const res = await fetch(baseUrl + path, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...headers },
    body: JSON.stringify(body),
  });
  return res.json();
}

function connectWs(roomId, memberId, token) {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(`${wsBase}/ws?roomId=${roomId}&memberId=${memberId}&token=${token}`);
    const client = {
      ws,
      received: [], // { memberId, latencyMs }
      opened: new Promise((res) => ws.once('open', res)),
    };
    ws.on('message', (raw) => {
      const msg = JSON.parse(raw.toString());
      if (msg.event === 'location:update') {
        client.received.push({
          memberId: msg.data.memberId,
          latencyMs: Date.now() - msg.data.ts,
        });
      }
    });
    ws.on('open', () => resolve(client));
    ws.on('error', reject);
  });
}

describe('WebSocket 广播负载（20 成员）', () => {
  it(
    '20 成员并发上报位置：广播覆盖率与延迟达标',
    async () => {
      // 1. 创建房间 + 19 人加入
      const created = await postJson('/api/rooms', { name: '负载房间', nickname: 'm0' });
      const roomId = created.data.room.id;
      const members = [{ id: created.data.memberId, token: created.data.token }];
      for (let i = 1; i < MEMBER_COUNT; i++) {
        const joined = await postJson('/api/rooms/join', {
          code: created.data.room.code,
          nickname: `m${i}`,
        });
        members.push({ id: joined.data.memberId, token: joined.data.token });
      }
      expect(members).toHaveLength(MEMBER_COUNT);

      // 2. 20 个 WS 客户端连接
      const clients = [];
      for (const m of members) {
        clients.push(await connectWs(roomId, m.id, m.token));
      }
      await Promise.all(clients.map((c) => c.opened));

      // 3. 每人上报 5 次位置（错峰 30ms 启动，模拟真实并发）
      const startedAt = Date.now();
      members.forEach((m, idx) => {
        const client = clients[idx];
        for (let r = 0; r < REPORTS_PER_MEMBER; r++) {
          setTimeout(() => {
            client.ws.send(
              JSON.stringify({
                event: 'location:update',
                data: { lat: 31.23 + idx * 0.001 + r * 0.0001, lng: 121.47 + idx * 0.001 },
              }),
            );
          }, idx * 30 + r * 80);
        }
      });

      // 4. 等待广播收敛：每个客户端应收 (N-1)*R 条他人位置（含自己则 N*R）
      const totalReports = MEMBER_COUNT * REPORTS_PER_MEMBER;
      const expectedPerClient = totalReports; // 广播含发送者
      const deadline = Date.now() + 8000;
      while (Date.now() < deadline) {
        if (clients.every((c) => c.received.length >= expectedPerClient)) break;
        await new Promise((res) => setTimeout(res, 100));
      }

      // 5. 统计覆盖率与延迟
      const latencies = [];
      let totalReceived = 0;
      for (const c of clients) {
        totalReceived += c.received.length;
        for (const r of c.received) latencies.push(r.latencyMs);
      }
      const expectedTotal = expectedPerClient * MEMBER_COUNT;
      const coverage = totalReceived / expectedTotal;
      latencies.sort((a, b) => a - b);
      const avg = latencies.reduce((s, v) => s + v, 0) / latencies.length;
      const p95 = latencies[Math.floor(latencies.length * 0.95)];
      const elapsed = Date.now() - startedAt;

      console.log(
        `[load] 20成员×5次上报: 覆盖率=${(coverage * 100).toFixed(1)}% ` +
          `(收到 ${totalReceived}/${expectedTotal}), 平均延迟=${avg.toFixed(1)}ms, ` +
          `P95=${p95}ms, 总耗时=${elapsed}ms`,
      );

      expect(coverage).toBeGreaterThanOrEqual(0.95);
      expect(avg).toBeLessThan(500);
      expect(p95).toBeLessThan(1500);

      // 6. 清理连接
      for (const c of clients) c.ws.close();
    },
    30_000,
  );
});
