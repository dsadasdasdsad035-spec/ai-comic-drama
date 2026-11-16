# Tasks: shot-prompt-agent-authored

## 1. 正文收口

- [x] 1.1 在 `src/videoPrompt.ts` 的 `buildShotVideoRequest` 中，把 `basePrompt` 三档与 `appendShotDirectives` 调用替换为单一赋值 `const prompt = (d.videoPrompt || '').trim()`，`textSource` 塌为 `video_prompt` 一档。验证：`rg -n "appendShotDirectives|basePrompt|shotAutoScriptPrompt" src/videoPrompt.ts` 无结果。
- [x] 1.2 删除 `appendShotDirectives`、`DIRECTIVE_PRESENT`、`SHOT_CONSTRAINTS_DIRECTIVE` 及五个 `shot*Directive` 构造函数、`buildReferenceImagesPromptHint`、`buildVideoReferencePromptHint`。验证：`rg -n "SHOT_CONSTRAINTS_DIRECTIVE|DIRECTIVE_PRESENT|shotMoveDirective|shotReferenceDirectives" src/` 无结果。
- [x] 1.3 删除 `fallback` 死代码与 `lexiconMoveLine` 的兜底句，确认 `lexiconMoveLine` 若因此无调用方一并删除。验证：`rg -n "雨丝与光尘|24fps" src/` 只剩 `promptRender.ts` bundle 内的静态字段（若保留）。
- [x] 1.4 新增 blocking `shot-prompt-empty`：正文为空时 push 到 `blocking`。验证：清空 `video_prompt` 后 `request.blocking[0].code === 'shot-prompt-empty'`。

## 2. 脚本拼装退场

- [x] 2.1 删除 `src/promptRender.ts` 的 `assembleShotPromptScript` 与 `shotAutoScriptPrompt`，保留 `buildShotPromptRenderBundle` 及其 `continuity` / `endFrame` 字段。验证：`rg -n "assembleShotPromptScript|shotAutoScriptPrompt" src/ server/ skills/ experts/` 无结果。
- [x] 2.2 确认 `read_prompt_render_bundle` 工具仍能取到完整 bundle（它的实现走 `adapter.promptRenderBundle`，不依赖被删函数）。验证：跑相关验收脚本或在创意会话里调用该工具。

## 3. 新增读工具

- [x] 3.1 在 `src/agent/stageTools.ts` 新增 `read_shot_video_inputs`：按 shotId / no / episode 定位镜头，调用 `buildShotVideoRequest` 后投影出 `mode`、`seconds`、`shotSeconds`、有序 `refs`、`omitted`、`omittedVideos`、`video`、`audio`。验证：对一条带两名角色参考的分镜调用，返回的 `refs[].index` 从 1 连续递增且与请求顺序一致。
- [x] 3.2 在 `src/skills/tools.ts` 的 `KNOWN_TOOL_IDS` 登记 `read_shot_video_inputs`，并在需要的 expert manifest 与 `expertToolGroups.ts` 中授权。验证：`rg -n "read_shot_video_inputs" src/ experts/` 至少覆盖 tools.ts 与 expertToolGroups.ts。
- [x] 3.3 为工具写测试：参考图超上限时 `omitted` 非空且带原因；无参考时 `refs` 为空且 `mode` 为 `first`。验证：新增用例在 `tests/` 下通过。

## 4. 服务端透明化

- [x] 4.1 删除 `server/app.ts:6207` 的空正文硬编码兜底，改为空正文直接返回 `bad-request`（错误消息「提示词为空」）。验证：`curl` 空 prompt 请求返回 4xx 且响应体含「提示词为空」。
- [x] 4.2 删除 `videoRefScopeSuffix` 与 `withVideoRefScope`，`buildVideoPayload` 直接接收 `prompt`。验证：`rg -n "videoRefScopeSuffix|withVideoRefScope|@视频1" server/` 无结果。
- [x] 4.3 确认 `watermark: false` 仍在图像与视频两条 payload 上（这是「无水印」的唯一保证）。验证：`rg -n "watermark: false" server/apimart.mjs` 命中两处。

## 5. 面板与文案

- [x] 5.1 `src/Inspector.tsx` 的 `sourceLabel` 从四分支收为二分支（`video_prompt` / 无正文阻断），删除 `prompt_fallback`、`script_assembled`、`默认运动描述` 三档。验证：`rg -n "prompt_fallback|script_assembled" src/` 无结果。
- [x] 5.2 在「运镜与语义」「表演」「台词 / 音效」「原生音频」四处各加一行说明：这些字段不进入出片正文，需由创意会话读取后写入运动提示词。验证：面板四处可见说明文字。
- [x] 5.3 确认出片面板仍显示「提交给 <模型>」与逐字提交声明，`video_meta.prompt` 记录保持不变（保留既有行为，不改）。验证：出片后「当前视频的提示词」显示实际发送正文。

## 6. 指纹与读工具语义

- [x] 6.1 `fingerprintOf` 的字段集合保持不变（这些字段是 Agent 的输入材料，变更时应提示旧快照）。只清理因删除而失效的引用：`motionForFingerprint` 与 `motion` 不再回落到 `pTrim` 与 `fallback`，改为只取 `video_prompt`。验证：`rg -n "motionForFingerprint|pTrim" src/videoPrompt.ts` 只剩单一路径。
- [x] 6.2 收缩 `textSource` 类型：从 `'video_prompt' | 'prompt_fallback' | 'fallback' | 'script_assembled' | 'template_render'` 收为 `'video_prompt'`（手改走 `effectiveVideoPrompt`，不占该字段）。验证：`rg -n "prompt_fallback|script_assembled|template_render" src/videoPrompt.ts` 无结果。
- [x] 6.3 改写 `src/agent/stageTools.ts` 的 `resolveShotVideoPrompt`：`source` 收为 `'override' | 'video_prompt' | 'blocked'`，删除 `keyframe_prompt` 回退与 `script_assembled` / `requiresCanvas` 分支，空正文返回 `blocked` 并提示需写入正文。验证：`rg -n "script_assembled|requiresCanvas|keyframe_prompt" src/agent/stageTools.ts` 只剩 `blocked` 相关文案。

## 7. 死代码清理

- [x] 7.1 删除 `src/transitionGen.ts` 中未使用的 `nativeAudioPrompt` 导入与无调用方的 `transitionSoundBlock`。验证：`rg -n "transitionSoundBlock" src/` 无结果。
- [x] 7.2 `npx tsc --noEmit` 无新增错误（`noUnusedLocals` 关闭，需人工确认无孤儿导入）。

## 8. 回归验证

- [x] 8.1 改写 `tests/performance-video-prompt.ts` 与 `tests/prompt-text-integrity.ts` 里断言自动追加段存在的用例，改为断言正文逐字等于 `video_prompt` 且不含七个标记。验证：`npx tsx tests/performance-video-prompt.ts` 与 `npx tsx tests/prompt-text-integrity.ts` 全绿。
- [x] 8.2 改写 `tests/shot-read.ts` 中 `four.source === 'script_assembled'` 的断言，改为断言 `source === 'blocked'` 且带补写提示。验证：`npx tsx tests/shot-read.ts` 全绿。
- [x] 8.3 改写 `verify-prompt-render.mjs` 与 `verify-video-prompt-preview.mjs` 中依赖追加段与「双空走脚本拼装」的检查，补充「服务端零改写」与「空正文阻断」两条。验证：两个脚本全部通过。
- [x] 8.4 端到端确认：一条有完整字段但 `video_prompt` 简短的分镜，出片请求 `prompt` 与面板正文逐字相同且不含 `【运镜】`/`【约束】`；一条空正文分镜被阻断并给出补写入口。验证：浏览器 Network 面板对比请求体。
- [x] 8.5 通过创意会话走一遍：Agent 调用 `read_shot_video_inputs` 拿到参考顺序，写出带 `[图1]` 映射的正文，`submit_prompts` 落库后出片请求与该正文逐字一致。验证：会话记录与请求体比对。

## Workflow follow-up

- 同步技能文档：明确「写分镜出片正文前先读 `read_shot_detail` 与 `read_shot_video_inputs`，由 Agent 自己组织景别、运镜、台词、表演与参考图映射；运行时不再代写」。
- 归档本 change：`openspec archive shot-prompt-agent-authored --yes`。本 change 的 `.openspec.yaml` 已设 `retire_capabilities: true`，归档时会把 `shot-prompt-script-assembly` 的 spec 文件整体删除（它的 3 条 Requirement 全在本 change 的 REMOVED 里）。归档后重跑 `openspec validate --all` 确认该 spec 已消失且无残留引用。

## 已知规格妥协

- `shot-video-prompt` 的 MODIFIED 块保留了历史 scenario 名「双空走脚本」，但断言已反转为「阻断而非脚本拼装」。delta 不支持 scenario 级改名，归档后该名字会留在主 spec 中，需在后续变更中通过重写处理。
