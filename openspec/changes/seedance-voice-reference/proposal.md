# Proposal

## Why

当前角色只有 `voiceId`，没有可复用的音色样本；Seedance 视频本身默认静音，只有原生音频模式能让视频自带声音。Seedance 2.5 具备原生音频能力，也支持音色参考，可以把“角色音色”变成角色资产，再在画布生成视频时选择参考，提升跨镜音色一致性和原生声画一体的效果。

这不是把 TTS 当逐字口型轨：参考音频只约束音色/说话方式，模型会重新发声，不保证与原 TTS 文件逐字同步。要“和我们的 TTS 精确对齐”仍然使用现有的 provider 口型；本变更做的是“角色音色参考 + Seedance 原生音频”这条独立路径。

## What Changes

- 角色卡新增可选**音色样本**：用当前角色的 `voiceId` 生成一段固定试音稿（目标 2-30 秒、单人、干净、无背景音乐），保存到项目媒体目录，记录实际时长、引擎、音色 id、模型和指纹。
- 角色换 `voiceId`、换 TTS 引擎/模型或试音稿变化时，旧音色样本 MUST 标记为需要重生成；图片和音频都保留，不自动删除。
- 画布视频新增**原生音频模式**：默认关闭；仅对声明了 `audioOut` 的视频模型开放，首期目标为 Seedance 2.5。
- 原生音频模式下，用户可以从本镜真正说话的角色中选择音色样本；系统把样本作为音色参考绑定到视频请求（单个 `audio_url`，指向本镜唯一说话角色）。
- **音色样本是可选增强**：没有可用样本时仍可开原生音轨，只发 `generate_audio: true`、不带 `audio_url`，声音由模型决定（2026-11-22 实测通过，见 `evidence/README.md`）。
- 原生音频模式下，该镜最终声音使用 Seedance 原生音轨，**不再混该镜 TTS**；字幕仍按台词文本生成。关闭原生音频后该镜为静音视频（连播/导出只认成片音轨，见 `canvas-prod-modes-no-voice` 的 R2）。
- 多说话人镜头不再禁用 native：上游只接受一条 `audio_url`，本次不带音色参考、照常出原生音轨，并说明原因。
- **不做强门镜（2026-11-24 修订）**：音色参考是可选增强，除「模型不具备音频能力」「镜头短于上游下限」外，缺样本 / 多说话人 / 说话人不在角色库 / 样本时长不合规一律降级为无参考照常出片。原生音频可与参考图、视频素材参考同时提交；provider 口型入口也不因 native 而禁用。
- 先做 provider 能力探测：确认 Seedance 2.5 / APIMart 实际接受的音频参考字段、时长/数量限制、是否需要公网 URL 或上传；不支持时原生音频入口 MUST 禁用并说明原因，不得猜测字段。
- 出口正文仍只由人/Agent 写入（`shot-prompt-agent-authored`）；台词与声音描述由视频提示词技能负责，运行时不追加声音段。正文缺本镜台词时只给软提示。
- 真实 Seedance 2.0+ 调用仍需人工确认；自动化只使用 mock、dryRun 和本地音频。

明确不做：

- 不把 TTS 参考音频当作逐字口型同步；模型仍会重新发声。
- 不默认开启原生音频，不改变旧项目的静音视频行为。
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
- 视频数据：`ShotData` / `ProjectShot` 增加 `audioMode`、`audioRef`（单个，可为空）；`VideoOpts` 增加 `generateAudio` / `audioRef`；`/api/seedance` 与 APIMart payload 需要按探测结果绑定音频参考，无参考时只发 `generate_audio`。
- 提示词：`video_prompt` 是唯一正文，由人/Agent 写入台词与声音描述；运行时不追加声音段，`nativeAudioPrompt` 仅作离线文本工具。
- 音轨：`Preview` / 导出 `buildAnimatic` 只认成片音轨；原生镜头取视频音轨，`off` 镜头静音，字幕仍来自台词。
- UI：角色卡增加音色样本生成/试听/失效；视频生成面板增加原生音频开关、无参考状态说明、正文缺台词软提示、与 provider 口型同时开启的换算说明。
- 测试与文档：新增角色样本、视频请求、提示词、导出音轨、provider 探测和真实 A/B 验收；README / DEPLOY / evidence 更新。
- 兼容与风险：旧项目无 `voiceSample`、无原生音频字段时保持原行为；Seedance 2.5 音频参考字段已实测（含无参考）。
