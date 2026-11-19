# Tasks

## 1. 项目 revision

- [x] 1.1 `GET /api/project`（及写回响应）暴露单调 `revision`；写路径递增。验证：改镜后 GET 的 revision 变大
- [x] 1.2 旧项目无字段时默认为 0，首次写升为 1。验证：夹具项目可读

## 2. 创意读路径每读必载

- [x] 2.1 `createStageToolSet` 支持 `freshReads`；桥接 `createReadAdapter` 启用且不注入 `getSnapshot`。验证：单元或桥测同轮两次 read 不共享对象引用（或 GET 计数 ≥2）
- [x] 2.2 `StudioToolBridge.invoke` 仍 `resetReadSnapshot`；与 2.1 联调。验证：`tests/studio-tool-bridge.mjs` 连续两次 read 仍绿

## 3. canvas-context revision 与合并门控

- [x] 3.1 推送体增加 `projectRevision`、`canvasRevision`；`studio-canvas-context.mjs` 存储与透出。验证：POST 后 GET 回显
- [x] 3.2 `shotsData` 仅在 revision 相等时 `nodeToShot` 覆盖。验证：桥测「写后未推」读落库、「revision 一致」读 overlay
- [x] 3.3 `docs/creative-host.md` 更新实况与 revision 语义

## 4. 写后立即推实况

- [x] 4.1 写工具成功（平台 `applyProjectDraft` / 镜级写）触发 `App.tsx` 立即 `postStudioCanvasContext`（可与防抖并存）。验证：手测或 hook 测试推两次且第二次无 400ms 等待

## 5. 素材读 overlay

- [x] 5.1 从实况 nodes 派生 asset 行，并入 `read_asset_inventory` / `read_asset_detail`（同 revision 门控）。验证：桥测或 `tests/` 未落库卡可见
- [x] 5.2 `read_characters` overlay（可选）：推送 characters + revision 门控。验证：手改角色名未落库时 read 一致

## 6. 集成

- [x] 6.1 `npm run build:server` 与 `npm run test:studio-tools` 全绿
- [x] 6.2 `tests/studio-tool-bridge.mjs` 增「写后 read 不被旧实况盖住」「素材 overlay」用例

## Workflow follow-up

- 归档后合并 delta 至 `openspec/specs/dsh-tool-bridge/spec.md` 与 `creative-asset-tools/spec.md`；若与未归档的 `dsh-tool-snapshot-freshness` 冲突，合并读快照条款为同一需求文本。