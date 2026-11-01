# Proposal

## Why

角色配音应跟「谁说话」走：每个角色绑定音色与 TTS 渠道/模型，而不是整片共用画布 Inspector 或设置页默认。当前实现只在角色上存 `voiceId`（及元数据），合成请求仍用全局 `modelPick.audio`；角色板生成音色样本还误用 `settings.defaults.audio`，与音色列表不同源，导致「在设置页配模型、在角色选音色却对不上」的困惑。

## What Changes

- 角色卡 **音色** 页增加 **配音模型** 选择（与三视图模型同级的 `CapModelSelect`），写入并持久化 `voiceModelKey`（必要时同步 `voiceProvider`）。
- **新建/未配置角色**：配音模型默认继承 `settings.defaults.audio`；用户改选后以角色为准。
- **音色下拉** 按 **该角色当前配音模型** 拉取目录，不再仅跟随全局 Inspector 手选。
- **镜头台词配音**：每行说话人使用其角色的 `voiceModelKey`（缺省回落设置默认）；多说话人一镜内可混用不同 TTS 渠道。
- **角色音色样本** 生成使用同一解析规则（角色模型键），与样本指纹、`stale` 判定一致。
- 设置页保留 **默认配音模型** 与 **音色库管理**（运维/预置目录），不再作为「配每个角色引擎」的主入口；画布 Inspector 的「配音模型」改为 **镜头级覆盖/默认**（见 design）或只显示当前说话人角色模型（二选一在 design 定案）。
- 修复现有 **渠道不一致** 报错逻辑：以角色绑定的模型渠道校验，而非仅全局当前模型。

## Capabilities

### New Capabilities

（无 — 行为增量并入既有 capability 的 delta spec。）

### Modified Capabilities

- `voice-synthesis`：配音请求与音色列表解析从「全局单一音频模型」扩展为「角色绑定模型 + 默认回落」；多说话人混渠道；Inspector/角色板 UX 要求。
- `character-appearance`（或角色数据契约相关段落）：角色 MUST 持久化可选 `voiceModelKey`/`voiceProvider` 并与配音模型选择联动（若该 spec 已覆盖角色字段则只增 requirement）。

## Impact

- 前端：`CharacterBoard` / `CharacterCard`、`App.tsx`（`generateVoiceOne`、`listVoices` 调用方式）、`Inspector.tsx`（配音模型与镜头默认的关系）、`ModelSelect.tsx`（复用 `CapModelSelect`）。
- 数据：`project.json` 角色已有 `voice_model_key` / `voice_provider` 字段，需确保读写一致；`voiceSample.modelKey` 与 stale 逻辑对齐。
- 测试：`verify-providers.mjs` / 单元测试扩展角色 per-model 配音与样本生成。
- 文档：README 角色音色小节说明「模型跟角色、设置页只管默认与音色库」。
