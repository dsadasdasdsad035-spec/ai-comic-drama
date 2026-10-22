# Tasks

## 1. 渠道类型与模型预设

- [x] 1.1 在 `vite.config.ts` 与 `src/api.ts` 扩展 `ProviderKind` 为 `ark-plan` / `volc-tts`，补 `capsOfKind`、`KIND_META`、`DEFAULT_PROVIDERS`（`ark-plan` 文本+图片、`volc-tts` 音频）与 `DEFAULT_MODELS`（文本 lite/pro、图片/三视图、火山 TTS）。验证：`GET /api/settings` 返回两个新渠道与预设模型；设置页把 `ark-plan` 分到文本/图片组、`volc-tts` 分到音频组。
- [x] 1.2 给 `AppSettings` 增加 `presetsVersion`，在读取设置时一次性合并缺失的新渠道/模型，不覆盖现有 `defaults`。验证：用没有 `presetsVersion` 的旧 settings 读取后出现新预设且默认值不变；保存后删除一个预设，重新读取不会复活。
- [x] 1.3 图片路由把 `ark-plan` 视为方舟协议（参考图可用），文本路由走既有 OpenAI 兼容分支。验证：新增 `verify-agent-plan.mjs`，用本地 mock 服务承载 `chat/completions` 与 `images/generations`，确认两个请求命中正确路径且参考图字段保留。
- [x] 1.4 确认视频/视频参考默认模型仍绑定标准 `ark`，`ark-plan` 不出现在视频渠道列表。验证：设置页视频组只列标准方舟；`GET /api/settings` 的 `defaults.video/videoRef` 仍指向 `ark-video/ark-video-ref`。
- [x] 1.5 把 `DEFAULT_DEFAULTS` 切到 MiniMax（文本/高质量文本/配音）与 Agent Plan（图片/三视图）初始默认，视频/视频参考仍标准 `ark`；Key 允许为空。验证：用临时 `SB_PROJECTS_DIR` 启动全新实例，`GET /api/settings` 默认指向 MiniMax/Agent Plan 且新渠道无 Key；不填 Key 调 `/api/text` 返回 `no-key`；已有本地设置默认不被覆盖。
- [x] 1.6 渠道 Key 解析改为“设置库优先，其次本地 `.env` / 环境变量”：`ark-plan` 读 `ARK_AGENT_PLAN_API_KEY` / `ARK_PLAN_API_KEY` / `VOLC_API_KEY`，`volc-tts` 读 `VOLC_TTS_API_KEY` / `ARK_AGENT_PLAN_API_KEY` / `ARK_PLAN_API_KEY` / `VOLC_API_KEY`，`minimax` 读 `MINIMAX_API_KEY`。验证：临时实例清空渠道 Key 后，仍能用 `~/.canghe-skills/.env` 的 `ARK_AGENT_PLAN_API_KEY` 调通文本与 TTS 测试。
- [x] 1.7 新增/更新 MiniMax 预设：`minimax-text` / `minimax-text-pro` 用 `MiniMax-M3`，`minimax-tts` 用 `speech-2.8-hd`；MiniMax 音色不在静态表时回落到 `male-qn-qingse`。验证：默认文本 200，默认配音生成 mp3，四个静态音色均可用，不再报 `2054 voice id not exist`。
- [x] 1.8 修复 MiniMax 拆镜空 content：文本统一走 `/chat/completions`，`MiniMax-M3` 的 JSON 请求传 `thinking: {type:"disabled"}`，空 content 返回 finish/usage。验证：真实拆镜 prompt 通过 `/api/text` 返回 16 个镜头，不再报“不是合法 JSON”。

## 2. 渠道测试

- [x] 2.1 为 `ark-plan` 增加测试分支：跳过 `/models`，用该渠道绑定的文本模型发 1-token 对话；没有文本模型时返回“先添加文本模型”。验证：mock 服务让 `/models` 返回 400、`chat/completions` 返回 200，测试结果通过；删除文本模型后测试返回明确提示。
- [x] 2.2 为 `volc-tts` 增加不合成音频的测试分支：空请求得到 `45000000` 视为鉴权通过，`AgentPlanDeductNotEnabled` 提示开启扣减，401/403 报鉴权失败。验证：mock TTS 服务分别返回三种响应，测试结果与消息符合预期。

## 3. 火山 TTS 合成

- [x] 3.1 新增 `server/volc-tts.mjs`：构造 `X-Api-Key` / `X-Api-Resource-Id: seed-tts-2.0` / 连接 ID 请求，解析行式 JSON，合并 `code:0` 的 base64 音频，处理 `20000000` 结束标记与业务错误。验证：新增 `verify-volc-tts.mjs`，mock 覆盖多块音频、空音频、非 JSON 行、扣减未开启、401，脚本退出码为 0。
- [x] 3.2 在 `synthesize()` 增加 `volc-tts` 分支：调用新模块，写入 `public/voices/voice-*.mp3`，用 ffprobe 取真实时长，引擎名 `volc-tts:<speaker>`。验证：把 `volc-tts` 渠道 Base URL 指向本地 mock，调用 `/api/voice` 返回 200、文件存在且时长大于 0；扣减错误时返回可读消息。
- [x] 3.3 多说话人路径复用既有逐行合成与拼接逻辑，每行 `voice` 映射为火山 TTS 的 `speaker`；未指定时使用默认音色。验证：一镜两行不同音色的请求产生两段合成并按既有逻辑拼成一条音轨。

## 4. 音色列表与界面

- [x] 4.1 `/api/voices` 接受 `modelKey`，按音频模型所属渠道返回音色；`volc-tts` 返回静态音色表，缓存改为按 provider 区分。验证：分别用火山 TTS、ElevenLabs、macOS 模型请求，返回各自的音色列表，不串渠道。
- [x] 4.2 前端 `listVoices(modelKey)`，App 的音色 effect 依赖 `modelPick.audio`；Inspector 显示“火山 Seed TTS”引擎名，切换配音模型后重新拉取音色。验证：在画布切换三种配音模型，音色下拉随之变化；无音色时配音按钮禁用。

## 5. 文档与回归

- [x] 5.1 更新渠道备注与设置页提示：说明 Agent Plan 的视频边界、TTS 扣减开关、AFP 计费不能当作人民币账单。验证：设置页可见对应提示，文案不出现“CLI”。
- [x] 5.2 运行 `npm run build`、`node verify-agent-plan.mjs`、`node verify-volc-tts.mjs`，并重跑受影响的 `verify-providers.mjs` 与 `verify-voice.mjs`（环境允许时）。验证：构建与脚本通过，失败项有明确原因。
- [x] 5.3 真实链路冒烟：用 Agent Plan Key 通过应用发一次 1-token 文本、一次最小尺寸图片；TTS 在控制台开启扣减后再合成一句；记录结果与费用。视频不纳入本次（当前套餐无视频模型，标准 Key 待提供）。

## Verification notes

- `node verify-agent-plan.mjs`：全部通过（预设、Agent Plan 文本/图片路由、视频默认仍走标准 ark、ark-plan 测试、volc-tts 测试、音色列表）。
- `node verify-volc-tts.mjs` 与 `node verify-volc-tts-route.mjs`：全部通过（多块音频拼接、结束标记、扣减/401/业务错误、单句 mp3 落盘、多说话人拼接为 m4a）。
- `node verify-presets-migration.mjs`：v1 → v2 一次性合并、默认值不变、删除预设后不复活。
- 全新实例（临时 `SB_PROJECTS_DIR`）：默认文本/高质量/配音指向 MiniMax，图片/三视图指向 Agent Plan，各新渠道无 Key；不填 Key 时文本/图片返回 `no-key`、配音返回缺 Key；音色列表正常。已有本地设置仍保留自己的默认值与 Key。
- MiniMax 实测：默认文本 `MiniMax-M3` 返回 200；3 集生成约 30s / 3,073 completion tokens（Agent Plan lite 同请求约 116s / 5,891 tokens）；默认配音 `speech-2.8-hd` 生成 1.18s mp3；`male-qn-qingse` / `female-shaonv` / `male-qn-jingying` / `female-yujie` 四个音色均可用；无效音色回落到 `male-qn-qingse`，不再报 2054。
- 拆镜复现：M3 默认 thinking 把 8192 token 全部用于 reasoning（content=0，80s 后报“不是合法 JSON”）；关闭 thinking 后同一 prompt 13.5s 返回 14 镜，应用 `/api/text` 34.6s 返回 16 镜。
- 本地 Key 兜底：临时实例的渠道 Key 为空时，`~/.canghe-skills/.env` 里的 `ARK_AGENT_PLAN_API_KEY` / `MINIMAX_API_KEY` 会被自动使用；文本默认请求 200，`ark-plan`、`volc-tts`、`minimax` 渠道测试均通过。
- UI：Playwright 实测切换 volc-tts / minimax-tts / eleven-tts，音色列表、引擎标签与无音色禁用状态均正确。
- `npm run build`：通过。
- 真实链路：Agent Plan 文本 200（返回“好”）、Seedream 图片 200（2048x2048）、火山 TTS 200（0.84s mp3）。验证后已恢复设置，未把 Key 留在库里；扣减开关当前已生效。
- `verify-providers.mjs`：dryRun 断言通过；脚本整体仍因标准方舟 Key 401 失败（环境问题，非本次改动）。
- `verify-voice.mjs`：本机 macOS say 无可用中文音色，配音按钮被禁用导致脚本无法点击（环境问题）。
- 视频未实测：当前 Agent Plan 套餐无视频模型，第二个标准方舟 Key 仍返回格式错误，待有效 Key 后补验。

## Workflow follow-up

- 实现与验证完成后，使用 archive workflow 归档变更。
- 归档后确认 `openspec/specs/model-provider-routing/spec.md` 与 `openspec/specs/voice-synthesis/spec.md` 已生成，Purpose 不是占位文本。
