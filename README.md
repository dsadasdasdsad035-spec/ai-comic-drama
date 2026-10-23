# ai-comic-drama · 分镜画布（storyboard-canvas）

AI 漫剧的可视化分镜工作台：分镜卡片自由排布 → 生成静帧 → 图生视频 → 台词配音 → 连播预览 → 一键导出带字幕成片。

## 运行

```bash
npm install
npm run dev      # http://127.0.0.1:5273
```

需要本机有 **ffmpeg（带 libass）**；API key 从以下位置读取：

- `~/.canghe-skills/.env` → `ARK_API_KEY`（Seedream 出图 / Seedance 出片）
- 任意上述 `.env` 或环境变量 → `ELEVENLABS_API_KEY`（可选，缺失则退回 macOS `say`）

## 项目上下文

顶栏的项目选择器是全站唯一数据边界：剧本、角色、镜头表、提示词和画布都只读写当前项目。

- **剧本**：生成和保存都必须绑定项目；有未保存分集时切换项目或离开剧本页会先确认，保存后才写回项目。
- **画布**：按项目存 `storyboard-canvas-v1:<project>`；切换项目时从该项目的 `project.shots` 水合，不再读写全局画布。旧全局画布会先备份到 `storyboard-canvas-v1:legacy-backup`，只迁移能归属当前项目的节点。
- **拆角色**：全剧读项目 `source + episodes`；本集读当前集的 `project.shots`（cast / 台词 / 画面），不依赖浏览器里残留的画布节点。
- **素材**：场景/道具设定存项目的 `designs`，和画布素材库分开；设定图可以单卡或批量发布成 `scene` / `prop` 素材卡。素材守则在设置页默认启用，按地点/道具去重，场景图固定空镜、道具图固定多角度隔离表。

## 项目媒体

角色三视图和场景/道具设定图是长效参考图，存放在 `projects/<项目名>/assets/`，项目数据里引用 `/project-assets/<项目名>/<文件>`。它们和 `projects/` 下的 SQLite 同生命周期：把整个 `projects/` 目录搬到新工作区，角色和设定图仍然可用；清空 `public/generated/` 也不会影响它们。

- `public/generated/` 只放镜头首帧、调度帧、视频等可重生成产物。
- 打开项目时会把仍存在的旧 `/generated/...` 引用复制进项目目录并改写；找不到文件的引用会保留并标记「图片文件缺失」。
- 恢复缺失图：把同名文件放进 `projects/<项目名>/assets/` 后重新打开项目（迁移按文件名命中），或在角色板重新生成。
- `projects/*/assets/` 与 `projects/*.sqlite` 一样不提交 git，需要随项目目录一起备份。

## 主题

顶栏右侧提供「日间 / 夜间」切换。夜间保留 Cinema Dark；日间是暖纸底的 Paper Studio，分镜图片和视频保持原色，只切换工作台界面。首次打开跟随系统 `prefers-color-scheme`，手动选择记在浏览器 `storyboard-theme`，刷新保持；主题偏好不会写入项目文件。

## 素材卡来源

素材卡 Inspector 的「选择素材」打开缩略图选择器：项目素材 / 生成图片 / 视频 / 手填地址分类，支持搜索、图片大图预览和视频 hover 播放。点选只预览，点「使用这张」或双击才写回；选视频会自动把素材类型切为视频，场景/道具卡换普通图会保留原类型。

## 画布参考与视频模式

右击分镜可以手动选择参考：角色、素材，以及同集的上一镜/下一镜当前生成画面。相邻参考不会自动加入，下一镜未出图时置灰；它们只取当前 `refImage`/候选图，不使用尾帧。相邻镜头已有叙事边，不再额外画一条参考线。

- 画面生成最多 10 张参考图；超出时提示省略项。
- 视频出片最多 4 张 `reference_image`，优先级为当前画面 → 角色 → 相邻分镜 → 场景/道具 → 3D 调度关键帧；超出时提示省略项。
- 视频有参考图时使用 `reference_image` 模式，有 3D 调度视频时使用 `reference_video` + 可选参考图；参考图/参考视频协议不变。
- 视频尾帧约束和尾帧接龙已移除：不再提交 `last_frame` / `return_last_frame`，不再保存或展示尾帧。旧项目的 `tail_image` 保留在数据库里但不再读取/展示。
- 画面参考和视频参考共用 `refIds` 中的 `shot-prev` / `shot-next` 关系 token，镜头重排后会指向当前相邻镜头。

## 3D 调度（代码优先）

每个镜头以一段 Three.js 代码为场景真相（`sceneCode`）。右侧 Inspector 的「编辑 3D 调度」或右键菜单打开代码工作台；旧 `shotScene`/`shotBlocking` 只保留只读 legacy 预览。

### 工作台

- 顶栏：镜号、有效时长、画幅、代码来源/hash、保存、渲染、关闭。
- 左侧参考内容：角色、素材、场景、道具、图片、视频、文本七类；支持搜索、缩略图/视频预览、多选、已选 chips、沿用上一镜选择和清空。
- 中间：沙箱预览、播放/暂停/拖动时间轴、渲染进度、运行错误。
- 右侧：聊天 / 代码双页签；上方「代码模型」可直接切换本机手选模型，同时作用于首次生成和 agent 聊天。聊天现在由浏览器内 LangGraph agent 驱动；代码页签可手改、运行、保存，支持撤销/重做。
- 空镜头首次打开会自动生成代码；已有代码直接预览，不重复生成。只有 legacy 数据的镜头显示只读横幅和「生成代码版本」，不会自动覆盖。

### 代码 ABI

沙箱内代码必须定义三个顶层函数：

```js
function init(ctx) {
  // ctx.THREE / ctx.scene / ctx.camera / ctx.renderer
  // ctx.assets: Map<稳定键, { texture, width, height, videoDuration?, frameTime? }>
  // ctx.width / ctx.height / ctx.aspect / ctx.duration / ctx.shot
}
function renderAt(t, mode) {
  // t 是 0..duration 秒；mode 是 clean/review
  // 每帧返回后运行时渲染 scene + camera；动画必须由 t 决定
}
function dispose() {}
```

选中素材通过稳定键注入，例如 `character:<id>`、`design:<id>`、`image:<hash>`、`video:<hash>:frame:0`。视频只以关键帧进入代码运行时和聊天，不依赖视频逐帧 seek。

`THREE` 是沙箱全局：既可以直接使用，也可以在 `init` 里写 `const THREE = ctx.THREE`；顶层声明同名变量不会和编译器参数冲突。

### Agent 聊天（LangGraph + assistant-ui）

聊天不是一次性改写，而是浏览器内的 agent 循环：

- `@langchain/langgraph` 的 `StateGraph` 管状态和工具循环；`ZCodeChatModel` 把现有 `/api/text` 包装成 JSON action 模型（`{content, tool_calls}`），不要求 provider 原生 tool calling。
- 工具白名单只有 `get_shot_context`、`set_scene_code`、`run_sandbox`、`capture_frames`、`review_frames`、`finish`。没有 shell、网络、保存、渲染或写其他镜头的工具。
- `set_scene_code` 只接受当前镜头完整代码；代码必须通过 `run_sandbox` 才进入工作台草稿。`capture_frames` 抓 5 个关键帧；`review_frames` 用视觉清单初筛；`finish` 必须已有沙箱通过，且视觉验收通过或明确转人工。
- 运行只开放可配置的总运行时长：默认 300 秒（范围 60–1800），不再有用户可配置的步骤上限。代码修复 3 次、视觉验收 2 次、单工具 30 秒、5 帧预算仍固定；LangGraph 内部有不可配置的递归安全阀。总时长超时会显示“运行超时”，用户取消仍显示“已取消”；两者都会释放沙箱，旧代码保持不变。
- 工作台当前镜头的有效代码会作为每轮 agent 的初始运行基线；已有代码时可以直接 `run_sandbox`，空镜头或无效草稿仍必须先 `set_scene_code`。
- agent 执行由 `graph.streamEvents`（v2）驱动：浏览器内的模型轮次取自 `agent` 节点的链事件，工具生命周期取自 `on_tool_*`，代码/帧/验收/完成继续走工具领域事件；事件按 run id 和轮次去重。
- 聊天展示每轮模型状态和面向用户的简短说明、工具开始/结束、代码摘要、帧、清单和摘要，不展示隐藏 chain-of-thought 或 reasoning token；模型 content 为空时仍显示“模型调用完成”。当前只消费每轮结束事件，不做 token 级打字流。
- 聊天和代码两个页签在打开的工作台内保持挂载，切换到代码页签不会清空消息/帧/清单/滚动位置，也不会取消运行中的 agent；关闭工作台仍会结束会话并释放沙箱。聊天记录不跨关闭、刷新或项目切换持久化。
- 不把帧的 base64 回灌给模型，模型只看到抓帧时间；工具参数中的完整代码和 data URL 会裁剪成摘要。
- 聊天消息里的 fenced code block 默认折叠，只显示语言/行数和“展开代码”；完整代码仍在代码页签查看。

- 当前镜上下文包含画面/运动提示词、出场角色、选中台词、景别/运镜、标记、场次、已选素材稳定键和媒体 brief；不会把其他镜头或项目素材写回当前镜。
- 前端用 `@assistant-ui/react` 的 `ExternalStoreRuntime`、`Thread`、`Composer` 和 `makeAssistantToolUI`；视觉层在 `src/chat-ui/`，用 Tailwind v4 + shadcn primitives，样式通过 `.chat-ui` scoped token 映射现有日夜主题，不启用全局 preflight。面板懒加载，900px 以下默认收起参考栏，参考内容仍可从顶部按钮打开。
- 「3D 代码」环节模型决定 agent 使用哪个文本模型；视觉模型缺失时 `review_frames` 返回「需人工验收」，不会伪造通过。真实模型必须遵守 JSON action 协议和沙箱 ABI；代码保持多行、使用 `ctx.scene`/`ctx.camera`。

### 沙箱与上限

- iframe 使用 `sandbox="allow-scripts"`，无同源权限；CSP 禁止网络、外部脚本和父页面访问。
- 父页面只接受带运行 token 和已知类型的消息；代码错误/超时不会写入项目。
- 代码 ≤ 200KB；图片 ≤ 16 张、视频 ≤ 4 个（每个 3 关键帧）；单图长边缩到 2048；单次素材 ≤ 48MB。
- 初始化 5s、单帧 250ms、试运行 15s 超时；超时销毁 iframe 并保留上一版代码/视频。
- 导出固定使用 `clean` 模式，按镜头有效时长 `clamp(round(seconds),2,12)` 和项目画幅渲染，继续走 `/api/save-video` 的 webm→mp4。

### 参考内容与媒体 brief

选中的图片和视频关键帧会合成带标签参考板，调用 `vision` 生成 `MediaBrief` 并缓存；没有视觉模型时只发送素材清单和标签，界面明确“素材未参与理解”。首次代码生成可选 `videoVision` 原生视频理解；渠道不支持本地视频时回退关键帧，聊天永远不直接调用视频理解。图片像素不写入项目或文本提示词。

### 过期与下游

代码哈希、ABI、参与渲染的素材指纹、选择指纹、有效时长和画幅组成 `sceneCodeMeta.fingerprint`。代码/选择/时长/画幅变化后旧 `scheduleVideo` 标为过期；过期或非 clean 视频不能作为 Seedance 参考视频/抽帧参考。`motionNote` 由代码生成或用户编辑，界面标明它不是几何自动推导。

### 模型设置

设置页「模型表」增加 `视觉 · 视频理解`；「生成环节默认模型」增加 `3D 代码（生成/聊天）` 和 `视频理解（首次 3D）`。`3D 代码` 走文本族，未绑定则沿用文本默认；`视频理解` 只列声明 `videoVision` 的模型。没有代码模型时 AI 生成禁用，手写代码仍可运行。建议把 `3D 代码` 绑定到编码能力更强的模型（本机验收使用 `ark-plan-text-deepseek`）；首次试运行报错时会带错误自动修复一次，仍失败则保留旧代码。

预置 `ark-plan-text-deepseek-flash`（DeepSeek Flash · `deepseek-v4-flash`）复用现有 Agent Plan Key。它是混合推理模型：普通文本默认开启思考；JSON / 工具协议（包括 3D agent 的 JSON action 和代码生成）自动关闭思考，避免 reasoning 吃掉结构化输出预算。模型条目上的 `thinking` 可显式覆盖为 `enabled` / `disabled`；默认 `auto` 不改变任何现有默认模型。另有 `ark-plan-vision-deepseek-flash` 用于参考板/关键帧视觉理解；agent 聊天里的 `review_frames` 会通过 `/api/vision` 调用它，JSON 验收同样自动关闭思考。`presetsVersion` 升到 5，旧设置只补一次新模型，已删除的预设不会复活。

### 明确不做

纯代码模式不提供角色名单、穿墙/碰撞、空间连续性或自动运镜文案校验；旧结构化编辑器不再提供拖拽/数值精修。需要精确空间关系时请检查代码、预览和运行错误。

## 3D Agent 验收（山 / 男女 / 双剑 / 环绕）

固定场景在 `fixtures/agent-duel-scene.js`：山体、一名男人和一名女人、两把交叉剑、对打动画，4 秒 16:9，相机环绕并始终 `lookAt` 两人中点。验收既看聊天工具轨迹，也看真实沙箱帧和 mp4，不只看最终回复。

```bash
# 纯图级回归：mock 模型/沙箱/视觉，不调用真实模型
node verify-agent-graph.mjs

# assistant-ui 聊天 UI：懒加载、工具卡、5 帧、清单、主题、900/760px
APP_URL=http://127.0.0.1:5280 node verify-agent-chat-ui.mjs
APP_URL=http://127.0.0.1:5280 node verify-agent-chat-failure.mjs

# 固定场景 mock 验收：脚本化模型 + 真实沙箱 + 真实 4 秒 mp4
APP_URL=http://127.0.0.1:5280 node verify-agent-3d-duel.mjs

# 同一 prompt 走当前设置的 sceneCode 模型；无视觉模型时清单转人工
AGENT_REAL=1 APP_URL=http://127.0.0.1:5280 node verify-agent-3d-duel.mjs
```

`verify-agent-3d-duel.mjs` 默认使用 mock，真实模型模式会把 codeHash、5 帧、mp4 和清单写入 `openspec/changes/agentic-3d-scene-chat/evidence/`；真实模型失败会写入明确原因并以非零退出，不伪装通过。本机一次真实运行使用默认 `minimax-text`（MiniMax M3），产出 49 行代码、5 帧、4.0 秒 16:9 视频；本机未配置视觉模型，清单状态是 `needsHumanReview`，最终画面由关键帧和 mp4 人工复核。

前置：`code-first-3d-chat` 与本变更修改同一聊天入口，归档前先完成/归档它；`agentic-3d-scene-chat` 自身要等 mock 与真实模式都通过后再归档。

## 能力

| 区块 | 说明 |
| --- | --- |
| 分镜画布 | React Flow 卡片拓扑 + Konva 图层，可调坐标/景别/运镜/台词 |
| 角色板 | 生成角色三视图，注入 `lookEn` 到分镜提示词保持一致性 |
| 素材设定板 | 从本集/全剧拆场景与关键道具，生成空镜/道具参考图，单卡或批量加入画布 |
| 主题 | 日间/夜间两套语义主题，跟随系统或手动记忆；覆盖画布、Inspector、时间线和原生控件 |
| 环节模型 | 剧本 / 角色 / 素材 / 镜头表 / 提示词 / 视觉在设置页绑定默认模型，工作台可临时手选（本机记忆） |
| AI 出图 | Seedream 4.5 多候选并发；单镜/批量/任务台账可取消，候选独立超时，刷新中断可重试 |
| 图生视频 | Seedance 任务式生成 + 轮询，支持首帧 / 1~4 张参考图 / 参考视频；相邻分镜可手动加入，尾帧已移除 |
| 3D 调度 | 每镜 Three.js 代码 + 可选中参考内容 + 媒体 brief + LangGraph agent 聊天 + 沙箱预览/录制；legacy 结构化只读 |
| 3D 调度参考 | 代码干净渲染视频经方舟 Files API 上传后作为 `reference_video`（Seedance 2.0/2.5，默认关闭）；过期/非 clean 视频会被拦截 |
| 台词配音 | ElevenLabs（有 key）或 macOS `say`（无 key），按角色选音色与语速 |
| 连播预览 | 按镜头时长推进，支持视频真实时长校正、字幕开关、上一镜/下一镜 |
| 导出成片 | 单条 ffmpeg 命令完成拼条 + 字幕 + 混音 |

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

## 导出管线（核心）

一条 `ffmpeg` 命令，不落中间文件：

1. **画面归一化**：每段 `scale=W:H:force_original_aspect_ratio=decrease:in_range=auto:out_range=tv` + `pad` 补黑边（不裁切），统一 `fps=24 / setsar=1 / yuv420p` 后 `concat`
2. **字幕**：有 libass 时生成 SRT 走 `subtitles` 滤镜；没有则退回前端 canvas 渲整帧透明 PNG + `overlay`
3. **混音**：每条配音 `adelay` 对齐镜头起点，再 `amix` + `apad/atrim` 到总长

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
  ProjectSelect.tsx  顶栏全局项目选择
  ShotNode.tsx       分镜卡片（出图、出片、配音角标）
  Preview.tsx        连播预览 + 导出面板
  Inspector.tsx      右侧属性面板
  Timeline.tsx       底部时间轴
  CharacterBoard.tsx 角色板
  AssetBoard.tsx     场景/道具素材设定板
  designExtract.ts   素材摘要、拆解合并、空镜/道具提示词
  SceneCodeWorkbench.tsx 代码优先 3D 工作台（参考内容 + 预览 + agent 聊天/代码）
  agent/             LangGraph agent、ZCode JSON action 模型、工具、沙箱会话、视觉验收、assistant-ui runtime 适配
  chat-ui/           聊天视觉组件：消息、轮次、工具卡、帧、清单、Composer；Tailwind/shadcn 样式只在 .chat-ui 内生效
  Shot3DContextPicker.tsx 角色/素材/场景/道具/图片/视频/文本选择器
  LegacyScenePreview.tsx 旧结构化 ShotScene/ShotBlocking 只读预览
  shot3dContext.ts   参考内容选择、默认/沿用、台词指纹
  shot3dContextCatalog.ts 项目参考内容目录与选择操作
  sceneCodePrompt.ts 3D 代码 prompt / ABI / 结果解析
  sceneCodeJob.ts    首次代码生成 + 聊天改写编排
  sceneCodePrepare.ts 选择 -> 素材字节 / 关键帧 / 媒体 brief
  sceneCodeSanitize.ts 代码大小/入口/静态越权检查
  sceneCodeFingerprint.ts 代码/素材/渲染指纹
  sceneCodeFreshness.ts 代码视频生效/过期判断
  sceneCodeAssets.ts 素材读取、缩放、内容哈希、稳定键
  sceneSandbox.ts    父页面沙箱客户端（iframe/CSP/token/超时/录制）
  sceneCodeRender.ts 隐藏沙箱录制 + 保存视频
  mediaBrief.ts      带标签参考板 -> vision brief / 缓存
  videoFrames.ts     视频关键帧抽取与缓存
  sandbox/runtime.ts 沙箱内 Three.js 运行时（构建为 runtime.generated.js）
  schedule3d.ts      legacy 白模 / 干净 POV / 审阅视角 / 录制
  scheduleAI.ts      legacy 场景与走位 JSON 生成、校验修复
  scheduleGeometry.ts 几何校验、插值、运镜文案、渲染指纹
  scheduleContext.ts legacy 场次/台词/标注/设定上下文拼装
  shotScene.ts       legacy 每镜空间解析 / 旧布局迁移 / 连续性检查
  referenceBoard.ts  legacy 参考板合成
  visualBrief.ts     legacy 视觉 brief
  shot3dJob.ts       legacy 每镜联合生成编排
  shotChat.ts        legacy 受限 patch 聊天
fixtures/agent-duel-scene.js  固定 3D 验收场景（山/男女/双剑/环绕）
  MediaPicker.tsx    素材卡来源缩略图选择器
  mediaPick.ts       媒体归一化、去重、类型/标题推导
  theme.tsx          日间/夜间主题状态、持久化、画布颜色
  ThemeToggle.tsx    顶栏主题切换
  subtitles.ts       无 libass 时的字幕位图渲染
  vite.config.ts     同时作为 dev 后端（所有 API + ffmpeg 合成）
server/
  shotReferences.ts  相邻分镜/角色/素材参考统一解析与上限
  media.mjs          项目媒体目录 / URL / 旧图迁移 / 参考图解析
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
APP_URL=http://127.0.0.1:5280 node verify-agent-chat-ui.mjs  # assistant-ui 工具卡/5 帧/清单/主题/窄屏
APP_URL=http://127.0.0.1:5280 node verify-agent-chat-failure.mjs  # 模型失败保留旧代码 / 取消 / 重试
APP_URL=http://127.0.0.1:5280 node verify-agent-limits.mjs  # Agent 运行上限：默认/夹取/旧设置/保存
node verify-agent-limits-api.mjs  # Agent 运行上限设置的服务端 round-trip（自起临时库）
APP_URL=http://127.0.0.1:5280 node verify-agent-3d-duel.mjs  # 固定山/男女/双剑/环绕场景 + 4 秒 mp4
AGENT_REAL=1 APP_URL=http://127.0.0.1:5280 node verify-agent-3d-duel.mjs  # 真实 sceneCode 模型
APP_URL=http://127.0.0.1:5280 node verify-deepseek-flash.mjs  # DeepSeek Flash：文本思考/JSON 关思考/视觉调用/设置页绑定
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
