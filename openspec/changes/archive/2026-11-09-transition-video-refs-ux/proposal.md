# Proposal

## Why

画布转场「生成视频」（Seedance 2.5 首尾直变）在数据层已支持继承两镜参考、排除与增补，但转场面板没有像分镜「本次出片」那样展示结构锚点与风格参考、也无法在生成前核对实际请求；用户无法按分镜习惯调整参考与提示词，且预览与 API 提交不一致，削弱信任与可控性。

## What Changes

- 转场面板「生成转场」区对齐分镜 `VideoPromptPanel` 信息架构：摘要、结构锚点（上镜尾/下镜首）、风格参考（继承/排除/增补）、分层提示词、最终正文、blocking/warnings、生成与取消。
- 扩展 `buildTransitionVideoPreview`（或等价拼装）为单一事实来源：预览附件、省略项、互斥说明与实际 `/api/seedance` 转场请求字段一致。
- 默认 **首尾直变（morph）** 保持现状；在模型/API 允许时提交风格参考图；在 Seedance 2.5「尾帧与 reference_image 互斥」时，面板 MUST 明示未提交的参考及原因（可写入正文或仅提示）。
- 可选 **锚点策略**（首期至少暴露 morph；「仅首帧 + 多图参考」作为后续或实验档位，在 design 中定边界）。
- 转场指纹 / stale 提示纳入参考与边界变更（与现有 `transitionFingerprint` 衔接）。
- 画布边上可选轻量状态（有成片 / stale / blocking）——首期可在 tasks 中标为 P1，不阻塞核心面板。

## Capabilities

### New Capabilities

- `shot-transition-video-prompt`：生成转场出片前的预览、参考编辑、提示词分层与手改全文；预览与请求一致性及模型互斥的人话说明。

### Modified Capabilities

- （无）效果转场、衔接正文、Agent 建议等既有 spec 行为不变；本变更不修改 `shot-transition-continuity` / `shot-transition-effect-presets` / `shot-transition-agent` 的 REQUIREMENTS 文本，仅与之并列的新能力。

## Impact

- 前端：`TransitionPanel.tsx`、`transitionGen.ts`、`theme.css`；可能抽取共用组件或样式自 `Inspector` / `VideoPromptPanel`。
- 客户端生成：`App.tsx` 中 `generateTransitionVideo` / `startVideo` 参数（`refImages`、边界、bridging）。
- 服务端：`vite.config.ts`（及 `server/video.mjs` 若存在镜像逻辑）转场分支下参考图提交策略与错误文案。
- 类型：`TransitionGenerated` 可能增加 `refVideo` 等字段（若纳入首期范围则在 design 锁定）。
- 测试：`verify-transitions.mjs` 或新增预览/请求一致性用例。
