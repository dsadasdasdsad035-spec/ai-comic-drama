# 创意工作室

创意会话是唯一**不绑定项目**的工作台：聊天即主界面，用来把外部参考视频拆成可复用的分镜与提示词，或先把一句想法发展成可拍方向。只有用户显式点「晋升项目」时，创意产出的内容才会写入项目数据。

## 入口与边界

- 顶栏第八个视图「创意」。进入后项目选择器与集选择器都会隐藏。
- 会话独立存储：`creatives/<sessionId>/{sources,frames,artifacts}`（不进仓库），记录在同一 `storyboard.sqlite` 的 `creative_*` 表。
- 切换全局项目不会重载或清空创意会话；重新打开同一会话会恢复消息、模式与产物。
- 删除会话会连带清理它独占的源视频与证据帧，其他会话不受影响。

## 三种模式

| 模式 | 宿主技能 | 能做什么 |
| --- | --- | --- |
| 策划 | `creative-plan` | 把想法拆成方向、节奏与镜头草案；不写项目 |
| 反推 | `video-reverse` | 摄取 → 切分 → 抽帧 → 逐镜反推 → 提示词包 |
| 复刻 | `video-reverse` | 在提示词包基础上生成图/视频/配音（每次付费先确认） |

模式切换保留消息与产物，只切换绑定的工具集。

## 摄取

支持三种输入，统一入口：

1. **本地上传**：界面按钮或直接拖入；单文件上限 200MB。
2. **公网直链**：服务端流式下载；只允许 http(s)，拒绝 localhost 与私网地址。
3. **平台链接**（抖音 / B 站 / TikTok）：需要先启用解析适配器。

适配器默认只开前两种。可选适配器：

- **yt-dlp**：设置页「创意 → 下载与摄取」填可执行文件路径并启用（`brew install yt-dlp`，路径通常是 `/opt/homebrew/bin/yt-dlp`）。未安装时该适配器显示不可用并给出原因；启用时若路径为空会被拦下，不允许保存出「开着但不可用」的状态。
  - **抖音 / TikTok 需要 cookies**：把「读取浏览器 cookies」设为 Chrome（或 Safari/Edge/Firefox），并确保该浏览器里登录过平台。yt-dlp 只在本机读取 cookie 库，不上传不落盘。抖音的 web detail 接口目前对未带新鲜 cookies 的请求返回 403，带 cookies 也可能被风控拦截——这种情况下用「上传视频」更稳。
  - **B 站**已验证可用（含封面探测）。
- **DTK（Douyin_TikTok_Download_API）**：自建服务，抖音/TikTok 的实际可行路径。
  - 部署：直接跑 `./scripts/dtk-up.sh`（拉源码、生成密钥、起容器、初始化管理员、铸造 API Key 全自动）。手工等价命令见 [`docs/deploy.md`](deploy.md)。**抖音必须加 `--profile browser`**，否则身份池为空，解析会返回 `IDENTITY_POOL_EXHAUSTED`。
  - 首次启动后从 `docker logs dtk-api-1` 取 setup token，在 `/setup?token=...` 建管理员，再到控制台创建 API Key（需要 `douyin:read` 等 scope）。
  - 本仓库只调两个稳定端点：`POST /api/v1/parse?wait=30` 与 `GET /api/v1/tasks/{id}`，从 `data.media.video.url` 取 CDN 直链，再由本机下载。**不走 `downloads` 端点**——那个只把文件存在 DTK 自己磁盘上，不从 API 回传。
  - 实测：抖音链接下载 147MB / 36 分钟 / 1440×1080 / 有音轨，作者与标题均正确。

已启用的适配器失败时**不会**静默回退到直链：避免你以为用的是 A，实际跑的是 B。

## 反推链路

```
摄取 → probe(时长/分辨率/帧率/音轨) → 场景切分 → 逐镜抽证据帧 → 视觉理解 → submit_reverse_pack
```

- 切分结果覆盖整段时长，相邻段首尾相接；短于 0.8 秒的段并入相邻段而不是丢弃。
- 重新切分不会删除旧证据帧与分析结果，只把它们标为「已过期」。
- 本地视频**不走** `/api/video-vision`（该接口只收公网 URL），而是抽帧后走 `/api/vision`。
- 视觉分析前会弹成本确认；同一轮内同一帧只付一次。

## 提示词包（reverse-v1）

每镜包含：时间范围、景别、机位、主体、动作、环境、光影、色彩、音频、`keyframe_prompt`、`video_prompt`、证据帧、置信度。

- `keyframe_prompt` 用于文生图，描述静态画面。
- `video_prompt` 只描述运动与运镜，不重复静态外观。
- 契约在工具入参 schema 上就会拦下非法值（例如 `end <= start`），服务端保存前还会再校验一次。

导出提供 JSON（通过 `reverse-v1` 校验）与按镜分组的可读文本。

## 晋升项目

- 新建项目：填项目名（字母/数字/`-`/`_`），写入分集、镜头与两段提示词。
- 写入现有项目：按稳定 `shotId`（`<sessionId>-001`）合并，**保留已有镜头的手改字段与参考**；重复晋升不会产生重复镜头。
- 来源链接与证据帧作为镜头扩展字段一起带出。
- 晋升失败不会留下半成品项目。

## 成本与能力

- **能力托盘**（头部右侧）：文本、视觉、视频理解、图像、三视图、视频、视频参考、配音分别绑定模型。留空则跟随全局默认；这里的选择只影响创意会话，不改全站默认路由。
- 每次付费调用前弹出确认卡（模型、调用次数、说明）。勾选「本会话内不再询问」只对同类能力生效。
- **Seedance 2.0 及以上**的真实视频生成每次都必须确认，不读「不再询问」。
- 单轮付费调用上限（默认 8）与单会话镜头上限（默认 40）在设置页可调；超限直接拒绝，不发请求。
- 能力未绑定时返回「未配置 … 模型」并禁用对应动作，**不会**拿文本模型冒充视觉/视频模型。

## 设置页

「设置 → 创意」：

- 下载与摄取：yt-dlp 路径与开关、DTK 地址与 Key（Key 只存本地，回读脱敏为「已保存」）。
- 能力绑定：七类能力各一个下拉。
- 分析与成本：分析深度、场景切分阈值、每镜证据帧数、付费前确认、单轮付费上限、单会话镜头上限。
- 「检测可用性」只读本地配置，不发起下载。

## 合规边界

- 只处理你有权使用的内容；不提供验证码破解、风控规避、批量养号或自动发布。
- Cookie / API Key 只由你显式填入、只存本地设置库；不会出现在聊天消息、线程记录或错误文本里。
- 下载内容只落本地创意目录，不进入版本控制。
- 需要公网视频地址的能力（如视频理解）会在发起前说明会上传，并等确认。

## 排障

| 现象 | 原因与处理 |
| --- | --- |
| 摄取报「不允许访问本机/内网地址」 | 直链或解析器返回了私网地址，被 SSRF 防护拦下；改用公网链接或本地上传 |
| 平台链接提示「这个平台链接需要解析器」 | 没有可用解析器。装 yt-dlp 并填路径，或部署 DTK；也可直接上传视频 |
| 平台链接提示「需要浏览器 cookies」 | 抖音/TikTok 反爬。设置页把「读取浏览器 cookies」设为 chrome，并确保浏览器登录过该平台 |
| 抖音仍 403（已带 cookies） | yt-dlp 当前版本对抖音 web 接口的已知限制；改用 DTK（已验证可用）或「上传视频」 |
| DTK 返回 `IDENTITY_POOL_EXHAUSTED` | 没启动 browser 容器。用 `--profile browser` 重启，然后再调一次「铸造身份」 |
| DTK 返回 `INVALID_PARAM: wait max 30` | `?wait=` 上限是 30 秒，别传更大值 |
| 反推报「没有可用的视觉模型」 | 设置页「创意 → 能力绑定」或「默认路由」里绑定 vision 模型 |
| 切分结果为 1 镜 | 画面变化不明显；调低阈值（更敏感）后重新切分 |
| 抽帧报某镜失败 | 该时点落在末帧之后；重跑会跳过已有帧，或在界面上对该镜单独重抽 |
| 晋升报「项目已存在」 | 项目名重复；换一个名称，或改用「写入现有项目」 |
| 线程超过 1MB | 新建会话，或清理旧轮次；线程只存引用与摘要 |

## 验收脚本

```bash
node verify-creative-reverse-contract.mjs   # reverse-v1 契约与技能解析
node verify-creative-session.mjs            # 会话 CRUD、线程上限、目录清理、前端 store
node verify-creative-ingest.mjs             # 摄取适配器、SSRF、probe、切分、抽帧
node verify-creative-export.mjs             # 导出与晋升（含手改保护、失败回滚）
node verify-creative-ui.mjs                 # 八视图、会话列表、模式、窄屏、项目切换
node verify-creative-reverse.mjs            # 端到端反推（media + vision + 契约）
node verify-creative-capabilities.mjs       # 能力托盘与成本闸门
node verify-creative-settings.mjs           # 设置页与可选适配器
node verify-creative-e2e.mjs                # 上传→反推→导出→晋升 全流程
node verify-skills-unit.mjs                 # 含 creative-contract / creative-tools 单测
```

## 容器部署

应用与 DTK 都能容器化，一条命令起全栈：

```bash
cp deploy/.env.example .env
./scripts/deploy-up.sh
```

详见 [`docs/deploy.md`](deploy.md)。容器里已验证：上传 → probe → 封面 → 切分 → 抽帧 → DTK 抖音抓取全链路。
