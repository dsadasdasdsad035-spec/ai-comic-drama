# Tasks

## 1. 脚本拼装器

- [x] 1.1 新增 `assembleShotPromptScript(bundle)`：固定段落模板 + 空节省略；单元或 `verify-prompt-render.mjs` 覆盖双空、有参考、有视频参考
- [x] 1.2 `buildShotVideoRequest`：双空时调用脚本拼装，替代单行 `fallback`；新增 `textSource: script_assembled`
- [x] 1.3 移除对 `video_prompt_rendered` / `isFreshVideoPromptRender` 的正文优先级分支

## 2. 面板与有效正文

- [x] 2.1 `effectiveVideoPrompt`：去掉 `renderStale` / `templateStale` 用户可见路径（或不再传入 panel）
- [x] 2.2 `OutgoingVideoPromptPanel`：删除/替换模板过期文案；徽章 `脚本拼装`；`Inspector` 摘要「正文来自脚本拼装」
- [x] 2.3 确认「恢复自动拼装」清除 override 后走脚本路径（双空场景）

## 3. 测试与文档

- [x] 3.1 更新 `verify-prompt-render.mjs`：脚本输出结构、与 request.prompt 一致
- [x] 3.2 更新 `verify-shot-inspector.mjs`：无 `renderStale` 文案；徽章语义层/脚本拼装
- [x] 3.3 README 出片提示词：九段 LLM 降为可选/历史；主路径为语义层 + 空时脚本拼装
- [x] 3.4 `openspec validate shot-prompt-script-bootstrap --strict`
