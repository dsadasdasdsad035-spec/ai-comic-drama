# Tasks

## 1. 能力探测与 provider 契约

- [x] 1.1 新增只读探测 `verify-seedance-audio-probe.mjs` / 等价服务端 helper：优先读 APIMart schema；schema 缺 `audio_url` 时使用已实测的 APIMart 能力描述，输出 `{ supported, audioRefField:'audio_url', maxRefAudios:1, minSeconds:2, maxSeconds:30, minVideoSeconds:4, supportsMultiSpeaker:false, source:'apimart-empirical' }`；验证：mock 覆盖“schema 有字段/schema 无字段但实测配置/不支持”三种结果，探测不生成视频。
- [x] 1.2 在 `src/modelCaps.ts` / `VideoOpts` 旁定义 `AudioRefCapabilities` 与 provider adapter 契约：APIMart 固定单 `audio_url` 字符串、单参考、2-30 秒音频、视频最短 4 秒；未知 provider 返回 `supported:false`；验证：纯函数断言字段/上限/未知 provider 三种情况。
- [x] 1.3 在 native 入口加能力门：未探测通过、模型没有 `audioOut`、镜头短于 4 秒或说话人多于 1 个时禁用并显示原因，不提交 `generate_audio`；验证：mock UI/API 断言禁用原因和任务数为 0。
- [x] 1.4 新增/更新 `docs/seedance-audio.md`：记录 APIMart 实测（对象 `audio_url` 400、字符串成功、2 秒拒绝、4 秒 data URL 成功、版权音频失败、成本 0.3883）和未验证项；验证：文档里的探测命令可执行且不产生视频任务。

## 2. 角色音色样本

- [x] 2.1 在 `src/characters.ts` / `src/charMap.ts` 增加 `VoiceSample` 与 `voiceSample` 字段，保持 `voiceId`、外观锚点、表情引用不变；验证：`verify-character-voice.mjs` 覆盖项目往返、旧角色无样本、换样本不改 `voiceId`。
- [x] 2.2 扩展 `/api/voice`（或新增样本端点）接受 `project` + `purpose:'character-sample'`，把 TTS 产物复制进项目媒体目录并返回 `/project-assets/...`；`/project-assets` 路由支持 mp3/m4a/wav 的 content-type；验证：mock/真实本地 TTS 产物文件存在，URL 可播放。
- [x] 2.3 在 `CharacterBoard` 增加音色样本区：默认试音稿（可编辑）、生成/试听/重生成/删除、实际时长、engine/voiceId；无 `voiceId` 时禁用；验证：`verify-character-voice-ui.mjs` 断言请求含 voiceId/试音稿，样本落库并显示时长。
- [x] 2.4 实现样本指纹与失效：`voiceId`、TTS 引擎/模型、试音文本、音频路径任一变化标 `stale`，保留音频；镜头不得静默使用失效样本；验证：改 voiceId/文本后 UI 出现“需要重生成”，选择逻辑跳过。
- [x] 2.5 增加 2-30 秒校验：过短/过长样本保留供试听但标不可用，返回可读原因；验证：用 1.2s/31s fixture 断言不可用，2-30s 可用。
- [x] 2.6 按项目隔离样本并更新 README 角色板说明；验证：A/B 项目切换不串样本，文档步骤能生成并试听样本。

## 3. 镜头音轨数据与画布 UI

- [x] 3.1 在 `ShotData` / `ProjectShot` 增加 `audioMode: 'off'|'native'`、单个 `audioRef: {character,url}|null`、`audioMeta`，接入 `bizSignature` / `nodeToShot` / `shotToData`；验证：`verify-native-audio.mjs` 覆盖往返、旧镜头默认 off、改参考触发 stale。
- [x] 3.2 新增纯函数 `nativeAudioRef`：从 `performance.speaks`/台词 speaker 推导唯一说话角色，过滤失效/缺失样本；多于一个说话人返回禁用原因；验证：单说话人、双人、失效样本、画外音。
- [x] 3.3 在 `Inspector` 视频区增加“原生音频”开关：模型能力/4 秒/单说话人/样本有效性全部通过才可用；显示角色、时长、失效；native 下 provider 口型入口禁用；验证：`verify-native-audio-ui.mjs` 覆盖模型不支持、镜头太短、双说话人、无样本、互斥提示。
- [x] 3.4 将 native 选择与视频生成指纹接入 `App.generateVideoOne`：记录模型/参考/台词/模式，变更时标 stale；验证：改参考或台词后 UI 标“需要重生成”，旧视频保留。
- [x] 3.5 更新 README 画布/音轨说明：原生音频默认关闭、单 `audio_url`、最短 4 秒、单说话人、参考是音色不是逐字同步；验证：按文档能打开 native、选参考并看到禁用原因。

## 4. 视频请求与提示词

- [x] 4.1 在 `src/api.ts` 扩展 `VideoOpts` 的 `generateAudio` / `audioRef?: string`，`startVideo` 请求体透传；验证：`verify-native-audio.mjs` mock `/api/seedance` 捕获字段，旧调用不传时行为不变。
- [x] 4.2 在 `/api/seedance` 解析单个 `audioRef`：支持项目媒体/`/voices` 本地音频转 data URL，校验 2-30 秒、大小和可读性；错误（不可读、格式、超限、内容审核）可读且不自动降级；验证：mock 覆盖 data URL、公网 URL、404、版权失败四种路径。
- [x] 4.3 在 `server/apimart.mjs` 的 Seedance 2.5 builder 增加 `audioUrl`/`generateAudio`：payload 写单个 `audio_url` 字符串和 `generate_audio`；`duration < 4` 拒绝；不发送 `reference_audio`/数组/对象；验证：`dryRun` 断言 native/off/2 秒三种 payload。
- [x] 4.4 新增 `nativeAudioPrompt`：单说话人、逐字台词、“音色参考音频1”，不写“原样播放/逐字同步 TTS”；无参考时只写角色台词并警告；验证：单说话人、无参考、画外音用例。
- [x] 4.5 `App.generateVideoOne` 在 native 模式下组装 `generateAudio:true`、`audioRef`、声音提示词，并改用 reference_image 携带关键帧（不送 first_frame/last_frame）；off 保持现有请求；验证：mock 捕获两种请求体，native 不混 `voiceUrl`、不含 first_frame。
- [x] 4.6 更新 README/DEPLOY：原生音频请求、`audio_url` 限制、4 秒下限、单说话人、内容审核、真实调用人工确认；验证：文档命令与行为一致。

## 5. 预览、导出与音轨

- [x] 5.1 `Preview.buildPlaylist` 增加 `audio: 'tts'|'native'|'none'`；native 镜头不传 `voiceUrl`，播放时使用视频音轨；验证：`verify-native-export.mjs` 断言 native/off 两种 item。
- [x] 5.2 `ExportSegment` 增加音轨模式；`buildAnimatic` 对 native 镜头提取视频音轨、按镜头起点延迟/裁剪并与 TTS 镜头混音，off 镜头保持现状；验证：ffprobe 断言 native 段有且只有一层音轨、off 段仍有 TTS。
- [x] 5.3 字幕在 native 镜头不再依赖 `voiceDur`，按原生视频/镜头时长收尾；验证：SRT cue 时间在镜头范围内，没有 TTS 时仍生成字幕。
- [x] 5.4 混合项目与转场：native + off 混排、native 镜头相邻转场不爆音/不双音轨；验证：2 镜混合 fixture 导出，波形/时长/音轨检查。
- [x] 5.5 更新 README 导出说明：native 镜头使用视频自带音轨，off 镜头继续 TTS；验证：文档步骤能导出混合样例。

## 6. 集成、真实验收与回归

- [x] 6.1 新增 `verify-character-voice.mjs`、`verify-character-voice-ui.mjs`、`verify-native-audio.mjs`、`verify-native-audio-ui.mjs`、`verify-native-export.mjs`；验证：全部通过，mock 断言不产生真实 Seedance/TTS 费用。
- [x] 6.2 做一次 mock 端到端：角色生成样本 → 镜头 native → 选参考 → 请求体含单 `audio_url` → 预览/导出使用 native 音轨；验证：脚本和截图记录在 `evidence/`。
- [x] 6.3 运行 `npm run build`、`node verify-performance*.mjs`、`node verify-export.mjs`、`node verify-lipsync*.mjs`；验证：全部通过，旧 TTS/口型路径不回退。
- [ ] 6.4 在用户确认后做真实 Seedance 2.5 A/B：至少 3 个 4 秒以上单说话人镜头，使用自己生成/授权音频，比较音色相似度、跨镜稳定性、口型、是否双声、成本和等待；未确认时保持未验收，不写通过。
- [x] 6.5 更新 evidence/README：记录探测结果（对象 400、2 秒 400、4 秒 data URL 成功、版权失败、成本 0.3883）、mock 证据、真实 A/B 状态、未支持项和回滚方式；验证：证据不把 mock 写成真实通过。
- [x] 6.6 写清楚本变更与 `shot-performance-direction` 的依赖/冲突：native 与 provider 口型互斥，apply/archive 顺序要先协调；验证：任务说明和 evidence 都记录该前置。

## Workflow follow-up

- 实现前确认 `shot-performance-direction` 已应用或与其并行；本变更复用其 `performance.speaks`、`lipSync` 和相关 UI，不重复实现。
- APIMart 能力以实测为准：单 `audio_url` 字符串、视频最短 4 秒、首期单说话人；不要重新引入 `reference_audio` 数组或对象形状。
- 归档前运行 `openspec validate seedance-voice-reference --strict`，同步 `character-voice-reference` / `video-native-audio` 主 specs。
- 真实 Seedance 2.5 原生音频调用必须由用户逐次/按批次确认；证据中区分 mock 与真实产物。
