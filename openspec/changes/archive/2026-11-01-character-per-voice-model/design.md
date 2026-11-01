# Design

## Context

见 `proposal.md`。现状摘要：

- `CharacterSheet` 已有 `voiceId` / `voiceProvider` / `voiceModelKey`；选音色时会写入后两者，但 **合成路径不读 `voiceModelKey`**。
- `App.generateVoiceOne` 对所有行使用 `modelPick.audio`；`resolveVoiceForSpeaker` 用 **全局** `audioModelKey` 推导 `currentProviderId` 做渠道校验。
- `CharacterBoard` 传 `audioModelKey={settings?.defaults?.audio}`，与 App 拉取 `voices` 用的 `modelPick.audio || defaults` 不一致。
- `/api/voice` 多行循环共用请求体 `modelKey`（`vite.config.ts` ~4754），每行仅 `voice`/`rate` 可不同。

## Goals / Non-Goals

**Goals:**

- 角色卡可选、可存配音模型；音色列表与样本生成跟该模型走。
- 镜头配音按 **说话人角色** 解析 `modelKey`；一镜多说话人可混不同 TTS 渠道（在服务端逐行合成已有拼接能力上扩展）。
- 设置页保留 **默认配音** + **音色库运维**；角色板成为「配声」主入口。
- 修复角色样本与列表/合成模型不一致。

**Non-Goals:**

- 不改 TTS 各渠道协议、音色克隆/设计能力（属 voice-catalog 范围）。
- 不做跨项目音色/模型模板复制。
- 不在本变更重构创意工坊能力托盘的配音绑定（仍可按既有 creative.models.audio 规则，后续可对齐）。

## Decisions

### 1. 权威字段：`voiceModelKey` 即角色配音模型

- **解析函数**（建议 `src/characters.ts` 或 `voiceCatalog.ts`）：

  `resolveCharacterAudioModelKey(character, settings) => trim(character.voiceModelKey) || trim(settings.defaults.audio) || ''`

- 新建角色：不写 `voiceModelKey` 直到用户手选；UI 显示「默认 · {label}」与 `CapModelSelect` 空值行为一致。
- 用户改配音模型：更新 `voiceModelKey` + `voiceProvider`（从模型 entry 取）；若现有 `voiceId` 渠道不匹配，**不清空** voiceId，但标记 UI 警告并阻止生成直至改音色（与 spec 一致）。

**替代方案**：新增独立字段 `audioModelKey` 与 `voiceModelKey` 并存 — 重复语义，放弃。

### 2. 角色板 UI：与三视图并列的 `CapModelSelect cap="audio"`

- `CharacterBoard` 接收 `audioModelKey` / `onPickAudioModel` **按当前编辑角色** 不适用 — 模型 per character，选择器放在 `CharacterCard` 音色 pane 内（每卡独立），或顶栏仅当「选中单卡」时显示。推荐：**音色 Tab 内** 先「配音模型」再「音色」，避免顶栏多角色歧义。
- 改模型时：`listVoices(modelKey)` 拉目录；可复用 App 层 `Map<modelKey, VoiceOption[]>` 缓存，避免 N 卡重复请求。

**替代方案**：顶栏全局 audio 手选 — 回到旧问题；放弃。

### 3. 镜头配音：去掉 Inspector 对合成的全局 `modelPick.audio` 依赖

- `generateVoiceOne`：对每行 `resolveCharacterAudioModelKey(char, settings)`，传入 `/api/voice`。
- **API 扩展**（向后兼容）：`body.modelKey` 仍为默认；`lines[i].modelKey` 可选，缺省用 `body.modelKey`。客户端多说话人时每行带上解析后的键。
- `voiceMeta.model`：存 **主说话人** 或 **混用** 摘要（例如 `mixed` + `applied` 数组）；至少记录第一行模型键以便调试。
- Inspector **移除**「配音模型」`CapModelSelect`，改为只读说明：「按角色绑定模型；到角色板修改」。若镜头无 cast 映射，用 `defaults.audio` + 镜头 `voiceName`（与 today 无角色时一致）。

**替代方案**：保留 Inspector 全局覆盖 — 与「模型跟角色」冲突；放弃。

### 4. 全局 `modelPick.audio` 与 App voices effect

- `listVoices` 的全局 effect 若仅服务 Inspector，可改为 **按需**（角色板/cache、Inspector 展示引擎名从角色解析）。
- `localStorage modelPick.audio` 可 deprecate：迁移时忽略或一次性删除键，避免用户以为仍生效。

### 5. 渠道校验

- `resolveVoiceForSpeaker` 改为接受 `modelKey` 或 `currentProviderId` **来自该行角色**，而非全局 `audioModelKey`。
- 错误文案指向「在该角色上切换配音模型或音色」。

## Risks / Trade-offs

- **[Risk] 一镜混渠道合成延迟更高** → 已有多段合成+ffmpeg 拼接；接受，并在 UI 提示多渠道镜耗时。
- **[Risk] 每角色拉 voices 请求增多** → App 级按 modelKey 缓存 + 设置页 refresh 时 invalidate。
- **[Risk] 旧项目只有 voiceId 无 voiceModelKey** → 回落 defaults.audio；若 provider 与 voiceId 不匹配，首次生成报错并引导打开角色卡重选。
- **[Risk] Inspector 用户习惯全局切模型** → 只读提示 + README；一个版本后可观察反馈。

## Migration Plan

1. 实现解析函数与服务端 `lines[].modelKey`。
2. 角色 UI + 持久化；样本/配音读解析键。
3. Inspector 移除全局下拉，调整 tests（`verify-providers.mjs`、`verify-stage-models-ui.mjs` 若断言 Inspector 配音模型则改角色板路径）。
4. 可选：打开项目时对缺 `voiceModelKey` 的角色不写盘，仅 UI 显示默认。

回滚：恢复 `generateVoiceOne` 单键 + Inspector 下拉；角色新增字段可保留（无害）。

## Open Questions

- 镜头级「临时 override 模型」（不写入角色）是否需要 — **首版不做**，减少状态面。
- 批量配音进度条是否按行显示不同引擎 — **首版不做**，仅错误信息区分。
