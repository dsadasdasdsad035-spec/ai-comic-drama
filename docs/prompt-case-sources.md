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

## flatkey（已登记，未启用）

- `prompt` 正文确实在 Next.js flight 数据里，服务端可解析；
- 但 `robots.txt` 明确 `Disallow: /_next/`，数据路径正在其下；
- 媒体 CDN `cdn.shulex-voc.com` 实测返回 404。

启用前需要单独确认授权口径，属于后续独立变更。

## apiko（已登记，未启用）

索引页是纯客户端渲染，HTML 里没有数据；`/api/` 被 robots 挡住，也没有公开的 JSON 索引。它有本地 MCP（`npx apiko-mcp`）可以生成媒体，但没有提示词检索工具。

## higgsfield（已登记，未启用）

只有项目页与社区作品页，没有批量索引；整页需要逐个抓取，不适合作为批量来源。

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
