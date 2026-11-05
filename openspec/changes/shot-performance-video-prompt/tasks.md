# Tasks

## 1. 表演正文

- [x] 1.1 在 `src/performance.ts`（或 `videoPrompt.ts` 邻域）实现 `performanceVideoPromptBlock`：输入 performance、dialogue、dialogue_delivery，输出【表演方向】段落或空串；覆盖多角色、speaks、空表演。验证：`npx tsx tests/performance-video-prompt.ts`（新建）至少 3 用例。
- [x] 1.2 在 `buildShotVideoRequest` 插入该段（motionNote 之后、refHint 之前）；`fingerprintOf` 纳入 performance 与 dialogue_delivery。验证：纯函数断言段落位置与空表演不插入。

## 2. UI 与指纹

- [x] 2.1 `VideoPromptPanel` 摘要在「表情参考开/关」旁增加表演摘要（条数或「无表演」）。验证：`verify-video-prompt-preview.mjs` 或同类脚本读 DOM/拼装结果。
- [x] 2.2 确认手改 override 指纹在表演变更后标 stale（沿用现有机制 + 更新指纹字段）。验证：单测或脚本改 performance 后 `effectiveVideoPrompt.stale === true`。

## 3. 回归

- [x] 3.1 更新 `verify-video-prompt-preview.mjs`：无 performance fixture 保持逐字兼容；有 performance fixture 断言含【表演方向】。验证：脚本通过。
- [x] 3.2 `npm run build` 与 `openspec validate shot-performance-video-prompt --strict`。验证：构建与校验通过。

## Workflow follow-up

- 实现完成后 `/opsx-apply shot-performance-video-prompt`；归档前确认主 spec `shot-video-prompt` 合并。
