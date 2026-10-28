# Proposal

## Why

导入只能补上「文件里有的行」。文件里少一镜、少一场，或者用户就想手写一行，目前无处可去：镜头表没有加镜与删镜，剧本页能加集不能加场，素材页只能靠模型拆解。更严重的是**镜头根本没有删除路径**——`mergeShots` 对未提交的镜头只标 `orphan`（`server/data.mjs`），而 `orphan` 镜头在所有工作台仍然渲染、只是多一个「孤儿」标签；画布的删除只移除节点不删数据；`saveProject`（PUT）虽然存在但没有任何调用方。所以现在删一镜的唯一办法是手改 `project.json`。

## What Changes

- 镜头表增加「加一镜」与「在此镜后插入」以及「删除此镜」，删除是**显式动作**，不再依赖「提交时缺少该行」来推断。
- 服务端新增显式删除镜头的入口：`POST /api/project` 接受 `deleteShotIds: string[]`，只删这些 id。**BREAKING** 相对的语义边界：缺席仍然是 orphan 保护，与显式删除互不影响。
- 删除一镜时同步清理指向它的引用：上一镜的 `transition_out`、画布上对应节点、以及该镜自己的产物引用（图片/视频文件保留，交给既有孤儿媒体清理脚本）。
- 剧本页增加「加一场」与「删除这场」；加集与删集已有。
- 素材页增加「新建场景/道具卡」，默认名可编辑，字段为空，不要求先拆解。
- 修复一个会导致加行出错的既有隐患：同一集内镜号（`no`）重复时，`buildShotsFromModel` 会生成相同的 `id`（`E{集}-{镜号}`），后续合并会互相覆盖。加行/改镜号时 MUST 校验并阻止集内重复镜号。
- 不做：自动重排镜号、批量插入、跨集移动镜头、从画布拖拽生成镜头、删除集（已有）。

## Capabilities

### New Capabilities

- `manual-row-editing`: 三个工作台里「人直接增删一行」的语义——镜头的加/插/删、场次的加/删、素材卡的手工新建，以及删除时对引用与产物的清理边界。

### Modified Capabilities

（无。剧本的加集/删集、角色的增删、素材卡发布等既有行为不变。）

## Impact

- 服务端：`vite.config.ts` 的 `POST /api/project` 处理新增 `deleteShotIds` 校验与删除；`server/data.mjs` 新增 `deleteShots(existing, ids)` 纯函数（与 `mergeShots` 并列，不改后者）。
- 前端：`src/ShotTable.tsx` 增加行操作与镜号唯一性校验；`src/ScriptBoard.tsx` 增加场次增删；`src/AssetBoard.tsx` 增加手工建卡；`src/api.ts` 的 `ProjectPatch` 增加 `deleteShotIds`。
- 画布：`src/App.tsx` 在删除镜头后同步移除对应节点与相关连线；画布自身的「删除卡片」增加「同时删除镜头数据」选项，避免两套删除按钮语义不一致。
- 数据：`project.json` 结构不变；删除是移出数组，不新增标记字段。
- 验收：`verify-project.mjs` 增加删除语义段；`verify-shot-inspector.mjs` 与新增 `verify-manual-rows.mjs` 覆盖三处增删。
