# Design

## Context

动机见 `proposal.md`，行为契约见 `specs/` 下四个能力。现有链路的关键事实：

- 画布与项目是两套字段：`ShotData`（`src/types.ts`）给画布用，`ProjectShot`（`src/api.ts`）给项目用；`src/shotSync.ts` 的 `nodeToShot` / `shotToData` 负责往返，`bizSignature` 决定画布改动是否写回项目。
- 台词在画布上是 `dialogue: string`，在项目里是 `{speaker,text}[]`；`src/prompts.ts` 的 `dialogueToText` / `parseDialogue` 只保留说话人和文本，任何附加表演字段都会被丢掉。TTS 的 `generateVoiceOne`（`src/App.tsx`）只把 `text/voice/rate` 传给 `/api/voice`。
- 提示词技能 `skills/prompt/SKILL.md` 的结构只有“外观 + 动作姿态 + 环境 + 景别 + 光影 + 画风”；`PromptTable` 的 `briefJson` 只带 `no/seconds/size/move/desc/dialogue`，没有 `cast` 和表演。拆镜技能 `skills/shotlist/SKILL.md` 的 `desc` 是一段整体描述，`dialogue` 只有 speaker/text。
- 角色只有一份 `lookEn` 和三视图；`src/characters.ts` 的默认角色甚至把 `tired eyes` / `calm but guarded` / `expression unreadable` 写进身份锚点，和“喜怒哀乐”直接冲突。`collectShotReferences`（`src/shotReferences.ts`）只解析角色身份图、相邻分镜、素材和手工参考，`limitReferences` 只做顺序截断。
- 视频请求走 `startVideo`，支持 `image` / `lastFrame` / `refImages` / `refVideos`，但当前 Seedance / APIMart 请求不把台词音频送进视频模型；音频是在预览/导出阶段单独合轨的。
- 口型没有任何字段、provider、任务或验收；`src/api.ts` 的 `VideoOpts`、`vite.config.ts` 的视频路由和 `Preview` 的 `buildPlaylist` 都没有口型版本概念。
- 外部 MIT 技能提供了可借鉴的规则，但没有运行时兼容：`zenstory-ai/drama-skills` 的表演弧/声音身份/连续性、`calesthio/generative-media-skills` 的 performance-direction 与 Sync Labs/Kling 口型 provider、`domco685/ai-cartoon-studio-skill` 的静音/发声抽帧 QA。

## Goals / Non-Goals

**Goals:**

- 用一份结构化表演数据贯通拆镜、提示词、工作台编辑、首帧生成和配音，避免情绪在每一跳丢一次。
- 让表情参考成为可选的表演参考，而不是新的身份资产；旧项目不批量迁移。
- 让配音情绪按 provider 原生能力落地，并在不支持时明确降级。
- 让口型从“提示词里提一句”变成可选择的模式：默认关闭、prompt 只改提示、provider 手动确认并验收。
- 保持旧技能、旧项目和旧视频流程可用；所有新增字段可选、默认关闭。

**Non-Goals:**

- 不在本变更里支持多说话人共享一条混合音轨的 provider 口型；首期只允许单说话人，多人对话走 prompt 模式或拆镜。
- 不做自动批量口型、自动采用、自动重生成，也不自动提交真实 Seedance 2.0+ 任务。
- 不把固定六格/九格表情表作为角色身份要求；表情参考是可选资产。
- 不重写已有项目的 `lookEn`，也不把外部技能正文复制进仓库。
- 不改变现有 `voice-synthesis` 的渠道协议、默认模型和 `shots-v1` 的旧输出兼容。

## Decisions

### 1. 表演数据挂在镜头上，台词表演与台词文本平行保存

在 `ShotData` 和 `ProjectShot` 上增加可选字段，不新建表，不改变 `shots` 表的固定列：

```ts
type PerformanceEmotion =
  | 'neutral' | 'happy' | 'sad' | 'angry' | 'fearful'
  | 'disgusted' | 'surprised' | 'calm'

type PerformanceEntry = {
  character: string          // 与 cast / 角色名一致
  emotion: PerformanceEmotion
  intensity: number          // 0-5
  action?: string            // 当前景别看得见的动作
  gaze?: string              // 看向谁/什么
  speaks?: boolean           // 本镜是否说话
}

type DialogueDelivery = {
  emotion?: PerformanceEmotion
  intensity?: number
  pace?: 'slow' | 'normal' | 'fast'
  volume?: 'whisper' | 'soft' | 'normal' | 'loud' | 'shout'
  emphasis?: string
}
```

- `ProjectShot.performance?: PerformanceEntry[]`、`ProjectShot.dialogue_delivery?: DialogueDelivery[]`。
- `ShotData.performance?: PerformanceEntry[]`、`ShotData.dialogueDelivery?: DialogueDelivery[]`。
- `dialogue_delivery` 与 `dialogue` 按行下标平行；`ShotData.dialogue` 仍是可编辑文本，性能参数不写进文本，避免 TTS 把标签读出来。
- `ProjectShot.dialogue` 继续只存 `{speaker,text}[]`；`nodeToShot` 解析文本行并单独写 `dialogue_delivery`，`shotToData` 反向拆成文本 + 平行数组。`parseDialogue` 增加一个保留/回填表演的辅助函数，文本行改动时先按完全相同的 `speaker+text` 匹配，再按行下标兜底；匹配不到的旧表演丢弃并提示。拆镜模型返回的 dialogue 行如果带表演字段，由 `buildShotsFromModel` 拆到 `dialogue_delivery`，不塞回 `speaker/text` 对象。
- `bizSignature` 加入 `performance`、`dialogueDelivery`、`lipSync`、`voiceMeta`，否则画布上改表演不会写回项目。
- 手改粒度：编辑表演记 `handEdited: ['performance']`，编辑台词表演记 `['dialogue_delivery']`；`mergeGenerated` 已按顶层字段保留旧值，不需要改合并算法。代价是改一个角色的表演会锁住整镜表演，但比拆成嵌套 key 简单、可解释；提供“恢复模型建议”清除手改标记。

替代方案：新建 `shot_performance` 表。需要新增表、路由、合并和迁移，收益只是查询更纯；项目 JSON 的 `extra` 已经能容纳这些字段，不采纳。

替代方案：把情绪写进台词括号，如“陈默（愤怒）：……”。TTS 会读出括号，字幕也会带上，且拆镜/提示词无法稳定解析；不采纳。

### 2. 拆镜与提示词技能共享一套表演词汇，旧输出继续兼容

`shots-v1` 的 schema 增加可选的 `performance` 数组和 dialogue 行的可选表演字段；`buildShotsFromModel` 把模型输出映射成 `ProjectShot.performance` 与 `dialogue_delivery`。旧技能没有这些字段时，按空表演处理，不阻止写入。

`skills/shotlist/SKILL.md` 的新增规则：

- 每个真正承担画面变化的角色一条表演；每个说话角色必须有条目。
- 多人镜头分别写动作/反应，不写“所有人都震惊”。
- 表演必须写当前景别读得到的目光、呼吸、身体、手部或语言变化；情绪词只作为锚，不替代可见动作。
- 空镜、道具特写、纯空间转场允许表演为空。

`skills/prompt/SKILL.md` 的新增规则：

- `briefJson` 每镜带 `cast`、`performance`、`dialogue`（含 delivery）。
- `keyframe_prompt` 在“动作姿态”之后写“本镜表情 + 说话状态”；多人镜头分别写。
- `video_prompt` 有台词时写“说话中的面部/嘴部动作”；嘴部不可见的镜头不得声称口型同步，并提示改景别。
- 没有表演数据时退回 `desc` 与台词，不自行发明情绪。
- 旧 `lookEn` 里的固定表情词不删除；提示词必须在本镜表演里显式覆盖，例如“tired eyes”之后写“本镜 happy，嘴角上扬、眼神明亮”，让后者成为本镜的表演指令。

`PromptTable` 的 `briefJson` 构造改为包含 `cast` 和表演；`auditOf` 仍以 `lookEn` 是否进入提示词为准，不把表情参考当身份锚点。

替代方案：让模型直接写 provider 标签或情绪代码。不同 provider 语法不同，且会把表演耦合进提示词文本；不采纳。

### 3. 表情参考是可选表演资产，不是身份变体

在 `CharacterSheet` / `ProjectChar` 增加可选表达式映射：

```ts
type CharacterExpression = {
  image?: string
  candidates?: string[]
  activeIdx?: number
  source?: 'generated' | 'uploaded'
  fingerprint?: string
  stale?: boolean
}
// expressions?: Partial<Record<PerformanceEmotion, CharacterExpression>>
```

- `lookEn`、`lookCn`、palette、keywords、角色 id 不变；表情参考只是 `expressions[emotion]`。
- 生成使用 `${lookEn}, ${expressionPrompt}, ${EXPRESSION_SUFFIX}`；`EXPRESSION_SUFFIX` 要求头肩/半身、同一发型服装配饰、中性无缝背景、相同光线、只改变表情、无文字水印。
- 指纹由 `lookEn + palette + keywords` 生成；`lookEn` 变化时已有表情标 `stale`，保留图片，提示重生成。
- 生成逐张手动触发，默认 2 张候选；不随拆角色自动生成。
- 镜头表演条目用 `emotion` 选表情；`collectShotReferences` 增加 `source: 'expression'`，顺序为：正在说话/主动作角色的表情 → 其他入画角色表情 → 角色身份图 → 相邻分镜 → 素材 → 手工参考。`limitReferences` 继续截断并报告未发送项；`Toast` 文案说明哪些表情被省略。
- 提示词审计仍只看 `lookEn`；没有表情图不报角色缺失。
- 默认角色 `lookEn` 里的固定表情不自动清理；提供文档和可选的“编辑身份锚点”手动清理，避免批量改旧项目。

替代方案：生成固定六格表情表并当作角色三视图的一部分。成本高、容易漂移，而且把瞬时表情重新焊进身份；不采纳。替代方案：把表情参考作为新角色卡；会破坏 cast/连线与项目隔离；不采纳。

### 4. 配音表演在服务端按 provider 映射，文本保持干净

`VoiceLine` 增加可选 `emotion/intensity/pace/volume/emphasis`；`generateVoiceOne` 从 `dialogue_delivery`（没有则从角色 `performance`）取值，按行构造 `lines`。服务端的 `synthesize` 增加一个 `performance` 参数，由 provider adapter 映射：

| 归一化参数 | MiniMax speech-2.8 | 火山 Seed TTS 2.0 | ElevenLabs | OpenAI 兼容 / APIMart |
|---|---|---|---|---|
| emotion | `voice_setting.emotion` | `emotion` + `emotion_scale` | 音频标签或 `style` | `instructions` |
| intensity 0-5 | 由 emotion 选择 + 文案强度 | `emotion_scale` 1-5 | 标签措辞/`style` | `instructions` |
| pace | `voice_setting.speed` | `speech_rate` | 标签/标点 | `instructions` |
| volume | `voice_setting.vol` | `loudness_rate` | `[whispers]` / `[shouts]` | `instructions` |
| emphasis | 标点/文本重音 | 文本重音 | 标签/标点 | `instructions` |

- 所有 adapter 都只把台词原文放进 `text`；标签、instructions、emotion 参数不进入项目台词和字幕。
- provider 不支持某个参数时返回 `applied` / `unsupported`；`/api/voice` 把结果带回 UI，显示“该引擎未应用情绪”。
- `VoiceResult` 增加 `applied` / `unsupported` / `engine`；`ShotData.voiceMeta` / `ProjectShot.voice_meta` 记录实际应用参数与指纹。台词文本或表演变化时 `voiceMeta` 指纹不匹配，界面标记“需要重生成”，旧音频保留。
- 默认 TTS 是 MiniMax，情绪可直接生效；火山 TTS 2.0 支持 voice-specific emotion / emotion_scale / speech_rate / loudness_rate，但具体字段以当前官方协议为准，adapter 用 `dryRun` 锁定请求体；macOS say 明确不支持，只忽略并提示。

替代方案：在提示词里让模型写 `[angry]`。会把 provider 语法泄漏给文本模型，且不同引擎不兼容；不采纳。

### 5. 口型是可选适配器，prompt 模式默认安全

镜头增加：

```ts
type LipSyncMode = 'off' | 'prompt' | 'provider'

type LipSyncState = {
  mode: LipSyncMode
  provider?: string
  status?: 'idle' | 'running' | 'done' | 'error' | 'stale'
  sourceVideo?: string
  audio?: string
  outputVideo?: string
  adopted?: boolean
  error?: string
  qa?: {
    pass?: boolean
    checkedAt?: string
    frames?: { at: number; kind: 'silence' | 'speech'; path: string }[]
    findings?: { at: number; kind: 'silence-open' | 'speech-closed'; frame: string; override?: string }[]
  }
}
```

- `off` 是旧项目默认；`prompt` 只影响提示词；`provider` 需要已接受视频 + 单说话人台词音频。
- 首期 provider adapter 用 Sync Labs：`POST /v2/assets/upload` 上传本地视频/音频（20MB 直传上限，超出走 Assets API），再 `POST /v2/generate`，轮询 `GET /v2/generate/{id}`，下载结果到项目媒体目录。Kling Advanced Lip-Sync 作为后续 adapter，不在首期。
- 多说话人镜头在 provider 模式禁用，提示拆成单人镜；prompt 模式仍可用。画外音不驱动口型。
- 结果独立于 `videoUrl`：`outputVideo` 与 `sourceVideo` 都保留；`adopted` 为 true 时 `Preview` / 导出使用 `outputVideo`，否则用 `videoUrl`。
- 手动确认：UI 展示 provider、源视频、音频、时长、估算成本、是否覆盖；只有确认后才提交。没有配置 provider 或 Key 时禁用并给设置入口；不自动 fallback。
- 验收：服务端用 ffmpeg `silencedetect` 找静音段、用 `-ss` 抽静音中点和发声段帧；UI 展示帧与时间点。首期用现有视觉模型做“嘴是否张开”的 advisory 判定，结果不自动采用；用户必须确认采用，失败可带理由忽略。这样避免把视觉判断当成硬真相。
- `lipSync.qa` 记录帧路径、时间点、判定和人工 override；源视频或音频变化时标 `stale`，保留结果。

替代方案：把台词音频直接送给 Seedance/Kling 视频模型，依赖模型原生口型。当前请求是 `generate_audio: false`，且模型/渠道是否支持音频驱动不统一；真实 Seedance 2.0+ 还需要人工确认；不作为默认路径。替代方案：本地 Wav2Lip/LatentSync。需要额外 Python/GPU 依赖，和当前 Blender 本地链路一样重；首期不引入。

### 6. 预览、导出和项目数据使用同一个口型版本

`Preview.buildPlaylist` 与导出的 `segments` 在构造时选择 `shot.lipSync.adopted && shot.lipSync.outputVideo ? outputVideo : videoUrl`；音频仍用 `voiceUrl`，字幕不变。`bizSignature` 包含 `lipSync`，因此采用/切回会写回项目。项目 JSON 的 shots 表把新字段收进 `extra`，不需要迁移；旧客户端读取时忽略未知字段。

### 7. 外部技能只做规则来源，不引入运行时依赖

- [zenstory-ai/drama-skills](https://github.com/zenstory-ai/drama-skills)（MIT）：表演弧、可见行为、声音身份与表演分离、对白/口型预算、连续性锁。
- [calesthio/generative-media-skills](https://github.com/calesthio/generative-media-skills)（MIT）：performance-direction 的 objective/obstacle/action、情绪强度、视线连续性、voice/lip-sync QA；Sync Labs / Kling provider 事实。
- [domco685/ai-cartoon-studio-skill](https://github.com/domco685/ai-cartoon-studio-skill)（MIT）：静音段/发声段抽帧 QA 的思路。

实现时用我们自己的字段名和中文规则重写，不复制外部脚本或整段正文；在 `README.md` 和 `evidence/README.md` 注明来源与许可证。外部技能不进入 `skills/` 运行时，也不自动安装。

## Risks / Trade-offs

| 风险 | 缓解 |
|---|---|
| 视觉模型误判“嘴张开/闭合”，造成假失败或假通过 | QA 只作 advisory，采用必须人工确认；记录帧和 override 理由；不自动覆盖视频 |
| 表情参考漂移，角色看起来不像同一人 | 身份锚点原样内嵌；表情只改表情；保留身份图作参考；候选人工选择；`lookEn` 变化标 stale |
| 参考图超过模型上限，表情被静默丢掉 | 明确优先级与 `limitReferences` 报告；Toast 列出未发送项 |
| TTS provider 情绪参数不统一或字段变更 | adapter 隔离；`dryRun` 锁定请求体；不支持时 `unsupported` 明示，不假装应用 |
| 多说话人混合音轨无法可靠驱动单脸口型 | 首期 provider 只允许单说话人；多人镜提示拆镜；prompt 模式仍可用 |
| Sync Labs 需要公网 URL / 付费 / 上传限制 | 用 Assets API 上传本地文件；展示成本与时长；逐镜手动确认；错误不自动 fallback |
| `handEdited` 以整镜表演为粒度，改一条会锁整镜 | 文档说明；提供“恢复模型建议”清除标记；后续可细化为嵌套 key |
| 旧 `lookEn` 含固定表情，和新表演冲突 | 提示词显式覆盖；不自动改旧数据；新角色拆解规则禁止瞬时表情进身份 |
| 提示词变长、模型输出变慢 | 表演字段只写可见短句；提示词技能不重复身份锚点；保留 2000 字符聊天引用规则 |
| 真实 Seedance 2.0+ 或外部口型调用产生费用/长时间等待 | 默认关闭；手动确认；任务面板显示成本与状态；测试只用 mock/dryRun |

## Migration Plan

1. **数据与契约**：先加可选字段、`bizSignature` 往返、`shots-v1` 可选 schema 和 `buildShotsFromModel` 映射。旧项目读取空表演，不批量改写。
2. **技能**：更新 `skills/shotlist`、`skills/prompt` 的正文与版本；`skills/character` 增加“身份锚点不写瞬时表情”的规则。用户已有正文覆盖不会被自动覆盖，设置页显示版本/恢复默认。
3. **工作台**：`ShotTable` / `Inspector` 接入表演编辑器；`PromptTable` 的 `briefJson` 增加 cast/performance；先保证无表演时行为与现在一致。
4. **配音**：`VoiceLine` / `/api/voice` / provider adapter 增加可选表演参数；默认 MiniMax 生效，其他引擎按能力降级。
5. **表情参考**：`CharacterBoard` 增加逐表情生成/候选/选择；`collectShotReferences` 接入表情图；先用 mock 图和现有图像模型验证。
6. **口型**：先做 `off`/`prompt` 与 QA；再实现 Sync Labs adapter（Assets 上传 + 生成 + 轮询 + 下载），默认关闭、逐镜手动确认。
7. **回归与证据**：新增纯函数、UI、请求体 dryRun、导出与口型 QA 脚本；跑既有 `verify-workbench-chats`、`verify-export`、`verify-*` 回归。真实素材验收记录在 `openspec/changes/shot-performance-direction/evidence/`。

回滚：关闭 `lipSync` 设置即回到原视频；表情字段可忽略；表演字段对旧代码是未知 JSON，读写不会丢；不删除任何已生成媒体。

## Open Questions

- Sync Labs Assets API 的当前上传大小、保留期和计费细节需要在实现时按官方文档再核实；这不改变本设计的 adapter 边界。
- 是否在首期后追加 Kling Advanced Lip-Sync adapter，取决于实际账号可用性与成本；不影响本变更的首期验收。
- 表情参考图首期使用 1:1 头肩构图、2 张候选；如果实际模型对 3:4 更稳，可在实现时调整，不改变“身份与表情分离”的契约。
