# Design

## Context

- 当前的写入与呈现链路有两条：`ShotTable` 持有 `shots` 本地草稿、显式 `mergeProjectShots` 保存；画布持有 `nodes/edges`，在 `view === 'board'` 时用 1.5s 防抖把节点差异写回项目（`bizSignature` 比对 + `syncedRef` 快照）。
- 画布已有两套「项目 → 节点」逻辑：项目加载时的 `buildShotNodes(storedNodes, shots)` + `chainEdges` / `repairTransitionEdges`，以及工作台推送时的 `pushShotsToCanvas`（另一套栅格与 `seq-` 连线）。两者对同一批镜头会算出不同布局。
- `pushShotsToCanvas` 会被 `promptStat.empty > 0` 拦住；而 `shotToData` 的 `prompt` 取 `keyframe_prompt || desc`，所以「空首帧」在节点数据层未必是真空，拦截口径在 Auditing 层（`auditKeyframePrompt`）。
- `IntakeDialog` 目前由 `ShotTable` 挂载，输入是它本地的 `shots` / `episodes` / `chars`，`onApply` 只 `setShots` + `setDirty`，不落库。
- `addShot` 建的是**没有 `shotId` 的**节点，`nodeToShot` 永远不会写回，因此也不是正式镜头；`shotRows.ts` 的 `blankShot` / `nextShotNo` / `findDuplicateNos` 只在表格里用。
- 工作台聊天组件（`SkillChat`、`WorkbenchChatAside`、`createCreativeProjectAdapter`）在仓库里存在，但当前 `src/` 内没有任何挂载点；验收脚本仍按 `[data-shots-chat]` 查找，属于未接线的半成品。

## Goals / Non-Goals

**Goals:**

- 让「项目镜头 → 画布节点」只有一条水合路径，加载、导入、Agent 写回、增删镜都复用它。
- 导入确认即落库，落库成功后才更新画布，失败不留半份。
- 画布同时承载集级上下文（目标时长、摘要、补齐锚点）与分镜 Agent。
- 镜头增删插产出正式的 `E{集}-{镜号}` 级 `shotId`，并保持现有转场与参考引用语义。

**Non-Goals:**

- 不重做 Inspector 的信息架构；不新增分镜字段。
- 不改画布出图/出片/转场生成/连播/导出。
- 不改 `project.json` 结构与 `shots-v1` / `prompts-v1` / `joins-v1` 契约。
- 不迁移已存的画布布局数据（保留各项目 `storyboard-canvas-v1:<project>`）。

## Decisions

### 1. 单一水合函数取代 `pushShotsToCanvas`

新增 `hydrateCanvasShots(shots, opts)`：以 `buildShotNodes` 保位置 + `chainEdges`/`repairTransitionEdges` 保转场为唯一实现，接收「本次受影响的集号」与「是否 fitView」。

- 项目加载、导入、Agent 写回、增删镜统一调用它；`pushShotsToCanvas` 删除。
- 节点 id 仍按 `shotId` 复用（`byShot` 映射），保证导入/重写不会重置用户拖过的位置。
- 其他集的节点与素材卡原样保留；示例卡（`/^S\d+$/` 且无 `shotId`）在出现同集真实镜头后退场。

**替代方案**：保留 `pushShotsToCanvas` 再给导入单独加一条路径。否决：两套栅格会继续漂移，且「加载后」与「导入后」布局不一致。

### 2. 导入状态上移到 App，确认即落库

`IntakeDialog` 改为由画布挂载，输入取 App 的项目快照（`shots` / `episodes` / `chars`），`onApply` 走新的 `applyShotImport(result)`：

1. 校验镜号唯一（`findDuplicateNos`）；
2. `mergeProjectShots(projectName, result.shots, deletes)`；
3. 成功后更新 App 的项目快照（`shots`、必要时 `episodes`）与 `epVersion`；
4. 调 `hydrateCanvasShots`，`fitView` 到当前集新镜；
5. 失败：不改快照、不动节点，保留对话框可重试。

`IntakeDialog` 内部的解析、预览与 `mergeShotsDraft` 逻辑保持不变，只把它原来假设的「本地草稿」替换为「项目快照 + 落库回调」。

**替代方案**：把导入放进一个新的独立「分镜面板」。否决：等于把表格抽屉化了，与「不再有表格」冲突。

### 3. 空首帧只拦生成，不拦水合

水合不读 `promptStat.empty`；拦截点收敛到生成入口：

- `generateOne` / 批量 `runOnSelected`：继续要求节点 `prompt` 非空（既有行为）；
- 视频与转场生成：沿用现有首帧/参考校验；
- Inspector 对空首帧显示提示，不隐藏卡片、不断边。

注意 `shotToData` 的 `prompt` 会回退到 `desc`，因此「节点有 prompt」不等于「有首帧提示词」。设计上以 `auditKeyframePrompt` 的口径（`keyframe_prompt`）做摘要与提示，生成入口继续用现有判断，不在此变更收紧。

### 4. 正式镜头的增删插

- 新增/插入：`nextShotNo(shots, epNo)` + `blankShot(epNo, no)` 生成带 `id = E{ep}-{no}` 的镜头，`mergeProjectShots` 后水合；插入位置落在目标镜之后，并重建该集顺序边。
- 删除：确认后 `mergeProjectShots(projectName, [上一镜清理后的 patch], [shotId])`，同时从 `nodes/edges` 移除并把 `syncedRef` 中对应项删掉，避免防抖写回把它「复活」。
- 改镜号：Inspector 内改 `no` 后，写入前做集内唯一校验；`E{集}-{镜号}` 是 id 契约，改号意味着新 id，按「新镜 + 删旧镜」处理，并迁移 `refIds` 中指向旧 id 的位置标记（当前只有 `shot-prev` / `shot-next` 位置标记，无需迁移）。

**替代方案**：保留无 `shotId` 的实验卡作为「草稿镜」。否决：与「项目是唯一真源」和删除语义冲突。

### 5. 画布挂载分镜 Agent

用 `board-with-chat` 布局 + `WorkbenchChatAside`（`surface: 'shots'`，`data-shots-chat`）+ `SkillChat`，adapter 复用 `createCreativeProjectAdapter` 的 `shots` 分支：

- `ownDraft`：当前集镜头（来自 App 快照）；
- `applyDraft`：`mergeShotsDraft` / `mergePromptDraft` / `applyJoinsToShots` 后 `mergeProjectShots`，再水合；
- `saveMode` 由 `explicit` 改为 `immediate`（写回即落库，不再有「未保存草稿」）；
- 线程键仍为 `{project, surface: 'shots', episode}`；
- 内置动作只保留聊天侧「拆镜」，不再有顶栏对应按钮。

**替代方案**：把 Agent 留在已删除的镜头表路由里。否决：视图删除后无宿主。

### 6. 集级摘要与目标时长进画布上下文带

`WorkbenchBar` 在画布加一条上下文带：范围（`E01`、`N 镜`、总时长 vs 目标、缺首帧/缺锚点数）+ 设置（目标时长）+ 动作（导入、补齐锚点）。为此 App 增加 `episodes` 状态（项目加载时一并保存），目标时长经既有 `setEpisodeTargetSeconds` + `patchProject` 写入。

**替代方案**：只放在画布浮动工具条。否决：浮动条按工具栏定位、会与缩放控件争夺空间；上下文带是三段位既有约定。

### 7. 接缝只保留画布入口

删除 `ShotTableJoinRow` 的宿主后，接缝编辑由 `TransitionPanel` 承担；`shotJoins` 的合并与 `transition_out` 读写不变。Timeline 可加「该镜与下一镜」入口，但非本变更必需。

### 8. 导航与路由清理

- `view` 去掉 `'table'`，删除按钮与 `ShotTable` 渲染分支；`view` 是内存态、不持久化，无需迁移。
- 设置页环节文案「镜头表（拆镜）」改为「画布 · 拆镜」。
- 空集文案从「先在镜头表拆镜」改为「在画布导入或让 Agent 拆镜」。

## Risks / Trade-offs

- **两套写回同时存在导致丢改动** → 导入/Agent 写回后必须重置 `syncedRef` 对应签名，并把当前集节点整体替换；删除镜头时同步清理 `syncedRef`，否则 1.5s 防抖会把已删镜头写回。
- **导入落库后水合覆盖用户手工布局** → `buildShotNodes` 只对**新** `shotId` 计算栅格位置，已有节点沿用原 `position`；导入不 `cleared` 画布存档。
- **`[data-shots-chat]` 验收与真实挂载不同步** → 本变更同时补挂载与选择器，实施时先跑一次 `verify-workbench-chats.mjs` 确认基线，再改断言。
- **`shot-table-transition-joins` 仍在进行中且以表行为锚点** → 需先与该项目对齐：接缝 UI 场景改画布，或先归档并把场景迁到画布；否则两条变更会在同一片代码上互相覆盖。
- **改镜号即改 id** → 可能丢失指向旧 id 的画布边与 `refIds`；实施时按「同一位置」重建顺序边，并对非顺序边提示用户。
- **导入幂等依赖镜号** → 文件里镜号为空或重复时 `mergeShotsDraft` 会跳过；预览必须继续显式报重复，不能靠落库兜底。

## Migration Plan

1. 无数据迁移：`project.json` 结构不变，画布存档 key 不变。
2. 部署顺序：先加 `hydrateCanvasShots` 与导入落库，保留镜头表入口一个版本；确认导入、Agent、增删镜在画布可用后，再删 `view === 'table'` 与 `ShotTable` 文件。
3. 回滚：删除导航与视图是纯前端改动，回滚即恢复入口；导入落库的数据与旧镜头表读取兼容（同一 `project.shots`）。
4. 文档与验收在最后一批：README、设置页文案、`verify-*` 脚本入口。

## Open Questions

- Timeline 是否需要一条「接缝」视觉锚点（点击即选中对应边）。不改变 specs 与任务拆分，可实施时按画布体验再定。
