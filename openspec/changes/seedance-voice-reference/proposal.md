# Proposal

## Why

当前角色只有 `voiceId`，没有可复用的音色样本；每镜台词都是单独 TTS，Seedance 视频本身是静音的，成片再混 TTS。Seedance 2.5 具备原生音频能力，也支持音色参考（具体字段和限制需按渠道验证），可以把“角色音色”变成角色资产，再在画布生成视频时选择参考，提升跨镜音色一致性和原生声画一体的效果。

这不是把 TTS 当逐字口型轨：参考音频只约束音色/说话方式，模型会重新发声，不保证与原 TTS 文件逐字同步。要“和我们的 TTS 精确对齐”仍然使用现有的 provider 口型；本变更做的是“角色音色参考 + Seedance 原生音频”这条独立路径。

## What Changes

- 角色卡新增可选**音色样本**：用当前角色的 `voiceId` 生成一段固定试音稿（目标 2-30 秒、单人、干净、无背景音乐），保存到项目媒体目录，记录实际时长、引擎、音色 id、模型和指纹。
- 角色换 `voiceId`、换 TTS 引擎/模型或试音稿变化时，旧音色样本 MUST 标记为需要重生成；图片和音频都保留，不自动删除。
- 画布视频新增**原生音频模式**：默认关闭；仅对声明了 `audioOut` 的视频模型开放，首期目标为 Seedance 2.5。
- 原生音频模式下，用户可以从本镜真正说话的角色中选择音色样本；系统把样本作为音色参考绑定到视频请求，并在提示词里用单个 `audio_url` 和“音色参考音频1”指向本镜唯一说话角色。
- 原生音频模式下，该镜最终声音使用 Seedance 原生音轨，**不再混该镜 TTS**；字幕仍按台词文本生成。关闭原生音频后恢复现有 TTS + 音轨流程。
- 多说话人镜头按“说话角色优先”选择参考，受 provider 的参考音频数量/时长限制；超出时明确报告省略项，不静默丢弃。
- 先做 provider 能力探测：确认 Seedance 2.5 / APIMart 实际接受的音频参考字段、时长/数量限制、是否需要公网 URL 或上传；不支持时原生音频入口 MUST 禁用并说明原因，不得猜测字段。
- 真实 Seedance 2.0+ 调用仍需人工确认；自动化只使用 mock、dryRun 和本地音频。

明确不做：

- 不把 TTS 参考音频当作逐字口型同步；模型仍会重新发声。
- 不默认开启原生音频，不改变旧项目的静音视频 + TTS 行为。
- 不做声音克隆、真人声音复刻或未授权音色参考。
- 不在本变更里支持所有视频模型；首期只接一个已验证的原生音频模型，其他模型继续静音出片。
- 不自动批量提交真实 Seedance 任务。

## Capabilities

### New Capabilities

- `character-voice-reference`: 角色级音色样本的生成、存储、时长/格式校验、指纹失效、项目隔离和可供镜头选择的引用。
- `video-native-audio`: 视频原生音频模式、音色参考选择与请求绑定、多说话人上限、最终音轨策略、provider 能力探测与错误/降级。

### Modified Capabilities

无。现有 `voice-synthesis` 继续负责 TTS 渠道协议；本变更新增角色音色样本资产和视频原生音频行为，不改变现有渠道要求。现有 `shot-performance` 的 `speaks` 字段作为选择依据，不修改其契约。

## Impact

- 角色数据：`CharacterSheet` / `ProjectChar` 增加 `voiceSample`（音频 URL、试音稿、时长、engine/voiceId/model/fingerprint/stale）；`characters.ts`、`charMap.ts`、`CharacterBoard`、`App` 的角色持久化。
- 音频存储：`/api/voice` 或新增样本端点需要把 TTS 产物写入项目媒体目录；`server/media.mjs` 需要允许/复制音频扩展名。不能只存 `/voices` 公共池路径。
- 视频数据：`ShotData` / `ProjectShot` 增加 `audioMode`、`audioRef`（单个）；`VideoOpts` 增加 `generateAudio` / `audioRef`；`/api/seedance` 与 APIMart payload 需要按探测结果绑定音频参考。
- 提示词：原生音频镜头需要把角色台词、`audio_url` 绑定和“音色参考音频1”写进视频提示词；现有 `video_prompt` 只写运动，需要增加声音段。
- 音轨：`Preview` / 导出 `buildAnimatic` 需要按镜头选择原生音轨或 TTS；原生镜头不再把 TTS 混入，字幕仍来自台词。旧项目默认走现有路径。
- UI：角色卡增加音色样本生成/试听/失效；视频生成面板增加原生音频开关、说话角色音色参考选择、上限/成本/状态提示；和 provider 口型互斥提示。
- 测试与文档：新增角色样本、视频请求、提示词、导出音轨、provider 探测和真实 A/B 验收；README / DEPLOY / evidence 更新。
- 兼容与风险：旧项目无 `voiceSample`、无原生音频字段时保持原行为；Seedance 2.5 音频参考字段和本地音频 URL 可达性尚未验证，必须在实现前探测。
