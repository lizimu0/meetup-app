# Meetup API 协议规范（REST + WebSocket）

三套后端（server-node / server-py / server-uni）共同遵守本协议。前端通过配置切换后端，行为必须一致。

> 说明：实时层采用**标准 WebSocket + JSON 信封**而非 Socket.IO，
> 原因：uni-app App 端 `uni.connectSocket` 对标准 WebSocket 支持最稳定，
> 且标准协议可让 Node（ws 库）与 Python（FastAPI WebSocket）实现完全等价。

## 1. 通用约定

- 所有 REST 接口前缀 `/api`，请求与响应均为 JSON（UTF-8）。
- 统一响应包裹：`{ "code": 0, "message": "ok", "data": {...} }`，`code !== 0` 表示业务错误。
- 鉴权（轻量）：加入房间后服务端返回 `memberId` + `token`；
  后续 REST 请求通过请求头 `X-Member-Id` 与 `X-Member-Token` 携带；
  WebSocket 通过连接 URL query 参数携带。
- 坐标均为 GCJ-02 坐标系（高德原生坐标系），格式 `lat`（纬度）/ `lng`（经度），浮点数。
- 时间戳 `ts` 为毫秒级 Unix 时间戳。

## 2. 数据模型

### Room

| 字段 | 类型 | 说明 |
|---|---|---|
| id | string | 房间 ID（UUID） |
| code | string | 6 位数字邀请码 |
| name | string | 房间名称 |
| createdAt | number | 创建时间（ms） |
| closed | boolean | 是否已关闭 |

### Member

| 字段 | 类型 | 说明 |
|---|---|---|
| id | string | 成员 ID（UUID） |
| nickname | string | 昵称 |
| avatar | string? | 头像 URL（可选） |
| lat / lng | number? | 最新位置（未上报时为空） |
| updatedAt | number | 最近一次位置上报时间（ms） |
| travelMode | string | 出行方式：`driving` / `walking` / `transit`，默认 `transit` |
| online | boolean | 在线状态（60 秒无位置上报或断连判定为离线） |

### PoiCandidate（推荐候选点）

| 字段 | 类型 | 说明 |
|---|---|---|
| id | string | 高德 POI id |
| name | string | 名称 |
| address | string | 地址 |
| category | string | 分类标签，如 `咖啡厅` / `购物中心` / `地铁站出入口` / `餐饮` |
| lat / lng | number | 坐标 |
| maxDist | number | 到全体成员直线距离的最大值（米） |
| durations | number[]? | commute 模式下各成员的预估通勤耗时（秒），与成员顺序一致 |
| score | number | 评分（越小越优），见 ALGORITHM.md |

## 3. REST 接口

### POST /api/rooms 创建房间

请求体：`{ "name": "周六聚餐", "nickname": "小明", "avatar": "" }`
响应 data：`{ "room": Room, "memberId": "...", "token": "..." }`
（创建者自动加入房间成为第一个成员）

### POST /api/rooms/join 加入房间

请求体：`{ "code": "123456", "nickname": "小红" }`
响应 data：`{ "room": Room, "members": Member[], "memberId": "...", "token": "..." }`
错误码：`4001` 邀请码不存在、`4002` 房间已关闭。

### GET /api/rooms/{roomId} 房间快照

请求头：`X-Member-Id`、`X-Member-Token`（快照含全体成员实时位置，必须鉴权）
响应 data：`{ "room": Room, "members": Member[] }`
（用于断线恢复与 uniCloud 轮询模式；云函数 snapshot action 同样要求 `memberId`/`token` 参数）

### POST /api/rooms/{roomId}/recommend 请求集合点推荐

请求头：`X-Member-Id`、`X-Member-Token`
请求体：`{ "optimize": "distance" | "commute", "radius": 2000 }`
响应 data：`{ "centroid": {lat,lng}, "candidates": PoiCandidate[] }`
同时服务端会通过 WebSocket 向全房间广播 `recommend:result` 事件。

### POST /api/rooms/{roomId}/vote 投票

请求头同上。请求体：`{ "poiId": "..." }`
响应 data：`{ "poiId": "...", "votes": number, "voters": string[] }`
同时广播 `vote:update` 事件。

### POST /api/rooms/{roomId}/close 关闭房间

请求头同上（仅首个成员可关闭）。广播 `room:closed` 后拒绝新请求。

### GET /api/poi/search 高德 POI 代理（调试用）

请求头：`X-Room-Id`、`X-Member-Id`、`X-Member-Token`（房间成员凭证）
query：`keywords`、`location=lng,lat`、`radius`、`types`
透传高德 `v5/place/around` / `v5/place/text`，隐藏服务端 Web Key。
无凭证返回 `401/4003`；按 IP 限流（60 次/分钟）超出返回 `429/4029`。

### GET /api/direction 高德路径规划代理（调试用）

请求头：同 `/api/poi/search`
query：`mode=driving|walking|transit`、`origin=lng,lat`、`destination=lng,lat`、`city`
响应 data：`{ "duration": 秒数或 null }`，同样隐藏服务端 Web Key。

### GET /health 健康检查

响应 data：`{ "ok": true, "backend": "node" | "python" | "unicloud" }`

## 4. WebSocket 协议

### 连接

```
ws://{host}/ws?roomId={roomId}&memberId={memberId}&token={token}
```

鉴权失败直接断开（close code 4001/4003）。连接成功后服务端立即发送房间快照：

```json
{ "event": "welcome", "data": { "room": Room, "members": Member[] } }
```

### 消息信封

所有消息为单层 JSON：`{ "event": "<事件名>", "data": {...} }`。

### 客户端 → 服务端

| 事件 | data | 说明 |
|---|---|---|
| `location:update` | `{ lat, lng }` | 上报位置，客户端节流 3s 一次；服务端补充 `ts` 后广播 |
| `ping` | `{}` | 心跳，服务端回 `pong`（30s 一次） |
| `vote` | `{ poiId }` | 投票（与 REST 投票等价，二选一即可） |

### 服务端 → 客户端

| 事件 | data | 说明 |
|---|---|---|
| `welcome` | 房间快照 | 连接成功时 |
| `member:join` | `{ member }` | 新成员加入 |
| `member:leave` | `{ memberId }` | 成员主动退出/断连 |
| `member:offline` | `{ memberId }` | 60s 无位置上报，标记离线（仍在房间内） |
| `location:update` | `{ memberId, lat, lng, ts }` | 广播全员位置（含发送者，前端自行过滤） |
| `recommend:result` | `{ centroid, candidates, optimize }` | 推荐结果广播 |
| `vote:update` | `{ poiId, votes, voters }` | 投票结果广播 |
| `room:closed` | `{}` | 房间关闭 |
| `pong` | `{}` | 心跳响应 |

### 离线判定

服务端每 10s 扫描一次：`now - member.updatedAt > 60000` 且当前在线 → 标记离线并广播 `member:offline`。

## 5. 微信云开发轮询模式（小程序端）

云函数无法维持长连接，小程序端（`config.mode = 'polling'`，条件编译仅 MP-WEIXIN 生效）：
- 所有调用走 `wx.cloud.callFunction({ name: 'meetup', data: { action, ...params } })`；
- action 与 REST 路由一一对应：`create` / `join` / `snapshot` / `location` / `recommend` / `vote` / `close`；
- 位置上报 3s 节流不变，前端每 5s 调 `snapshot` 拉取成员快照；
- 在线状态按"60s 内有位置上报"计算；
- 返回结构与 REST 一致：`{ code, message, data }`。
