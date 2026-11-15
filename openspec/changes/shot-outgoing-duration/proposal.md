# Proposal

## Why

分镜单镜出片在开启原生音频时，面板、卡片与成本确认显示的是 `round(镜头时长)`，而「原生音频」能力检查用的却是被抬高到 `minVideoSeconds + 1` 的临时值。结果是镜头时长为 4.0–4.4 秒时，前端判定可出片、面板显示 4s，真正提交的却是 4s，服务端按「原生音频须大于 4 秒」直接 400。用户既看不到这个差异，也不知道该把时长改到多少才一定能生成。

## What Changes

- 单镜出片的 `seconds` 改为唯一的「最终请求秒数」：`clamp(2..12, round(镜头时长))`；原生音频模式下若该值不大于模型下限（当前 4），MUST 抬到 `minVideoSeconds + 1`（5），使请求严格大于 4 秒。
- `buildShotVideoRequest` 返回的 `seconds` MUST 就是实际提交的秒数；面板摘要、出片设置、成本估算与 Agent `generate_clip` 全部读同一个值。
- 原生音频的能力门改用「最终请求秒数」判断，不再用临时抬高值自证通过；不满足时前置给出阻止原因。
- 「运镜与语义」仍是时长的编辑真相；同时在「出片设置」内提供同一字段的时长输入，并在摘要显示 `镜头 4.2s → 请求 5s`（两者不同时）。
- 时长按当前视频模型能力区间前置校验（Seedance 2.5 4–30s、Kling v3 3–15s、原生音频 >4s），越界在提交前说明，不再等 `/api/seedance` 返回 400。
- 转场路径与单镜路径共用同一个「最终请求秒数」helper，去掉两套算法。

## Capabilities

### New Capabilities

（无）

### Modified Capabilities

- `shot-video-prompt`: 出片请求的秒数 MUST 是最终提交值（含原生音频下限抬升），面板与成本展示的秒数 MUST 与实际请求一致；模型时长区间不满足时 MUST 在提交前阻止并说明原因。
- `shot-inspector-layout`: 「出片设置」MUST 提供与「运镜与语义」同源的时长输入，并在取整或抬升导致显示值不同时同时展示镜头时长与请求秒数。

## Impact

- 前端拼装：`src/videoPrompt.ts`（`ShotVideoRequest.seconds`、原生音频门）、`src/nativeAudio.ts`（去掉自证的临时抬升值）、`src/transitionGen.ts`（复用同一 helper）。
- 界面：`src/Inspector.tsx`（出片设置时长输入、摘要）、`src/OutgoingVideoPromptPanel.tsx`（摘要文案）、`src/inspectorLayout.ts`（折叠默认值如需调整）。
- Agent：`src/agent/builtinPlatformTools.ts` 的成本确认与提交沿用 `request.seconds`，不改字段。
- 服务端：`server/app.ts` 保持「原生音频 >4 秒」的最后兜底，不放松。
- 验证：`verify-native-audio.mjs`、`verify-native-audio-ui.mjs`、`verify-video-prompt-preview.mjs`、`verify-shot-inspector.mjs` 需要按新语义补充断言。
