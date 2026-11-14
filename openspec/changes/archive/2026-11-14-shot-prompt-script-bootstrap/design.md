# Design

## Context

见 `proposal.md`。当前 `buildShotVideoRequest` 在 `video_prompt_rendered` 指纹匹配时优先九段全文，否则回退 `semantic`（`video_prompt || prompt || 硬编码 fallback`）。`effectiveVideoPrompt` 对持久化九段层设 `renderStale` / `templateStale`。`buildShotPromptRenderBundle` 已结构化场景/资产/表演，但默认消费路径面向 LLM。画布 Inspector 无「模板渲染」按钮却展示相关警告。

## Goals / Non-Goals

**Goals:**

- 实现 `assembleShotPromptScript(bundle) → string`，在双空提示词时替代单行 `fallback`。
- 调整 `buildShotVideoRequest` 正文链：override → `video_prompt` / `prompt` → script；忽略 `video_prompt_rendered` 对 `prompt` 的影响。
- 面板徽章与警告与 spec 对齐；`textSource` 增加 `script_assembled`（或复用 `fallback` 并更新摘要文案）。
- 单测 / `verify-prompt-render.mjs` 断言脚本段落与指纹稳定。

**Non-Goals:**

- 删除 `video_prompt_rendered` 字段或 `seedance-prompt-render` 技能文件。
- 转场 `assembleTransitionPromptScript`（follow-up 变更）。
- 恢复「AI 扩写」浮层或 LLM 一键渲染 UI。
- 服务端 `/api/prompt-render` 行为变更（若无调用可不动）。

## Decisions

1. **拼装器位置**  
   在 `src/promptRender.ts`（或 `promptScript.ts`）实现 `assembleShotPromptScript`，输入为 `PromptRenderBundle`（由现有 `buildShotPromptRenderBundle` 生成）。  
   *理由*：bundle 已与附件/表演对齐，避免 `videoPrompt.ts` 二次采集。  
   *备选*：在 `videoPrompt.ts` 内联拼句 — 重复逻辑，否决。

2. **段落结构（首期）**  
   固定顺序小节：场景与主体 → 画面与光影 → 运镜与动作 → 台词/表演 → 资产映射（图N/视频N）→ 连续性与禁止项。每节用模板字符串 + bundle 字段；空节省略。  
   *备选*：单段流水账 — 可读性差，否决。

3. **彻底忽略九段持久化层**  
   不在 `buildShotVideoRequest` 读取 `freshRender`；`effectiveVideoPrompt` 不再计算 `renderStale`/`templateStale`（或恒 false）。存量字段只读，可选后续「采纳到运动提示词」按钮（本期不做）。  
   *理由*：与产品「模板仅 bootstrap」一致，消除误导警告。

4. **仍无参考时的 fallback**  
   双空且 blocking（无图）时脚本可不调用；若 partial 有描述字段（`desc`）仍可无参考生成短句，但不假装有附件。保持现有 blocking 优先。

5. **`textSource` 枚举**  
   新增 `script_assembled` 便于摘要「正文来自脚本拼装」；保留 `video_prompt` / `prompt_fallback` / `fallback` 语义。

## Risks / Trade-offs

- **[Risk] 脚本文案偏机械** → 用户依赖 `video_prompt` 字段或手改；README 说明分工。  
- **[Risk] 与 README 九段 LLM 叙述冲突** → 本变更同步改 README。  
- **[Risk] 转场仍用旧逻辑** → design 标明 follow-up，避免用户误以为转场已统一。  
- **[Trade-off] 不删字段** → 项目 JSON 仍可能含大段 `video_prompt_rendered`，占体积；可后续迁移工具。

## Migration Plan

1. 部署前端后：新出片请求不再读九段层；用户无操作即生效。  
2. 无需 DB 迁移；旧 `render_meta` 无害。  
3. 回滚：恢复 `freshRender` 分支（git revert）。  
4. 验收：`verify-prompt-render.mjs`、`verify-video-prompt-preview.mjs`（若有）、`verify-shot-inspector.mjs` 更新断言。

## Open Questions

- 是否在元数据 Tab 提供「将旧九段正文写入运动提示词」一次性动作（本期不做，待反馈）。
