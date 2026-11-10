# Proposal

## Why

上一个变更把首尾帧改成手动选择，但候选池铺得太开：上/下镜静帧、候选图、项目媒体库、手填地址全都可选，还要「抽取候选 → 再点选」两步。用户的实际工作流只有一种——**首帧必须是上一镜成片的最后一帧，尾帧必须是下一镜成片的第一帧**。多出来的候选来源和二次点选都是噪音。

## What Changes

- **BREAKING** 首尾帧候选收敛为唯一来源：首帧 = 上镜成片尾帧，尾帧 = 下镜成片首帧。删除媒体库、手填地址、静帧与候选图来源。
- **BREAKING** 「抽取」直接写入槽位：点一次「抽取两镜成片帧」即同时填好两帧并标来源 `source-tail` / `target-head`，不再有「先产候选、再点选」两步。
- **BREAKING** 去掉静帧回退：`ensureTransitionBoundary` 不再在没有成片时回退当前画面；没有成片的镜无法生成转场，blocking 提示先生成该镜成片。
- 弹窗首尾帧页简化为两个预览槽 + 「抽取两镜成片帧」+「打开上/下镜」；抽取结果展示来源标签。
- 删除 `transitionBoundaryCandidates` 与 `BoundaryCandidate` 及对应候选网格 UI/CSS。
- 同步主 spec：`shot-transition-video-prompt` 的候选来源要求删除，抽取要求改为写入语义。

## Capabilities

### New Capabilities

（无）

### Modified Capabilities

- `shot-transition-video-prompt`: 首尾帧来源收敛为两镜成片抽帧；抽取动作直接写入；移除静帧回退与外部候选来源。

## Impact

- **前端**：`src/transitionGen.ts`（去静帧回退、删候选函数）、`src/OutgoingReferencePickerModal.tsx`（去候选网格/媒体库/手填）、`src/TransitionPanel.tsx`（抽取即写入）、`src/theme.css`（删候选样式）。
- **类型**：`BoundarySource` 保留四个历史值以读旧数据，新写入只用 `source-tail` / `target-head`。
- **服务端**：无协议变化；缺边界 400 文案保持不变。
- **数据**：旧项目已存的媒体库/手填来源边界仍可读、可生成；只是不能再新选。
- **测试/文档**：`verify-transitions.mjs`、`README.md`、`ACCEPTANCE.md`。
