# Design

## Context

动机见 `proposal.md`，行为契约见 `specs/character-voice-reference` 与 `specs/video-native-audio`。当前事实：

- 角色只有 `voiceId`（`src/characters.ts`），`CharacterBoard` 只提供音色下拉，没有角色级音频资产；TTS 是 `App.generateVoiceOne` 在镜头层面调用 `/api/voice`。
- `/api/voice` 把结果写到 `public/voices/`，返回 `/voices/...`；项目媒体目前主要存图片（`server/media.mjs` 的 `saveProjectImage` / `copyIntoProjectMedia`）。
- `VideoOpts`（`src/api.ts:151`）只有 `refImages` / `refVideos`，没有音频参考；`startVideo` 也不传音频。
- APIMart Seedance 2.5 payload（`server/apimart.mjs:464-488`）只有 `image_with_roles` / `video_urls`，固定 `generate_audio: false`；通用视频分支也是 false；`docs/apimart.md:38-43` 没有音频参考字段。
- `ModelFeatureSet.audioOut` 已存在，Seedance 2.5 目录标记为 true（`server/apimart.mjs:264`），但这是能力标记，不等于当前请求已启用。
- 预览/导出的 `buildAnimatic` 只把 `seg.voice` 作为音频输入（`vite.config.ts:1739+`），没有“视频自带音轨”这条路径；原生音频必须改这里。
- `shot-performance-direction` 已经提供镜头 `performance.speaks`、`lipSync` 面板和 provider 口型；本变更复用这些数据，不重复做表演层。
- 真实 APIMart 探测：`audio_url` 字段存在且类型是字符串；`audio_url` 对象会 400；2 秒视频被拒绝，最短 4 秒；4 秒 + 自己生成的 TTS data URL 已成功出片（854x480、AAC、4.064s、cost 0.3883）；公开版权音频会被内容安全/版权拦截。当前 APIMart 只验证单 `audio_url`，多段未暴露。

## Goals / Non-Goals

**Goals:**

- 把音色从“每镜 TTS 参数”提升为“角色身份资产”，可试听、可复用、可失效。
- 让 native 镜头使用 Seedance 自己的声音和嘴型，不再混该镜 TTS；TTS 样本只做音色参考。
- 把音色参考选择放在画布视频生成面板，按说话角色自动推导，允许手动取消。
- 在提交前确认 provider 能力、参考音频可达性、数量/时长限制；不支持时明确禁用，不猜测字段。
- 旧项目、旧 TTS 路径和 provider 口型路径保持可用。

**Non-Goals:**

- 不把 TTS 参考音频当作逐字口型同步；模型会重新发声。
- 不默认开启 native，不自动批量提交真实 Seedance 2.0+。
- 不做声音克隆/真人声音复刻；只使用当前 TTS 预置音色或已授权声音。
- 不首期支持所有视频模型；只接一个经过探测的原生音频模型。
- 不在本变更里重做口型 provider；native 与 provider 口型互斥，二选一。

## Decisions

### 1. 音色样本是角色资产，不是镜头 TTS

`CharacterSheet` / `ProjectChar` 增加：

```ts
type VoiceSample = {
  url: string          // /project-assets/<项目>/<文件>
  text: string         // 固定试音稿，可编辑
  seconds: number      // 真实时长
  engine: string
  voiceId: string
  modelKey?: string
  fingerprint: string
  stale?: boolean
  createdAt?: string
}
```

- 样本与 `voiceId` 分离：换样本不改 `voiceId`，换 `voiceId` 才让样本失效。
- 默认试音稿是一段 2-30 秒的中性短句；用户可编辑，但修改文本后旧样本标 stale。
- 生成走 `/api/voice` 的扩展：传入 `project` 和 `purpose: 'character-sample'`，服务端合成后复制到项目媒体目录，返回 `/project-assets/...`；不再只存公共 `/voices`。
- `server/media.mjs` 增加音频扩展名支持或新增 `saveProjectAudio`；`/project-assets` 路由按扩展名返回 `audio/mpeg` / `audio/mp4`。
- `CharacterBoard` 增加“生成音色样本/试听/重生成/删除”和试音稿输入；没有 `voiceId` 时禁用。样本不随拆角色自动生成。
- `App.patchCharacter` 在 `voiceId`/音频模型变化时用 `markVoiceSampleStale`；`toProject`/`toSheet` 负责往返。

替代方案：每镜 TTS 直接拿去当参考。单句经常不足 2 秒，且会把本镜情绪/语速带进“音色身份”；不采纳。

### 2. native 是镜头级音轨模式，默认 off

`ShotData` / `ProjectShot` 增加：

```ts
type ShotAudioMode = 'off' | 'native'
type AudioRef = { character: string; url: string; label?: string }
type AudioMeta = { fingerprint: string; modelKey?: string; createdAt: string }
```

- `off` = 现有静音视频 + TTS 混音；旧镜头缺字段按 off。
- `native` = 该镜视频自带音轨，最终预览/导出使用视频音轨；不再混 `voiceUrl`。
- `audioRef` 是本镜的单个音色参考（角色 + 音频路径）；`audioMeta` 记录请求指纹，参考样本/台词/模型变化时标 stale。
- 音色参考从 `performance.speaks` 或台词 speaker 推导；沉默/画外角色默认不选。用户可以取消某个角色，但不会自动删除角色样本。
- native 下 provider 口型入口禁用；如果已有口型结果，保留但不参与预览/导出。

替代方案：项目级开关。会让一次项目切换突然改变全部镜头音轨；不采纳。

### 3. 视频请求增加音频参考，但字段由能力探测决定

`VideoOpts` 增加：

```ts
generateAudio?: boolean
/** APIMart Seedance 2.5：单个字符串；URL 或 data:audio/...;base64 */
audioRef?: string
```

链路：

```text
App.generateVideoOne
  -> build audioRef from the single speaking character
  -> startVideo({ generateAudio, audioRef, ... })
  -> /api/seedance 解析并校验
  -> provider adapter 上传/解析音频
  -> buildVideoPayload({ referenceAudios, generateAudio })
```

- **先探测**：读取 APIMart 的 model schema / 文档，确认 Seedance 2.5 接受 `audio_url` 字符串（当前 APIMart），以及音频 2-30 秒/单参考/能否与 reference_image 混用。探测前不写死字段，不把未验证字段发到生产。
- 首个 adapter 把探测到的字段封装成 `audioRefField`；如果 provider 只接受公网 URL，而项目音频只有本地路径，则 native 入口禁用并提示上传/公网地址，**不回退**成无参考或 TTS。
- `generateAudio: true` 时，Seedance 2.5 payload 的 `generate_audio` 从 false 改为 true；其他模型如果未通过探测，拒绝 native。
- 首期只有一个 `audio_url`，提示词固定写“音色参考音频1”；不要让提示词声称存在多个音频槽位。

替代方案：直接假定 `reference_audio` 字段。APIMart schema 没有列出音频参考，但实测只接受 `audio_url` 字符串；对象/数组会 400。按实测值实现，不猜其他形状。

### 4. 原生音频提示词独立于运动提示词

`video_prompt` 继续只写运动/表情；native 请求时在 `App` 里追加声音段：

```text
声音：
陈默说：“你来了。”音色参考音频1。陈默的嘴型与这句中文台词同步。
```

- 台词逐字来自 `dialogue`，不重写、不翻译。
- 参考音频只写“音色参考”，不写“原样播放”或“逐字对齐 TTS”。
- 首期只支持单说话人；多说话人 native 禁用，不做 `@音频1..N` 的多槽绑。
- 如果 native 选择“无参考”，提示词只写角色和台词，UI 标“声音由模型决定”。

### 5. 预览/导出按镜头选择音轨

- `Preview.Item` 增加 `audio: 'tts' | 'native' | 'none'`；`buildPlaylist` 根据 `audioMode` 与是否存在视频音轨设置，native 时不把 `voiceUrl` 传给播放器。
- 导出 `ExportSegment` 增加 `audioMode` / `nativeAudio`；`buildAnimatic`：
  - native 镜头从视频输入取音轨，按镜头起点延迟/裁剪，与 TTS 镜头一起 `amix`。
  - off 镜头继续现有 TTS 路径；没有 TTS 的镜头保持静音。
  - 生成转场片段仍不带音频；native 镜头与转场的音频接缝先按硬切处理，必要时做短淡入淡出，避免爆音。
- 字幕仍按台词文本和镜头/原生时长生成；没有 TTS 时不再用 `voiceDur` 作为字幕长度。
- 切回 off 时恢复 TTS 混音；旧 native 视频保留，可再次切回。

替代方案：在浏览器里把 native 音频再单独混一遍。预览可行，但导出必须由 ffmpeg 服务端统一处理，不能两套时间账；不采纳。

### 6. 参考音频上限和优先级由 provider 描述

- provider 能力描述包含 `audioRefField`、`maxRefAudios`、`minSeconds`、`maxSeconds`、`maxTotalSeconds`、`supportsMultiSpeaker`。APIMart 实测 `audioRefField: audio_url`、`maxRefAudios: 1`、`supportsMultiSpeaker: false`。
- 首期只允许一个真正说话的角色；有两个或更多说话人时 native 禁用，提示拆镜或走 off+TTS。
- 单段短于/长于 provider 范围时不提交，提示重生成样本。

### 7. 能力探测是提交前的硬门

新增只读探测（不生成视频）：

```text
GET /api/seedance/audio-capabilities?modelKey=...
  -> { supported, audioRefField, maxRefAudios, minSeconds, maxSeconds, maxTotalSeconds, supportsMultiSpeaker, source }
```

- 有 schema 时读 schema；没有 schema 时读 provider 文档/实测配置；两者都没有则 `supported: false`，UI 显示“未验证”而不是猜测。
- APIMart 的 schema 未列 `audio_url`，但实测字段为 string；能力描述记录为 `audio_url`，并注明“实测/非 schema”。
- 探测结果带缓存与手动刷新；模型/渠道变化时失效。
- 真实 Seedance 2.0+ 生成仍逐镜/按批次人工确认，探测本身不产生费用。

### 8. 兼容与迁移

- 旧项目没有 `voiceSample`、`audioMode`、`audioRef`、`audioMeta` 时按无样本/off 读取；不批量迁移。
- 旧 TTS 路径不变；provider 口型路径不变，只是 native 镜头禁用该入口。
- 如果 APIMart 探测不支持音频参考，角色音色样本仍可交付（试听/未来复用），但 native 入口禁用；不把整个变更阻塞在音频参考上。
- 回滚：关闭 native 即回到静音视频 + TTS；删除 `voiceSample` 不影响 `voiceId`，旧 TTS 继续可用。

## Risks / Trade-offs

| 风险 | 缓解 |
|---|---|
| 参考音频只影响音色，模型仍重新发声，跨镜一致性不保证 | UI/文档明确“音色参考不是逐字同步”；真实 A/B 验收；保留 provider 口型作为精确路径 |
| 参考音频触发版权/内容安全 | 只用自己生成/授权音频；显示 provider 原始原因；不自动换音频 |
| 2 秒镜头被 provider 拒绝 | native 最短 4 秒；不足时禁用并提示 |
| 首尾帧与音频参考互斥 | native 用 reference_image 模式，不提交 first/last frame + audio_url |
| APIMart 不暴露音频参考字段，或字段名与文档不一致 | 先探测；不支持则禁用 native；不猜字段、不静默降级 |
| 本地音频 /voices 不可被 provider 访问 | 可编码为 data URL（实测成功）；不能访问/超限就阻止提交 |
| 多说话人 native | 首期禁用；提示拆镜或走 off+TTS，不把多人混成一个 audio_url |
| native 音频与 TTS 双重人声 | 镜头级音轨互斥；native 不使用 voiceUrl；导出按模式选择 |
| 生成转场/native 音频接缝 | 先按硬切并加短淡入淡出；复杂转场音频单独验收 |
| TTS 样本过短/过长 | 2-30 秒硬校验；保留样本但标不可用，提示改试音稿 |
| 2.0+ 真实调用成本/等待 | 默认关闭、逐镜确认、成本预览；测试只用 mock/dryRun |
| 旧项目/旧接口 | 全部新字段可选，默认 off；旧 TTS/口型路径不变 |

## Migration Plan

1. 角色数据与音色样本（字段、项目媒体、CharacterBoard、失效指纹）。
2. 视频数据与 UI（`audioMode`/`audioRef`、Inspector、光声选择）。
3. 能力探测与 provider adapter（字段/上限/URL 可达性）。
4. 视频请求与提示词（`generateAudio`、`audioRef`、“音色参考音频1”）。
5. 预览/导出音轨（native 视频音频、TTS 互斥、字幕）。
6. 测试、文档、证据和真实 A/B；未探测通过的渠道保持 native 关闭。

回滚：native 默认 off；关闭后不影响旧 TTS/口型；角色样本是附加资产，不参与现有导出。

## Open Questions

- APIMart 的 `audio_url` 是否能与 `image_with_roles` 的 reference_image 组合；首期按官方“参考模式”发送，真实 A/B 时验证。
- 角色样本的默认试音稿长度是否需要按语言调整（中文/英文），首期用固定中文稿并在 UI 显示实际时长。
