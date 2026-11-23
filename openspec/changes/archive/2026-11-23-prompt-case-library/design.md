# Design

## Context

现状与约束（只列影响方案的）：

- `reverse-v1` 契约（`src/skills/contracts.ts`）已定义逐镜字段：时间范围、景别、机位、主体、动作、环境、光影、色彩、音频、`keyframe_prompt`、`video_prompt`、证据帧与置信度。服务端的产物保存（`/api/creative/artifacts`）、导出与晋升（`server/creative-promote.mjs`）都在，但入口 UI 随 dsh 迁移被删除，`creative_*` 表的写入统一返回 410。
- `src/AssetBoard.tsx` 的素材页 Tab 是显式条件分支（角色 / 场景 / 道具 / 视频 / 场景三维 / 镜头语言），加第 7 个 Tab 需要同时处理上下文带、动作区与空态。
- 画布写回链路已有先例：`injectCharacter`（`src/App.tsx`）证明「拿选中镜头 + 追加文本」这条路可用；镜头字段是 `ShotData.prompt`（画面）与 `ShotData.videoPrompt`（运动）。
- 后台作业的先例是 `server/blender.mjs`：独立作业目录、子进程、总超时 + 无输出停滞检测、SIGTERM→SIGKILL、并发上限、产物体积上限。
- 每个项目媒体在 `<projects>/<项目>/assets/`，站内 URL 前缀 `/project-assets/`；可写状态根由 `SB_STATE_ROOT` 决定，媒体根由 `SB_MEDIA_ROOT` 决定。
- 外部来源实测：`vflow.live` 有公开 JSON 索引（约 5 MB，13,665 条）与逐条 JSON；`robots.txt` 为 `ai-train=no, use=reference`。其余候选站（flatkey / apiko / higgsfield / gemiomni）或无正式接口、或需登录、或数据路径被 robots 挡住。
- `rea-video` 是 Apache-2.0 的 Python CLI（`pip install "rea-video[ocr] @ git+..."`），依赖 numpy / opencv-headless / Pillow / PyYAML / videomd / onnxruntime；`--no-stems` / `--no-asr` / `--no-speakers` / `--no-packaging` / `--no-moments` 可跳过全部模型下载。VLM 通过 `REA_VLM_BASE_URL` / `REA_VLM_API_KEY` / `REA_VLM_MODEL` 配置。

## Goals / Non-Goals

**Goals:**

- 一张全局表装下三种来源（外部导入 / 手工录入 / 自有片反推），避免两套存储与两套 UI。
- 外部抓取全部收敛在服务端，前端只发关键词与条目标识；浏览器不直连外部索引。
- 拆解作业可中断、可取消、有上限，不因单次拆解拖垮进程或磁盘。
- 案例内容到镜头的写入复用现有字段与现有保存链路，不新增镜像字段。
- 许可口径在数据层与界面层都强制，外部案例永远不可能被标成自有。

**Non-Goals:**

- 不做自动复刻（不接 `rea-video remake` / capsule-cinema / 任何视频生成调用）。
- 不做 `report.html` 的站内托管或渲染。
- 不做案例的多用户共享、云端同步或版本历史。
- 不下载外部案例的封面与视频；不把它们转存进项目媒体根。
- 不改 `reverse-v1` 契约的必填字段与语义。
- 不恢复旧创意会话（`creative_*` 表）的任何写入路径。

## Decisions

### D1：全局单表 + `source` 区分，而不是每种来源一张表

三种来源的差异只在「有没有逐镜结构」与「许可口径」，而浏览、搜索、收藏、应用、删除的行为完全相同。拆三张表会让列表查询、分页与收藏状态三处重复。

字段形状：`id` / `source` / `source_id` / `title` / `prompt` / `shots`(JSON) / `model` / `category` / `tags`(JSON) / `video_url` / `poster_url` / `author` / `license` / `note` / `favorite` / `created_at`，唯一键 `(source, source_id)`。

`id` 用带前缀的稳定串：`vflow:<id>` / `manual:<uuid>` / `rea:<jobId>`，便于日志与排障直接看出降级来源。

替代方案：一张表 + 每来源独立子表；被否——跨来源浏览需要 UNION，分页与收藏会立刻变复杂。

### D2：外部索引在服务端抓取并短时缓存，逐条正文按需补取

vflow 的索引只有 id、标题与 facet，正文要按 id 单独取。因此分两步：

1. 预览：拉索引（缓存 10 分钟，内存 Map，按来源 key），按模型 / 分类 / 关键词过滤，取前 N 条（上限 60）返回摘要。
2. 提交：对勾选的 id 逐条取正文（并发受限，单条超时 8s），成功后 UPSERT。

替代方案 A：预览阶段就把正文全取回来。被否——预览 50 条就是 50 个请求，用户在预览阶段取消等于是白花。
替代方案 B：只存索引、正文查看时再取。被否——外链会失效，正文是案例的核心资产，必须落库。

### D3：抓取只走 `assertPublicUrl` + 固定来源地址，不接受客户端 URL

适配器内部持有来源的基地址与路径模板，客户端只能传关键词 / 模型 / 分类 / 条目标识。每次抓取前用 `server/ingest.mjs` 的 `assertPublicUrl` 校验解析结果（挡环回与私网）。索引响应体积上限 12 MB、超时 20s；逐条响应上限 512 KB、超时 8s。

这是 `stock-media-library` 已经验证过的模式（服务端签发导入令牌、客户端不传下载地址），这里进一步收紧为「客户端连地址都不能传」。

### D4：媒体只存外链，用 `<img>` / `<video>` 直连 + `onError` 占位

实测 `pbs.twimg.com` 在部分网络下不可达。若走服务端代理，等于把别人的 CDN 变成我们的带宽与合规负担；若下载，等于在仓库/磁盘里存他人内容。折中是：只存 URL，加载失败显示占位（`AssetVideoBoard` 的 `onError` 已是同类先例）。

代价明确：离线或墙内该案例没有封面。可接受——案例的主体价值是提示词文本，封面只是识别辅助。

### D5：拆解作业复用 Blender 作业模型，但独立模块

`server/blender.mjs` 的作业模型（一次性目录、子进程、超时/停滞、SIGTERM→SIGKILL、并发、产物上限）正是拆解需要的。但不复用它的代码：Blender 的逻辑绑定了版本区间、EEVEE 档位与帧目录，硬套会带来大量无关分支。

新模块 `server/rea-video.mjs` 只保留通用骨架，作业目录落 `statePath(appRoot, '.rea-jobs', id)`。

并发默认 1（拆解是分钟级重任务），可用 `REA_CONCURRENCY` 覆盖；单作业总超时按视频时长估算（`max(180s, duration × 8)`），停滞上限 90s（拆解会在阶段间长时间无输出，比渲染宽）。

### D6：档位映射为显式参数，默认档位不触发任何下载

```
quick（默认）
  --no-stems --no-asr --no-speakers --no-packaging --no-moments --no-survey
  => 0 模型下载；约「片长 × 1.5」分钟
full
  不加上述开关
  => 首次约 216 MB 下载（67 + 149 + 160 + 35，按实际启用项）
```

档位名与参数集合放在服务端一张常量表里，前端只传档位标识。发起前把该档位的「会下载什么」回给界面显示。

替代方案：把开关交给用户在高级设置里逐项勾。被否——组合爆炸，且用户无法预判哪一项会触发下载。

### D7：VLM 配置从应用设置注入子进程环境，不落盘

从 `getAppSettings()` 的视觉模型解析出 `baseUrl / apiKey / model`，拼成子进程 `env` 传入。**不写 `.env` 文件**：密钥落在作业目录里就等于散落到磁盘各处，还会进备份。

已知限制：rea-video 除了关键帧还会送视频片段，而方舟的 `/chat/completions` 只接受 `image_url`。这类调用会失败，`summary` 里 `VLM:` 会显示 `partial`。设计上把 `partial` / `failed` / `not_configured` 一律当作「视觉判定未完全生效」，在结果里标注，并提示可改用「逐镜抽帧 + 设置页视觉模型」的降级路径。

### D8：拆解产物解析 `breakdown.json`，报告改走沙箱预览

`breakdown.json` 是几十万字的完整数据，`VIDEO.md` 是分层摘要。解析只取 `breakdown.json`：

- 逐镜列表、制作方式、置信度、证据 → `shots[].base`（label / confidence / decided_by / evidence）。
- 两段提示词有两个来源，优先级从高到低：`shots[].review.replication`（agent 看图复核后手填，最具体）、`shots[].replication.spec.scene`（代码渲染类镜头的自动画面规格 `picture` / `move`）。
- **`shots[].replication` 本身不是提示词**：它给的是复刻路线（`route`）、候选工具、执行器与验证项，界面上单独展示为「复刻路线」。

实测结论（真实产物，3 秒 testsrc）：AI 生成类镜头在**未做看图复核时没有提示词**，这是上游设计而非缺数据。因此 `promptMissing` 如实标为缺失，界面提示「未开视觉复核 / 未人工补写」，不伪装成空字符串。

**报告预览**：`report.html` 与它引用的相对资源（`storyboard.jpg` / `shots/*` / `sfx/*` / `frames/*`）整份复制到 `prompt-cases/<job>/report/`，以禁脚本 sandbox iframe 呈现。实测产物零 `<script>`、零内联事件、零外链，沙箱即可作为安全边界；复制失败只标注报告不可预览，不影响结构化详情。

### D8b：视觉模型可选，且必须经应用内中转

面板提供视觉模型下拉，默认跟「默认路由 → 视觉」。选择结果作为 `vlmModelKey` 传给创建作业的请求。

**为什么必须中转**：实测两条直连路径都不通——

| 路径 | 实测失败原因 |
|---|---|
| APIMart 直连 | 即使不传 `stream` 也只回 SSE，rea-video 按 JSON 解析报 `Expecting value: line 1 column 1` |
| APIMart 走 `HTTPS_PROXY` | Python requests 不信任 Clash 的 MITM 证书（`CERTIFICATE_VERIFY_FAILED`） |

因此新增内部端点 `/api/prompt-cases/vlm-proxy`：只认 studio 内部令牌（`Authorization: Bearer` 或 `x-studio-internal`），用应用自己的 apimart 客户端（代理 + IPv4）转发，并用 `parseChatBody` 把 SSE 归一成非流式 JSON。子进程只拿到内部令牌，渠道 Key 不出应用进程。

实测结果：`VLM 已生效`，判定置信度 0.644 → 0.992。

### D9：「应用到镜头」写现有字段，不建快照

画面提示词写 `ShotData.prompt`，运动提示词写 `ShotData.videoPrompt`。两者都是画布既有字段，`shotSync` 已有双向映射。不写 `videoPromptOverride`（那是「手改整段出片正文」的语义，案例文本不是这个用途），因此也不会引入「旧快照」警告。

写入后不弹确认框，但多镜案例给一条 toast 提示可能需要删减——与 `injectCharacter` 的成功提示同级。

### D10：Tab 位置放在「镜头语言」之后

素材页现有 6 个 Tab，「镜头语言」是一个子工作室（`lexiconOpen` 是独立状态而非 Tab 枚举）。新 Tab 加入 `MaterialTab` 联合类型，且必须同时覆盖三处：上下文带文案、动作区按钮、内容区分支，以及 `readInitialMaterialTab` 的会话恢复逻辑。

替代方案：把案例库做成「镜头语言」里的第二个子页。被否——两者的动作语义不同（镜头语言产出的是可连线的参考视频，案例产出的是文本），且案例库是全局作用域，镜头语言的导入是项目级。

## Risks / Trade-offs

- **外部站点结构变化** → 适配器与解析器分离，解析失败只影响该来源；`verify-prompt-cases.mjs` 用固化 fixture 守住解析契约；来源失败不阻塞其他来源。
- **`pbs.twimg.com` 等外链在部分网络不可达** → 只存外链的决定带来的直接代价；卡片占位 + 提示词文本不受影响；详情页提供原文链接。
- **`rea-video` 是新增的部署硬阻塞** → `DEPLOY-CHECKLIST.md` 里如实记一条；设置页给出可复制的安装命令与检测按钮；找不到时反推入口显示原因而非静默失败。
- **Python 版本与 wheel 兼容** → 已实测：Python 3.13 + onnxruntime 1.32（cp313 arm64 wheel 存在）+ videomd 1.2（纯 Python）+ rapidocr 3.10（纯 Python）。设置页检测时把实际版本与探测失败原因一并显示。
- **拆解耗时与磁盘** → 并发默认 1、总超时按片长、产物上限 512 MB、作业目录在状态根下（不进代码目录、不进仓库）。作业完成后产物保留（证据帧要用），由用户删除案例时不自动清理，另给「清理作业目录」入口。
- **视觉模型不支持视频输入导致判定变弱** → 结果必须暴露 `VLM:` 状态；界面在 `partial` / `failed` 时给出「本例视觉判定未完全生效」的明示，避免用户把弱判定当强结论。
- **案例文本是整片级而非单镜级** → 外部案例多为一条 5–15 秒完整视频的描述，直接写进单镜会产生「一镜描述了多镜」。设计上保留写入能力但给出提示，不做自动拆分（自动拆分需要模型改写，属于另一个能力）。
- **许可口径被绕过** → 服务端在保存时按 `source` 强制 `license`，前端把该字段设为只读；`reverse-own` 之外的 `license` 一律回落 `reference-only`。

## Migration Plan

1. **建表**：`prompt_cases` 加入 `server/db.mjs` 的 `SCHEMA`（`CREATE TABLE IF NOT EXISTS`），老库启动时自动补建；没有数据迁移，也没有旧表改写。
2. **灰度**：外部导入的来源适配器提供 `enabled` 开关，默认只启用 vflow；其余来源登记但关闭。关闭时导入面板不出现该来源。
3. **反推依赖**：不强制作业可用的前置条件；未装 `rea-video` 时素材页仍可用（案例库的浏览、复制、应用都不依赖它），只是反推入口不可用。
4. **回滚**：删除前端 Tab 与路由即可回到当前状态；`prompt_cases` 表留空不影响任何现有流程（没有外键，也没有其他代码读它）。已入库的案例在回滚后成为孤儿数据，不影响运行。

## Open Questions

- `breakdown.json` 的实际字段名与嵌套层级需要在实现首个任务时用一条真实样本固化 fixture 才能定稿；设计上已把解析层隔离为独立模块，字段对齐不改变外部行为。
- 外部来源是否要在后续把 `flatkey` 也接上：其数据在 robots 的 `Disallow: /_next/` 下，商用前需要单独确认授权口径。属于来源清单扩展，不影响本设计。
