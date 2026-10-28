# 部署前须做清单（storyboard-canvas）

> 结论：**当前形态不适合直接发布到云端**。本地可用，但换一台机器有 3 个硬阻塞。
> 本文记录每一项改什么、改哪里、大概多少工作量，便于以后一次性动手。

---

## 一、当前能发布什么、不能发布什么

| 能力 | 本地 | 部署后 |
| --- | --- | --- |
| 界面 / 画布 / 表格 / 剧本编辑 | ✅ | ✅ |
| 项目数据读写（project.json） | ✅ | ⚠️ 需改成服务端持久化，沙箱文件系统重启即丢 |
| 文本生成（剧本/拆镜/提示词） | ✅ | ❌ 需注入 ARK Key |
| 出图（Seedream） | ✅ | ❌ 同上 |
| 出片（Seedance） | ✅（HTTP API） | ⚠️ 需注入 ARK Key，不再依赖 Python CLI |
| APIMart（文本/图像/视频/配音） | ✅ | ⚠️ 需注入 `APIB_API_KEY` / `APIMART_API_KEY`；图像/视频异步任务与目录同步走 HTTP |
| 视频素材参考 | ✅（素材连线 → 方舟 Files API + Seedance 2.0/2.5） | ⚠️ 同上；需模型权限，首期只取第一条连线视频 |
| 配音 | ✅（MiniMax / 火山 / ElevenLabs / APIMart / macOS say） | ⚠️ Linux 无 say；需配置任一云端 TTS Key |
| 口型 | ✅（prompt + 本地抽帧；provider 需 Key） | ⚠️ provider 需要外网与 `SYNC_LABS_API_KEY`；本地抽帧需要 ffmpeg |
| Seedance 原生音频 | ✅（APIMart Seedance 2.5，单 `audio_url`，4 秒+） | ⚠️ 需要 APIMart 视频额度与可访问音频；参考音频受内容审核 |
| 合成 / 字幕 | ✅（ffmpeg + libass + CJK 字体） | ⚠️ 只探测 macOS 路径；无 libass 时自动走客户端 PNG 定时叠加 |
| 发布台（成片版本 / 文案 / 封面 / 预检 / 发布包） | ✅ | ✅（纯 HTTP + 本地文件） |
| 平台自动发布（抖音 / B 站 / 头条草稿） | ✅（本机 Chrome + profile） | ❌ 需要桌面环境与常驻进程，远程部署只能导出发布包 |

---

## 一之二、发布台部署约束

浏览器自动化不是服务端能力，它依赖**本机桌面 + 可见 Chrome + 应用进程常驻**：

- `playwright-core` 目前是 `devDependencies`。如果抽独立生产服务，必须移到 `dependencies`，并在目标机器安装 Chrome；否则 `/api/publish/health` 会返回 `browserAvailable: false`。
- 登录态存在 `.publish-profiles/<账号>/`，权限 0700，已进 `.gitignore`。换机器或清目录等于丢登录态，需要重新扫码。
- 发布包输出到 `public/publish-packages/`，同样不进仓库；备份/迁移时要么一起拷，要么接受重新生成。
- 平台后台改版会让选择器失效。适配器此时返回 `selectors_changed` 并停在当前阶段，不会盲点；该平台应先在能力表标 `manualOnly`。
- 自动草稿只在账号显式开启时触发，且**永远不会点最终发布**；这条是代码里的队列约束，不是界面提示。

部署后自查：

```bash
curl -s http://127.0.0.1:5299/api/publish/health | jq '{browserAvailable,ffmpegAvailable,adapterReady,adapterUnverified}'
```

`browserAvailable: false` 时，发布台会自动把可用路径收敛到「导出发布包」。

---

## 二、三个硬阻塞

### 1. API 路由只在 dev server 里存在（最根本）

所有接口写在 `vite.config.ts` 的 `configureServer` 里 —— 这是 **Vite 插件钩子，只在 `vite dev` 生效**。
`vite build` 出来的静态产物**没有任何 `/api`**，部署上去每个请求都是 404。

**改法**：把中间件抽成独立的 Node HTTP 服务（`server/index.mjs`），开发时由 Vite `proxy` 转发，
生产时直接 `node server/index.mjs` 监听 `$PORT`。
**工作量**：中（约 1 天）。要搬的东西：`/api/health · /api/project · /api/text · /api/generate · /api/voice · /api/seedance · /api/assemble · /api/lipsync · /api/lipsync/qa`。

### 2. ffmpeg 只探测 macOS 路径

```ts
const FFMPEG = '/opt/homebrew/bin/ffmpeg'
const FFMPEG_CANDIDATES = [
  '/opt/homebrew/opt/ffmpeg-full/bin/ffmpeg',
  '/opt/homebrew/bin/ffmpeg',
  '/usr/local/bin/ffmpeg',
]
```
Linux 上三条都不存在。

**改法**：装 `ffmpeg-static` + `ffprobe-static` npm 包，探测顺序改为「环境变量 → npm 包 → 系统路径」。
注意 `ffmpeg-static` 默认**不带 libass**，SRT 烧录不可用；纯合片不受影响。没有 libass 时会自动走客户端逐 cue PNG 定时叠加，成片仍带字幕，只是渲染路径不同（见 2.2）。

### 2.1 效果转场依赖 `xfade`

叠化/擦除/推移用 ffmpeg 的 `xfade` 滤镜（需要 4.3+；本机 9.0.x 已带）。部署前确认：

```bash
ffmpeg -filters | grep xfade
```

`ffmpeg-static` 一般包含；如果打包的 ffmpeg 缺 `xfade`，导出会在效果转场处失败。
`/api/assemble` 新增的 `joins` 是可选字段：没有它时仍是纯 `concat` 硬切，旧客户端可继续工作。建议服务端与前端同批发布，至少先发服务端。

### 2.2 字幕：libass、CJK 字体与 PNG 兜底

`/api/health` 的 `ffmpegAss` 现在要求 **subtitles 滤镜和可用 CJK 字体同时存在**；任一缺失就返回 false，前端自动走 PNG 兜底。

- 有 libass + 字体：应用把 cue 写成 SRT，走 `subtitles` 烧录，并返回与烧录一致的 `srtUrl` sidecar。
- 没有 libass 或没有 CJK 字体：前端为每条 cue 渲一张透明 PNG，服务端用 `overlay + enable=between(t,start,end)` 定时叠加；同样返回 SRT sidecar。
- Linux 部署建议安装带 libass 的 ffmpeg 和 `fonts-noto-cjk`，并确认 `fc-list :lang=zh` 能列出字体；macOS 使用 PingFang/Heiti。
- 不要只检查 `ffmpeg -filters | grep subtitles`：没有 CJK 字体时 libass 会输出方框，所以 health 会关闭 SRT 路径。
- SRT 样式和 PNG/预览共用字号、底部安全区、最大宽度、底色/文字色；ASS 的底色是方角、PNG/预览是圆角，这是已知的平台差异。
- 验收：`node verify-preview-captions.mjs`（连播/音频/字幕/导出 payload）和 `node verify-subs.mjs`（cue/SRT/真实导出/sidecar/强制 PNG）。

### 3. 配音只有 macOS `say`，没有云端引擎

`ttsProvider` 现在是 `macos-say`，因为 `.env` 里没有 `ELEVENLABS_API_KEY`。

**改法**：配置 ElevenLabs（或多角色中文 TTS）作为云端引擎，`say` 仅作 macOS 本地兜底。
若无 key，部署后「配音」按钮应**明确禁用并提示原因**，而不是点了报错。
**工作量**：小（半天），前提是有可用的 TTS 账号。

---

## 三、此外还需要处理

### API Key 不能硬编码进部署环境

现在 Key 从 `~/.canghe-skills/.env` 读。云端必须走平台环境变量（`ARK_API_KEY`）。
**安全提醒**：一旦部署成公开链接，任何拿到链接的人都能消耗你的方舟额度。
发布前至少要加一道口令或访问限制，或者只发给自己人。

在线素材库的来源 Key 用 `PEXELS_API_KEY` / `PIXABAY_API_KEY` / `OPENVERSE_API_KEY`（都可选，Openverse 匿名也能用但额度很低）。来源检索与导入只在服务端发起，容器需要能访问对应图库域名；导入文件落在 `projects/<项目>/assets/`，与项目数据同生命周期。设置页填写的 Key 同样只存本地 SQLite，生产环境建议改用环境变量。

APIMart 渠道使用独立的 `APIB_API_KEY` / `APIMART_API_KEY`，不会回退方舟 Key。设置库里的 Key 存在 SQLite `settings` 表，部署时应改用环境变量，避免把 Key 写进镜像或仓库。余额不足时网关对所有请求（包括 `/v1/models`）返回 402；部署后的渠道测试与状态条会把 402 显示为「余额不足」。APIMart 的图像/视频任务需要服务端能访问外网并下载结果到本地；参考视频只接受公网 URL（没有文档化的视频上传接口）。详见 `docs/apimart.md`。

口型 provider 默认关闭；启用后需要 `SYNC_LABS_API_KEY` 或设置页 Key，以及服务端能访问 `api.sync.so` 并上传本地视频/音频。每次 provider 生成仍需人工确认；多说话人镜头不支持。口型验收只使用本地 ffmpeg 抽帧，不依赖云端。

Seedance 2.5 原生音频使用单个 `audio_url` 字符串（公网 URL 或 data URL），视频最短 4 秒，首期只支持单说话人；参考音频只影响音色，模型会重新发声。真实 Seedance 2.0+ 调用仍需人工确认。

出片提示词预览/手改不需要新增服务端配置：面板与实际请求共用前端拼装器，手改写 `video_prompt_override`，成功后写 `video_meta`；旧项目没有这两个字段时走自动拼装。验收脚本 `verify-video-prompt-preview.mjs` 会拦截 `/api/seedance` 比对面板正文与请求 `prompt`。

### 项目数据要落到持久存储

项目库已切到 SQLite：`<SB_PROJECTS_DIR>/storyboard.sqlite`（容器内 `/data/projects`，compose 已把 `./data/projects` 挂成卷）。沙箱重启后非卷目录仍会重置，所以 `SB_PROJECTS_DIR` 必须指向持久卷。

删除项目时会先在同一目录写数据库快照到 `SB_PROJECTS_DIR/.deleted/`。该目录与 `storyboard.sqlite` 同生命周期：备份或迁移数据卷时要一起处理，否则删掉的项目没法手工恢复。快照只含数据库行，不含 `projects/<项目>/assets/` 里的媒体文件。

### 视频/图片产物不进仓库

`public/videos`、`public/generated` 在 `.gitignore` 里。项目文件里记的是**相对路径**，
换机器要连目录一起拷，否则断链。

---

## 四、建议动手顺序

1. **抽独立 server**（阻塞项，其他都依赖它）
2. **ffmpeg-static + Key 走环境变量**
3. **TTS 换云端引擎**

前两步完成后，就能部署出一个「能看、能改、能出图」的版本；出片已经走纯 HTTP API，配音可以后续补。

---

## 五、如果只想要一个可分享的演示链接

不改后端也能做：`vite build` 出静态产物，配一份**内置样例数据的只读 mock API**
（`/api/project` 返回打包进去的 recycle 项目快照），把「生成」类按钮禁用并标注「演示版」。

优点：几分钟出链接，不涉及你的 API Key。
代价：只能看和演示，不能真跑流水线。

---

## 六、部署后的自检清单

发布完按顺序过一遍，任何一条失败说明对应改造没生效：

```
GET  /api/health          → hasKey / ffmpegReady / videoReady / ttsProvider 四项
GET  /api/project         → 能列出项目
GET  /api/project?name=X  → 能读到 episodes / characters / shots
POST /api/text            → 返回 ok 与 model
POST /api/voice           → 返回 url（若禁用应返回明确原因）
POST /api/generate        → 返回图片 url
POST /api/seedance        → 返回任务 id（服务端提交方舟任务并轮询）
GET  /api/seedance?id=...  → 能轮询到 succeeded，并返回本地视频路径
POST /api/assemble        → 轮询能到 succeeded
POST /api/assemble + joins → 带效果转场的成片时长 = A + B − T；joins 缺失时仍按硬切合成
```
