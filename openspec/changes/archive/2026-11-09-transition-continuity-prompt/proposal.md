# Proposal

## Why

生成转场的自动提示词只写「外观一致、运动连续」，没有把两镜的景别、机位和动作落点写成可执行的衔接约束。结果是首尾帧直变容易跳轴、跳景别或动作对不上。镜头语言规则应当约束提示词，剪辑流水线只负责成片拼接，不负责生成这段视频。

## What Changes

- 自动转场正文在现有 morph/keyframe 尾句之外，增加一段由两镜已有字段推导的衔接约束：景别跨度、机位/轴线、动作落点到起点。
- 字段缺失时省略对应句子，不编造景别或机位。
- 用户手改的 `videoPromptOverride` 仍逐字发送，自动衔接段不覆盖手改。
- 效果转场（叠化/擦除/推移）与成片 `xfade` 拼接行为不变。
- 不接入外部 Video Shotcraft 或 video-editing 技能作为运行时引擎。

## Capabilities

### New Capabilities

- `shot-transition-continuity`: 生成转场的自动提示词如何根据相邻两镜写出衔接约束，以及何时让位于手改正文。

### Modified Capabilities

- （无）`shot-video-prompt` 只管分镜出片预览与手改，不覆盖转场正文。

## Impact

- `src/transitionGen.ts` 的 `autoTransitionVideoPrompt` / `defaultTransitionPrompt`
- 转场面板「最终发送正文」预览（已有，正文变化后自动反映）
- 不改视频模型请求形状、不改取消生成、不改效果转场导出
