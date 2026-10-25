# Proposal

## Why

当前配音音色下拉是固定预设：MiniMax 固定 4 个、火山 Seed TTS 固定 2 个、APIMart 固定 OpenAI 兼容音色；只有 ElevenLabs 会动态请求账号音色，macOS say 只探测本机已安装语音。用户无法在应用里加入自己的 MiniMax 克隆音色、火山 speaker 或自定义 voice_id，只能改代码数组。

这个变更把“音色”从各渠道的硬编码数组升级为统一的音色目录：能列出的渠道动态列出，能新增的渠道提供新增入口，不能新增的渠道明确标注能力边界，避免给用户一个填了也会 400 的假入口。

## What Changes

- 新增统一的 `VoiceEntry` 目录：包含 id、显示名、渠道、模型、来源（preset/account/clone/design/system/custom）和能力标记。
- 新增渠道能力矩阵：`supportsCustomVoiceId`、`supportsList`、`supportsClone`、`supportsDesign`、`supportsPreview`；UI 按能力显示入口。
- MiniMax：接 `/v1/get_voice` 列出 system / voice_cloning / voice_generation 音色；支持把账号内克隆/设计音色纳入目录。
- ElevenLabs：保留现有 `/v1/voices` 动态列表，补充来源分组、刷新和账号音色说明。
- 火山 Seed TTS：接入可用的 speaker 列表；账号有克隆 speaker 时纳入目录；没有列表接口时允许“自定义 speaker ID”并明确标注未验证。
- APIMart：只列出现有 OpenAI 兼容预置音色；`supportsCustomVoiceId: false`、`supportsClone: false`，不显示新增入口。
- macOS say：只列本机已安装语音；提供“打开系统语音管理”的说明，不在应用内创建。
- 设置页新增「音色管理」：按渠道筛选、刷新、分组、试听、添加/删除自定义音色；自定义条目保存在设置库，不写进项目。
- 角色卡音色下拉改为合并目录 + 自定义音色，按渠道/来源分组；选中的自定义 `voiceId` 不再因为不在固定数组里被静默回落，而是直接使用或在合成时返回明确错误。
- 新增音色创建能力（按渠道）：MiniMax 克隆/设计、ElevenLabs 账号侧创建、火山账号侧克隆；APIMart/macOS 明确不支持应用内创建。创建前展示授权/所有权边界，真实付费或克隆调用需要人工确认。
- 旧项目和无自定义音色的用户保持原行为；固定预设继续作为回退目录。

明确不做：

- 不承诺所有渠道都能创建音色；APIMart `gpt-4o-mini-tts` 和 macOS say 没有任意音色创建能力。
- 不给所有渠道一个无校验的自由 `voice_id` 输入；只对声明 `supportsCustomVoiceId` 的渠道开放。
- 不做跨渠道 voice id 迁移或把 MiniMax 音色名发给 ElevenLabs。
- 不做未授权声音克隆、真人声音复刻或绕过供应商授权。
- 不自动批量调用克隆/设计接口；真实调用按现有付费/确认规则。

## Capabilities

### New Capabilities

- `voice-catalog`: 各渠道音色目录的加载、刷新、分组、缓存、预置/账号/自定义来源、角色选择与合成校验。
- `voice-provisioning`: 各渠道音色创建能力（克隆/设计/导入）的能力矩阵、授权边界、预览和错误处理；不支持创建的渠道明确禁用。

### Modified Capabilities

无。现有 `voice-synthesis` 的渠道合成协议保持不变；本变更新增目录与创建能力，不改变现有预置音色的合成请求形状。现有 `model-provider-routing` 的默认路由不变，音色目录只增加可选条目。

## Impact

- 服务端：`vite.config.ts` 的 `/api/voices` 拆成渠道 adapter；MiniMax/Volc/ElevenLabs/macOS/APIMart 各自实现 `listVoices` 与能力描述；新增刷新参数与缓存失效。
- 设置：新增 `voiceCatalog` 自定义条目设置与「音色管理」页；Key 仍只存设置库/环境变量。
- 角色：`CharacterBoard` 音色下拉改为分组目录，支持自定义 `voiceId`；角色 `voiceId` 仍按项目持久化。
- 配音：`App.generateVoiceOne` 不再对显式自定义 voiceId 静默回落；合成错误透出；试听/样本生成复用同一目录。
- API/类型：`VoiceOption`/`VoiceList` 扩展来源、渠道、能力和自定义标记；新增自定义音色 CRUD 与音色创建接口。
- 测试/文档：各渠道目录 mock、刷新/缓存、自定义 ID 往返、无效 ID 错误、不支持创建渠道的禁用态；README 与证据更新。
- 风险：MiniMax/火山/ ElevenLabs 的账号音色权限、克隆授权、缓存时效和模型支持差异需要在实现时探测；不能把未验证能力标成可用。
