# Design

## Context

见 `proposal.md`。DSH 桥每次 `invoke` 已 `resetReadSnapshot`；浏览器以 400ms 防抖推送 `canvas-context`；`shotsData` 用 `nodeToShot` 覆盖镜头。用户选定：**未落库用 overlay**、**同轮多个 read 各打 GET**（不在读工具之间复用项目 promise）。

## Goals / Non-Goals

**Goals:**

- 创意读工具：每次 `read_*` run 触发独立项目加载（studio 适配器 `freshProject: true` 或等价）。
- `canvas-context` 带单调 `projectRevision`（与落库一致）与 `canvasRevision`（每次推送 +1）。
- 读合并：overlay 仅当 `canvasContext.projectRevision === loadedProject.revision` 时应用；否则**只读 DB**（写后空窗也不被旧节点盖住）。
- 素材读：`project.assets` ∪ 画布 asset 节点（`assetNodesFromAssets` / 节点 `data` 投影为 inventory 行）。
- 写成功：`PATCH` 响应或后续 `GET` 携带新 revision；前端 `getProject` + **0 防抖** `postStudioCanvasContext`。

**Non-Goals:**

- 全字段即时落库（仍允许画布防抖写 DB）。
- 布局坐标、标注、候选图列表、PromptRenderBundle 中间态进读工具。
- 多标签槽位隔离（仍单槽位，与 `studioProject` 同）。
- Pi 工作台非 DSH 路径是否保留 invoke 内去重：默认保留，仅 `stage: 'creative'` / 桥接 `createReadAdapter` 收紧。

## Decisions

1. **项目 revision 来源**  
   在 `GET /api/project`（及写响应）增加整数 `revision`（SQLite 写时递增或 `updatedAt` 哈希）。桥比对实况 `projectRevision` 与本次 GET。  
   备选：仅用时间戳——否决：时钟与序列化不稳定。

2. **取消 studio 读路径 `snapshotPromise`**  
   `createStageToolSet(adapter, { freshReads?: boolean })`：`freshReads` 时 `snapshot()` 每次 `adapter.projectSnapshot()` 不用模块级 promise。`createBuiltinPlatformTools` 对桥接读适配器传 `freshReads: true`，且不注入 `getSnapshot`。  
   备选：每次 `invoke` reset 已够——不满足用户「每 read 各 GET」若单工具内多次 `snapshot()`。

3. **合并门控**  
   `canvasContextForProject` 返回 `projectRevision`；`shotsData` / 素材 overlay 入口检查相等才 merge。不等时 `shotVideoContext` 仍可用节点做 **出片解析**（`read_shot_video_inputs`）还是仅读工具？**决策**：读列表/详情不 merge；**生成/出片输入**仍用实况节点（用户要看见与按钮一致），但文档标明「读详情以 GET 为准至再推实况」。  
   若需完全一致，可第二阶段统一——本变更优先消灭「读详情错」。

4. **写后推实况**  
   `applyProjectDraft` 成功 → 自定义事件或 `onProjectDataChanged` 在 `App.tsx` 监听 → 立刻 `postStudioCanvasContext`（绕过 400ms）。桥侧可选：`studioCanvasStaleUntilPush` 标志在 revision 不等时忽略旧 nodes（读侧已不做 merge，生成侧见上）。

5. **素材 overlay**  
   从推送 `nodes` 筛 `type`/数据形态为素材卡，映射为 `MaterialRow`（category `assets`）；与 `project.assets` 按 `canvasId` 或 url key 合并。新卡仅节点存在时 inventory 计数 +1。

## Risks / Trade-offs

- **[同轮多 read 多 GET]** → 用户显式选择 B；后续可提供 `read_project_bundle`  opt-in，不默认复用。
- **[写后短暂无实况，出片读仍用旧节点]** → 写后立即推 + revision 门控读详情；出片工具文档提示可能需等推或再调 read。
- **[payload 变大]** → 仍单项目；专家列表仍 `packRecords`。

## Migration Plan

1. 加 `revision` 写路径递增（默认 0，旧项目首次写升为 1）。
2. 部署服务端与 `build:server`。
3. 部署前端推 revision。
4. `npm run test:studio-tools` + 新断言。

## Open Questions

- `read_characters` overlay 是否与本变更同一 PR：proposal 标可选，tasks 可单列 1.x 若时间紧。