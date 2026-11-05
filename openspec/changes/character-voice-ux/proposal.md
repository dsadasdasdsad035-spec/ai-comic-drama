# Proposal

## Why

角色「声音」能力已改为按角色绑定配音模型，但 UI 仍像设置页堆叠下拉 + 分散警告，用户常搞不清「为什么不能生成试音」、换引擎后要不要重选音色，以及角色页与画布镜头配音的分工。需要一次以状态驱动、区块化、主操作明确的 UX 改造，降低配置错误与 silent fail。

## What Changes

- 角色卡 Tab 文案与结构：推荐 **「声音」**（或保留「音色」但页内分区标题明确「引擎 / 音色 / 试音」）。
- **状态轨（status strip）**：单行展示当前最高优先级阻塞（缺项目、无音色目录、未选音色、渠道不一致、样本 stale、就绪等），并给出**单一主修复动作**。
- **三块布局**：A 配音引擎、B 说话音色、C 试音样本（Seedance）；底栏说明镜头台词在画布 Inspector。
- **换配音模型交互**：旧 `voiceId` 在新目录不存在或渠道变化时，默认引导 **重选音色**（可选高级「保留原 voiceId」）；禁止静默改 provider 却保留跨渠道 id 仍可点生成。
- **试音区**：试音稿预览 + 编辑与「生成试音」同屏；一个 primary 按钮，删除样本降为次要。
- **卡片 summary**：外显引擎 + 音色 + 试音状态（可用 / 需重生成 / 未配置）；Tab 可选状态点。
- **空态**：当前引擎无音色时，链到设置页音色库/Key 说明，而非单行 hint。

## Capabilities

### New Capabilities

（无）

### Modified Capabilities

- `character-appearance`：角色卡「声音」页信息架构、状态展示、换模型与试音生成的 UX 与可访问性要求。
- `workbench-shell`：角色工作台 Tab/摘要与声音配置状态的外显约定（若与 shell 规范冲突则只在 character-appearance 写细，shell 写一条 cross-ref）。

## Impact

- 前端：`CharacterCard.tsx`（`renderVoice`）、`theme.css`（`.char-voice-*`）、可选 `verify-character-card-ui.mjs`。
- 行为：`setAudioModel` / 渠道不一致恢复流（与 `character-per-voice-model` 数据模型兼容，不重复改 API）。
- 文档：README 角色声音小节与 Inspector 分工文案对齐。
