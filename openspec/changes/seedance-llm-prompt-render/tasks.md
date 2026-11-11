# Tasks

## 1. 类型与持久化

- [x] 1.1 在 `types.ts` / `ProjectShot` 增加 `video_prompt_rendered`、`video_prompt_render_meta`；`TransitionGenerated` 增加 `rendered_prompt`、`render_meta`；`shotSync` 读写验证：round-trip `nodeToShot`/`shotToData` 保留字段。

## 2. Bundle 与拼装

- [x] 2.1 新增 `src/promptRender.ts`：`PROMPT_RENDER_TEMPLATE_VERSION`、九段模板 system 文案、`buildShotPromptRenderBundle`、`buildTransitionPromptRenderBundle`、`renderMetaStale`。验证：`verify-prompt-render.mjs` bundle 与 `buildShotVideoRequest` 指纹一致。
- [x] 2.2 改造 `buildShotVideoRequest` / `effectiveVideoPrompt`：新鲜 `video_prompt_rendered` 时不追加机械后缀；无渲染时行为不变。验证：`verify-prompt-render.mjs`。
- [x] 2.3 改造 `mechanicalTransitionVideoPrompt` / `resolveTransitionAutoPrompt` / `effectiveTransitionVideoPrompt`：新鲜 `renderedPrompt` 时跳过食谱/衔接机械块（`finalize` 结构注记保留）。验证：`verify-transitions.mjs` 无渲染路径不变。

## 3. API 与技能

- [x] 3.1 `server/promptRender.mjs` + 客户端 `renderSeedancePrompt`（走 `/api/text`）；验证：`node verify-prompt-render.mjs`。
- [x] 3.2 新增 `skills/seedance-prompt-render/SKILL.md`；`tools.ts` 注册 `submit_prompt_renders`；`mergePromptRenderDraft` 写回镜头。验证：`verify-creative-all-skills.mjs` 含工具名。

## 4. UI

- [x] 4.1 扩展 `OutgoingVideoPromptPanel`：来源徽章（模板/机械/手改）、「模板渲染」「恢复机械拼装」；分镜 Inspector 与转场 `TransitionPanel` 均已接 `renderTransitionTemplate`。

## 5. 回归

- [x] 5.1 新增 `verify-prompt-render.mjs`；`tsc` 通过（`vite.config` mock-text 声明为既有问题）。验证：`node verify-prompt-render.mjs`。

## Workflow follow-up

- 归档前合并 delta 到 `openspec/specs/*`。
