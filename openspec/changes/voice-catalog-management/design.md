# Design

## Context

动机见 `proposal.md`，行为契约见 `specs/voice-catalog` 与 `specs/voice-provisioning`。现状：

- `/api/voices`（`vite.config.ts:1180`）按渠道返回：MiniMax 固定 `MINIMAX_VOICES` 4 个、火山固定 `VOLC_TTS_VOICES` 2 个、APIMart 固定 `APIMART_VOICES`，ElevenLabs 动态 `/v1/voices`，其余回落 macOS `probeSayVoices()`。
- `CharacterBoard` 只接收 `voices: {id,label}[]` 并渲染一个 `<select>`；没有自定义条目、来源分组或刷新。
- `App.generateVoiceOne` 用 `available.some(v => v.id === voice)` 校验，显式 voice 不在列表时会回落到默认；`server/volc-tts.mjs` 的 `pickSpeaker` 也只认固定数组，MiniMax/APIMart 的适配器也会回落到默认 voice。
- 设置库只存渠道/模型/定价/技能等，没有“自定义音色”条目；项目角色只存 `voiceId`。
- 渠道能力差异大：MiniMax 有 voice management（system/clone/design），ElevenLabs 有账号音色，火山有 speaker/克隆（接口需确认），APIMart `gpt-4o-mini-tts` 只有 OpenAI 预置音色，macOS 只能用系统已安装语音。

## Goals / Non-Goals

**Goals:**

- 所有渠道都进入同一目录协议，UI 能明确看到来源、渠道和可用能力。
- 支持动态目录的渠道自动列出账号音色；只支持预置的渠道不出现假的新增入口。
- 对支持自定义 voice id 的渠道，允许添加/删除自定义条目并可被角色选择。
- 显式 voiceId 不再静默回落到默认；错误可读且可定位。
- 目录刷新、缓存失效、空态/错误态可操作。
- 为 MiniMax/ElevenLabs/火山中真正支持克隆/设计的渠道预留创建能力；不支持的渠道明确禁用。

**Non-Goals:**

- 不把 APIMart `gpt-4o-mini-tts` 做成可克隆渠道；它没有该能力。
- 不在应用内创建 macOS 系统语音。
- 不做跨渠道 voice id 迁移、跨渠道音色复用。
- 不做未授权真人声音克隆；不在没有确认的情况下自动提交克隆/设计。
- 不在本变更里改 TTS 音频合成协议或音色 DSP。

## Decisions

### 1. 统一 VoiceEntry 与 provider adapter

`/api/voices` 返回：

```ts
type VoiceSource = 'preset' | 'account' | 'clone' | 'design' | 'system' | 'custom'

type VoiceEntry = {
  id: string              // 目录内稳定 id（provider + voiceId 的复合键）
  voiceId: string         // 真正发给渠道的 id
  label: string
  provider: string        // 渠道 id
  providerKind: string
  modelKey?: string
  source: VoiceSource
  note?: string
}

type VoiceCapabilities = {
  supportsList: boolean
  supportsCustomVoiceId: boolean
  supportsClone: boolean
  supportsDesign: boolean
  supportsPreview: boolean
  maxCustomVoices?: number
}
```

服务端每渠道一个 adapter：

```ts
listVoices(ctx): Promise<{ entries: VoiceEntry[]; capabilities: VoiceCapabilities; error?: string }>
preview?(ctx, entry, text): Promise<AudioPreview>
clone?(ctx, input): Promise<VoiceEntry>
design?(ctx, input): Promise<VoiceEntry>
```

目录响应同时返回 `capabilities`，UI 只根据能力显示按钮；不要在组件里判断渠道名。

替代方案：继续按渠道写死数组 + 各页面自行判断。与“所有渠道”目标冲突，且自定义/错误态散落；不采纳。

### 2. 渠道能力矩阵

| 渠道 | list | custom voiceId | clone | design | 说明 |
|---|---|---|---|---|---|
| MiniMax | 是（`/v1/get_voice`） | 是 | 是（账号/接口允许时） | 是（接口允许时） | system/clone/design 来源 |
| ElevenLabs | 是（`/v1/voices`） | 是 | 账号侧/接口允许时 | 账号侧/接口允许时 | 已有动态列表 |
| 火山 Seed TTS | 是（speaker 列表接口可用时） | 是（标注未验证） | 账号/接口允许时 | 否 | 当前 `pickSpeaker` 要允许自定义 |
| APIMart | 是（固定预置） | 否 | 否 | 否 | OpenAI 兼容预置 |
| macOS say | 是（本机探测） | 否 | 否 | 否 | 系统语音 |

能力未探测/接口失败时 `supports*` 为 false 并带错误；预置目录仍可展示，不把错误当成“没有音色”。

### 3. 自定义音色是设置库条目，不是项目数据

`AppSettings` 增加：

```ts
type CustomVoice = {
  id: string
  label: string
  provider: string
  modelKey?: string
  voiceId: string
  note?: string
  createdAt: string
}
customVoices?: CustomVoice[]
```

- 设置页音色管理按当前渠道筛选，添加/删除；保存到 SQLite `settings` 的 `app` JSON，不写项目。
- 角色只保存 `voiceId`，并可选记录 `voiceProvider`/`voiceModelKey` 用于校验；旧角色没有 provider 时按当前音频模型解释。
- 自定义条目的 `id` 由 provider + voiceId 生成，避免不同渠道同名 id 冲突；角色仍存实际 `voiceId`，保持旧数据兼容。

替代方案：新增音色表。需要迁移、路由、项目隔离，收益低；`app` JSON 已足够。

### 4. 角色下拉合并目录、自定义和旧值

`CharacterBoard` 接收扩展后的 `VoiceEntry[]`：

- 按渠道/来源用 `<optgroup>` 分组：预置、账号、克隆/设计、自定义、系统。
- 当前 `voiceId` 不在目录时显示“未知/保留原值”；用户可保留，保存不改写。
- 用户选择条目时保存 `voiceId`，并写入可选 `voiceProvider`/`voiceModelKey`。
- 切换音频模型时，目录切换；旧渠道的 voiceId 标记“不属于当前渠道”，不自动替换。

替代方案：只显示当前目录并清空旧值。会造成旧项目音色丢失；不采纳。

### 5. 显式音色不回落，默认只在“未指定”时使用

`App.generateVoiceOne` / `server` TTS 分发：

- 角色/镜头显式 `voiceId`：总是使用它；如果 `voiceProvider` 与当前音频模型不一致，直接报错并提示切模型/改音色。
- 供应商拒绝：返回可读错误（401/权限/voice not found），保留角色值，不静默换成默认。
- 只有没有显式 voiceId 或用户明确选择“跟随默认”时，才使用渠道默认。
- 火山 `pickSpeaker`、MiniMax `vid` 回落、APIMart `normalizeVoice` 回落都改为“仅默认路径回落”；显式自定义 id 原样发送，由供应商校验。
- 试听/音色样本生成复用同一解析，保证下拉里能选的音色和实际发送一致。

替代方案：继续“列表里没有就回落”。用户会以为自定义音色生效但实际用了别人；不采纳。

### 6. 目录刷新与缓存

- 每个 adapter 有独立缓存（provider + model + key 指纹），默认 10 分钟；`refresh=1` 强制刷新。
- 切换音频模型、修改渠道 Key、401/403、创建/删除自定义条目时使对应缓存失效。
- 目录请求失败时返回 `entries` 的预置回退和 `error`；UI 显示错误与重试，不把旧账号音色当成当前账号音色。
- 自定义条目本地立即生效，不依赖账号目录请求。

### 7. 创建能力只对声明支持的渠道出现

MiniMax/ElevenLabs/火山 adapter 按能力暴露 `clone`/`design`；UI 只在 `supportsClone`/`supportsDesign` 为 true 时显示入口。

- MiniMax：`/v1/get_voice` 列账号音色；克隆/设计按当前官方接口探测，上传/授权样本前展示确认和成本。
- ElevenLabs：已有 `/v1/voices`；应用内没有创建接口时只给账号控制台说明，不伪造。
- 火山：speaker 列表/克隆接口需探测；没有列表时允许自定义 speaker id，标“未验证”。
- APIMart/macOS：入口禁用并说明原因。

创建成功刷新目录；失败不加入半成品；样本/Key 不写项目；真实克隆/设计调用需确认和授权记录。

### 8. 预览与试听

- 有 `supportsPreview` 的渠道提供“试听”按钮，使用当前渠道和音色合成一句中性短句；试听结果只临时播放，不写项目。
- 自定义/账号音色在加入角色前可试听；失败显示供应商错误，不自动换默认。
- 试听和角色音色样本使用同一 TTS 分发，避免试听能播、正式合成却用另一个 id。

## Risks / Trade-offs

| 风险 | 缓解 |
|---|---|
| MiniMax `/v1/get_voice` 的返回分类/权限与文档不一致 | adapter 先探测，失败时保留预置；不把未知分类当账号音色 |
| 火山 speaker/clone 接口未文档化或不稳定 | 先接 speaker 列表；自定义 ID 标未验证；失败透出供应商原因 |
| APIMart 不能新增音色，用户会觉得“所有渠道”没做到 | 能力矩阵明确显示“不支持应用内创建”，不伪造入口 |
| 克隆授权/真人声音风险 | 创建前要求来源/授权；不自动提交；记录来源和使用范围 |
| 显式 voiceId 不再回落，旧项目可能突然报错 | 只对显式/自定义 id 生效；旧项目未指定时仍用默认；错误可读并可回到下拉 |
| 目录缓存导致新音色不出现 | 刷新按钮 + 切换模型/Key 失效；创建成功主动失效 |
| 跨渠道同名 voice id | 目录 id 用 provider + voiceId；角色记 provider/model 可选字段；不跨渠道复用 |
| 试听/创建产生费用 | 创建/试听前展示成本；真实调用人工确认；自动化只 mock |

## Migration Plan

1. 增加 `VoiceEntry`/`Capabilities` 类型与 `/api/voices` adapter 协议，保留现有预置数组作为回退。
2. MiniMax/ElevenLabs 动态目录；火山 speaker 列表/自定义；APIMart/macOS 能力描述。
3. `customVoices` 设置、音色管理页、刷新/添加/删除/试听。
4. `CharacterBoard` 下拉分组、旧值保留、provider/model 校验。
5. `generateVoiceOne`/server TTS 改为显式不回落，更新错误提示。
6. 创建能力按渠道接入；未探测通过的渠道保持禁用。
7. 测试、文档、证据。

回滚：删除 `customVoices` 不影响旧音色；目录 adapter 失败时回退预置；显式不回落逻辑可按 feature flag/设置关闭；项目数据不迁移。

## Open Questions

- 火山 Seed TTS 当前账号可用的 speaker 列表/克隆接口具体字段和权限，需要实现前探测。
- MiniMax `voice_design`/`voice_clone` 当前账号的接口版本、样本时长/格式和计费，需要按官方文档与账号实测。
- ElevenLabs 当前接入是否暴露应用内创建接口，还是只做账号控制台跳转；首期可只做动态目录 + 试听。
