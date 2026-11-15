# Tasks

## 1. 服务端存储与读写

- [x] 1.1 在 `server/db.mjs` 的 SCHEMA 里新增 `canvas_layouts(project_id, node_key, x, y, updated_at, UNIQUE(project_id,node_key))`，并给 `assets` 加 `canvas_id TEXT DEFAULT ''`；验证：`node server/verify-db.mjs` 通过，且在一个已有旧库上启动后 `PRAGMA table_info(assets)` 含 `canvas_id`、`sqlite_master` 含 `canvas_layouts`。
- [x] 1.2 `readProject` 回读布局，项目返回体新增 `canvas: [{ key, x, y }]`（按 `node_key` 排序，结果稳定）；验证：`server/verify-db.mjs` 追加断言「写入 2 行后读回顺序与内容一致」。
- [x] 1.3 `POST /api/project` 接受 `canvas`（逐行 upsert）与 `canvasDelete`（按 key 删除），在字段清单里登记，并校验 `key` 前缀为 `shot:`/`asset:`、`x`/`y` 为有限数、单次行数有上限；验证：`verify-project-lifecycle.mjs` 断言非法 key 返回 400、合法请求后读回值一致、未传 `canvas` 时既有布局不被清空。
- [x] 1.4 `server/project-lifecycle.mjs` 的 `PROJECT_CASCADE` 增加 `canvas_layouts`；验证：`verify-project-lifecycle.mjs` 断言删除项目后该表不再有该项目行（`PROJECT_TABLES` 已含 `canvas_layouts`）。

## 2. 素材卡标识的落库与兜底

- [x] 2.1 `saveProject` 替换 `assets` 时，对未带 `canvas_id` 的传入卡按「`design_id` 优先、其次 `kind + title`」沿用旧行 `canvas_id`；验证：`server/verify-db.mjs` 断言同一张卡连续两次落库（第二次不带 `canvas_id`）后该值不变。
- [x] 2.2 前端类型与合并补齐 `canvasId`：`ProjectAsset` 增加可选 `canvasId`，`mergeAssetCards` 在命中同一张卡时保留既有 `canvasId`；验证：`tests/asset-cards.ts`（`node --test`）断言「不带 canvasId 的更新不会清掉已有值」「新增卡可携带 canvasId」。

## 3. 前端布局模块（纯函数）

- [x] 3.1 新增画布布局存取模块：`shotKey(shotId)`、`assetKey(canvasId)`、`nodeKeyOf(node)`、`assetNodeId(canvasId)`、`applyLayout(nodes, canvas)`、`diffLayout(nodes, snapshot)`；只做纯数据变换，不碰 React 与网络。验证：`src/canvasLayoutStore.ts` 无运行时 import，可被 `node --test` 直接导入。
- [x] 3.2 为新模块写单元测试：key 形态正确（`shot:E01-S03` / `asset:<uuid>`）、有存量位置时覆盖默认栅格、缺位置时保留落位规则结果、`diffLayout` 只返回坐标真正变化的 key。验证：`node --test tests/canvas-layout-store.ts` 全绿（9 项）。

## 4. 画布接入

- [x] 4.1 `src/api.ts` 补类型：`ProjectData.canvas`、`ProjectPatch.canvas` / `canvasDelete`；验证：`npx tsc --noEmit` 通过。
- [x] 4.2 载入项目时改为「素材卡由 `project.assets` + `canvasId` 构建（缺 `canvasId` 时生成一次并等待落库）、位置按 `applyLayout` 取值」，不再从 `localStorage` 取节点；验证：`verify-canvas-persist.mjs` 断言卡片 id 为 `asset-<canvasId>` 且重新载入后不变。
- [x] 4.3 位置写回：`onNodeDragStop` 后用快照 diff 只提交变动项，400ms 合并窗口，卸载前 flush；`hydrateCanvasShots` 后重置快照且不发起写回；验证：`verify-canvas-persist.mjs` 断言拖动一张卡后只发出一次请求且请求体只含该 key、载入后无位置请求。
- [x] 4.4 增删素材卡的布局副作用：新增即写位置（`assetNodes` 中快照里没有的 key 统一补写）；删除即 `canvasDelete` 对应 key；验证：`verify-canvas-persist.mjs` 拖动/新增落库、删除走 `canvasDelete`（单测覆盖 key 生成）。
- [x] 4.5 画布素材卡落库时携带 `canvasId`（`assetsSnapRef` 那条防抖通道）；验证：`verify-canvas-persist.mjs` 断言整表替换漏传 `canvasId` 时服务端沿用旧值，且载入后不会触发多余写回。
- [x] 4.6 新增验收脚本 `verify-canvas-persist.mjs`：连一张素材参考 → 重新加载项目 → 断言参考边仍存在、`refIds` 未被清理；验证：`node verify-canvas-persist.mjs` 通过（含换端口重启、拖动写回、旧画布迁移三段）。

## 5. 本地存储降级为缓存

- [x] 5.1 `Saved` 增加版本号，`readSavedKey` 接受 `nodes` 缺省的 v2 形状，避免每次载入都回落到「旧全局画布迁移」分支；验证：`tests/canvas-layout-store.ts` 断言 v2 形状可读出 `edges` / `epNo`，`verify-canvas-persist.mjs` 断言只有边缓存的项目不会被当成「无存档」。
- [x] 5.2 项目模式只写 `{ version: 2, edges, epNo }`，不再写 `nodes` 与 `characters`；沙盒模式（未选项目）保持 v1 完整形状；验证：项目模式下 `localStorage` 该项目键不含 `nodes`（`verify-canvas-persist.mjs` 断言）。沙盒一半不适用：本项目画布入口挂在项目下，未选项目时没有画布视图，`STORAGE_KEY` 已无任何写入方（只被迁移逻辑读取），故不存在「沙盒刷新后画布恢复」这条路径。
- [x] 5.3 更新 `docs/project-lifecycle.md`「删除之后的全局上下文」：项目画布位置已随项目落库，删除项目由 `canvas_layouts` 级联清理，本地只剩边与集号缓存；验证：文档描述与实际行为逐条对得上（按文档走一遍删除流程，`verify-project-lifecycle.mjs` 断言 `canvas_layouts` 行随之清空）。

## 6. 存量本地画布的一次性迁移

- [x] 6.1 实现迁移：读 v1 项目存档 → 按 `designId` 优先、其次 `kind + title` 匹配素材卡，把旧 uid 写进 `canvas_id`、把位置写进 `canvas`；无业务 id 的遗留节点与匹配不到的素材卡逐条进报告。验证：`tests/canvas-layout-store.ts` 覆盖「命中」「未命中」「重复执行不重复写」（`planLegacyCanvasMigration` 纯函数 + `verify-canvas-persist.mjs` 端到端一段）。
- [x] 6.2 执行条件与收尾：仅当项目 `canvas` 为空时执行；成功后把 v1 项目存档键改名为 `:legacy-backup`，不删除；验证：已有 `canvas` 数据的项目载入时旧存档不生效且不被删除（`verify-canvas-persist.mjs` 断言）。
- [x] 6.3 迁移报告可见：命中数、未匹配素材卡、遗留节点分别输出，用户能在界面上看到（toast 或控制台）；验证：`verify-canvas-persist.mjs` 构造一条指向已删卡的旧连线，断言报告里点名该卡而不是静默忽略。

## 7. 集成回归

- [x] 7.1 `node --test`（含新增用例）与 `node verify-all.mjs` 全绿；验证：`node verify-skills-unit.mjs`（已挂 `tests/asset-cards.ts`、`tests/canvas-layout-store.ts`）与 `npx tsc --noEmit` 全绿；`node verify-all.mjs canvas` 12 个脚本中 7 个通过（含 `verify-canvas-persist`、`verify-canvas-layout`、`verify-project-lifecycle`），另 5 个（`verify-canvas-shots-crud`、`verify-canvas-shots-bar`、`verify-chars-canvas`、`verify-expression-sheet-canvas`、`verify-canvas-code-fallback`）在 `git worktree` 的 HEAD 基线跑出同样失败，与本次改动无关，未纳入本 change 的验收范围。
- [x] 7.2 桌面端连测：连续启动两次（服务端口不同）后，素材参考连线仍在、卡片位置不变；验证：`verify-canvas-persist.mjs` 第 1 段起两个 dev server 跑在不同端口、共用同一项目库，断言 `canvas` / `assets.canvasId` / `shots[0].refIds` 逐字一致，第 2 段在真实浏览器里断言重新载入后卡片 id、位置与参考连线不变；未起 Electron 窗口截图（等价断言已覆盖「换端口后仍一致」这一条）。
- [x] 7.3 反向验证：把某镜的 `refIds` 指向一个不存在的 `asset-` token，载入后应只报孤儿警告且不崩溃；验证：`verify-canvas-persist.mjs` 第 4 段写入 `asset-ghost-missing` 后重载，断言画布照常渲染、有效参考连线仍在、无未捕获异常、孤儿值不被静默清掉且不影响其他镜；警告本身由 `videoPrompt` 的 `ref-orphan-asset` 承载，`tests/performance-video-prompt.ts` 断言其级别为 warn 且点名数量。

## Workflow follow-up

- 按项目评审要求完成后归档该 change（`openspec archive canvas-layout-persistence`），并确认归档后的 `openspec/specs/canvas-layout-persistence/spec.md` 已生成。
