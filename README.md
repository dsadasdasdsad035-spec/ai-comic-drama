# ai-comic-drama · 分镜画布（storyboard-canvas）

AI 漫剧的可视化分镜工作台：分镜卡片自由排布 → 生成静帧 → 图生视频 → 台词配音 → 连播预览 → 一键导出带字幕成片。

## 运行

```bash
npm install
npm run dev      # http://127.0.0.1:5273
```

需要本机有 **ffmpeg（带 libass）**；API key 从以下位置读取：

- `~/.canghe-skills/.env` → `ARK_API_KEY`（Seedream 出图 / Seedance 出片）
- `APIB_API_KEY` / `APIMART_API_KEY` → APIMart（APIB）文本 / 图像 / 视频 / 配音；余额不足时网关返回 402
- 任意上述 `.env` 或环境变量 → `ELEVENLABS_API_KEY`（可选，缺失则退回 macOS `say`）
- `SYNC_LABS_API_KEY`（可选）→ 口型 provider；也可以在设置页「口型」里填，默认关闭

3D 预演需要本机 **Blender**（受支持范围 4.2–6.0，当前实测 5.2.2 LTS）：

```bash
brew install --cask blender    # 或自行安装到 /Applications
```

- 定位顺序：`BLENDER_BIN` 环境变量 → `/Applications/Blender.app/Contents/MacOS/Blender` → `PATH` 里的 `blender`。
- 未安装或版本不符时，工作台的生成与渲染入口会禁用并给出指引；手写代码、保存和旧视频查看不受影响。
- 可选环境变量：`BLENDER_MIN_VERSION` / `BLENDER_MAX_VERSION`（默认 4.2 / 6.0）、`BLENDER_CONCURRENCY`（默认 2）、`BLENDER_ENGINE`（默认 eevee）、`BLENDER_PROXY_FPS`（默认 15）、`BLENDER_PROXY_EDGE`（默认 540）。
- 渲染作业在 `.blender-jobs/<jobId>/` 下运行，成功、失败或取消后自动删除；产物只保留 `public/videos/` 的 mp4 与 `public/generated/` 的关键帧。
- 健康检查：`GET /api/blender/health`（`?refresh=1` 强制重新探测）。
- 安全边界：场景代码以**本机用户权限**在 Blender 进程内执行，只有静态准入与一次性工作目录，不是浏览器沙箱。

## 界面骨架

上沿固定两条带，位置和成分不随视图变化：

- **全局带**（52px）：品牌、项目选择、集选择、八个视图、密钥告警、任务台账、日/夜切换、导出 JSON。它在所有视图里长得一样。
- **视图上下文带**（44px，只在需要的视图出现）：固定「范围 | 设置 | 动作」三段。范围说明本视图在看什么，设置是只影响本视图的参数，动作是本视图的入口和主操作。每个视图最多一个强调色主操作。
- **画布专属工具**（标注、操作、加素材、连播）在画布内左上角的浮动条里，不占全局带。
- **集**只是全局带上的一个下拉选择器，显示当前集的集号、标题和镜数；剧本、角色、素材、镜头表、提示词、画布六个项目视图共用。
- **创意**是唯一不绑定项目的视图：进入后全局带隐藏项目与集选择器，聊天是主界面；会话与源视频独立存储，只有「晋升项目」才写入项目。详见 [`docs/creative-studio.md`](docs/creative-studio.md)。

## 项目上下文

全局带的项目选择器是全站唯一数据边界：剧本、角色、镜头表、提示词和画布都只读写当前项目。创意的唯一例外是它**不读项目**：会话、源视频与产物自成一套，只有显式「晋升项目」才通过既有项目写入路径落库。

- **剧本**：生成和保存都必须绑定项目；有未保存分集时切换项目或离开剧本页会先确认，保存后才写回项目。
- **画布**：按项目存 `storyboard-canvas-v1:<project>`；切换项目时从该项目的 `project.shots` 水合，不再读写全局画布。旧全局画布会先备份到 `storyboard-canvas-v1:legacy-backup`，只迁移能归属当前项目的节点。
- **拆角色**：全剧读项目 `source + episodes`；本集读当前集的 `project.shots`（cast / 台词 / 画面），不依赖浏览器里残留的画布节点。角色页也能直接切集，切完镜头上下文与聊天上下文一起跟着走。
- **素材**：场景/道具设定存项目的 `designs`，和画布素材库分开；设定图可以单卡或批量发布成 `scene` / `prop` 素材卡。素材守则在设置页默认启用，按地点/道具去重，场景图固定空镜、道具图固定多角度隔离表。

## 项目媒体

角色三视图和场景/道具设定图是长效参考图，存放在 `projects/<项目名>/assets/`，项目数据里引用 `/project-assets/<项目名>/<文件>`。它们和 `projects/` 下的 SQLite 同生命周期：把整个 `projects/` 目录搬到新工作区，角色和设定图仍然可用；清空 `public/generated/` 也不会影响它们。

- `public/generated/` 只放镜头首帧、调度帧、视频等可重生成产物。
- 打开项目时会把仍存在的旧 `/generated/...` 引用复制进项目目录并改写；找不到文件的引用会保留并标记「图片文件缺失」。
- 恢复缺失图：把同名文件放进 `projects/<项目名>/assets/` 后重新打开项目（迁移按文件名命中），或在角色板重新生成。
- `projects/*/assets/` 与 `projects/*.sqlite` 一样不提交 git，需要随项目目录一起备份。

## 主题

全局带右侧提供「日间 / 夜间」切换。夜间保留 Cinema Dark；日间是暖纸底的 Paper Studio，分镜图片和视频保持原色，只切换工作台界面。首次打开跟随系统 `prefers-color-scheme`，手动选择记在浏览器 `storyboard-theme`，刷新保持；主题偏好不会写入项目文件。两套主题各有自己的上沿表面 token（`--chrome-1` / `--chrome-2` / `--chrome-line`），日间用比内容更亮的暖白，避免上沿看起来是凹进去的。

## 素材卡来源

素材卡 Inspector 的「选择素材」打开缩略图选择器：项目素材 / 生成图片 / 视频 / 手填地址分类，支持搜索、图片大图预览和视频 hover 播放。点选只预览，点「使用这张」或双击才写回；选视频会自动把素材类型切为视频，场景/道具卡换普通图会保留原类型。

## 画布参考与视频模式

右击分镜可以手动选择参考：角色、素材，以及同集的上一镜/下一镜当前生成画面。相邻参考不会自动加入，下一镜未出图时置灰；它们只取当前 `refImage`/候选图，不使用尾帧。相邻镜头已有叙事边，不再额外画一条参考线。

- 画面生成最多 10 张参考图；超出时提示省略项。
- 视频出片最多 4 张 `reference_image`，优先级为当前画面 → 角色 → 相邻分镜 → 场景/道具；超出时提示省略项。
- 视频素材参考来自画布连线：把视频素材卡连到分镜，即作为 `reference_video` 提交；首期只使用第一条视频，其余在面板列出。视频不占 4 张图片额度，可与参考图同时使用。
- 3D 调度不再有专用参考开关；需要结构参考时，把渲染好的 MP4 选成素材并连线。
- 视频尾帧约束和尾帧接龙已移除：不再提交 `last_frame` / `return_last_frame`，不再保存或展示尾帧。旧项目的 `tail_image` 保留在数据库里但不再读取/展示。
- 画面参考和视频参考共用 `refIds` 中的 `shot-prev` / `shot-next` 关系 token，镜头重排后会指向当前相邻镜头。

### 3D 调度（提示词工作台）

- 提示词工作台每镜的「3D」列显示 `未渲染 / 生效 / 仅审阅 / 已过期`，点「打开」进入该镜的 Blender 3D 工作台；画布右击菜单和 Inspector 不再提供编辑/生成 3D 调度入口。
- 3D 工作台按镜头保存代码、参考内容和渲染元数据；从提示词工作台保存时只写 3D 字段，不会覆盖未保存的提示词草稿。
- 渲染仍由用户显式触发，只用于人工审阅运镜、走位和空间；不会自动判定提示词或视频，也不会产生 Seedance 成本。
- 渲染出的 MP4 落在 `public/videos`，素材选择器的「视频」分类可以直接选，确认成视频素材后连线到分镜，即可作为出片参考。

### 分镜 Inspector 四页结构

选中分镜后，右侧 Inspector 分成 `画面` / `视频` / `声音` / `更多` 四页；顶部固定镜头缩略图、镜号和状态 chip，底部固定当前页的主操作，长内容只在中间滚动。

- `画面`：镜头参数、当前画面与候选、画面提示词、参考汇总、出图设置、构图标注；参考图的画布连线仍然通过右击卡片操作。
- `视频`：当前视频、运动提示词、本次出片提示词、原生音频、出片设置和挂载视频；不再包含 3D 调度区块。
- `声音`：台词/音效、表演、配音、口型；原生音频属于视频请求，仍留在 `视频` 页。
- `更多`：稳定 ID、场次、节点信息、手工参考 URL 和删除入口；不再包含 3D 调度入口。
- 已有画面的镜头默认进入 `视频`，没有画面默认进入 `画面`；手动切页后记住选择。头部 chip 可一键跳到画面、视频、配音和提示词。
- 面板宽度 320–520px，默认 360px，左侧拖拽调整、双击复位；宽度、当前页和折叠状态存在浏览器，不写入项目文件。
- 镜头参数、表演、参考和高级区块可折叠，折叠后保留摘要；切换 tab 不丢未保存的提示词草稿。
- 删除镜头收进右上角 `...` 菜单并二次确认；素材卡 Inspector 保持原结构，不使用分镜驾驶舱。
- 验收：`node verify-shot-inspector.mjs` 覆盖 tab、默认页、吸底、拖宽、折叠、草稿保留、删除确认和素材卡隔离。

### 连播与字幕

连播现在是可听、可看、可定位时间的成片预览：TTS/native 音轨会播放，字幕按 cue 显示，头部显示实际播放时间而不是镜头结束点。

- 播放顺序只由镜号决定；画布节点数组顺序和时间线拖动都不会改变顺序。
- 播放头连续推进；拖动当前镜头进度或点击分段可 seek/跳转；空格播放/暂停，方向键换镜，`M` 静音，`F` 全屏，Esc 在全屏时先退出全屏。
- 字幕与导出烧录分开：`预览字幕` 只控制画面 overlay，`烧录字幕` 只控制导出。
- 字幕按句从台词派生，默认去掉「角色：」前缀；有 TTS 时按 `voiceSeconds` 和 `voiceOffset` 分配，native/无配音时按镜头时长估算并在时间线标虚线。
- 连播、时间线、导出和校验共用同一份 cue；导出时服务端加真实段起点并夹紧越界 cue。
- 有 libass + CJK 字体时用 SRT 烧录，并输出与烧录一致的 SRT sidecar；没有 libass 时每条 cue 渲成透明 PNG，按 `between(t,start,end)` 定时叠加，不再整镜静态覆盖。
- 导出前校验空文本、起止倒置、越界、重叠、单行过长、阅读速度和 cue 时长；错误阻止导出，警告要求确认。
- 当前不做逐词/TikTok 高亮、逐句拖拽/改文本、样式设置、软字幕和外部 SRT 导入。
- 验收：`node verify-preview-captions.mjs` 覆盖播放头/TTS/字幕/seek/全屏/导出 payload；`node verify-subs.mjs` 覆盖 cue、SRT、真实导出和 sidecar。

### 出片提示词预览与手改

Inspector 视频页的「本次出片提示词」面板在点生成之前展示最终正文，以及实际附加的 `图N / 视频N / 音频N` 槽位、标签和用途；超过 4 张被省略的参考图、首期未使用的视频素材都会逐项列出。上半部分附件清单由画布连线（参考图与视频素材）和音色样本决定，改正文不会增删附件。

- 点「编辑」可以把正文改成手写版本并保存到本镜；之后出片逐字发送手改全文，不再追加自动段落。
- 参考图、台词、运动提示词、运镜走位、音色参考或出片模式变化后，手改版本标为「旧快照」并保留正文；点「重新拼装」回到最新自动结果。
- 手改版本参与 `handEdited`，重新拆镜或重写 `video_prompt` 不会覆盖它。
- 出片成功后记录 `video_meta`（实际提示词、指纹、模型、时间）；当前视频与记录 URL 一致时可展开查看，旧视频显示未记录。
- 预览与实际请求共用同一个拼装器，验收脚本会逐字比对面板正文和 `/api/seedance` 请求里的 `prompt`。

## 分镜转场（接缝）

点画布上分镜之间的连线标签会在硬切 → 转场 → 闪回 → 分支之间循环；落到「转场」时立刻应用 **0.5 秒叠化**（缺省值读时兜底，不批量改旧存档）。标签右侧的 `⋯` 打开转场面板。

- **效果转场**：叠化、擦除（左/右/上/下）、推移（左/右/上/下），时长 0.2–1.5 秒；实际时长会夹到较短镜头的 80%。成片按重叠计算：`A + B − T`。
- **生成转场**：先生成关键帧，再图生视频。边界帧自动取上一镜尾帧 / 下一镜首帧（没有视频就用当前画面），参考默认继承相邻两镜已连的角色和素材，可在面板增删；关键帧最多 10 张参考。
- 生成视频按模型能力分流：关键帧永远作首帧；方舟只用首帧（成片裁到目标时长），APIMart Seedance 2.5 / Kling v3 再加 B 首帧作尾帧、不送参考图（上游禁止尾帧与参考图混用）。生成片段作为独立片段插入，两端各 0.2 秒叠化，成片按 `A + T + B − 2f` 计算，片段自带音频会被丢弃。
- 生成转场**逐条手动触发**；「操作 → 全片统一叠化」只改效果转场，跳过生成转场。面板显示请求时长、模型与估算成本。
- 转场只对播放序列中相邻的两镜生效；不相邻的线会标「未参与成片」，不缩短成片。
- 时间线、预览、导出共用同一份剪辑序列。预览里叠化忠实呈现，擦除/推移为近似表现，以导出为准。
- 上一镜或下一镜重出片后，生成转场的边界会变化，面板标「需要重生成」；导出结果会报告失效数量，仍可继续导出。
- 配置与产物按 `transition_out` 存在源镜头上（跟随 project.json）；画布连线丢失后，重载会按镜头对自动修复。

操作路径：画布点连线标签 → 选「效果」或「生成」→ 生成关键帧 → 生成转场视频 → 「连播」里预览 → 「导出成片」。

## 表演方向、配音情绪与口型

镜头表新增「表演」列，Inspector 也有同一份表演区：按角色记录情绪、0-5 强度、当前景别看得见的动作、视线和是否说话；台词行可以另存情绪、语速、音量与重音。旧项目没有这些字段时按空表演读取，不会要求迁移。

- 拆镜技能会为每个说话角色输出表演；提示词技能把 `cast`、`performance` 和逐行表演一起送进模型，首帧写表情与说话状态，视频写说话中的嘴部动作。没有表演时仍按 `desc` 与台词生成。
- 表演是手改字段：在镜头表或 Inspector 改过的 `performance` / `dialogue_delivery` 会在重新拆镜时保留；「恢复模型建议」清除保护后才接受模型值。
- 角色身份锚点只写稳定外观，瞬时表情交给镜头表演。每个角色维护一张 4×2 表情总图（8 个固定情绪格），一次只生成 1 张；有三视图时用三视图作身份参考。总图发布为一张 `expression-sheet` 画布素材卡，分镜按表演裁出单格发送，整张总图不会进入生成参考。旧的逐情绪单图只读回退，`lookEn` 变化会把总图标为需要重生成。详见 [`docs/character-expression-sheet.md`](docs/character-expression-sheet.md)。
- 视频出片默认不带表情参考；在 Inspector「声音」页显式开启后，最多加入一张说话角色单格。4 张参考按“当前画面 → 身份图 → 场景/道具 → 表情”分配，预算不够先省略表情；当前画面与身份图不会被静默省略。
- 配音把逐行表演映射到当前 TTS 引擎：MiniMax 用 `voice_setting.emotion/speed/vol`，火山 Seed TTS 用 emotion/emotion_scale/speech_rate/loudness_rate，ElevenLabs 用音频标签或 style，OpenAI 兼容渠道用 `instructions`。引擎不支持时会显示「未应用」，台词文本和字幕始终是原文。台词或表演变化后旧配音保留并标记需要重生成。
- 口型有三档：`关闭`、`提示词`、`外部口型`。`提示词` 只影响首帧/视频提示词；`外部口型` 需要已接受视频、台词音频和设置页配置的 Sync Labs Key，逐镜手动确认并显示成本。首期只支持单说话人镜头，多人镜头请拆成单人镜；结果作为独立版本保存，采用后才进入预览/导出，切回原版不会删除结果。
- 口型验收在本地用 ffmpeg 找静音段/发声段并抽帧；可以点「视觉自动判定（advisory）」让视觉模型判断嘴部开合，也可以人工确认。判定只用于提示，采用口型版仍是手动动作。
- 真实 Seedance 2.0+ 和外部口型调用仍按人工确认规则执行；自动化测试只用 mock、dryRun 和本地 ffmpeg。

## 音色目录与自定义音色

设置页「音色」按当前音频模型列目录：MiniMax 动态读取 `/v1/get_voice`，ElevenLabs 读取账号 `/v1/voices`，火山列预置并允许自定义 speaker，APIMart 只列 OpenAI 兼容预置，macOS 只列本机语音。

- 支持自定义的渠道（MiniMax / ElevenLabs / 火山）可添加 `voice_id`；条目存设置库，不写项目。
- APIMart 和 macOS 不显示新增入口；macOS 需去系统语音管理安装。
- 角色音色下拉按“渠道 · 来源”分组；旧 `voiceId` 不在目录时保留为“未知/保留原值”，不会静默换音色。
- 显式音色不再回落到默认；供应商拒绝时显示错误。
- 克隆/设计入口目前保持禁用，需先探测供应商接口；可在供应商控制台创建后把 voice_id 加为自定义音色。

详见 `docs/voice-catalog.md`。

## 角色音色样本与 Seedance 原生音频

角色卡可以生成一段 2-30 秒的**音色样本**（固定试音稿、单人、无背景音乐），保存到项目媒体目录；它独立于 `voiceId`，换音色/模型/试音稿会让旧样本标为需要重生成。画布 Inspector 的「原生音频」只对通过实测的 APIMart Seedance 2.5 开放：

- 当前 APIMart 实测使用**单个 `audio_url` 字符串**（公网 URL 或 `data:audio/...;base64,...`），不是 `reference_audio` 数组；`generate_audio: true`。
- 视频最短 **4 秒**；2 秒会被 provider 拒绝。
- 首期只支持**单说话人**；多人镜头 native 禁用，继续用静音视频 + TTS 或拆镜。
- native 镜头最终使用视频自带音轨，不再混该镜 TTS；字幕仍按台词生成；切回关闭恢复 TTS。
- native 与 provider 口型互斥；要 TTS 逐字对齐仍用 provider 口型。
- 参考音频会经过内容安全/版权审核；只使用自己生成或已授权音频。

实测：4 秒 + 自己生成的 TTS Base64 音频已出片（854x480、AAC、4.064s）；`/api/assemble` 能从 native 视频取音轨导出。详见 `openspec/changes/seedance-voice-reference/evidence/README.md`。

## 3D 调度（Blender 代码优先）

每个镜头以一段 Blender Python（bpy）代码为场景真相（`sceneCode`，`version: 2`、`abiVersion: 2`、`runtime: 'blender'`）。从**提示词工作台**每镜的「3D」列打开代码工作台；画布右击菜单和 Inspector 不再提供 3D 入口。旧 `shotScene`/`shotBlocking` 和 v1 Three.js 代码只读，需要显式转换为 Blender 代码。

### 工作台

- 顶栏：镜号、有效时长、画幅、代码来源/hash、引擎版本、保存、渲染、关闭。
- 左侧参考内容：按当前项目和集数浏览角色、素材、场景、道具、图片、视频、文本七类；点选只预览，「加入上下文」才进入附件；支持搜索、推荐参考（先预览再确认）、沿用上一镜和清空。
- 中间：代理片预览（低清 mp4）、播放/暂停/拖动时间轴、渲染进度、运行错误。没有浏览器实时渲染；改代码后代理片标脏，点「运行」或保存时重新渲染。
- 右侧：聊天 / 代码双页签；上方「代码模型」可直接切换本机手选模型，同时作用于首次生成和 agent 聊天。
- 空镜头首次打开不自动生成；附件栏为空时生成会提示先添加参考。已有生效视频直接当代理片，不重复渲染。只有旧数据的镜头显示只读横幅和「转换为 Blender 代码」，不会自动覆盖。
- 渲染 MP4 落在 `public/videos`；素材选择器「视频」分类可以直接选成视频素材，再连线到分镜作为出片参考。3D 渲染只用于人工审阅，不自动判定提示词或视频。

### 代码 ABI

代码必须定义三个顶层函数：

```python
def build(ctx):
    # ctx.scene / ctx.camera / ctx.camera_data
    # ctx.asset(key) -> 素材只读路径；ctx.assets() -> 清单
    # ctx.width / ctx.height / ctx.aspect / ctx.duration / ctx.fps / ctx.shot
def pose(t, mode):
    # t 是 0..duration 秒；只改场景状态，不渲染、不写文件
def dispose():
    pass
```

宿主逐帧执行 `frame_set` → `pose(t, mode)` → 渲染；同一 `t` 必须产生同一画面。渲染设置（引擎、采样、分辨率、帧率、输出）由宿主拥有，代码不能修改。

选中素材通过稳定键取路径，例如 `character:<id>`、`design:<id>`、`image:<hash>`、`video:<hash>:frame:0`。视频只以关键帧进入代码运行时和聊天，不依赖视频逐帧 seek。

### Agent 聊天（LangGraph + assistant-ui）

- `@langchain/langgraph` 的 `StateGraph` 管状态和工具循环；JSON action 由 `ZCodeChatModel` 实现（`{content, tool_calls}`），provider 原生工具调用由 `NativeToolChatModel` 实现。
- 工具白名单只有 `get_shot_context`、`begin_scene_draft`、`append_scene_draft`、`read_scene_draft`、`patch_scene_draft`、`commit_scene_draft`、`discard_scene_draft`、`set_scene_code`、`run_render`、`capture_frames`、`review_frames`、`finish`。没有 shell、网络、保存或写其他镜头的工具。
- 长代码用草稿工具分片写入：`begin_scene_draft` 重置当前镜头草稿，`append_scene_draft` 单次 ≤32KB，`read_scene_draft` 按 1-based 行范围读（≤200 行/8KB），`patch_scene_draft` 一次替换一个行范围（start 含、end 不含），`commit_scene_draft` 读整份草稿并做静态准入，`discard_scene_draft` 删除。`set_scene_code` 保留为短代码快捷方式。
- 草稿是应用管理的临时文件，固定落在 `.scene-drafts/<项目>/<镜头>/draft.py`（gitignore）；模型只拿到随机草稿 id，不能传路径。服务端拒绝路径穿越/绝对路径/符号链接，总量 200KB；关闭工作台、取消、`discard` 或 dev server 启动时清理。
- `commit_scene_draft` 只把通过准入的代码设为当前 agent 代码（`session.code`），**不会**覆盖工作台草稿；只有 `run_render` 试运行成功才更新工作台。提交/试运行失败不改旧代码，聊天草稿卡显示失败原因。
- 聊天草稿卡只显示行数/字符数和状态（暂存 / 已提交，待试运行 / 已生效 / 失败 / 已丢弃）；「查看草稿」是只读预览，固定标注「未试运行」或「已试运行」，不提供保存/运行入口。
- 历史序列化时把已提交之前的早期 `begin/append/patch` 折叠成一行摘要，保留最近 4 次编辑和 `read/commit` 结果；模型改代码前重新 `read_scene_draft`，避免长代码重复占满上下文。
- `set_scene_code` 只接受当前镜头完整代码；代码必须通过 `run_render`（Blender 渲染开头与结尾帧）才进入工作台草稿。`capture_frames` 抓 5 个关键帧；`review_frames` 用视觉清单初筛；`finish` 必须已有渲染试运行通过。
- `finish` 后聊天自动进入视频验收：用最终代码和本次上下文渲染 clean MP4，从 MP4 按有效时长抽 5–9 帧（含首尾），再交给视觉清单；最终结论只使用 MP4 帧。
- 只有 MP4 帧验收通过才原子保存代码、参考上下文、MP4、`sceneCodeMeta` 和 `scheduleMeta`。未通过、取消或超时保留草稿和旧项目视频。
- 代码卡、视频卡和验收卡共享 `codeHash`；代码或引擎版本变化后旧视频/旧验收标记过期。工作台「最近视频」显示生效/已过期；工作台有未保存草稿时，画布右键 3D 出片会被阻止。
- 运行只开放可配置的总运行时长：默认 300 秒（范围 60–1800）。代码修复 3 次、视觉验收 2 次、单工具 30 秒仍固定；总时长超时显示“运行超时”，取消显示“已取消”，两者都会终止未完成渲染并保留旧代码。
- 聊天展示每轮模型状态、工具开始/结束、代码摘要、帧、清单和摘要，不展示隐藏 chain-of-thought；3D 线程按项目 + 镜头持久化，关闭工作台释放 Blender 沙箱并把运行中的本轮标记取消，重新打开恢复消息、工具摘要和已保存代码/视频引用。
- 模型生成期间显示「第 N 轮 · 已生成 N 字符」的进度：`/api/text` 以 SSE 返回 `meta/progress/done`，渠道不支持流式时自动回退整段 JSON。reasoning 字段和 `<think>…</think>` 块在代理层就被丢弃，不会进入聊天。
- 文本流与工具参数流是后续档位：JSON action 当前只发进度，不把 JSON 片段当聊天文本；原生 tool calls 会发送参数增量事件，但代码页仍然只在参数完整后才接收草稿。
- 模型输入以显式附件清单为准：镜头元数据只有镜号/时长/画幅；角色、场景、道具、图片、视频关键帧、文本和媒体 brief 都必须通过「加入上下文」进入附件，左侧浏览本身不改变上下文。
- 「查看将发送」展示系统提示、视觉/代码两条通道、附件全文与预计大小；媒体 brief 可按附件排除；每轮模型调用在聊天里生成可折叠的「本轮上下文」审计卡。
- 画布右键 3D 出片不再自动使用默认参考；没有附件时会提示先打开工作台添加（可用「推荐参考」，先预览再确认）。

### 工具协议（原生 tool calls / JSON action）

- 设置页「Agent 运行上限 → 工具协议」决定 3D agent 用哪种协议：`auto`（默认）、`native`、`json`。`auto` 只对已声明支持 tools 的模型使用原生协议，其余模型继续 JSON action；显式 `native` 遇到未声明支持的模型会报错，不会静默换渠道或换协议。
- 首批已验证模型：MiniMax-M3、Agent Plan 的 `doubao-seed-2-1-lite-260915` / `deepseek-v4-flash` / `kimi-k3`。能力表在 `src/agent/toolCapabilities.ts`，含 thinking 策略与验证日期；未列出的模型默认“不支持”，`auto` 自动回退 JSON。
- 原生请求仍经过 `/api/text`：请求体可带 `messages`（含 `assistant.tool_calls` 与 `tool` 角色）、`tools`（OpenAI function 定义）、`toolChoice`；响应与 SSE 的 `done` 返回 `toolCalls`（`{id,name,arguments}`）、`finishReason` 和可用的 `usage`，流式还会先发 `tool_call_delta`。
- 工具参数增量只作为进度事件（`tool_call_args`），参数完整前不执行工具、不写草稿；执行仍由 LangGraph 的 `tools` 节点完成，两种协议的工具集合、上限、草稿和验收流程完全一致。
- 原生模式不发送 JSON action 协议提示；JSON 模式保留原路径作为回退。单次 `append_scene_draft` 仍建议 ≤1500 字符（硬上限 8000），原生协议同样会被输出长度截断，分片策略不变。
- 原生模型的输入输出：`NativeToolChatModel._generate(messages)` 接收 LangChain 消息（system / human / 带 `tool_calls` 的 assistant / `tool`），输出 `AIMessage`，其 `tool_calls` 为 `{name, args, id}`；`ask` 收到 `messages`、`tools`、`toolChoice`，返回 `toolCalls`、`finishReason`、`usage`。JSON 模型则接收压平后的 prompt，解析文本里的 `{content, tool_calls}`，两者共用 `compactDraftHistory` 与工具执行节点。
- 本机验证过的 thinking 行为：工具调用模式会关闭 MiniMax-M3、豆包、DeepSeek Flash、Kimi 的思考，避免 reasoning 吃掉参数输出预算；设置页会显示 3D 代码环节当前模型的支持状态。

直接验证工具协议（示例）：

```bash
curl -s -X POST http://127.0.0.1:5274/api/text \
  -H 'Content-Type: application/json' \
  -d '{
    "modelKey": "minimax-text",
    "messages": [{"role": "user", "content": "查一下北京天气，必须调用 get_weather"}],
    "tools": [{"type": "function", "function": {
      "name": "get_weather",
      "parameters": {"type": "object", "properties": {"city": {"type": "string"}}, "required": ["city"]}
    }}],
    "toolChoice": "auto"
  }'
```

返回里的 `toolCalls` 是 `[{id,name,arguments}]`，`arguments` 为 JSON 字符串；带 `"stream": true` 时同一份请求会先返回 `tool_call_delta`，最后在 `done` 里给完整 `toolCalls`。

### 执行模型与上限

- 场景代码在本机 Blender 进程中以**用户权限**执行，使用 `--factory-startup` 和一次性作业目录；这**不是浏览器沙箱**，只运行你信任的代码。
- 静态准入：必须定义 `build`/`pose`；拒绝 `os`/`sys`/`subprocess`/`socket`/`urllib`/`open`/`eval`/`exec` 与 `bpy.ops.wm`/`export`/`import` 等写盘调用；代码 ≤ 200KB。
- 素材复制进作业目录后 `chmod 0444`；图片长边超过 2048 时落盘缩放；≤ 16 张图、≤ 4 个视频（每个 3 关键帧）、单次素材 ≤ 48MB。
- 作业并发上限 2；试运行 60s、代理预览 240s、定稿 900s 总预算；取消、超时或进程崩溃都会终止进程、删除作业目录并保留上一版视频。
- 输出 PNG 帧序列后由 ffmpeg 编码为 mp4，帧数 = 有效时长 × 帧率，固定 `clean` 模式，继续走 `/videos` 与 `/generated` 的下游通路。

### 参考内容与媒体 brief

选中的图片和视频关键帧会合成带标签参考板，调用 `vision` 生成 `MediaBrief` 并缓存；没有视觉模型时只发送素材清单和标签，界面明确“素材未参与理解”。首次代码生成可选 `videoVision` 原生视频理解；渠道不支持本地视频时回退关键帧，聊天永远不直接调用视频理解。图片像素不写入项目或文本提示词。

### 过期与下游

代码哈希、ABI、参与渲染的素材指纹、选择指纹、有效时长和画幅组成 `sceneCodeMeta.fingerprint`。代码/选择/时长/画幅变化后旧 `scheduleVideo` 标为过期；过期或非 clean 视频不能作为 Seedance 参考视频/抽帧参考。`motionNote` 由代码生成或用户编辑，界面标明它不是几何自动推导。

### 模型设置

设置页「模型表」增加 `视觉 · 视频理解`；「生成环节默认模型」增加 `3D 代码（生成/聊天）` 和 `视频理解（首次 3D）`。`3D 代码` 走文本族，未绑定则沿用文本默认；`视频理解` 只列声明 `videoVision` 的模型。没有代码模型时 AI 生成禁用，手写代码仍可运行。建议把 `3D 代码` 绑定到编码能力更强的模型（本机验收使用 `ark-plan-text-deepseek`）；首次试运行报错时会带错误自动修复一次，仍失败则保留旧代码。「Agent 运行上限」里的工具协议默认 `auto`，设置页会显示当前 3D 代码模型是否支持原生工具调用。

预置 `ark-plan-text-deepseek-flash`（DeepSeek Flash · `deepseek-v4-flash`）复用现有 Agent Plan Key。它是混合推理模型：普通文本默认开启思考；JSON / 工具协议（包括 3D agent 的 JSON action 和代码生成）自动关闭思考，避免 reasoning 吃掉结构化输出预算。模型条目上的 `thinking` 可显式覆盖为 `enabled` / `disabled`；默认 `auto` 不改变任何现有默认模型。另有 `ark-plan-vision-deepseek-flash` 用于参考板/关键帧视觉理解；agent 聊天里的 `review_frames` 会通过 `/api/vision` 调用它，JSON 验收同样自动关闭思考。`presetsVersion` 升到 5，旧设置只补一次新模型，已删除的预设不会复活。

### APIMart（APIB）渠道

设置页可以添加 `APIMart（APIB）` 渠道，Base URL 默认 `https://api.apimart.ai/v1`，Key 取设置库或 `APIB_API_KEY` / `APIMART_API_KEY`，不沿用方舟 Key。当前 `presetsVersion` 为 9：v5 追加 DeepSeek Flash，v9 追加 APIMart 渠道与 8 个已接入运行时的预置模型；已有默认模型保持不变。

- 模型目录：`GET /v1/models?expand=category`。设置页「模型 → 同步 APIMart 目录」可拉到全量模型；一个模型只登记一行，能力写在 `caps` 里（文本/高质量/视觉、图像/三视图、视频/视频参考、配音）。
- 已接入运行时：文本与视觉（GPT-5.1 视觉已实测）、图像异步任务与参考图上传、`gpt-4o-mini-tts` 配音，以及 51 个生成型视频模型（通用 schema 适配：`prompt/duration/resolution/aspect_ratio/first_frame_image/last_frame_image/image_urls/video_urls`）。
- 6 个视频模型仍标「未接入」：它们是编辑/动作控制/源任务再生成/提示词增强，不是“给首帧就出片”的生成模型（`MiniMax-H3-Context-IR`、`MiniMax-H3-Regeneration`、`wan2.7-videoedit`、`kling-v2-6-motion-control`、`kling-v3-motion-control`、`veo3.1-lite`）。
- 音频里只有 `gpt-4o-mini-tts` 走配音；`tts-1` / `tts-1-hd` 实测返回 404，Whisper、Suno/Flow Music、音频对话模型需要单独功能。嵌入、审核、旧版 completions 也没有对应入口。
- 图像/视频是异步任务：提交后轮询 `/v1/tasks/{id}`，结果立即下载到 `public/generated` / `public/videos`，不依赖 24–72 小时的临时 URL。
- 参考图先走 `/v1/uploads/images` 换 URL（20MB 上限）；APIMart 没有文档化的参考视频上传接口，视频参考只接受公网 `video_urls`，本地 3D 调度视频不能直接提交。
- 余额不足时网关对所有请求（包括 `/v1/models`）返回 402；设置页的「测试」会显示「余额不足」而不是 Key 无效。充值后再做真实出图/出片验收。
- Whisper 转写、Suno/Flow Music、内容审核属于后续能力，本期未接入；APIMart 原生 tool calls 在实测前继续走 JSON action。

### 明确不做

纯代码模式不提供角色名单、穿墙/碰撞、空间连续性或自动运镜文案校验；旧结构化编辑器不再提供拖拽/数值精修。需要精确空间关系时请检查代码、预览和运行错误。

## 3D Agent 验收（山 / 男女 / 双剑 / 环绕）

固定场景在 `fixtures/agent-duel-scene.py`：山体、一名男人和一名女人、两把剑、对打动画，4 秒 16:9，Blender 相机环绕并始终看向两人中点。验收既看聊天工具轨迹，也看真实渲染帧和 mp4，不只看最终回复。

```bash
# 纯图级回归：mock 模型/渲染/视觉，不调用真实模型
node verify-agent-graph.mjs

# assistant-ui 聊天 UI：懒加载、工具卡、5 帧、清单、主题、900/760px
APP_URL=http://127.0.0.1:5280 node verify-agent-chat-ui.mjs
APP_URL=http://127.0.0.1:5280 node verify-agent-chat-failure.mjs

# 固定场景 mock 验收：脚本化模型 + 真实 Blender 渲染 + 真实 4 秒 mp4
APP_URL=http://127.0.0.1:5280 node verify-agent-3d-duel.mjs

# 同一 prompt 走当前设置的 sceneCode 模型；无视觉模型时清单转人工
AGENT_REAL=1 APP_URL=http://127.0.0.1:5280 node verify-agent-3d-duel.mjs
```

`verify-agent-3d-duel.mjs` 默认使用 mock，真实模型模式会把 codeHash、5 帧、mp4 和清单写入 `openspec/changes/agentic-3d-scene-chat/evidence/`；真实模型失败会写入明确原因并以非零退出，不伪装通过。本机一次真实运行使用默认 `minimax-text`（MiniMax M3），产出 49 行代码、5 帧、4.0 秒 16:9 视频；本机未配置视觉模型，清单状态是 `needsHumanReview`，最终画面由关键帧和 mp4 人工复核。

前置：`code-first-3d-chat` 与本变更修改同一聊天入口，归档前先完成/归档它；`agentic-3d-scene-chat` 自身要等 mock 与真实模式都通过后再归档。

## 技能与工作台聊天

- 技能是可编辑的数据，不是代码：每个技能一个 `skills/<id>/SKILL.md`，frontmatter 声明环节/工具/输入/输出契约，正文分「角色与约束」和「任务」两节。完整格式见 [skills/README.md](skills/README.md)。
- 剧本、角色、素材、镜头表、提示词五个工作台的生成按钮与聊天共用同一套技能模板和输入来源；聊天里的大输入由读工具按范围读取，按钮始终使用完整的 inline 输入。
- 每个工作台聊天都有与顶部按钮一一对应的**内置动作**：剧本「生成分集/重新生成分集」（全剧）、角色「从本集拆角色/从全剧拆角色」、素材「从本集拆/从全剧拆」、镜头表「拆镜」、提示词「生成提示词」。动作在空态直接可见，首轮后仍可从头部「+ 内置动作」运行。
- 内置动作由用户点击触发，走工作台自己的宿主函数：完整 inline 输入、任务台账/进度、输出契约和合并逻辑与顶部按钮完全一致；它不是模型工具，不占用聊天轮次/步骤/总时长，也不会在 agent 循环里再套一次模型调用。
- 动作运行中可取消；取消会中止底层请求，不写入半份草稿。同一工作台一次只跑一个动作：运行中禁用聊天发送、顶部按钮和其他动作；聊天模型运行中动作也禁用。
- 动作结果以结构化回执进入线程（动作、范围、数量、保存语义、模型、耗时），重新打开线程仍在；下一轮模型只看到摘要，不重放整份产物。
- 聊天嵌在工作台里：宿主技能可写，其他技能只能只读加载；写工具只产生草稿，合并交给宿主工作台。内置动作只写当前工作台的产物，不跨工作台。
- 只读技能：每个线程最多再加载 1 个参考技能，只拿到读工具，不会出现写工具；模型只能建议加载，不能自行激活。
- 技能来源与版本：设置页「技能」显示内置/用户覆盖、版本和锁定契约；保存只写本机覆盖，恢复默认删除覆盖。旧「技能规则包」只迁移一次，没有自定义的规则包不生成覆盖；迁移用的旧文本冻结在 `src/skills/legacyPrompts.ts`，运行时不引用。
- 聊天入口与面板：五个工作台统一「助手」按钮（⌘J）；首屏显示助手名、编辑范围、当前模型和本轮上下文摘要。面板默认 400px，可拖 340–600，按工作台记住宽度和开合；≥1440 首次展开，≤1180 改为覆盖式抽屉，≤900 全屏。
- 空态与示例：空态、3 个示例和 placeholder 按工作台区分；空态同时显示该工作台的内置动作，点示例只预填输入框，不自动发送。
- 写回执：显示新增/更新/保留手改和保存语义——剧本/镜头表/提示词显式保存，角色约 1 秒自动保存，素材即时落库；显式保存的工作台可在回执里直接保存草稿。内置动作有独立回执，标明动作、范围、数量与是否落库。
- 线程范围：剧本/角色/素材按项目，镜头表/提示词按项目+集，3D 按项目+镜头。关闭工作台后线程仍保留，重新打开可继续；只存文本、工具摘要、内置动作摘要和产物引用。
- 设置页的「技能」区可以编辑正文、查看来源/版本、恢复默认；frontmatter、工具、输出 schema、代码 ABI/安全规则是锁定契约，只读展示。
- 完整流程验收：`node verify-skills-real.mjs` 跑五阶段真实文本；`node verify-agent-3d-duel.mjs` 用 mock 模型 + 真实 Blender 跑通代码/试运行/抓帧/MP4。`AGENT_REAL=1` 的真实 3D 当前在 4 秒环绕场景上仍可能因模型超时、运行错误或视觉验收未通过停在门禁前，详见 [evidence/full-flow.md](openspec/changes/skill-driven-workbench-chats/evidence/full-flow.md)。工作台聊天内置动作的验收：`node verify-workbench-builtin-actions.mjs`（mock 全覆盖）与 `node verify-workbench-builtin-real.mjs`（真实模型从聊天拆镜/生成提示词）。

## 能力

| 区块 | 说明 |
| --- | --- |
| 分镜画布 | React Flow 卡片拓扑 + Konva 图层，可调坐标/景别/运镜/台词 |
| 分镜 Inspector | 画面/视频/声音/更多四页驾驶舱；状态 chip、吸底主操作、320–520px 拖宽、折叠持久化 |
| 角色板 | 生成角色三视图，注入 `lookEn` 到分镜提示词保持一致性；一张 4×2 表情总图、单格裁剪参考、画布素材卡和主图页签角色卡，不写回身份 |
| 素材设定板 | 从本集/全剧拆场景与关键道具，生成空镜/道具参考图，单卡或批量加入画布 |
| 主题 | 日间/夜间两套语义主题，跟随系统或手动记忆；覆盖画布、Inspector、时间线和原生控件 |
| 环节模型 | 剧本 / 角色 / 素材 / 镜头表 / 提示词 / 视觉在设置页绑定默认模型，工作台可临时手选（本机记忆） |
| AI 出图 | Seedream 4.5 多候选并发；单镜/批量/任务台账可取消，候选独立超时，刷新中断可重试 |
| 图生视频 | Seedance 任务式生成 + 轮询，支持首帧 / 1~4 张参考图 / 首期 1 条连线视频素材；相邻分镜可手动加入，尾帧已移除 |
| 3D 调度 | 入口在提示词工作台；每镜 Blender Python 代码 + 可选中参考内容 + 媒体 brief + LangGraph agent 聊天 + 代理片预览/帧精确录制；legacy 只读 |
| 视频素材参考 | 素材选择器选视频 → 素材卡连线分镜 → 作为 `reference_video`（Seedance 2.0/2.5）；首期只取第一条，不再有 3D 专用开关 |
| 表演方向 | 镜头按角色记录情绪/强度/动作/视线/说话；台词行记录情绪/语速/音量/重音，拆镜与提示词共用，手改受保护 |
| 台词配音 | MiniMax / 火山 Seed TTS / ElevenLabs / APIMart / macOS `say`，按角色选音色；逐行情绪映射到引擎原生参数，不支持时明示降级 |
| 口型 | 关闭 / 提示词 / 外部口型三档；默认关闭，provider 逐镜手动确认；本地静音/发声抽帧验收，所有采用动作手动 |
| 连播预览 | TTS/native 音频 + 字幕 overlay + 连续播放头/seek/分段/全屏；与导出共用 cue |
| 导出成片 | 单条 ffmpeg 命令完成拼条 + 字幕 + 混音；有 libass 走 SRT，无 libass 逐 cue PNG，均输出 SRT sidecar |

## 出图生命周期

画布出图现在有界、可取消：

- 运行中的卡片遮罩、Inspector 主按钮、任务台账都能取消；批量出图的选择栏有「取消出图」。
- 单镜取消会保留已有画面/候选，不写失败；批量取消会停止当前请求和后续镜头。
- 服务端每个候选独立超时（默认 180 秒），一个候选卡住不会拖死整单；部分成功会返回图片并提示超时候选。
- 图片下载默认 60 秒超时；客户端请求默认 200 秒超时。
- 同一镜头只允许一个在途出图；旧请求迟到的响应不会覆盖新结果。
- 刷新时遗留的 `genState: 'running'` 会复位为「上次生成已中断，可重试」，不再永久转圈。
- 取消/超时/中断不计入成功任务花费；供应商侧是否实际计费不在本地控制范围。

测试可用 `SEEDREAM_TIMEOUT_MS` / `SEEDREAM_DOWNLOAD_TIMEOUT_MS` / `VITE_IMAGE_TIMEOUT_MS` 缩短超时。

## 发布台（多平台分发）

顶栏「发布」把一条成片分发给抖音、B 站、头条。入口有三个：预览导出成功后的「发布到平台 →」、顶栏「发布」（带运行/失败角标）、发布台里的「导入成片」。

### 成片是发布对象

- 每次导出成功，服务端写一条成片记录（项目 + 集 + 自增版本 + 分辨率 + 时长 + SRT）。刷新或切项目后仍在。
- 也可以直接导入已有 MP4；时长与分辨率用 ffprobe 探测，读不出来就拒绝。
- 发布配置（平台、账号、文案、封面、方式）跟着成片版本保存，重新导出会生成新版本，旧版本仍可选择。

### 平台能力边界（V1）

| 平台 | 保存草稿 | 直接发布 | 说明 |
|---|---|---|---|
| 抖音 | ✅ | 需适配器验证后 | 竖屏优先；AI 生成内容需声明 |
| B 站 | ✅ | 需适配器验证后 | 需分区与标签，封面 16:9 |
| 头条 | ✅ | 需适配器验证后 | 页面结构变动频繁，未验证时只能草稿 |

国内平台没有面向普通创作者的统一发布 API，V1 走本机 Chrome 操作创作者后台。适配器 `verified: false` 时**只能保存草稿**，不会点最终发布；验证后才能直接发布。

### 账号与本机 profile

- 账号只保存「平台 + 显示名 + 本机 profile 目录 + 状态」，**不保存 cookie / token / 密码**。
- profile 落在 `.publish-profiles/`（权限 0700，已进 `.gitignore`），列表与错误信息都不返回其绝对路径。
- 连接账号会打开有头 Chrome，由人完成扫码或账号密码登录；遇到验证码或短信验证同样交给人。
- 会话检查分三态：`connected` / `expired`（明确跳登录页）/ `unknown`（网络或页面结构无法判断）。`unknown` 不会被当作可用。

### 发布流程

1. 选成片 → 选平台与账号 → 填主文案（可逐平台覆写）→ 准备封面（9:16 供抖音，16:9 供 B 站/头条）。
2. 右侧检查器实时预检：**阻断**（账号未连、标题超限、缺封面、未确认 AI 声明、文件超限）必须解决；**警告**（横屏发竖屏平台等）可确认后继续。
3. 三种方式：`保存草稿` / `立即发布`（每次弹确认，列出平台与账号）/ `导出发布包`。
4. 「发布记录」按成片展示逐平台状态，点开有事件时间线，可单平台重试、取消、标记已发布。

状态语义：`排队中 → 上传中 → 待确认/平台审核中 → 已发布`。**「审核中」不是已发布**，拿不到作品地址时显示「待确认」，需要打开平台后台确认后手动标记。

### 自动草稿

账号行可勾选「自动草稿」：导出成功后自动排队上传并停在平台草稿箱或人工确认页，**任何自动流程都不会点最终发布**。预检不通过时不排队，原因写在成片卡片上。

### 发布包（兜底）

没有本机 Chrome、没有连接账号、或用户主动选择时，「导出发布包」生成 `public/publish-packages/<id>/`：成片、已准备封面、可用时的 SRT、以及记录逐平台文案与 AI 标识的 `copy.json`；系统有 `zip` 时另出压缩包。发布包不含任何账号凭据。

### 安全与边界

- 成片/封面/SRT 只接受 `/exports/`、`/videos/`、`/generated/`、`/project-assets/` 下的文件，解析符号链接后仍须在允许根内。
- 错误消息统一脱敏：去掉查询串、token 样式片段、本机绝对路径，并截断 500 字符。
- 不做验证码绕过、指纹伪造、自动点赞/评论/关注；多账号与定时发布不在 V1 范围。
- 浏览器自动化可能违反平台条款，账号受限风险由使用者承担；默认草稿 + 有头浏览器 + 并发 1 是最小风险配置。

### 验证

```bash
node verify-publish-contract.mjs   # 能力表 / 状态机 / 幂等 / 脱敏 / 路径白名单
node verify-publish-api.mjs        # 成片、预检、任务、重启恢复、发布包、适配器 mock
node verify-publish-queue.mjs      # 并发 1、失败不阻塞、自动流程不进入已发布
node verify-publish-ui.mjs         # 需要 dev server 在 5299（临时库），覆盖页签/预检/断点
```

真实平台上传只做人工验证：各自登录一次、保存一次草稿，确认页面结构；验证不了的平台在能力表标 `manualOnly`。

## 导出管线（核心）

一条 `ffmpeg` 命令，不落中间文件：

1. **画面归一化**：每段 `scale=W:H:force_original_aspect_ratio=decrease:in_range=auto:out_range=tv` + `pad` 补黑边（不裁切），统一 `fps=24 / setsar=1 / yuv420p`
2. **接缝折叠**：硬切走 `concat`；效果转场走 `xfade`（`fade` / `wipe*` / `slide*`），`offset` 正好是当前段起点；生成转场是普通片段，两端各接一个 0.2s `xfade`
3. **字幕**：按句 cue 统一生成；有 libass + CJK 字体时生成 SRT 走 `subtitles` 滤镜，否则每条 cue 由前端 canvas 渲透明 PNG，用 `overlay` + `enable=between(t,start,end)` 定时叠加；同时输出 SRT sidecar
4. **混音**：每条配音 `adelay` 对齐折叠后的镜头起点，再 `amix` + `apad/atrim` 到总长；生成转场片段不参与混音

### 踩过的坑（别改回去）

- **色彩范围**：jpeg 静帧是 full range、Seedance 视频是 tv range，不统一会输出 `yuvj420p` 导致部分播放器偏亮。必须 `out_range=tv` + `-color_range tv`
- **ASS 颜色是 `&HAABBGGRR`**：alpha 在前。`OutlineColour=&HC8000000` 是 78% 透明，等于没描边；不透明要写 `&H00000000`
- **配音起点要用探针出的真实时长**：视频实际长度与名义镜头时长常差零点几秒，用名义值会累积错位
- **超长配音必须在镜头末尾收掉**：否则会溢出盖住后续镜头的声音，并与字幕截断点不一致；用 `atrim` + 0.12s `afade`
- React Flow 在冒泡阶段吞掉 Esc / 方向键，预览器的按键监听必须走捕获阶段（capture）

## 目录

```
src/
  App.tsx            主布局 / 状态
  ProjectSelect.tsx  全局带项目选择
  EpisodeBar.tsx     全局带集选择器（弹出列表）
  WorkbenchBar.tsx   视图上下文带：范围 / 设置 / 动作三个槽位
  ShotNode.tsx       分镜卡片（出图、出片、配音角标）
  Preview.tsx        连播预览 + 导出面板
  Inspector.tsx      右侧属性面板
  Timeline.tsx       底部时间轴
  TransitionPanel.tsx 转场面板：效果 / 生成 / 参考 / 关键帧 / 视频
  transition.ts      接缝归一化、默认叠化、时长夹紧、指纹与摘要
  editList.ts        唯一剪辑序列：效果重叠、生成插入、非相邻判定
  CharacterBoard.tsx 角色板
  AssetBoard.tsx     场景/道具素材设定板
  designExtract.ts   素材摘要、拆解合并、空镜/道具提示词
  SceneCodeWorkbench.tsx 代码优先 3D 工作台（参考内容 + 预览 + agent 聊天/代码）
  agent/             LangGraph agent、ZCode JSON action 模型、工具、渲染会话、视觉验收、assistant-ui runtime 适配
  chat-ui/           聊天视觉组件：消息、轮次、工具卡、帧、清单、Composer；Tailwind/shadcn 样式只在 .chat-ui 内生效
  Shot3DContextPicker.tsx 角色/素材/场景/道具/图片/视频/文本选择器
  LegacyScenePreview.tsx 旧结构化 ShotScene/ShotBlocking 只读预览
  shot3dContext.ts   参考内容选择、默认/沿用、台词指纹
  shot3dContextCatalog.ts 项目参考内容目录与选择操作
  sceneCodePrompt.ts 3D 代码 prompt / ABI / 结果解析
  sceneCodeJob.ts    首次代码生成 + 聊天改写编排
  sceneCodePrepare.ts 选择 -> 素材清单 / 关键帧 / 媒体 brief
  sceneCodeSanitize.ts 代码大小/入口/静态越权检查
  sceneCodeFingerprint.ts 代码/素材/渲染指纹
  sceneCodeFreshness.ts 代码视频生效/过期判断
  sceneCodeAssets.ts 素材清单、内容哈希、稳定键（缩放由宿主执行）
  sceneBlender.ts    浏览器侧渲染作业客户端（提交/轮询/取消/错误）
  sceneCodeRender.ts 试运行 / 代理 / 定稿渲染编排
  sceneDraft.ts      草稿客户端：begin/append/read/patch/commit/discard/只读预览
  mediaBrief.ts      带标签参考板 -> vision brief / 缓存
  videoFrames.ts     视频关键帧抽取与缓存
  scheduleAI.ts      legacy 场景与走位 JSON 生成、校验修复
  scheduleGeometry.ts 几何校验、插值、运镜文案、渲染指纹
  scheduleContext.ts legacy 场次/台词/标注/设定上下文拼装
  shotScene.ts       legacy 每镜空间解析 / 旧布局迁移 / 连续性检查
  referenceBoard.ts  legacy 参考板合成
  visualBrief.ts     legacy 视觉 brief
  shot3dJob.ts       legacy 每镜联合生成编排
  shotChat.ts        legacy 受限 patch 聊天
fixtures/agent-duel-scene.py  固定 3D 验收场景（山/男女/双剑/环绕）
  MediaPicker.tsx    素材卡来源缩略图选择器
  mediaPick.ts       媒体归一化、去重、类型/标题推导
  theme.tsx          日间/夜间主题状态、持久化、画布颜色
  ThemeToggle.tsx    全局带主题切换
  subtitles.ts       无 libass 时的字幕位图渲染
  vite.config.ts     同时作为 dev 后端（所有 API + ffmpeg 合成）
server/
  shotReferences.ts  相邻分镜/角色/素材参考统一解析与上限
  media.mjs          项目媒体目录 / URL / 旧图迁移 / 参考图解析
  blender.mjs        Blender 定位 / 作业队列 / 素材落盘 / 取消超时 / ffmpeg 编码
  scene-draft.mjs    场景草稿固定目录 / 分片读写 / 行号 patch / 路径安全 / 清理
verify-*.mjs         Playwright 端到端验证脚本（需先 npm run dev）
verify-agent-*.mjs   Agent 图/聊天 UI/固定 3D 场景验收（mock 与真实模型）
```

> 后端全部写在 `vite.config.ts` 里，没有独立 server。

## 脚本

```bash
node verify-subs.mjs     # 配音 + 字幕 + 导出全链路
node verify-video.mjs    # 图生视频
node verify-voice.mjs    # 配音
node verify-project-scope.mjs  # 项目切换 / 画布隔离 / 剧本守卫 / 拆角色数据源（自起临时库）
node verify-asset-board.mjs    # 素材守则 / 场景道具拆解 / 生图约束 / 发布幂等 / A-B 隔离（自起临时库，mock 模型）
node verify-theme.mjs          # 日间/夜间切换 / 系统偏好 / 持久化 / 对比度 / 画布适配 / 窄屏（自起临时库）
node verify-media-picker.mjs   # 素材来源分类/缩略图/图片视频预览/确认取消/类型修正/键盘/窄屏（自起临时库）
node verify-media-persistence.mjs  # 项目媒体落盘 / 刷新恢复 / 旧图迁移 / 缺失标记与出图保护（自起临时库）
node verify-agent-graph.mjs        # LangGraph agent 图：成功/失败修复/取消/上限/无视觉/工具白名单
node verify-agent-scene-draft.mjs  # 场景草稿：路径安全/大小上限/append/patch/read/commit/trial 边界/历史压缩
APP_URL=http://127.0.0.1:5274 node verify-agent-draft.mjs  # 长代码草稿 UI：分片写入/预览/真实试运行/取消清理
APP_URL=http://127.0.0.1:5280 node verify-agent-chat-ui.mjs  # assistant-ui 工具卡/5 帧/清单/主题/窄屏
APP_URL=http://127.0.0.1:5280 node verify-agent-chat-failure.mjs  # 模型失败保留旧代码 / 取消 / 重试
APP_URL=http://127.0.0.1:5280 node verify-agent-limits.mjs  # Agent 运行上限：默认/夹取/旧设置/保存
node verify-agent-limits-api.mjs  # Agent 运行上限设置的服务端 round-trip（自起临时库）
APP_URL=http://127.0.0.1:5280 node verify-agent-3d-duel.mjs  # 固定山/男女/双剑/环绕场景 + 4 秒 mp4
AGENT_REAL=1 APP_URL=http://127.0.0.1:5280 node verify-agent-3d-duel.mjs  # 真实 sceneCode 模型
node verify-transitions.mjs     # 转场纯函数：默认叠化/夹紧/重叠与插入时间账/失效/持久化映射
node verify-transitions-ui.mjs  # 转场 UI：chip/面板/批量/关键帧与视频（mock）/修复/导出
node verify-performance.mjs     # 表演数据：台词表演对齐/镜头往返/旧项目/手改保护
node verify-performance-skills.mjs # 拆镜契约/旧输出兼容/说话角色缺表演拒绝/技能规则
node verify-performance-ui.mjs   # 镜头表表演编辑/保存/重载/Inspector/口型面板（mock）
node verify-voice-performance.mjs # 逐行表演/指纹/provider 映射接线
node verify-expression.mjs      # 旧角色表情纯函数：身份分离/往返/参考排序/失效/超限
node verify-expression-ui.mjs   # 旧逐情绪表情只读兼容：不再渲染逐情绪生成按钮
node verify-expression-sheet.mjs       # 总图：格序/坐标/指纹/可用性/旧图选择/项目往返
node verify-expression-sheet-refs.mjs  # 分镜参考：总图单格优先/旧图回退/整图排除
node verify-expression-sheet-ui.mjs    # 总图 UI：一次生成/身份图/8 格裁剪/抽屉/stale
node verify-expression-sheet-canvas.mjs # 画布：发布/更新/改名/删除/刷新持久化
node verify-video-expression-budget.mjs # 视频预算：默认关/说话角色单格/4 张分配/UI 开关
node verify-character-card-ui.mjs      # 角色卡：页签/状态主操作/44px 表情格/窄屏
node verify-lipsync.mjs         # 口型：模式/资格/stale/Sync Labs mock/火山映射/本地抽帧
node verify-lipsync-ui.mjs      # 口型面板：三档模式/禁用原因/prompt 提示/不自动调用
node verify-character-voice.mjs # 角色音色样本：往返/指纹/2-30 秒/失效
node verify-voice-catalog.mjs   # 音色目录：能力/自定义/分组/显式不回落
node verify-voice-catalog-ui.mjs # 设置页音色管理：目录/添加/删除/保存
node verify-voice-provisioning.mjs # 渠道创建能力门：支持/不支持
node verify-character-voice-ui.mjs # 角色音色样本 UI：生成/落库/试听/试音稿 stale
node verify-native-audio.mjs    # 原生音频：能力门/单说话人/4 秒/audio_url payload
node verify-native-audio-ui.mjs # 原生音频 UI：开启写回/2 秒禁用
node verify-native-export.mjs   # 预览列表 native/tts/none
node verify-seedance-audio-probe.mjs # 只读探测 APIMart 音频字段（不生成视频）
APP_URL=http://127.0.0.1:5280 node verify-deepseek-flash.mjs  # DeepSeek Flash：文本思考/JSON 关思考/视觉调用/设置页绑定
node verify-agent-video-acceptance.mjs  # 视频验收编排：通过/未通过/无视觉/抽帧失败/取消/超时/保存失败
APP_URL=http://127.0.0.1:5280 node verify-agent-video-acceptance-ui.mjs  # 真实浏览器 MP4→MP4 帧→验收→保存
APP_URL=http://127.0.0.1:5280 VIDEO_TEST_REJECT=1 node verify-agent-video-acceptance-ui.mjs  # 视频验收失败不覆盖
APP_URL=http://127.0.0.1:5280 VIDEO_TEST_NO_VISION=1 node verify-agent-video-acceptance-ui.mjs  # 无视觉人工采用
APP_URL=http://127.0.0.1:5280 SHOT_SECONDS=8 node verify-agent-video-acceptance-ui.mjs  # 长镜头 9 帧覆盖结尾
APP_URL=http://127.0.0.1:5280 REAL=1 node verify-agent-video-acceptance-ui.mjs  # 真实模型/视觉的 4 秒视频验收
node verify-3d-geometry.mjs    # 场景 sanitize / 走位校验 / 路径穿墙 / 插值 / 运镜文案 / 指纹
node verify-3d-ai.mjs          # 场景/走位上下文 / 稳定 id / 修复一次 / 取消 / 兜底（mock ask）
node verify-scene-blocking-api.mjs  # 场景布局与镜头场次/走位持久化 / 隔离 / 非法拒绝
node verify-3d-render.mjs      # 右键快速渲染 / 9:16 时长与尺寸 / scheduleMeta / 场景落库
node verify-scene-blocking.mjs # @deprecated 旧入口 → verify-code-auto-legacy
node verify-3d-freshness.mjs   # @deprecated 旧入口 → verify-code-freshness
node verify-schedule3d.mjs     # 3D 抽帧参考回归（新版场景/走位链路）
node verify-shot-scene-api.mjs # 每镜 shotScene / 迁移 / 种子 / 连续性 / visualBrief 持久化
node verify-shot-vision.mjs    # @deprecated 旧入口 → verify-media-brief
node verify-shot-3d-chat.mjs   # @deprecated 旧入口 → verify-code-workbench
node verify-image-lifecycle.mjs # 单镜取消 / 旧图保留 / 防重入 / 批量取消 / 刷新中断
node verify-code-api.mjs       # sceneCode / 选择 / 元数据持久化 / 项目隔离
node verify-code-sandbox.mjs   # 沙箱立方体/纹理/抓帧/录制/CSP/父页面隔离/超时/素材上限
node verify-code-render.mjs    # 隐藏沙箱录制 → mp4 → ffprobe 时长/尺寸；取消
node verify-3d-context.mjs     # 参考内容目录/默认选择/逐句台词/缺失/图片计数
node verify-media-brief.mjs    # 媒体 brief/vision mock/缓存/无视觉回退/视频关键帧
node verify-code-ai.mjs        # 代码 prompt/成功/失败/取消/无模型/聊天完整代码
node verify-code-workbench.mjs # 三栏布局/预览/参考内容/代码页签/聊天/撤销/窄屏
node verify-code-auto-legacy.mjs # 空镜头自动生成/legacy 只读/显式转换
node verify-code-freshness.mjs # 代码渲染/Inspector 生效过期/参考开关
node verify-neighbor-refs.mjs  # 相邻参考纯函数/token/排序/缺失/上限
node verify-neighbor-ui.mjs    # 右键相邻选择/画面与视频请求/4 张上限/旧尾帧兼容
node verify-tail.mjs           # 尾帧字段与 UI 移除静态回归
node verify-code-settings.mjs  # sceneCode/videoVision 设置项
node verify-code-visual.mjs    # 桌面/窄屏/日间/夜间/错误/聊天/legacy 截图
node verify-code-real.mjs      # 真实代码模型生成 + 渲染 mp4（需真实设置与 Key）
node verify-seedream-timeout.mjs # 服务端候选/下载超时、部分成功、客户端断开（需短超时实例）
```
