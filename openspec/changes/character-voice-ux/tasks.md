# Tasks

## 1. 状态与逻辑

- [x] 1.1 新增 `resolveVoiceUiState`（或同文件内纯函数）集中 voice 页阻塞优先级；`tests/` 或 `verify-voice-catalog.mjs` 旁路单测覆盖 mismatch / 无 voiceId / 无 voices。验证：单测通过。
- [x] 1.2 调整 `setAudioModel`：引擎切换且 voiceId 不在新目录时清空 voiceId、标记 sample stale、展示 inline 引导（不 silent 跨渠道生成）。验证：手动换引擎后 strip 提示重选音色。

## 2. UI 结构

- [x] 2.1 重构 `CharacterCard.renderVoice` 为 status strip + 三块（engine/voice/sample）+ footnote；Tab 文案改「声音」。验证：`data-char-tab=voice` 或等价选择器仍可用于 E2E。
- [x] 2.2 试音区：试音稿预览 + 编辑入口、播放器与单一 primary「生成试音」；警告只出现在 status strip 或 sample 块底部。验证：无 voiceId 时 primary 禁用且 strip 说明原因。
- [x] 2.3 更新 `char-summary` 显示引擎 + 音色 + 试音状态；可选 Tab 状态点 CSS。验证：summary 文案与声音 Tab 内状态一致。

## 3. 样式与文档

- [x] 3.1 `theme.css` 增加 `.char-voice-status`、`.char-voice-block`、与 Inspector `voice-box` 对齐的 sample 卡片样式；窄列 strip 可折叠。验证：角色 grid 窄宽度下无横向溢出。
- [x] 3.2 README 角色声音小节：三块分区、状态轨、与 Inspector 分工。验证：与 UI 文案一致。

## 4. 回归

- [x] 4.1 扩展 `verify-character-card-ui.mjs`（或新建 voice 段）：断言 status strip、三块、`data-cap-model-select=audio`、无 voiceId 时生成禁用。验证：脚本通过（需 dev server 时文档注明）。
- [x] 4.2 `npm run build` 与 `openspec validate character-voice-ux --strict`。验证：构建与校验通过。

## Workflow follow-up

- 实现完成后 `/opsx-archive`；若与未推送的 `character-per-voice-model` 代码同分支，一并推送。
