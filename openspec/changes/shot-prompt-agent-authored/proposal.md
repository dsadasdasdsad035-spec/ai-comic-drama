# Proposal: shot-prompt-agent-authored

## Why

分镜出片正文当前由运行时把右侧 Inspector 的字段机械拼成句式追加进去：`【运镜】`、`【台词】`、`【表演方向】`、`声音：`、`参考图：`、`@视频1` 范围约束、`【约束】`，共七段，其中 `【约束】` 无条件追加。服务端在正文为空时再注入一句硬编码，有视频参考时再补一段 `@视频1` 约束。

结果是用户（或 Agent）写的正文永远不等于最终发出去的正文。而这些字段本该是**创意会话读取的数据**：Agent 通过内置读工具取到景别、运镜、台词、表演与参考图，自己组织语言写进 `video_prompt`，而不是让运行时替它组织措辞。

## What Changes

- 分镜出片正文 **MUST** 逐字等于 `video_prompt`（或手改正文 `videoPromptOverride.text`），运行时 MUST NOT 追加任何系统生成的段落。
- 删除前端全部七段指令块及其拼装函数：`appendShotDirectives`、`DIRECTIVE_PRESENT`、`shotMoveDirective`、`shotDialogueDirective`、`shotPerformanceDirective`、`shotSoundDirective`、`shotReferenceDirectives`、`buildReferenceImagesPromptHint`、`buildVideoReferencePromptHint`、`SHOT_CONSTRAINTS_DIRECTIVE`。
- 删除脚本拼装路径：`shotAutoScriptPrompt`、`assembleShotPromptScript`，以及 `video_prompt` / `prompt` 双空时回落到脚本拼装的优先级档位。
- 删除死代码：`videoPrompt.ts` 的 `fallback`（含「雨丝与光尘缓慢飘动」）与 `lexiconMoveLine` 的兜底句。
- 删除服务端两处兜底：正文为空时注入的「镜头缓慢推进，环境细节自然流动，人物保持姿态」，以及有视频参考时追加的 `@视频1` 范围约束。
- 新增只读工具 `read_shot_video_inputs`，返回本次出片的**除正文之外**的全部输入：有序参考图列表（含 label / purpose / slot）、被省略项及原因、出片模式、镜头秒数与请求秒数。Agent 据此写出准确的 `[图N]` 映射。
- 正文为空时 MUST 以 blocking 阻断出片（`shot-prompt-empty`），MUST NOT 静默兜底。
- **BREAKING**：`video_prompt` 为空的分镜不再能出片，必须先补正文；此前依赖自动追加的景别、运镜、表演、台词将不再出现在正文中，需由 Agent 或用户显式写入。

## Capabilities

### New Capabilities

无。本变更不引入新的系统行为，只收窄正文来源并补齐 Agent 的读取能力。

### Modified Capabilities

- `shot-video-prompt`：`自动正文优先级` 改为单档（`video_prompt`）并新增空正文阻断；删除 `恢复自动拼装含脚本路径`；新增「正文由 Agent 写入、运行时零拼装」「出片输入对 Agent 可见」「出片面板显示提交目标与实际正文」三条。

## Impact

- 前端：`src/videoPrompt.ts`（删除拼装层、收缩 `textSource`）、`src/promptRender.ts`（删除脚本拼装，保留 bundle）、`src/cameraLexicon.ts`（删除兜底句）、`src/Inspector.tsx`（正文来源标签塌缩、字段不再入正文的说明）、`src/agent/stageTools.ts`（新增 `read_shot_video_inputs`，改写 `resolveShotVideoPrompt` 的 `blocked` 语义）、`src/skills/tools.ts`（登记工具 id）、`src/agent/expertToolGroups.ts` 与各 expert manifest（按需授权）。
- 服务端：`server/app.ts`（删除空正文注入与 `withVideoRefScope`）。
- 数据：无 schema 变化。已存 `video_prompt` 不动；旧分镜若 `video_prompt` 为空，升级后会被阻断，需补写。
- 测试：`tests/performance-video-prompt.ts`、`tests/prompt-text-integrity.ts`、`tests/shot-read.ts`、`verify-prompt-render.mjs`、`verify-video-prompt-preview.mjs` 中依赖自动追加段与脚本拼装的断言需改为反向断言。
- 规格：本 change 完整退役 `shot-prompt-script-assembly` 能力（3 条 Requirement 全部 REMOVED），`.openspec.yaml` 已设 `retire_capabilities: true`，归档时删除该 spec 文件。
- 不受影响：`buildShotPromptRenderBundle` 与 `read_prompt_render_bundle` 工具（那是喂给 Agent 的输入材料，不是运行时正文）；`performanceDirectionText`、`nativeAudioPrompt`（作为可复用文本工具保留）。
