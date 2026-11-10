# Proposal

## Why

上一个变更把首尾帧收敛为「必须两镜成片抽取才能生成」，但用户要的是**首尾帧可选**：有就用来锁定起止画面，没有也应该能出片。当前的强制要求把大量本来能跑的转场（只有参考图、甚至只有提示词）挡在门外。

## What Changes

- **BREAKING** 不再要求首尾帧齐全才能生成转场。按实际输入自动降级：
  - 两帧都有 → 首尾直变（boundary）
  - 只有首帧 → 单首帧出片（生成后裁到目标时长）
  - 无帧但有连线参考图/参考视频 → reference_image / reference_video
  - 全都没有 → 纯文本生成（文生视频）
- **新增模型能力位** `features.textToVideo`。纯文本模式只对声明该能力的模型放行；未声明的模型仍 blocking，文案要求补参考或换模型，而不是静默失败。
- 面板摘要与出片提示词预览显示当前输入模式（首尾直变 / 单首帧 / 参考图 / 纯文本），blocking 只在真的没有可用输入且模型不支持纯文本时出现。
- 服务端按同一规则推导模式，不再对「转场但没有首尾帧」直接 400。
- `transitionRequestSeconds` 按「是否真的提交尾帧」决定是否裁剪，而不是按模型能力。

## Capabilities

### New Capabilities

（无）

### Modified Capabilities

- `shot-transition-video-prompt`: 首尾帧从必填改为可选；新增输入模式降级链与纯文本模式的能力门禁。

## Impact

- **类型**：`src/api.ts` 的 `ModelFeatureSet` 增加 `textToVideo`；模型预设按能力标注。
- **前端**：`src/transitionGen.ts`（输入模式推导、blocking 规则、请求时长、参考互斥）、`src/TransitionPanel.tsx`、`src/App.tsx`（去掉缺边界 throw）。
- **服务端**：`vite.config.ts`（模式推导与文案）、`server/video.mjs`（`buildVideoPayload` 支持纯文本）。
- **数据**：无迁移；已存首尾帧照旧使用。
- **测试/文档**：`verify-transitions.mjs`、`README.md`、`ACCEPTANCE.md`。
