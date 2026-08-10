# 聚哪儿（Meetup）— 实时位置共享与集合点推荐

类似微信"共享实时位置"的应用（Web + 微信小程序）：创建/加入房间后实时共享成员位置，并基于所有人的位置智能推荐集合地点（咖啡厅、商场、地铁口等），支持投票确定最终集合点。

## 技术架构

```
meetup-app/
├── shared/                # API 协议与推荐算法规范
├── server-node/           # Node.js + Express + ws 后端（Web 端使用，端口 3000）
└── app/                   # uni-app 前端（Vue 3 + Pinia，编译 Web/H5 与微信小程序）
    ├── src/               # 前端源码（页面 / store / 网络层）
    └── cloudfunctions/    # 微信云开发云函数（小程序端后端，免域名免备案）
```

双端架构：

| 端 | 后端 | 实时性 | 说明 |
|---|---|---|---|
| Web (H5) | server-node（WebSocket） | 实时 | 本机或部署公网均可 |
| 微信小程序 | 微信云开发云函数（5s 轮询） | 准实时 | 免域名、免备案，微信生态内调用 |

核心功能：

| 功能 | 说明 |
|---|---|
| 房间制位置共享 | 6 位邀请码加入，位置 3s 节流上报（Web 端 WebSocket 广播 / 小程序端轮询快照） |
| 地图实时展示 | 地图显示全体成员位置标记与在线状态（Web 端用高德 JS API，小程序用内置腾讯地图） |
| 集合点推荐（距离版） | 计算全员地理质心 → 高德 POI 周边搜索 → 按"最远成员直线距离"排序 Top 10 |
| 集合点推荐（通勤版） | 在距离版粗筛基础上，按各成员出行方式（驾车/公交/步行）调用高德路径规划，评分 `max + 0.3 × avg` 选"最不折腾"的点 |
| 投票 | 一人一票，实时更新票数 |

## 一、申请高德 Key（仅推荐功能需要，小程序地图零 Key）

1. 注册 [高德开放平台](https://lbs.amap.com) 并完成开发者认证（个人认证免费）。
2. 进入控制台 → 应用管理 → 创建新应用。
3. 按需添加 Key：

| Key 类型 | 用途 | 配置位置 | 是否必需 |
|---|---|---|---|
| **Web服务** | 服务端 POI 搜索、路径规划（集合点推荐核心） | `server-node/.env` 的 `AMAP_WEB_KEY`；微信云函数 `app/cloudfunctions/meetup/index.js` 顶部的 `AMAP_WEB_KEY` | 要用推荐功能则必需 |
| **Web端(JS API)** | Web 页面地图底图显示 | `app/src/manifest.json` → `h5.sdkConfigs.maps.amap` | 可选（不填则 Web 端无底图，小程序不受影响） |

4. 配额说明：个人开发者 Web 服务 Key 的 POI 搜索/路径规划日配额通常为 5000 次，开发调试足够；通勤模式会消耗路径规划配额（每次推荐最多 5 候选 × N 成员），注意控制频率。服务端已内置请求间隔控制 + 限流自动重试。
5. 微信小程序的地图使用内置腾讯地图，**无需任何 Key**。

## 二、运行 Node 后端（Web 端使用）

```bash
cd server-node
npm install
copy .env.example .env   # 填入 AMAP_WEB_KEY
npm start                # http://localhost:3000
npm test                 # vitest 测试（20 项，含 20 成员 WS 负载测试）
```

> 小程序端不走这个后端（走微信云开发）；Node 后端仅服务 Web 版。

## 三、微信云开发配置（小程序端使用）

1. 到 [微信公众平台](https://mp.weixin.qq.com) 注册小程序账号，获取 AppID（个人主体免费，测试号不支持云开发）；
2. 填入 `app/src/manifest.json` → `mp-weixin.appid`；
3. 微信开发者工具打开编译产物后，点顶部「云开发」按钮开通环境（按量计费，含免费额度）；
4. 把云环境 ID 填入 `app/src/config/index.js` → `cloudEnv`；
5. 在开发者工具中右键 `cloudfunctions/meetup` → 「创建并部署：云端安装依赖」；
6. 云开发控制台 → 数据库 → 新建集合 `meetup_rooms`。

完成后小程序即运行在微信云端：**无需域名、无需备案、电脑关机也能用**。发布流程：开发者工具「上传」→ mp.weixin.qq.com 版本管理 → 设体验版（最多 15 名成员）→ 提交审核 → 发布。

## 四、运行前端（Web + 微信小程序）

```bash
cd app
npm install
npm run dev:h5         # Web 浏览器预览 http://localhost:5173
npm run dev:mp-weixin  # 微信小程序监听编译（产物 dist/dev/mp-weixin，含云函数目录）
```

- H5 端定位需浏览器授权（HTTPS 或 localhost），已内置 WGS84→GCJ02 本地转换，零 Key 可用；
- 小程序在微信开发者工具导入 `dist/dev/mp-weixin`（发布用 `npm run build:mp-weixin` 的 `dist/build/mp-weixin`）；
- 两端模式自动切换（条件编译）：小程序走云函数轮询，Web 走 Node 后端 WebSocket。

## 五、协议与算法文档

- [shared/PROTOCOL.md](shared/PROTOCOL.md)：REST + WebSocket 协议、数据模型、错误码、云函数轮询模式
- [shared/ALGORITHM.md](shared/ALGORITHM.md)：质心计算、POI 召回、评分公式、兜底策略

## 六、测试

| 模块 | 命令 | 覆盖内容 |
|---|---|---|
| server-node | `npm test` | 地理计算、推荐算法（fake 高德客户端）、房间全生命周期 REST、高德代理、WebSocket 20 成员并发广播负载（覆盖率/平均延迟/P95） |

测试使用 fake 高德客户端，无需真实 Key 即可通过。

## 七、目录结构速览

```
server-node/src/
├── index.js            # 入口（HTTP + WS）
├── app.js              # Express 工厂（依赖注入）
├── routes/rooms.js     # 房间 REST 路由
├── routes/amapProxy.js # 高德 POI / 路径规划调试代理
├── services/recommend.js # 推荐算法（核心）
├── services/geo.js     # Haversine / 质心
├── store/memory.js     # 内存存储（预留 Redis 适配接口）
├── amap/client.js      # 高德 Web API 客户端（含 QPS 限流重试）
└── ws/{hub,server}.js  # WebSocket 广播中心与连接管理

app/cloudfunctions/meetup/
└── index.js            # 微信云函数：与 server-node 同业务逻辑（云数据库存储）

app/src/
├── pages/index/        # 首页：创建/加入房间
├── pages/room/         # 房间地图页：实时位置共享
├── pages/recommend/    # 推荐页：候选点列表 + 投票
├── store/room.js       # Pinia：房间状态、WS/轮询、定位上报
├── api/{http,ws,cloud}.js # REST / WebSocket / 微信云函数适配
├── utils/geo.js        # WGS84→GCJ02 坐标转换（H5 零 Key 定位）
└── config/index.js     # 后端地址、模式与云环境配置
```

## 已知限制与后续规划

- 无账号体系（邀请码 + 昵称的轻量模式，与微信共享位置一致）；
- transit 路径规划的 `city` 参数以候选点 adcode 近似，跨城场景精度有限；
- 小程序切后台时定位暂停（微信限制），回前台自动恢复；
- 未做消息聊天、导航跳转（可后续接高德导航 URI）；
- Node 后端内存存储重启即失（可配 `STORE_FILE` JSON 持久化，生产建议 Redis）；小程序数据在云数据库持久保存。
