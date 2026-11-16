# Proposal

## Why

出片正文与 Agent 读取路径存在多处静默字符截断，用户无法从界面或回执察觉。表现最直接的一例：转场 `generated.prompt` 留空时，兜底拼装会把上下镜正文各切到 90 字符并补「…」，于是面板与实际请求里出现「`… paw …。`」这种看起来「没生成完」的正文；而同一批数据在数据库里是完整的。九段模板渲染与之同理：转场 §3 场景环境被切到 300 字符、单镜 §3 被切到 200 字符，Agent 读取工具的正式结果超过 8000 字符会被替换成 `preview` 片段。这些截断没有任何提示、没有来源标注，也无法通过设置关闭。用户已明确要求删除这些字数限制。

## What Changes

- **删除转场正文的 90 字符硬切**：`generated.prompt` 为空时的兜底拼装与面板下方的「衔接」预览块，改为使用上下镜完整正文，不再补 `…`。
- **删除九段模板渲染的字段切片**：单镜与转场 bundle 的 `scene.environment` / `scene.castStates` 使用完整来源文本。
- **转场空正文改为显式状态**：`mode=generated` 且 `generated.prompt` 与 `videoPromptOverride` 均为空时，不再静默用兜底正文顶替，改为在出片前以可读原因标出「正文未填写」，由用户选择补写或改用手改正文。
- **删除 Agent 读取路径的字符折叠**：`read_prompt_render_bundle` 不再把超长 bundle 折成 `preview`；`read_shot_video_prompt` 回完整模板渲染正文而非仅字符数；`list_installed_skills`、验收回执、角色/设定抽取、视觉输出解析、事件日志不再按固定字符数切分。
- **BREAKING**：工具回执体积会显著变大。原先依赖「回执一定小」的调用方（上下文预算、历史折叠）需要改为按条装填，而不是按字符切片。
- **不在本变更范围**：白模 Blender 代码的上下文上限（`sceneCodePrompt.ts` 的 28000 与 `MATERIAL_CODE_MAX`）、`engine.ts` 的 `maxTokens`、UI 首行摘要（`OutgoingVideoPromptPanel` 的 72 字符 peek、标题 24 字符等）。前两者是模型上下文与渠道约束，不是「显示用字数限制」；后者是纯显示摘要，删除会破坏界面布局。

## Capabilities

### New Capabilities

- `prompt-text-integrity`: 规定凡是会进入模型请求、落库提示词或工具回执的文本，系统 MUST 原样传递，MUST NOT 施加无提示的字符截断；确需截断时必须显式标注、可追溯、且不改变持久化内容。

### Modified Capabilities

- `shot-transition-continuity`: 衔接约束与兜底正文 MUST 使用相邻两镜的完整字段文本，MUST NOT 按固定字符数取片段。
- `shot-transition-video-prompt`: 提示词各层（画面与过渡短提示、声音描述、衔接约束、最终正文）在进入预览与请求前 MUST NOT 被字符截断；正文为空时 MUST 作为可见状态而非静默兜底。

## Impact

- 代码：`src/transitionGen.ts`、`src/promptRender.ts`、`src/agent/stageTools.ts`、`src/agent/workbenchChat.ts`、`src/agent/sceneAgentEvents.ts`、`src/agent/agentReview.ts`、`src/agent/builtinPlatformTools.ts`、`src/charExtract.ts`、`src/designExtract.ts`、`src/visualBrief.ts`
- 行为：转场与单镜的九段模板渲染结果变长；Agent 单次读工具回执变大，可能需要配套的「按条装填 + 游标续读」策略（`src/agent/readBudget.ts` 已有该机制）
- 数据：无 schema 变更；已落库的 `renderedPrompt` / `video_prompt_rendered` 会因模板输入变化而指纹失配，需要重渲染
- 风险：长正文可能触及渠道上下文上限，届时以明确的 `length` 错误结束，而不是静默变短
