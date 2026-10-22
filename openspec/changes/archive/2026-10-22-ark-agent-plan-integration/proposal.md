# Proposal

## Why

用户持有的方舟 Agent Plan Key 只能访问 `/api/plan/v3`（OpenAI 兼容）和 `/api/plan`（Anthropic 兼容），标准 `/api/v3` 会拒绝它；同时 Agent Plan 的文本、图片模型 ID 与当前默认值不同，语音模型走独立的 `openspeech.bytedance.com` 接口。应用目前只认识标准方舟渠道和标准模型 ID，无法直接使用这套 Key，也没有火山 TTS 渠道。

## What Changes

- 新增 `ark-plan` 渠道类型与预设：Base URL 固定为 `https://ark.cn-beijing.volces.com/api/plan/v3`，承接文本与图片；不承接视频（当前套餐无视频模型）。
- 新增 Agent Plan 模型预设：文本 `doubao-seed-2.1-lite-260915`、`doubao-seed-2.1-pro-260915`，图片/三视图 `doubao-seedream-5-0-pro-260628`，以及可选的 DeepSeek / Kimi / GLM 文本模型。
- 全新实例的初始默认值：文本、高质量文本、配音指向 MiniMax（`MiniMax-M3` / `speech-2.8-hd`）；图片、三视图指向 Agent Plan；视频与视频参考仍走标准方舟。API Key 允许留空后填，缺 Key 时返回明确错误。
- MiniMax 文本走 OpenAI 兼容 `/chat/completions`；`MiniMax-M3` 的 JSON 请求关闭 thinking，避免 reasoning 吃光输出预算；空 content 返回 finish/usage 诊断。
- Key 解析优先使用设置库中的渠道 Key，其次读取本地 `.env` / 环境变量的专用变量（如 `MINIMAX_API_KEY`、`ARK_AGENT_PLAN_API_KEY`、`VOLC_TTS_API_KEY`）。
- 修复 Agent Plan 渠道的“测试”行为：该套餐不提供 `/models`，测试回退到 1-token 对话。
- 图片路由把 `ark-plan` 视为方舟协议，继续支持参考图与 `response_format: url`。
- 标准 `ark` 渠道保持原样，视频/视频参考继续走它；本次不新增 Agent Plan 视频模型，也不做运行时自动回退（按能力显式路由）。
- 新增 `volc-tts` 音频渠道类型与预设：调用 `https://openspeech.bytedance.com/api/v3/plan/tts/unidirectional`，使用 `X-Api-Key` 与 `X-Api-Resource-Id: seed-tts-2.0`。
- 新增火山 TTS 合成：按行解析 JSON、拼接 base64 音频、落盘 mp3；把 `AgentPlanDeductNotEnabled` 转成明确提示（去控制台开启扣减）。
- 音色列表改为按当前音频模型所属渠道返回；Inspector 切换配音模型时重新取音色，并显示“火山 Seed TTS”引擎名。
- **BREAKING**（仅内部接口）：`/api/voices` 增加 `modelKey` 参数，`listVoices()` 签名随之变化；`ProviderKind` 联合类型新增两个值。
- 不包含：ASR 转写、向量检索 UI、Agent Plan 视频、AFP 精确计价、自动渠道回退。

## Capabilities

### New Capabilities

- `model-provider-routing`: 按能力把生成请求路由到标准方舟或 Agent Plan 渠道，维护渠道/模型预设、连通性测试与能力边界。
- `voice-synthesis`: 通过火山 Seed TTS 2.0 合成台词语音，包括音色选择、行式 JSON 解析、音频落盘与错误提示。

### Modified Capabilities

无。

## Impact

- 代码：`vite.config.ts`（渠道类型、预设、测试端点、图片路由、TTS 客户端）、`src/api.ts`（`ProviderKind`、`VoiceList`、`listVoices`）、`src/Settings.tsx`（渠道类型与提示）、`src/App.tsx` / `src/Inspector.tsx`（音色刷新与引擎名）。
- 新增模块：`server/volc-tts.mjs`（TTS 请求/解析，便于用本地 mock 验证）与对应验证脚本。
- 数据：不涉及 SQLite schema 变更；设置 JSON 新增渠道/模型预设。全新实例默认指向 MiniMax（文本/配音）与 Agent Plan（图片）；已有设置保留保存的默认值；Key 可后填，也可直接放在本地 `.env` 的专用变量里。
- 外部服务：`ark.cn-beijing.volces.com/api/plan/v3`、`openspeech.bytedance.com/api/v3/plan`。
- 前提：TTS 需在 Agent Plan 控制台开启扣减；视频真实验证需要一个有效的标准方舟 Key。视频 HTTP 实现已由 `canvas-video-api` 提供，本变更不重复修改。
