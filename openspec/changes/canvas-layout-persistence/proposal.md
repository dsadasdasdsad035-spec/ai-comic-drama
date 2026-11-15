# Proposal

## Why

画布的节点位置与素材卡节点 id 只存在浏览器 `localStorage`，而桌面端每次启动都由系统随机分配本地服务端口（`desktop/main/service.mjs` 里 `SB_PORT: '0'`，`main.mjs` 用 `service.origin` 加载界面），`origin` 每次不同 → 存储每次是空的。结果是「素材卡连到分镜」的参考连线在重启后从画布上消失：`shot.refIds` 里的 `asset-<uid>` 还在库里，但 uid 是上一次随机的画布节点 id，新画布按 `project.assets` 重建卡片时会生成新的 uid，`refEdges` 因 `inCanvas.has(rid)` 为假而不画边，出片只留一条 `ref-orphan-asset` 警告。角色参考不受影响（`char-<角色名>` 由角色表派生），所以现象是「只有素材线丢」。

同一根因还导致每次启动丢主题、模型选择、角色视图开关与上次打开的集号。

## What Changes

- **新增画布布局持久化**：新增 `canvas_layouts` 表（`project_id` + `node_key` + `x/y`），存分镜节点与素材卡的几何位置；项目模式下画布位置以项目数据为真源，不再从 `localStorage` 读节点。
- **素材卡节点 id 落库**：`assets` 表新增 `canvas_id`，画布素材节点 id 确定性派生为 `asset-${canvas_id}`。于是 `refIds` 里的 token 与画布节点 id **同源**，不再依赖某一次随机的浏览器状态。
- **一次性迁移**：首次加载时读既有 `localStorage` 存档，把素材节点的旧 uid 写回 `project.assets.canvas_id`（按 `designId` 优先、其次 `kind+title` 匹配），位置写进 `canvas_layouts`，随后把旧存档键改名为 `:legacy-backup`，不删除。
- **写回通道**：`POST /api/project` 接受 `canvas` / `canvasDelete`，逐行 upsert；`GET` 随项目返回 `canvas`。拖动只在 `onNodeDragStop` 后按差异写，不逐帧写。
- **迁移报告**：匹配不到的素材节点、无业务 id 的遗留节点逐条报告，不静默丢弃。
- **范围外（明确不做）**：连线仍按现有派生规则重建（不新增边表）；角色卡坐标、`charsOn`、`epNo`、主题、模型选择不搬；沙盒模式（未选项目）继续用 `localStorage`；不改 `canvas-node-layout` 的落位算法，只在其之上「有存量位置就用存量」。
- **不做但记录**：已丢失的 `asset-` 孤儿参考无法复活（卡片已不在 `assets` 表），本变更只报告，不提供修复界面。

## Capabilities

### New Capabilities

- `canvas-layout-persistence`: 画布几何与素材卡节点身份的持久化契约——位置随项目保存、素材节点 id 跨会话稳定、节点 id 与 `refIds` token 同源、旧本地存档的一次性迁移与报告。

### Modified Capabilities

（无）

## Impact

- **服务端**：`server/db.mjs`（新表 `canvas_layouts`、`assets.canvas_id`、`readProject` 回读、`saveProject` 写入）、`server/app.ts`（`POST /api/project` 字段白名单）、`server/project-lifecycle.mjs`（`PROJECT_CASCADE` 增表）。老库补列由既有 `ensureColumns()` 自动完成。
- **前端**：新增布局存取模块（key 构造、应用、差异）；`src/App.tsx`（载入应用布局、`onNodeDragStop`、增删素材卡、迁移执行、项目模式不再把 `nodes/edges` 写 `localStorage`）；`src/api.ts`（`ProjectAsset.canvasId`、`ProjectPatch.canvas/canvasDelete`、`ProjectData.canvas`）；`src/assetCards.ts`（合并保持 `canvasId`）。
- **不变**：`shot.refIds` 的 token 格式与语义、连线派生规则、`project.shots`/`project.assets` 的顺序与字段、`canvas-node-layout` 的落位规则、`read_shots` 的读取契约。
- **迁移成本**：`assets.canvas_id` 为空的历史卡片在首次载入时分配一次新值；已断开的素材参考需要用户重新连线。
- **测试**：key 构造与布局应用/差异的纯函数单测；迁移映射单测；项目载入后刷新仍能画出素材参考边的验收脚本。
