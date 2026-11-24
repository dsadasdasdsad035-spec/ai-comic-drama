# 提示词案例库：外部来源

素材页「提示词案例」Tab 可以从外部站点导入公开的提示词案例。本文记录各来源的实测结论、抓取地址、许可口径与失败表现，供排障与后续扩展参考。

## 为什么只存外链

外部案例的封面与视频都来自对方 CDN。系统只保存 URL，不下载到项目媒体根：

- 下载等于把别人的内容复制进用户磁盘与备份，许可风险与体积都无法收敛；
- 服务端代理等于把对方 CDN 变成我们的带宽账单。

代价是外链在部分网络下不可达，此时卡片显示占位，提示词文本与复制功能不受影响。

## vflow（已启用）

| 项 | 值 |
|---|---|
| 索引 | `https://www.vflow.live/data/daily159-successor-20261111/index-all.json` |
| 逐条 | `https://www.vflow.live/data/prompt-sources/v1/<id>.json` |
| 规模 | 约 13,600 条（索引约 5 MB） |
| robots | `Content-Signal: search=yes, ai-train=no, use=reference` |

**索引是位置数组，不是对象。** 这是对方为压体积做的取舍，列序固定：

| 下标 | 含义 |
|---|---|
| 0 | `id`（也用在逐条 URL 上） |
| 1 | 标题 |
| 2 | 缩略图路径（拼成 `pbs.twimg.com/amplify_video_thumb/<值>.jpg`） |
| 3 | 作者 handle |
| 4 | 视频路径（拼成 `video.twimg.com` 绝对地址） |
| 9 | 分类下标数组（前一个取 `cat` 表，其余当标签） |
| 10 | 日期 `YYYYMMDD` |
| 11 | 模型下标（`mod` 表：seedance-2-0 / seedance-2-5 / minimax-h3 / grok-imagine / opus-5-5 / sora-2 / kling / veo-3 / happy-horse） |
| 12 | 作者显示名 |
| 13 | 时长（秒） |
| 8 | 比例下标（`asp` 表） |

逐条 JSON 才有正文：

```json
{
  "id": "...",
  "prompt": "完整提示词正文",
  "title": "...",
  "referenceModel": "seedance-2-5",
  "sourceUrl": "https://x.com/<作者>/status/<id>",
  "videoUrl": "https://video.twimg.com/...",
  "thumbnailUrl": "https://pbs.twimg.com/...",
  "aspectRatio": "16:9",
  "durationSec": 15,
  "rightsStatus": "embedded"
}
```

**许可口径**：`ai-train=no` 表示内容不得用于训练模型；`use=reference` 表示可以作为参考。因此这些案例在库里的许可固定为 `reference-only`，服务端按来源强制，客户端无法改成 `own`。

**导入是两步**：预览只拉索引并按模型 / 分类 / 关键词过滤，返回摘要与令牌；提交只接受该令牌与预览中出现过的 id。索引缓存 10 分钟，令牌有效期 30 分钟。

**限制**：索引 12 MB / 20 秒，逐条 512 KB / 8 秒，提交并发 4，单次预览上限 60 条。任何一步失败都返回可读原因，单条失败不影响同批其余条目。

## 全量同步：把案例灌进本地库

外部来源的价值在「离线可查」。`scripts/sync-case-sources.mjs` 把 vflow 与 apiko
一次性导进本地 SQLite，之后浏览、搜索、筛选全部走本地，不再依赖外网。

```bash
node scripts/sync-case-sources.mjs --status            # 看进度与库内条数
node scripts/sync-case-sources.mjs --source vflow      # 全量 vflow（13,665 条）
node scripts/sync-case-sources.mjs --source apiko      # 视频模型页（约 567 条）
node scripts/sync-case-sources.mjs --source all
node scripts/sync-case-sources.mjs --source vflow --limit 200   # 试跑
```

设计要点：

- **断点续传**：vflow 逐条抓取会写 `.case-sync/vflow.json`，中断后重跑跳过已完成的 id。
  万级抓取里任何一次网络抖动都不该让进度归零。
- **目标库解析**：复用 `applyDefaultProjectsDir()`，默认写桌面端 userData 里的真实库
  （`~/Library/Application Support/storyboard-canvas/projects`）。直接拼 `./projects`
  会把数据导进应用根本不会读的空库。
- **并发 8**：实测单条 127ms；再高容易触发来源限流。
- **媒体只存外链**：视频与封面都保留来源 URL，不下载。全量视频若下载是数百 GB，
  且会把别人的内容复制进用户磁盘与备份。
- **分面回填**：同步末尾自动跑 `refreshCaseFacets`，让新数据立刻能被 18 轴筛到。

实测结果（截至本次全量）：轴覆盖从 147/430 提升到 262/430，**18 轴全部点亮**。

## flatkey（已登记，未启用）

- `prompt` 正文确实在 Next.js flight 数据里，服务端可解析；
- 但 `robots.txt` 明确 `Disallow: /_next/`，数据路径正在其下；
- 媒体 CDN `cdn.shulex-voc.com` 实测返回 404。

启用前需要单独确认授权口径，属于后续独立变更。

## apiko（已接入：脚本批量同步，约 570 条视频提示词）

**实测修正**：旧结论「纯客户端渲染、没有数据」只对首页成立。提示词页
（`/seedance-2-5-prompts` 这类）是**服务端渲染**的，每页 90-140 条完整提示词，
结构极规整：

```
<h2>Cinematic</h2>        ← 分类
<h3>标题</h3>             ← 一条案例
<p>完整提示词正文</p>
```

**规模与筛选**：sitemap 里 11 个模型页，合计约 2,081 条。但其中 1,514 条是
**图像模型**（gpt-image-2/2-5/2-6 = 1,344，nano-banana 119，seedream 51），
内容形如「生成一张海报 / 网页 / 商品图」，进视频案例库语义是错的。
同步脚本只收 **7 个视频模型页**（claude-fable-5-2 / claude-opus-5-5 / kling-4-0 /
seedance-2-0 / seedance-2-5 / wan-3-0），约 **567 条**。

**为什么不开放界面导入**：每页 90-140 条、需要翻 11 个页面，让用户在弹窗里
逐条勾选不现实。走 `scripts/sync-case-sources.mjs --source apiko` 一次性同步。

**许可**：`reference-only`，与 vflow 一致。媒体用站内图片外链。

## higgsfield（两路：案例库 + 写作指南）

**重要修正**：第一次只筛 URL 带 "prompt" 的 6 篇，漏了大量内容。实测**全量扫描 347 篇**
（`scripts/scan-higgsfield-blog.mjs`）后发现 **21 篇含可提取提示词，共 169 条**——是初判
23 条的 7 倍。原因是 higgsfield 的文章按**项目/案例**命名（`Santiago-breakdown`、
`case4k`、`cinematic_headphones`），提示词在正文里，URL 里看不出来。

按内容分成两路，不重复：

| 类型 | 特征 | 去向 | 条数 |
|---|---|---|---|
| **成品型** | 拆解 / 案例 / 实操；正文里有完整提示词（最长 17,951 字符） | **案例库**（`source=higgsfield`） | 112 条（去重后） |
| **方法论型** | `Settings:` / `Bad prompt vs Good prompt` / `Why this combination` | **写作指南** Tab | 23 条 |

成品型的代表文章（按条数）：

```
ai-car-commercial-youtube-guide   23 条   max 8,678 字符
cinematic_headphones              20 条   max 9,166
Santiago-breakdown                19 条   max 15,066
cinematic                         18 条   max 11,281
case4k                            16 条   max 13,234
make-game-trailer-with-ai          3 条   max 17,951
```

**去重**：同一段人物设定/场景锁常在多篇文章里重复出现，按正文前 400 字的
`sha256` 去重（本次去掉 14 条）。

### 路径可用性

实测结论按路径分裂，别按站点名一刀切：

| 路径 | 结果 |
|---|---|
| `/blog/*` | ✅ **服务端渲染，正文完整**。347 篇文章中有 6 篇提示词指南，其中 3 篇可解析成结构化配方（共 23 条） |
| `/flow/`、`/library/`、`/asset/`、`/share/` | ❌ robots 明确 Disallow |
| `/flow/video/prompt` | ⚠️ 虽在 allow 列表，但 301 到 `/ai/video`（营销页），无内容 |
| `/@user/projects/*` | ❌ 28 个公开项目页，但 HTML 只有骨架，靠客户端 JS 拉 |
| `/shots`、`/projects` | ❌ 404 |

**当前用法：打包快照，不走运行时抓取。** `scripts/fetch-prompt-guides.mjs` 解析
`/blog/` 的三篇指南，产物落在 `public/presets/prompt-guides/v1.json`。
不启用为「案例来源」——博客是方法论，不是「一条视频 + 一段提示词」的案例。

三篇文章的模板各不相同，解析器（`scripts/lib/parse-higgsfield-blog.mjs`）认四种：

| 模板 | 文章 | 结构 | 产物类型 |
|---|---|---|---|
| A 配方 | `seedance-2-5-prompting-guide` | `Settings:`（Genre/Lighting/Camera/Color）+ `Why this combination` + 提示词 | 10 条 |
| B 变体 | `seedance-prompting-guide` | `What it does` + `Inputs` + `The Prompt` + `Pro tip` | 6 条 |
| C 诊断 | `ai-video-prompt-mistakes` 开头 | `Mistake` / `Why It Happens` / `The Fix` | 1 条 |
| D 对照 | `ai-video-prompt-mistakes` 正文 | `Bad prompt` + `Good prompt` + 修复步骤 | 7 条 |

**许可**：higgsfield 的 robots 允许 `/blog/`，但站点**没有**像 vflow 那样声明
`ai-train=no`。快照一律标 `reference-only`，界面显示出处，不作为本项目产物发布。
若之后要开源本仓库或分发安装包，这批快照需单独复核授权。

## gemiomni（已登记，未启用）

宣称 4,915 条，但公开可见仅 100 条，其余需登录。

## 排障

| 现象 | 原因 | 处理 |
|---|---|---|
| 预览返回「来源未启用」 | 该来源在注册表里 `enabled: false` | 预期行为；启用需评估授权 |
| 预览返回「索引请求失败：HTTP 4xx/5xx」 | 站点改版或临时故障 | 重试；持续失败时检查索引路径是否变化 |
| 「索引返回的不是合法 JSON」 | 拿到的是 HTML 错误页 | 同上 |
| 导入时某几条失败 | 单条 URL 变更或超时 | 失败条目会逐条列出，重新预览后再导入 |
| 卡片没有封面 | 外链 CDN 在当前网络不可达 | 预期；提示词与复制不受影响 |
| 提示词正文是外语 | 来源原样保存，未翻译 | 预期；提示词通常与目标模型语言一致 |

## 手工录入

没有外部来源的案例可以手工录入：`source=manual`，`sourceId` 自动生成 UUID。手工录入同样按 `reference-only` 处理——自有内容应走「反推我的片子」（`reverse-own`），那条路径才会标记为自有。
