# Design

## Context

当前渠道抽象只有 `ark`、`openai`、`minimax`、`elevenlabs` 四种 `ProviderKind`。标准方舟渠道使用 `/api/v3`，改造前的默认模型是 `doubao-seed-2-0-lite-260428` / `doubao-seed-2-1-pro-260915` / `doubao-seedream-4-5-251128` / `doubao-seedance-1-0-pro-250528`。文本路由对非 MiniMax/ElevenLabs 的渠道走 `{base}/chat/completions`，图片路由只对 `kind === 'ark'`（改造后含 `ark-plan`）启用参考图，视频路由只接受 `kind === 'ark'`。本次把全新实例的文本/配音默认切到 MiniMax，图片/三视图切到 Agent Plan；已有设置保留用户保存的默认值。

Agent Plan 的约束已经实测：

- Key 只在 `/api/plan/v3`（OpenAI）与 `/api/plan`（Anthropic）可用；
- 文本、图片、向量可用，视频模型全部不存在；
- 语音走独立的 `openspeech.bytedance.com/api/v3/plan/tts/unidirectional`，鉴权用 `X-Api-Key` + `X-Api-Resource-Id: seed-tts-2.0`；
- TTS 当前被账户级 `AgentPlanDeductNotEnabled` 挡住。

设置以 JSON 存在 SQLite 的 settings 表。`normalizeSettings` 对已有 providers/models 数组原样返回，因此只在代码里新增预设不会自动出现在已保存的设置里。`canvas-video-api` 已把视频实现改为 HTTP 客户端，本次不重复改视频链路。

## Goals / Non-Goals

**Goals:**

- 用独立渠道类型承接 Agent Plan 的文本/图片与火山 TTS，避免和标准方舟 Key 串用。
- 新增预设后，已有设置也能一次性拿到新渠道/模型，同时不覆盖用户已改的默认值。
- 全新实例的文本、高质量文本、配音默认指向 MiniMax；图片、三视图指向 Agent Plan；Key 允许留空后填。
- 本地设置库或本地 `.env` / 环境变量有 Key 时自动使用；设置库优先。
- 渠道测试对新协议给出可操作结果，尤其是 TTS 扣减未开启。
- TTS 解析与下载逻辑可以脱离 Vite、用本地 mock 验证。

**Non-Goals:**

- 不做运行时自动渠道回退；每个能力只认设置里显式选定的渠道/模型。
- 不为 Agent Plan 添加视频模型；视频继续走标准 `ark`。
- 不实现 ASR、向量检索 UI、AFP 精确计价。
- 不覆盖已有设置里保存的默认值；全新实例才使用 MiniMax / Agent Plan 初始默认。
- Key 允许留空后填；缺 Key 时返回明确错误，不做标准 Key 兜底。

## Decisions

### 1. 新增 `ark-plan` 与 `volc-tts` 两个 ProviderKind

`ark-plan` 使用 `https://ark.cn-beijing.volces.com/api/plan/v3`，`caps: ['text','image']`；`volc-tts` 使用 `https://openspeech.bytedance.com/api/v3/plan`，`caps: ['audio']`。

**理由**：复用 `ark` 会让 `providerKey()` 在没填 Key 时回落到 `.env` 的标准方舟 Key，正好是 Agent Plan 不接受的 Key；同时测试端点、图片参考图开关、视频渠道过滤都需要区分协议。新增 kind 后这些判断可以显式表达。

**替代方案**：只加一个 provider 条目、不改 kind。改动更小，但缺 Key 时会串用标准 Key，且测试端点无法区分；放弃。

**Key 解析优先级**：`provider.apiKey`（设置库）> 本地 `.env` / 环境变量专用 Key。`ark-plan` 依次读 `ARK_AGENT_PLAN_API_KEY`、`ARK_PLAN_API_KEY`、`VOLC_API_KEY`；`volc-tts` 依次读 `VOLC_TTS_API_KEY`、`ARK_AGENT_PLAN_API_KEY`、`ARK_PLAN_API_KEY`、`VOLC_API_KEY`；标准 `ark` 仍走 `ARK_API_KEY`。设置库有值时不再读 env，避免两个 Key 打架；专用变量排在通用 `VOLC_API_KEY` 前面，避免旧值覆盖新 Key。

### 2. 按能力显式路由，不实现自动回退

模型表的一行就是“能力 + 渠道 + 模型 ID”。用户为文本/图片选 Agent Plan，为视频/视频参考选标准方舟；请求失败直接返回错误。

**理由**：视频、图片都是计费任务，自动回退可能重复提交；显式路由也更容易解释账单。Agent Plan 渠道不声明 `video` 能力，视频模型下拉里自然看不到它。

**替代方案**：捕获 `UnsupportedModel` 后换渠道重试。会隐藏配置错误并可能重复扣费；放弃。

### 3. 预设与初始默认值

给 `AppSettings` 增加 `presetsVersion?: number`。读取设置时，如果版本低于当前值，把缺失的新 providers/models 追加到已有数组，然后写回新版本；之后用户删除预设不会在每次加载时被重新加回来。`defaults` 采用 `{ ...DEFAULT_DEFAULTS, ...(raw.defaults || {}) }`，所以已有设置里保存的默认值优先，不被迁移覆盖。

新增预设：

```
ark-plan  -> 文本 lite   doubao-seed-2.1-lite-260915
          -> 高质量 pro  doubao-seed-2.1-pro-260915
          -> 图片/三视图 doubao-seedream-5-0-pro-260628
          -> 可选文本    deepseek-v4-pro / kimi-k3 / glm-5.3
volc-tts  -> 音频        doubao-seed-tts-2.0
```

`DEFAULT_DEFAULTS` 指向 MiniMax（文本/配音）与 Agent Plan（图片）：

```
text / textPro -> minimax-text / minimax-text-pro（MiniMax-M3）
image / view   -> ark-plan-image / ark-plan-view
audio          -> minimax-tts（speech-2.8-hd）
video / videoRef -> ark-video / ark-video-ref（标准方舟，不变）
```

MiniMax 复用现有 `minimax` kind，文本/高质量文本都用 `MiniMax-M3`（实测 3 集约 30 秒，快于 Agent Plan lite 的约 116 秒），配音用 `speech-2.8-hd`。音色不在 `MINIMAX_VOICES` 时回落到 `male-qn-qingse`，避免把 macOS 的 `Tingting` 发给 MiniMax 报 `2054 voice id not exist`。Key 解析：设置库 > `MINIMAX_API_KEY` > 空。

全新实例没有保存过设置时使用这组初始默认；Key 允许为空，文本/图片/配音会在生成时返回明确的缺 Key 错误，且不会回退到其他渠道的 Key。

**理由**：直接改 `DEFAULT_MODELS` 对已有 `raw.models` 无效；每次读时无条件合并又会把用户删掉的预设置回。版本化迁移只跑一次；默认值只在没有用户保存值时才生效。

### 4. 渠道测试按协议分支

- `ark-plan`：跳过 `/models`（实测返回 400），直接取该渠道绑定的文本模型发 1-token 对话；没有文本模型时返回“先添加文本模型”。
- `volc-tts`：向 TTS 端点发空请求（不产生音频）。`code: 45000000`（缺少 req_params）视为鉴权通过；`AgentPlanDeductNotEnabled` 返回“Key 可用，但需开启 Agent Plan 扣减”；401/403 为鉴权失败。

**理由**：Agent Plan 不提供 models 列表；TTS 没有免费鉴权端点，但空请求在扣减检查之前即可判断 Key 是否有效。

### 5. TTS 客户端抽到 `server/volc-tts.mjs`

模块负责 HTTP 与行式 JSON 解析，返回合并后的音频 Buffer 与引擎标识；`vite.config.ts` 负责写文件、用 ffprobe 取时长。请求固定：

```
POST {base}/tts/unidirectional
X-Api-Key: <provider key>
X-Api-Resource-Id: seed-tts-2.0
X-Api-Connect-Id: <uuid>
body: { user, req_params: { text, speaker, audio_params: { format: "mp3", sample_rate: 24000 } } }
```

解析规则：每行一个 JSON；`code === 0` 收集 `data` 的 base64；`code === 20000000` 结束；其他非零码抛错并保留 `code/message`。非空且非 JSON 的行视为协议错误。

**理由**：与 `server/video.mjs` 一致，可用本地 mock HTTP server 验证多块拼接、错误码和扣减提示，不必真调语音。

**替代方案**：直接写在 `synthesize()` 里。`vite.config.ts` 已经很大，且无法独立测试；放弃。

### 6. 音色列表按音频模型所属渠道返回

`/api/voices?modelKey=...`：先解析音频模型，再按渠道返回：

- `volc-tts`：静态音色表（首版 `zh_female_vv_uranus_bigtts`、`zh_female_gaolengyujie_uranus_bigtts`）；
- `elevenlabs`：沿用现有 API 查询；
- 其他：沿用 macOS say 音色。

缓存从单一 `voiceCache` 改为按 provider id 缓存。前端 `listVoices(modelKey)`，App 的音色 effect 依赖当前 `modelPick.audio`；Inspector 切换配音模型后重新拉取。引擎名增加“火山 Seed TTS”。

**理由**：当前音色列表是全局的，切到火山 TTS 仍会显示 ElevenLabs/say 的音色，`voiceName` 会传错。按模型取列表是唯一不会串音色的做法。

### 7. 语速参数首版不映射

火山 TTS 请求体里暂不写语速字段；Inspector 的慢/中/快仍只对 ElevenLabs / say 生效。等确认 Agent Plan TTS 支持的语速参数后再补。

**理由**：当前扣减未开启，任何额外参数都无法实测；先不引入未验证字段。

### 8. 视频链路保持现状

`ark-plan` 不声明视频能力，视频/视频参考继续绑定标准 `ark` 渠道。视频路由的 `kind === 'ark'` 判断暂不扩展；等有含视频的 Agent Plan 套餐并验证模型后再改。

**理由**：当前套餐没有任何可用的 Seedance 模型，提前放宽只会制造 404。

### 9. MiniMax 文本走 `/chat/completions`，结构化请求关闭 thinking

MiniMax 的 `/text/chatcompletion_v2` 与 `/chat/completions` 都能用，但只有后者支持 `thinking` 开关。实测拆镜 prompt 下 `MiniMax-M3` 默认思考把 8192 token 全部用于 reasoning（`reasoning_tokens=8192`），content 为空，前端只看到“不是合法 JSON”。同一 prompt 传 `thinking: { type: "disabled" }` 后 13.5 秒返回 14 个镜头 JSON。

因此 MiniMax 文本统一走 `/chat/completions`；`MiniMax-M3` + `json: true` 时传 `thinking.type = disabled`，非 JSON 用 `adaptive`；content 为空时返回包含 `finish_reason`、completion 与 reasoning token 的明确错误。**替代方案**：换 `MiniMax-M2.7-highspeed`，同 prompt 约 60 秒能出 JSON，但更慢；保留为可选模型。

## Risks / Trade-offs

- **TTS 扣减未开启** → 合成和测试都返回 `AgentPlanDeductNotEnabled`；错误提示直接告诉用户去控制台开启，代码不做自动重试。
- **预设模型随套餐下线** → 只预置截图中未标“即将下线”的 ID；模型表可编辑，后续在设置页替换。
- **一次性预设迁移** → 用户首次升级会看到新渠道/模型；删除后不会复活。迁移失败时保留原设置，不清空。
- **音色缓存串渠道** → 缓存键改为 provider id；切换模型时前端重新请求。
- **语音 ID 与旧数据不兼容** → App 已有“当前 voiceName 不在列表则回落首个音色”的逻辑，沿用。
- **AFP 计费与人民币估价不一致** → 计价仍是估算；在渠道备注/设置提示里说明，不能当作账单。
- **标准方舟 Key 无效** → 视频无法实测；本次代码不依赖视频 Key，等用户提供有效 Key 后验证。
- **本地 `.env` 混有旧 Key** → `ark-plan` / `volc-tts` 只读专用变量优先，标准 `ark` 才读 `ARK_API_KEY`；都不匹配时明确报缺 Key，不静默串号。
- **Key 泄露风险** → Key 只存设置 DB 或环境变量，不写进代码；两个已出现在聊天里的 Key 建议轮换。
- **TTS 行式响应格式变化** → 解析器对非 JSON 行和未知 code 报错，不静默产出空音频。

## Migration Plan

1. 新增 `server/volc-tts.mjs` 与 mock 验证脚本。
2. 扩展 `ProviderKind`、`capsOfKind`、`KIND_META`、`Provider` 预设与模型预设。
3. 加 `presetsVersion` 一次性合并；`DEFAULT_DEFAULTS` 文本/配音指向 MiniMax、图片/三视图指向 Agent Plan；已有设置保存的默认值不被覆盖；全新实例无 Key 时生成返回 `no-key`，不回退其他渠道 Key。Key 解析增加本地 `.env` 兜底（设置库优先）。
4. 图片路由把 `ark-plan` 视为方舟协议；文本路由沿用 OpenAI 兼容分支。
5. 测试端点增加 `ark-plan` / `volc-tts` 分支。
6. 音频路由增加 `volc-tts` 合成分支；音色接口与前端联动。
7. 回归：全新实例默认值与无 Key 行为、设置接口、渠道测试、mock TTS、真实文本 1-token、真实图片一张、真实 TTS 一句；视频等有效标准 Key。
8. 回滚：删除新增渠道/模型或回退代码；不涉及数据库 schema，`presetsVersion` 字段可保留。

## Open Questions

无。
