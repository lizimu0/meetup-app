# 集合点推荐算法规范

Node 与 Python 后端必须按本规范实现，保证相同输入产出相同排序。

## 输入

- `members`：房间内已上报位置的成员列表（`lat`、`lng`、`travelMode`）。少于 2 人时返回错误码 `4003`（人数不足）。
- `optimize`：`distance`（基础方案）或 `commute`（通勤时间优化）。
- `radius`：POI 搜索半径，默认 2000 米。

## 步骤

### 1. 计算集合中心点（加权质心）

对所有有位置成员的坐标求加权平均：

```
centroid.lat = Σ(lat_i * w_i) / Σ(w_i)
centroid.lng = Σ(lng_i * w_i) / Σ(w_i)
```

权重 `w_i` 当前版本恒为 1（保留接口，便于后续按成员重要性加权）。
质心即为高德 POI 搜索的中心。

### 2. 候选点召回（高德 v5/place/around）

以质心为中心、`radius` 为半径，按以下顺序依次搜索，每类取最多 20 条，按 POI id 去重后合并：

| 顺序 | 分类 | 高德 type code |
|---|---|---|
| 1 | 咖啡厅 | `050500` |
| 2 | 购物中心 | `060100` |
| 3 | 地铁站出入口 | `150500` |
| 4 | 餐饮 | `050000` |

### 3. 直线距离评分（两种模式都做）

对每个候选点 p，用 Haversine 公式计算到每个成员的直线距离：

```
maxDist(p) = max( haversine(p, member_i) )
```

按 `maxDist` 升序排序：
- `distance` 模式：直接返回 Top 10，`score = maxDist`；
- `commute` 模式：取 Top 5 进入耗时精算（控制高德 API QPS）。

### 4. 通勤耗时精算（仅 commute 模式）

对 Top 5 中的每个候选点，对每个成员按其 `travelMode` 调用高德路径规划：

| travelMode | 高德接口 | 耗时字段 |
|---|---|---|
| driving | `/v5/direction/driving` | `route.paths[0].cost.duration` |
| walking | `/v5/direction/walking` | `route.paths[0].cost.duration` |
| transit | `/v5/direction/transit/integrated` | `route.cost.duration` |

`origin` / `destination` 格式均为 `lng,lat`。
`transit` 接口的 `city1` / `city2` 参数近似取候选点 POI 的 `adcode`（跨城场景精度有限，属已知限制）。

评分公式（秒）：

```
score(p) = max(各成员耗时) + 0.3 × avg(各成员耗时)
```

含义：优先压缩最差体验（最远成员），同时兼顾总耗时。按 `score` 升序返回全部候选（最多 5 个）。

### 5. 失败兜底

- 单个 POI 的耗时查询失败（高德限流/无路线）时，该成员耗时按 `直线距离 / 1.4 / 步行速度1.2m/s` 估算并标记 `estimated: true`；
- 高德 Key 未配置时，接口返回错误码 `5001`（提示配置 `AMAP_WEB_KEY`），前端展示降级提示。

## Haversine 公式

```
a = sin²(Δlat/2) + cos(lat1)·cos(lat2)·sin²(Δlng/2)
d = 2R·asin(√a)，R = 6371000 米
```
