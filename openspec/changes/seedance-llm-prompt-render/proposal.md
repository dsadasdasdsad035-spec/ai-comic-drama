# Proposal

## Why

画布单镜与镜间转场的 Seedance 出片正文目前由「镜头表 LLM 写的短 `video_prompt` + 运行时规则后缀」或「转场 Agent 段落 + 景别/食谱/衔接块拼接」组成，未对齐 Seedance 2.5 推荐的资产映射、连续时间轴与全局约束写法，也难以在参考图/视频/音频变化时保持语义一致。需要把**最终出片正文**改为由大模型按固定九段模板渲染，运行层只负责附件与指纹，保持「预览 = 请求」。

## What Changes

- 新增 **`seedance-prompt-render`** 技能（及可选 API）：输入结构化 `PromptRenderBundle` + 九段模板 + Seedance 官方规则摘要，输出单条中文 `rendered_prompt`；结果带 `fingerprint` 持久化到镜头或 `transition_out.generated`。
- 单镜：`buildShotVideoRequest` 的正文来源改为优先 `video_prompt_rendered`（新鲜则使用），否则回退现有 `video_prompt + 后缀`；指纹与现有 `VideoPromptOverride` 机制扩展兼容。
- 转场：`autoTransitionVideoPrompt` 的正文来源改为优先 `generated.rendered_prompt`（或等价字段），否则回退现有 Agent + 规则拼装；手改 `videoPromptOverride` 仍短路。
- Inspector / 转场面板：「重新拼装」触发 LLM 渲染（非同步阻塞出片）；展示渲染来源（模板版 / 回退 / 手改 / 过期）。
- **首期不破坏**：未触发渲染的旧项目行为与今天一致（纯回退路径）。
- **Out of scope（首期）**：每次打开面板自动调 LLM；用渲染结果替代 `skills/prompt` 的表内 `video_prompt` 语义层；服务端在 `/api/seedance` 内嵌二次 LLM。

## Capabilities

### New Capabilities

- `seedance-prompt-render`：结构化输入 → 九段模板 LLM 渲染 → 持久化、指纹、失效与批量刷新。

### Modified Capabilities

- `shot-video-prompt`：自动正文可来自 LLM 渲染结果；指纹纳入渲染输入；「重新拼装」语义区分手工后缀拼装与模板渲染。
- `shot-transition-video-prompt`：转场自动正文可来自 LLM 渲染；输入含 A/B 镜与 `inputMode`，禁止写入不存在的结构锚点。

## Impact

- **技能**：`skills/seedance-prompt-render/SKILL.md`（新）；可选调整 `skills/prompt` 说明与渲染层分工。
- **前端**：`src/videoPrompt.ts`、`src/transitionGen.ts`、`Inspector` / `VideoPromptPanel`、`TransitionPanel`、项目/镜头类型字段。
- **宿主/API**：工作台聊天或 `POST /api/prompt-render`（设计阶段定稿）；设置页绑定「出片提示词渲染」模型。
- **测试**：`verify-video-prompt-preview.mjs` 扩展渲染/回退用例；转场对应用例。
- **文档**：README 出片提示词一节补充「模板渲染 vs 机械后缀」。
