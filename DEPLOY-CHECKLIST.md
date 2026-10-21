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
| 配音 | ✅（macOS say） | ❌ Linux 无 say，且未配 ElevenLabs |
| 合成 / 字幕 | ✅（Homebrew ffmpeg-full） | ❌ 只探测 macOS 路径 |

---

## 二、三个硬阻塞

### 1. API 路由只在 dev server 里存在（最根本）

所有接口写在 `vite.config.ts` 的 `configureServer` 里 —— 这是 **Vite 插件钩子，只在 `vite dev` 生效**。
`vite build` 出来的静态产物**没有任何 `/api`**，部署上去每个请求都是 404。

**改法**：把中间件抽成独立的 Node HTTP 服务（`server/index.mjs`），开发时由 Vite `proxy` 转发，
生产时直接 `node server/index.mjs` 监听 `$PORT`。
**工作量**：中（约 1 天）。要搬的东西：`/api/health · /api/project · /api/text · /api/generate · /api/voice · /api/seedance · /api/assemble`。

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
注意 `ffmpeg-static` 默认**不带 libass**，字幕烧录会失效；纯合片不受影响。
**工作量**：小（半天），但字幕功能需要另外的方案（见下文「软字幕」）。

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

### 项目数据要落到持久存储

`project.json` 现在写在 `manga-pipeline/projects/`（本地磁盘）。沙箱重启后文件系统可能重置。
**改法**：换成 SQLite（沙箱支持）或对象存储；或者明确接受「演示用、重启丢数据」并写清楚。

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
```
