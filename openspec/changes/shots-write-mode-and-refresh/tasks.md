# Tasks

## 1. 服务端写回模式

- [x] 1.1 `server/db.mjs` 的 `mergeShots(existing, incoming, mode = 'partial')` 增加 mode 分支：`full` 才把未提交的既有镜头标 `orphan`；`partial` 原样保留。验证：`node verify-db.mjs` 通过，且新增用例「单镜写回后其余镜无 orphan」断言为真。
- [x] 1.2 `server/app.ts` 的 `POST /api/project` 读取 `body.shotsMode`，非法值返回 400，缺省 `partial`，并透传给 `mergeShots`。验证：`node verify-manual-rows.mjs` 里用 `curl` 形状的请求断言 `partial` 不产生 orphan、`full` 产生 orphan。
- [x] 1.3 更新 `server/verify-db.mjs` 的 orphan 回归用例：分别断言 `full` 标孤儿、`partial` 不标。验证：`node server/verify-db.mjs` 全绿。

## 2. 客户端 API 与调用点

- [x] 2.1 `src/api.ts` 的 `mergeProjectShots` 改为 `(name, shots, opts?: { deleteShotIds?: string[]; mode?: 'partial' | 'full' })`，`patchProject` 的 `ProjectPatch` 增加 `shotsMode`。验证：`npm run build` 的 `tsc --noEmit` 通过。
- [x] 2.2 5 处整表写回点显式声明 `mode: 'full'`：`src/platform/projectDraft.ts`（`shots-v1`）、`src/App.tsx` 的 `persistProjectShots` / 打开时 reconcile / `delete_shots` 调用点、`src/agent/builtinPlatformTools.ts` 的 `delete_shots`、`src/agent/promptRefineAdapter.ts` 的出片改稿写回。验证：`grep -n "mode: 'full'"` 命中 5 处，且 `tsc --noEmit` 通过。
- [x] 2.3 5 处局部写回点保持不传 mode（画布防抖、`purgeRefIds`、`migrateCharRefs`、`writeShotBack` 单镜、分镜表导入），并逐个在注释里写明「局部写回，不标孤儿」。验证：`grep -n "局部写回"` 命中 5 处，代码评审可对照 design.md D6。
- [x] 2.4 新增 `tests/shot-write-mode.ts` 并加入 `verify-skills-unit.mjs` 的用例列表：断言局部写回不动其余镜、整表写回标孤儿、显式 `deleteShotIds` 与 mode 互不干扰。验证：`node verify-skills-unit.mjs` 通过。

## 3. 历史孤儿标记一次性清理

- [x] 3.1 `server/db.mjs` 增加幂等迁移：`settings` 键 `shots.orphanCleanedAt` 未设置时执行 `json_remove` 清理并写标记。验证：新用例「迁移执行后镜头无 orphan、重复调用不改变结果」在 `node server/verify-db.mjs` 通过。
- [x] 3.2 清理只针对已存在数据，不影响随后 `full` 写回新产生的标记。验证：用例先跑迁移、再整表写回缺一镜，断言该镜仍带 `orphan`。
- [x] 3.3 对真实项目抽样确认：清理后 `read_shots` 返回的镜头不再带 `orphan`。验证：对本地项目目录跑一次读取脚本，输出里 `orphan` 计数为 0。

## 4. Agent 写回后水合画布

- [x] 4.1 `src/creative/CreativeStudio.tsx` 的 `CreativeStudioProps.materialHost` 增加 `onProjectDataChanged?: () => void | Promise<void>`，并透传给 `createBuiltinPlatformTools`。验证：`tsc --noEmit` 通过，且 `grep` 可见该字段从 props 流到平台工具构造处。
- [x] 4.2 `src/App.tsx` 渲染 `CreativeStudio` 时传 `onProjectDataChanged: () => void refreshProjectSnapshot()`（不传 `fit`，避免打断视口）。验证：在创意工作室让 Agent 用 `submit_shots` 写 3 镜后切到画布即可见，无需重启。
- [x] 4.3 写回失败时不刷新：确认 `applyProjectDraft` 的失败路径不调 `onProjectDataChanged`，并补一条断言。验证：mock 失败的 `writeShots`，断言回调未被调用（可并入 2.4 的用例文件）。

## 5. 集成回归

- [x] 5.1 端到端复现原问题：对真实项目先单镜 `link_shot_refs`、再整表 `submit_shots`，断言两次之后都不会留下新的孤儿。验证：`node verify-manual-rows.mjs` 与新增断言全绿。
- [x] 5.2 分镜表导入只影响覆盖集：导入只含第 1 集的文件后，第 2 集镜头无 `orphan` 且字段不变。验证：`node verify-import*.mjs`（或既有导入回归脚本）通过。
- [ ] 5.3 全量回归：`node verify-all.mjs` 与 `node verify-skills-unit.mjs` 相对基线无新增失败。

## Workflow follow-up

- 按项目评审要求归档该变更，并确认归档后 `openspec/specs/manual-row-editing/spec.md` 与 `openspec/specs/canvas-shots-workbench/spec.md` 已合入新的 requirement。
- 归档后重启桌面开发版确认：项目 `a` 的 14 个存量孤儿标记已消失，`read_shots` 不再返回 `orphan`。
