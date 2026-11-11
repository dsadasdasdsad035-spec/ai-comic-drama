# shot-transition-video-prompt Delta

## ADDED Requirements

### Requirement: 转场自动正文可来自模板渲染

当转场 `generated` 存在与当前转场指纹匹配的 `rendered_prompt` 时，自动拼装 MUST 以其为桥接正文主文案，并 MAY 仅追加与 `inputMode` 一致的结构锚点注记（手改 `videoPromptOverride` 仍短路全部自动逻辑）。预览与请求 `prompt` MUST 逐字一致。

#### Scenario: 有新鲜转场渲染

- **WHEN** `generated.rendered_prompt` 存在且 `render_meta.fingerprint` 匹配
- **THEN** 面板正文以渲染结果为基础，经 `finalizeTransitionPromptText` 允许的锚点/参考注记后与请求一致

#### Scenario: 无渲染回退

- **WHEN** 没有 `rendered_prompt`
- **THEN** 行为与引入本能力前一致（`generated.prompt` + 食谱 + 衔接块 + 尾句 + 声音）

#### Scenario: 纯文本模式禁令

- **WHEN** `inputMode` 为 `text` 且用户触发模板渲染
- **THEN** `rendered_prompt` MUST NOT 包含「首帧」「尾帧」等仅在有结构附件时才成立的表述

### Requirement: 转场 bundle 含双镜与决策输入

转场 `PromptRenderBundle` MUST 包含上镜与下镜的 `video_prompt`/`desc`/景别/运镜、接缝 `recipeIds`/`bridging`/`soundPrompt`、以及 `transition-director` handoff 摘要（若有）。食谱 `pitfalls` MUST 进入 bundle 连续性禁止项，由模型写入模板 §8 而非运行时机械追加（有新鲜 `rendered_prompt` 时）。

#### Scenario: 食谱 pitfalls 在渲染正文

- **WHEN** 接缝命中转场食谱且用户已模板渲染
- **THEN** 最终 `prompt` 的避免约束来自渲染正文；运行时 MUST NOT 再追加重复的 `transitionRecipePromptBlock` 避免段

## MODIFIED Requirements

### Requirement: 转场出片只有一个拼装结果

系统 SHALL 为每条生成转场边提供单一拼装结果，同时给出最终提示词、结构锚点附件、参考图与参考视频附件（含省略项）、锚点策略及阻止原因；转场面板展示的正文 MUST 与实际 `/api/seedance` 转场请求中的 `prompt` 逐字一致，结构首尾帧与（在策略允许时）参考图、参考视频 MUST 与面板列出的附件一致。成功出片后 MUST 持久化当次 prompt 的元数据以供提示词面板「当前视频的提示词」展示。存在 `rendered_prompt` 时，元数据 MUST 记录正文来源为 `template-render` 或 `override` 或 `legacy-auto`。

#### Scenario: 预览与请求一致

- **WHEN** 用户展开「本次出片提示词」并点击底栏「生成视频」
- **THEN** 面板正文与请求 `prompt` 完全相同，且 `vp-refs` 列出的首尾帧与请求边界字段一致

#### Scenario: 互斥时清单诚实

- **WHEN** 锚点策略为首尾直变且当前模型禁止同时提交尾帧与 reference_image
- **THEN** 面板仍将参考图列出，并标明本次未提交及原因；生成不因隐藏项而静默丢参考

#### Scenario: 允许提交时参考图一致

- **WHEN** 锚点策略与模型允许同时提交风格参考图
- **THEN** 请求 `refImages` 与面板标记为将提交的参考图 URL 集合一致
