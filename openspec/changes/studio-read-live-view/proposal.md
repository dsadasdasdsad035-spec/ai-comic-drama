# Proposal

## Why

创意「全能专家」读画布与素材时，用户期望工具结果与当前屏幕一致，且不以进程内快照或过期实况掩盖刚落库的数据。`dsh-tool-snapshot-freshness` 已修复跨 invoke 陈旧项目快照，但读侧仍存在：invoke 内仍可合并 HTTP、素材读工具不消费画布实况、写回后旧 `canvas-context` 覆盖新 DB、以及合并策略未版本化。需要把读路径收成明确的「每次读拉库 + 带 revision 的 overlay」契约。

## What Changes

- 创意/DSH 读工具：**每次** `read_*` 执行时重新 `GET` 项目（禁用桥接 `getSnapshot` 短路；`stageTools` 对 studio 适配器不跨读复用 `snapshotPromise`）。
- `canvas-context` 增加 **`projectRevision` / `canvasRevision`**（或等价单调序）；读合并时 **revision 门控**：实况仅覆盖「新于或等于本次 GET revision」的字段，**禁止**旧实况盖住写工具刚提交的 DB。
- **写工具成功**后：递增项目 revision、前端 **立即**（无防抖）再推实况；桥侧可将过期实况视为无效直至新推送到达。
- **`read_asset_inventory` / `read_asset_detail`**：在落库 `project.assets` 基础上，用画布 **asset 节点** overlay（标题、kind、url、与 `asset-<canvasId>` 一致的 identity），与 `read_shots` 同源策略。
- **角色**（可选同变更内）：`read_characters` 在推送含 `characters` 时按 id/name  overlay 未落库字段（与镜头一致，避免角色板手改读空）。
- 文档：`docs/creative-host.md` 更新「画布实况」为 revision 与写后失效语义。
- 测试：`tests/studio-tool-bridge.mjs` 增写后读、素材 overlay、同轮多次读 GET 计数（若可观测）。

## Capabilities

### New Capabilities

（无）

### Modified Capabilities

- `dsh-tool-bridge`：读工具每次执行重新拉库；实况 revision 与合并门控；写后实况失效/再推。
- `creative-asset-tools`：创意会话下素材读工具 MUST 合并画布 asset 节点实况。

## Impact

- `src/agent/stageTools.ts`：studio/creative 读路径取消或可配置关闭 `snapshotPromise` 去重。
- `src/agent/builtinPlatformTools.ts`：桥接不注入 `getSnapshot`；`shotsData` / 素材读的 overlay 与 revision 检查。
- `server/studio-canvas-context.mjs`、`server/studio-tool-bridge.mjs`、`server/index.mjs`：revision 字段、写回 bump（或读 GET 返回 revision 供比对）。
- `src/creative/pushStudioCanvasContext.ts`、`src/App.tsx`：写成功后立即推；payload 带 revision。
- `docs/creative-host.md`；测试 `tests/studio-tool-bridge.mjs`、素材/读工具单测。