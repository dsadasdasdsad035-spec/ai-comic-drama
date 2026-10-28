# Tasks

## 1. 服务端删除语义

- [x] 1.1 在 `server/data.mjs` 新增 `deleteShots(existing, ids)` 纯函数：返回移除命中 id 后的数组与被删数量；不改 `mergeShots`。在 `verify-project.mjs` 增加段：`deleteShots([S01,S02,S03], ['S02'])` 结果为 `[S01,S03]`、未知 id 被忽略、空 ids 返回原数组。
- [x] 1.2 在 `vite.config.ts` 的 `POST /api/project` 处理 `deleteShotIds`：校验必须是字符串数组；**先 `mergeShots` 再 `deleteShots`**；同一 id 同时在 `shots` 与 `deleteShotIds` 中时以删除为准。在 `verify-project.mjs` 用临时项目断言：「提交 S01,S03 + deleteShotIds:['S02']」后 `project.json` 只剩 S01,S03；「只提交 S01,S03 不带 deleteShotIds」时 S02 仍为 orphan（保护不回退）。
- [x] 1.3 写盘后兜底清理悬空转场：扫描所有镜头的 `transition_out.to`，指向已不存在 id 的条目清除。在 `verify-project.mjs` 构造一个 `transition_out.to` 指向已删镜头的场景，断言写盘后该字段被清除。
- [x] 1.4 服务端校验集内镜号唯一：`mergeShots` 之后按 `(episode, no)` 检查重复，重复则拒绝写入并返回含冲突镜号与集号的错误。在 `verify-project.mjs` 断言「两条同集同镜号」请求被拒且 `project.json` 未被修改。

## 2. 镜头表行操作

- [x] 2.1 新增 `src/shotRows.ts`（纯函数）：`nextShotNo(shots, epNo)` 取集内最大号 +1、`insertAfter(shots, id, row)`、`removeRow(shots, id)`、`findDuplicateNos(shots, epNo)`；新建 `verify-manual-rows.mjs` 覆盖：空集新增得 `S01`、有 `S06` 时新增得 `S07`、删除 `S02` 后新增不复用 `S02`、两集同名 `S01` 不算冲突。
- [x] 2.2 在 `src/ShotTable.tsx` 增加「新增镜头」与行内「在此镜后插入」按钮，新行带默认值（时长 3、景别 中景、运镜 固定、空描述/台词）且 `handEdited` 为空。运行 `verify-manual-rows.mjs` 与 `verify-shot-inspector.mjs`，确认新增后行数与顺序正确。
- [x] 2.3 在 `src/ShotTable.tsx` 增加行内「删除此镜」：确认框显示镜号、该镜是否有首帧/成片/配音；确认后在前端清掉其他镜头指向它的 `transition_out.to`，并把 id 记入待删集合。保存时随请求提交 `deleteShotIds`。在 `verify-manual-rows.mjs` 断言删除后草稿行数减一、相关转场被清空。
- [x] 2.4 保存前校验镜号唯一：`findDuplicateNos` 非空时阻止保存并在对应行标出冲突。在 `verify-manual-rows.mjs` 断言「手改成重复镜号」被阻止、「改回唯一」后可通过。
- [x] 2.5 在 `src/api.ts` 的 `ProjectPatch` 增加 `deleteShotIds?: string[]`，`patchProject` 原样透传。运行 `npx tsc --noEmit`。

## 3. 孤儿镜头治理

- [x] 3.1 在 `src/ShotTable.tsx` 增加「清理孤儿」入口：列出本集所有 `orphan` 镜头（镜号、是否有产物），逐条勾选后走 `deleteShotIds` 删除；不提供全选删除。在 `verify-manual-rows.mjs` 断言列表只含孤儿、勾选 2 条后提交的 `deleteShotIds` 长度为 2。
- [x] 3.2 确认删除孤儿后其他页面不再显示它们。运行 `verify-prompt-inject.mjs` 与 `verify-casts*` 相关脚本，断言提示词表与角色页的镜头计数同步下降。

## 4. 场次增删

- [x] 4.1 在 `src/ScriptBoard.tsx` 增加「新增场次」：取集内最大场次号 +1，字段为空。在 `verify-script-knobs.mjs` 增加段：第 1 集 3 场时新增得第 4 场。
- [x] 4.2 增加「删除这场」：确认框显示属于该场（`shot.scene_no === 场号`）的镜头数；确认后从集内移除该场，镜头不删。在 `verify-script-knobs.mjs` 断言删除后 `episodes` 场次数减一、`shots` 数量不变。
- [x] 4.3 确认删除场次后，`scheduleContext` 一类读取能容忍查不到的 `scene_no`（不抛错、按无场次处理）。运行 `verify-schedule3d.mjs` 与 `verify-scene-blocking-api.mjs`。

## 5. 素材手工建卡

- [x] 5.1 在 `src/AssetBoard.tsx` 增加「新建场景卡」与「新建道具卡」按钮：创建只有名称与类型的空卡（`refs: []`、`promptEn: ''`、`keywords: []`、无图），名称可立即编辑。在 `verify-asset-board.mjs` 断言新建后出现在对应 tab、可编辑、无图时「加入画布」禁用。
- [x] 5.2 同名提示：新建时若与已有卡同名，提示「后续拆解会合并到同一张卡」。在 `verify-asset-board.mjs` 增加断言。

## 6. 画布删除一致性

- [x] 6.1 在 `src/App.tsx` 的画布删除卡片确认框里增加「同时从镜头表删除该镜头」勾选（默认不勾）。勾选时把该镜 id 记入待删集合并随保存提交 `deleteShotIds`，同时移除节点与边。运行 `verify-canvas.mjs` 与 `verify-ctxmenu.mjs`。
- [x] 6.2 确认删除镜头后重新加载画布，对应节点因 `buildShotNodes` 只为现存镜头建节点而不复现。在 `verify-manual-rows.mjs` 增加断言。

## 7. 集成与回归

- [x] 7.1 运行 `npx tsc --noEmit` 与 `npm run build`，修复类型问题。
- [x] 7.2 运行 `node verify-all.mjs`。新增 `verify-manual-rows`（含服务端往返与 UI 行操作）全绿；`deleteShotIds` 是可选字段，未传即保持原行为。全量跑相对基线无新增失败。
- [x] 7.3 手工验证完整链路：镜头表新增 2 镜 → 中间插入 1 镜 → 删除 1 镜 → 保存 → 刷新后行数与内容正确；再验证删掉带转场的镜头后，上一镜不再有转场。
- [x] 7.4 在 `README.md` 的镜头表说明处补一段：加镜/插入/删除是显式动作，删除不可撤销（可从 `project.json.bak` 找回），并说明「孤儿」含义与清理入口。
