# Design

## Context

见 `proposal.md` 的 Why。当前实现中有三处事实共同造成本次问题，设计必须逐条对上：

1. **位置从未进过项目**：拖节点只改 React Flow 的 `position`，而业务写回用 `bizSignature(n.data)` 比对（`src/App.tsx:2596`），`position` 不在签名字段里，因此拖拽不会触发任何落库；位置只写进 `localStorage`（`src/App.tsx:3524-3540`）。
2. **素材卡节点 id 是浏览器现生成的**：写回 `project.assets` 时只带 `kind/title/url/designId`（`src/App.tsx:1723-1742`），节点 id 被丢弃；重建时一律 `asset-${uid()}`（`src/App.tsx:853-861`、`1749-1762`），uid 来自 `crypto.randomUUID()`（`src/types.ts:388`）。
3. **参考边在源节点缺席时被跳过**：`refEdges` 里 `if (!inCanvas.has(rid)) continue`（`src/App.tsx:1843-1845`），所以 token 指不到节点就不画边，而 `refIds` 本身仍在库里。

分镜节点 id 不需要跨会话稳定：`refIds` 里引用的相邻镜是逻辑 token `shot-prev`/`shot-next`，转场用 `shotId`（如 `E01-S02`）。**只有素材卡的节点 id 需要稳定**，这决定了本设计可以很小。

## Goals / Non-Goals

**Goals:**

- 画布几何成为项目数据，跨会话、跨 origin、跨设备可恢复。
- 素材卡节点 id 由一个持久标识确定派生，与 `shot.refIds` 里的 token 同源。
- 迁移既有 `localStorage` 存档，尽量把已经存在的 `asset-<uid>` 引用救回来；救不回来的逐条报告。
- 写回量与拖动频率解耦：一次拖动一次写。

**Non-Goals:**

- 不引入边表：顺序链由 `chainEdges` 重建、转场由 `transition_out` 修复，冷启动唯一可能丢的是「非相邻手工硬切边」，属既有行为，本次不动。
- 不搬角色卡坐标、`charsOn`、`epNo`、主题、模型选择（另属视图偏好）。
- 不修复已经断掉、且素材卡已不存在的孤儿参考（只报告）。
- 不改 `canvas-node-layout` 的落位算法，只在其结果之上做「有存量位置就用存量」。

## Decisions

### 决策 1：位置独立成表，不塞进 `assets` / `shots` 行

```
canvas_layouts(project_id, node_key, x, y, updated_at)  UNIQUE(project_id, node_key)
```

理由：

- `assets` 的落库是整表替换（`server/db.mjs:1603-1615` 先 `DELETE` 再逐行 `INSERT`）。把几何放进 `assets`，则任何一次业务写（画布同步、Agent 发布素材卡）都会带着几何一起重写，一次漏传就丢位置。
- 拖动只产生几何变化，几何变化不产生业务变化。两者写频率、来源、失败影响都不同，共用一个通道会互相拖累。
- 行级 upsert 只改一行，避免拖动重写整块 JSON。

**否决的替代方案**：

| 方案 | 否决理由 |
|---|---|
| `projects` 加一列 JSON 存整块画布 | 一次拖动重写整块；两台设备同时拖会互相覆盖整块数据；单行冲突面太大 |
| `shots.canvas_x/y` + `assets.canvas_x/y` | 见上：`assets` 整表替换；且给 `shots` 加纯展示字段会污染镜头写回策略（`SHOT_FIELD_POLICY`）的语义 |

### 决策 2：`node_key` 只两种形态，节点 id 由 key 派生（不存 `node_id` 列）

```
shot:<shotId>         例 shot:E01-S03        -> 节点 id 由 buildShotNodes 生成（会话内 uid，无需稳定）
asset:<canvasId>      例 asset:9f2a…         -> 节点 id = 'asset-' + canvasId
```

`canvasId` 是项目级稳定 uuid。因为「素材节点 id = `asset-` + `canvasId`」是确定性映射，表里不需要再存一列 `node_id`——存的越少，越不会出现两处不一致。

**保持 `asset-` 前缀**是刻意的：`src/shotReferences.ts`、`src/videoPrompt.ts:347`（孤儿检测）、`src/storyboardMarkdown.ts:250`（token → 标题）都按 `startsWith('asset-')` 分支，换前缀等于同时改三条链路，收益为零。

### 决策 3：`assets` 新增 `canvas_id`，而不是用「类型 + 标题」当 key

否决「用 `kind:title` 当 key」：用户改标题就会换 key → 换节点 id → `refIds` 断链。而今天改标题不会断链（uid 与标题无关），那会是比现在更糟的回归。

否决「把素材内容复制进 `canvas_layouts`」：`assets` 与布局表会持有同一张卡的两份内容副本，改名、换图时必然漂移。

所以身份落在 `assets.canvas_id`（`TEXT DEFAULT ''`），内容仍只在 `assets` 一处。

### 决策 4：读写复用现有项目接口，不新增端点

- 读：`GET /api/project?name=` 的返回里加 `canvas: [{ key, x, y }]`，避免一次额外往返。
- 写：`POST /api/project` 接受 `canvas: [{ key, x, y }]` 与 `canvasDelete: string[]`，逐行 upsert / 删除；与 `shots`、`assets` 等字段互不影响。
- 需要在 `server/app.ts:4327` 的字段清单里登记，否则会被静默忽略（这是现有实现的坑，不是新问题）。

校验：`key` 必须匹配 `^(shot|asset):`；`x`/`y` 必须是有限数；单次请求行数设上限（与既有 patch 的其他维度一致，超限拒绝而不是截断）。

### 决策 5：写回时机——拖动结束 + 差异 + 合并

```
onNodeDragStop  --> 计算 {key,x,y}  --> 与 layoutSnapRef 比对 --> 只发改动项

新增/删除卡片   --> 立即写 / canvasDelete
hydrate         --> 只读；layoutSnapRef 重置为水合后的值
```

`layoutSnapRef` 与既有 `syncedRef` 同款快照法（`src/App.tsx:408-409`），作用有二：避免水合把默认栅格坐标写回项目；避免一次 `setNodes` 把所有节点都当成变动。写入合并窗口 400ms，页面卸载前 flush。

**不逐帧写**是硬要求（spec 里有对应场景）：`onNodesChange` 在拖动中每帧都会触发，接在那里等于把库当画板用。

### 决策 6：`localStorage` 降级为「边 + 上次集号」的项目级缓存

`Saved` 增加版本号。项目模式下只写 `{ version: 2, edges, epNo }`，不再写 `nodes` 与 `characters`（`characters` 本来就是 `project.characters` 的重复副本）。沙盒模式（未选项目）继续写 v1 完整形状。

`readSavedKey` 必须接受 `nodes` 缺省的 v2 形状，否则 `loadProjectSaved` 里的 `if (!Array.isArray(p?.nodes)) return null` 会让每次加载都退回「旧全局画布迁移」分支，反复把历史数据搬回来。这是改动中最容易踩的一处。

### 决策 7：迁移是一次性、只读旧存档、不覆盖项目数据

```
if (project.canvas 为空 && 存在 v1 项目存档)
    for 每个 type==='asset' 的节点:
        uid = node.id.slice('asset-'.length)
        按 designId 优先、其次 kind+title 匹配 project.assets
          命中 -> assets[i].canvas_id = uid（若为空）
                  canvas['asset:'+uid] = position
          未命中 -> 报告：卡已不存在
    for 每个分镜节点: 按 data.shotId 匹配 -> canvas['shot:'+shotId] = position
    其他无业务 id 的遗留节点 -> 报告（不猜、不丢）
    写回 assets + canvas
    把 v1 项目存档键改名为 :legacy-backup
```

先判空再迁移，保证「重复迁移不覆盖」；改名而不是删除，保证用户还能人工取证。

### 决策 8：服务端对 `canvas_id` 做兜底保留

`assets` 整表替换时，若某条传入的素材卡没带 `canvas_id`，服务端按「`design_id` 优先，其次 `kind + title`」在旧行里找同卡并沿用其 `canvas_id`；找不到才留空。这条兜底让「前端某处漏传」不至于又变成一次身份丢失——正是本次事故的成因，值得在服务端再拦一次。

### 决策 9：老库自动补列

`ensureColumns()`（`server/db.mjs:512-529`）会从建表语句推导缺列并 `ALTER TABLE`，所以 `assets.canvas_id` 与新表都不需要手写迁移代码。只需把新表加进 `PROJECT_CASCADE`（`server/project-lifecycle.mjs:29` 附近），否则删项目会留残余行。

## Risks / Trade-offs

| 风险 | 处理 |
|---|---|
| 同一 `designId` 在画布上出现两张卡 → 同一个 `canvas_id` → React key 冲突 | 构建素材卡时按 `assetCardKey` 去重，后出现的复用首张的 `canvas_id`；迁移同样去重 |
| `assets` 整表替换漏带 `canvas_id` → 身份再次丢失 | 决策 8 的服务端兜底 + 测试断言「落库后 canvas_id 不变」 |
| 两台设备同时拖动同一卡 | 最后写入者赢，不做 CRDT。写进规格的已知限制 |
| 400ms 合并窗口内关页面 → 最后一次位置丢失 | `beforeunload` / 卸载清理时 flush，并接受极端情况下的丢失（位置不是业务数据） |
| `composeShotCanvasNodes` 保留的 `extras` 节点（无 `shotId`、非素材、非示例卡）无处持久 | 迁移报告里点名，不静默丢弃；这类节点的创建入口在实际代码里未出现 |
| 已断开的 `asset-` 孤儿参考无法复活 | 迁移报告列出；本变更不提供修复界面（范围内明确不做） |
| 布局表增长 | 每项目每节点一行；删除卡片与删除项目都有清理路径，不会无界增长 |

## Migration Plan

1. 服务端先发布：建表 + 补列 + 读写字段 + 级联登记。老客户端不受影响（不认识 `canvas` 字段，忽略即可）。
2. 前端发布：载入时应用项目布局；首次载入执行一次性迁移；项目模式停止写 `nodes`。
3. 回滚：前端回退即恢复旧行为（旧代码继续读 `localStorage`，`:legacy-backup` 与 v2 存档都不会破坏它）；`canvas_layouts` 与 `assets.canvas_id` 可以留着不删，不影响旧代码。

## Open Questions

- 布局写入是否需要在服务端做「项目版本号」级别的冲突检测？当前按最后写入者赢处理；如果后续出现多端同时编辑的真实需求，再单独立项，不改本次规格。
