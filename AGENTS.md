# AGENTS.md — 本项目的操作约束

给在此仓库工作的 AI Agent 的项目记忆。**动手前先读这一节**，尤其是 Seedance 2.5 的成本红线。

---

## 0. 硬约束：不要测试 Seedance 2.5

**任何 Seedance 2.0 及以上的真实视频生成调用，一律不自动跑。2.5 尤其如此。**

2026-11-24 用户明确要求：「以后不要测试 seedance 2.5，因为成本问题。」

### 实测成本（真实任务 `task_01M87114YP1A68DFB1RQ4Q1VY3`）

| 项 | 值 |
| --- | --- |
| 成片 | 5.04 秒 / 1280×720 |
| 上游 `cost` | **$1.6902 USD** |
| 上游 `credits_cost` | **16.902** |
| `usage.completion_tokens` | **281700** |
| 等待时长 | 4.5 分钟 |
| 折算 | **约 $20.28 / 分钟成片** |

**按 completion token 计费，不按秒**。5 秒视频吃掉 28 万 token —— 这是模型计价方式，不是接入错误。

### 怎么做验证

| 手段 | 是否花钱 | 用途 |
| --- | --- | --- |
| `dryRun: true` | ❌ 免费 | 看最终 payload 每个字段，覆盖 90% 的契约验证 |
| mock 上游（本地 http server） | ❌ 免费 | 上传/轮询/错误路径 |
| 纯函数断言（`verify-*.mjs`） | ❌ 免费 | payload 拼装、秒数求解、样式判定 |
| 去掉 `dryRun` 提交 | ✅ **花钱** | 禁止，除非用户当次明确批准 |

判别方法：`POST /api/seedance` 带 `dryRun: true` 不产生费用；去掉它就是真实扣费。

确实需要真实产物时，先报「模型 / 任务 / 时长 / 预估成本」，等**当次**明确同意。默认预期是不跑。

> 相关：`verify-apimart-video-payload.mjs` 已用 dryRun 覆盖 2.5 的关键字段（含 `omni_reference_task_type`），改 payload 优先扩展它，而不是真跑。

---

## 1. Seedance 2.5 的完整限制

### 1.1 时长

| 约束 | 值 | 代码位置 |
| --- | --- | --- |
| 模型下限 | **4 秒（含边界，4 秒合法）** | `server/apimart.mjs` `clampDuration(seconds, 4, 30)` |
| 模型上限 | **30 秒** | 同上 |
| 镜头夹取 | 客户端夹到 **2–12 秒** | `src/videoSeconds.ts` `SHOT_SECONDS_MAX = 12` |
| 原生音频下限 | **4 秒**（强制抬高到 4） | `src/videoSeconds.ts` `shotRequestSeconds` |

注意：模型支持到 30 秒，但**分镜镜头**当前被夹在 12 秒内。要出更长的片子得绕开镜头时长，别误以为模型不行。

### 1.2 比例与分辨率

- 比例：`16:9` / `4:3` / `1:1` / `3:4` / `9:16` / `21:9` / `adaptive`
- 分辨率：`480p` / `720p` / `1080p`
- **有首帧或尾帧时，比例必须是 `adaptive`**（输出跟随首帧画幅），传显式比例会被上游拒绝

### 1.3 参考视频：必须声明任务类型（踩过的坑）

带 `video_urls` 时**必须**同时发：

```json
{ "omni_reference_task_type": "reference" }
```

不传的话，上游会**按提示词自动判断任务类型**。提示词里出现「参考视频的运镜」「拍摄同样的角色」这类描述，就会被判成**「视频编辑」**，然后要求 `ratio=adaptive`、`duration=-1`，整单参数无效：

```
请求中指定的参数 `ratio` 和 `duration` 无效。Seedance 根据您的提示将您的任务识别为视频编辑。
对于这种任务类型，输出比例和时长应遵循模型选择的输入视频进行编辑，
所选视频必须满足时长要求为 4 到 30 秒。
问题： [0] `ratio` 必须为 `adaptive`。 [1] `duration` 必须为 -1。
```

方舟分支（`server/video.mjs:155`）早就有这条，**APIMart 分支（`server/apimart.mjs`）2026-11-24 才补上**。判定依据用模型家族（`family === 'seedance-2.5'`）而不是模型条目字段 `videoRefTaskType`——preset 迁移只补缺失条目、不更新已有条目，靠字段会漏。

#### 「视频编辑模式」那 5 个参数的适用范围

上游报错里出现的这张表**只在被判成「视频编辑」时才生效**，不是 Seedance 2.5 的常规要求：

| 参数 | 视频编辑模式 | 本仓库做法 |
| --- | --- | --- |
| 参考视频 | 必须提供 | 用户连线视频素材即提供 |
| `ratio` | `adaptive` | **不跟随**，仍用显式比例（16:9 等） |
| `duration` | `-1` | **不跟随**，仍用具体秒数（4–30） |
| 视频时长 | 4–30 秒 | 一致（`clampDuration(seconds, 4, 30)`） |
| 任务类型 | `edit` | **显式声明 `reference` 来绕开这个模式** |

正确解法是**别让它被判成 edit**，而不是去满足 edit 的参数。已实测：声明 `reference` 后 `duration: 5` + `size: "16:9"` 正常出片。

#### 各条路径的覆盖情况（2026-11-24 核查）

| 路径 | 带参考视频时 | 状态 |
| --- | --- | --- |
| APIMart `seedance-2.5` | 自动注入 `reference` | ✅ |
| 方舟 `ark-video-2-5`（preset 有 `videoRefTaskType`） | 注入 `reference` | ✅ |
| 方舟 `ark-video-2-0` | **不传**（规格明确设计：仅 2.5 需要） | ⚠️ 面板给 `video-ref-task-type-missing` 警告 |
| APIMart generic 族（veo / kling-omni 等） | 通用 schema 的 `video_urls`，上游不会走 edit 判定 | ✅ 放行 |
| APIMart generic 里有 seedance 2.x 名字 | 本地拒绝并提示改用 2.5 | ✅ 防呆 |

用户自建的 seedance 2.x 条目若没在设置页选「任务类型 = 参考」，靠条目字段会漏——所以 `src/videoPrompt.ts` 在「supportsVideoRef 但没有 videoRefTaskType」时给出警告，提示去设置页补选。

#### 本轮核查又修掉的三处（2026-11-24 第二轮）

1. **`videoFamilyFor` 精确匹配漏变体**：原来只认 `seedance-2.5` / `seedance-2-5` / `seedance-2_5`，`seedance-2.5-pro`、`seedance2.5` 这类会掉进 generic（不带任务类型 → 被判 edit）。改成正则，只把已知规格后缀（pro/hd/fast/turbo/standard）算同族，`kling-v3-omni` 这类**不同能力**的仍走 generic。
2. **参考视频时长没校验**：`POST /uploads/videos` 之前不看时长，1 秒的视频也会先上传再被上游拒（浪费一次配额，且用户只看到「参数无效」）。现在上传前用 `probeDuration` 校验 **2–30 秒**（2 秒含边界合法），超范围直接本地报错。注意上游那句「4 到 30 秒」是被判 edit 时的要求，声明 `reference` 后不适用。
3. **APIMart 分支的任务类型判定依据**：用模型家族而不是条目字段（preset 迁移不更新已有条目）。

其他参考视频约束：
- 单段 2–30 秒
- 方舟：上传 Files API 后换公网 URL；APIMart：`POST /v1/uploads/videos`（保留 3 天，配额 2000 次/72h）
- **本仓库只取第一条视频素材**，其余进 `omittedVideos`

### 1.4 参考图

- 官方上限 30 张；客户端 `VIDEO_REFERENCE_IMAGE_LIMIT = null`（**不截断**，全部随连线提交）
- APIMart：本地参考图先 `POST /v1/uploads/images` 换 URL（20MB 上限，72 小时有效）
- 本地参考图会上传成公网 URL；方舟则转 data URL
- 有参考图时**不提交首帧**（二者互斥）

### 1.5 原生音频

| 约束 | 值 |
| --- | --- |
| 参考音频 | 单个 `audio_url` 字符串；**不要**发 `reference_audio` / `audio_urls` 对象或数组 |
| 样本时长 | 2–30 秒 |
| 视频下限 | 4 秒（`generate_audio` 时） |
| 多说话人 | 上游只接一条 `audio_url` |

**本仓库的软降级策略（2026-11-24 起不做强门镜）**：音色参考是可选增强，只有「模型没有 `audioOut`」「镜头短于上游下限」才拦截出片。多说话人 / 说话人不在角色库 / 样本不合规 / 样本缺失，一律降级成 `no-reference`（只发 `generate_audio`、声音由模型决定）并说明原因。

`generate_audio: true` **不传** `audio_url` 也能出片（2026-11-22 实测 `task_01M81KX9X0DN2JBVBSXS9KCGY1`）。

### 1.6 原生音频与视频参考可以并存

两者在同一个请求里不冲突：`video_urls` + `image_with_roles` + `generate_audio` + `audio_url` 可以同时出现。以前那条「原生音频只能用参考图模式」是产品限制，已删除。

---

## 2. 改服务端代码：必须重建 bundle

桌面端与 `npm start` 加载的是 **`server-build/app.mjs`**，不是 `server/*.ts` 源码。

```bash
npm run build:server     # 改完 server/ 必跑
```

**踩过的坑（2026-11-24）**：源码改了但没重建，用户重启后仍加载旧 bundle，同样的报错重复出现。排查这类「改了没生效」时，第一件事是核对：

```bash
stat -f '%Sm' server-build/app.mjs     # bundle 时间
ps -p $(pgrep -f server/desktop-entry.mjs) -o lstart=   # 进程启动时间
```

bundle 时间必须**晚于**源码改动时间，进程必须**晚于** bundle。

另外：`git stash` 做基线对照时，会短暂把源码还原成旧版；如果这期间用户触发构建，就会把旧代码编进 bundle。做对照要避开构建窗口，事后务必重建。

---

## 3. 运行时位置

| 用途 | 路径 |
| --- | --- |
| 项目库（SQLite + 各项目 assets） | `~/Library/Application Support/storyboard-canvas/projects/` |
| 媒体产物（generated / videos / voices） | `~/Library/Application Support/storyboard-canvas/media/` |
| 机器私有状态（dsh / 渲染作业 / 计费库） | `~/Library/Application Support/storyboard-canvas/state/` |
| 设置库（含渠道 Key、创意配置） | 上面 projects 目录下的 `storyboard.sqlite` 的 `settings.app` |

`SB_PROJECTS_DIR` / `SB_MEDIA_ROOT` / `SB_STATE_ROOT` 可覆盖三者；不设时开发态回退到仓库 `projects/` 与 `public/`。

**站内路径有两个根**，解析时都要认：

- `/project-assets/<项目>/<文件>` → `<projects>/<项目>/assets/`
- `/videos/...`、`/generated/...` 等 → 媒体根

统一用 `server/media.mjs` 的 `localFileForRef()`（2026-11-24 新增）。图片早就有这个分支，视频曾漏掉，导致素材库连线的视频报「参考视频不存在」。

---

## 4. 凭据与网络

- 渠道 Key 读取顺序：设置库 `apiKey` > `~/.canghe-skills/.env` > `./.canghe-skills/.env` > `./.env` > 进程环境变量
- 仓库根 `.env` 被 gitignore，**已丢失两次**（`git clean -xfd` 会带走）。重要 Key 建议同时写进 `~/.canghe-skills/.env`（不在仓库里，不受 git 清理影响）
- **`api.apimart.ai` 在墙外，必须走系统代理**（本机 `127.0.0.1:7897`）。代理没开时表现为「无法经代理连接 APIMart」，不是 Key 问题
- APIMart 渠道缺 Key 的报错会说清查了哪几个文件、认哪几个变量名（`APIMART_API_KEY` / `APIB_API_KEY`）

---

## 5. 验证脚本

本仓库用 `verify-*.mjs` 平铺在根目录，不是 jest/vitest。

```bash
node verify-apimart-video-payload.mjs   # 纯函数：payload 拼装
node verify-apimart-routes.mjs <base>   # 路由集成（需先起服务）
node verify-native-audio.mjs            # 原生音频三态解析
node verify-project-media-resolve.mjs   # 站内路径两个根 + 视频上传
```

浏览器级脚本（`verify-*-ui.mjs`）需要 5273 上的 dev server，否则报 `ERR_CONNECTION_REFUSED` / `networkidle` 超时——**那不是改动引起的失败**。

服务端跑测试要 Node ≥ 24.9：`./desktop/bin/node server/index.mjs`（系统 node 可能只是 22）。

部分 `tests/*.ts` 需要 esbuild 打包 + `createRequire` banner 才能跑：

```bash
npx esbuild tests/xxx.ts --bundle --platform=node --format=esm \
  --banner:js="import { createRequire as __cr } from 'node:module'; const require = __cr(import.meta.url);" \
  --outfile=/tmp/t.mjs && node /tmp/t.mjs
```

---

## 6. 已知未修问题

- **计费价目表低估 Seedance 2.5 约 22 倍**：`server/billing/price-catalog.mjs` 按 `video_second` 计价（720p = 0.15 credits/秒，5 秒估 0.75），实际按 completion token 扣 16.902 credits。平台自有 Key 出片按此表收费会亏。建议改为按 `completion_tokens` 计价并对齐实测单价（约 6e-5 credits/token）。
- `server/whitebox.mjs` 有一批未提交改动（`HARD_MAX_FRAMES` 12→96、`DEFAULT_FPS`→`DEFAULT_INTERVAL=0.5`），来自另一工作流，不要顺手回退。
