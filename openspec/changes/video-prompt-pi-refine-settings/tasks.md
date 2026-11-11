# Tasks

## 1. 统一模板来源

- [x] 1.1 实现 `resolveVideoPromptRenderPrompt(settings)`（读 `seedance-prompt-render` 内置 + DB override，产出 system/task/digest/source）。验证：单测 mock settings override 改变输出 digest。
- [x] 1.2 `renderSeedancePrompt` 与 `server/promptRender.mjs` 改用 resolver；删除或 deprecated 硬编码 `RENDER_SYSTEM`。验证：`node verify-prompt-render.mjs`。
- [x] 1.3 `templateVersionStale` 纳入 override digest。验证：改 mock override 后 meta 标 stale。

## 2. Refine 技能与工具

- [x] 2.1 新增 `skills/seedance-prompt-refine/SKILL.md`；`tools.ts` 注册；`submit_prompt_renders` 门禁单镜/单接缝。验证：`verify-creative-all-skills.mjs` 含 refine id。
- [x] 2.2 `mergePromptRenderDraft` 已支持写回；补充 refine 路径单实体测试。

## 3. 改稿弹窗 UI

- [x] 3.1 `PromptRefineModal` + adapter（shot/transition）；复用 `SkillChat` / `runStageAgent`；`WorkbenchInspector` 扩展 role/task/bundle 行。
- [x] 3.2 `Inspector.tsx`、`TransitionPanel.tsx`、`OutgoingVideoPromptPanel` 入口与 busy 状态。
- [x] 3.3 线程键 `prompt-refine:*` 接入 `threads.ts`。验证：`verify-video-prompt-refine.mjs`（新建）线程隔离。

## 4. 规格与文档

- [x] 4.1 归档前 `openspec validate video-prompt-pi-refine-settings --strict`。
- [x] 4.2 README 出片一节：设置即唯一九段模板；改稿弹窗与检查器说明。
