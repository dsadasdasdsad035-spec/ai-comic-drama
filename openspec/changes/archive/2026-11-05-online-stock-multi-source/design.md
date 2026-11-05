# Design

## Context

参见 `proposal.md` 的 Why。当前实现约束（已读过代码与线上实测）：

- 来源是纯对象适配器，注册表在 `server/stock.mjs`；设置层在 `server/stock-settings.mjs`，只有 `id / label / baseUrl / envKey / requiresKey` 五个字段。
- 检索结果 `StockItem` 已经带 `token`，导入只认 `provider + token + project`；下载走 `assertPublicUrl` + Content-Type/大小/超时校验，失败不留文件。
- 来源元数据存 `stock_imports` 侧表，画布整表回写不影响它。
- 前端 `StockBrowser` 只有「检索 / 预览 / 导入」三态，没有「外链跳转」这种形态。
- 现有验收全部离线：`verify-stock-api.mjs` 注入 `fetchImpl`，`verify-stock-ui.mjs` 用 `page.route` 拦 `/api/stock/*`。

实测到的来源差异（决定了下面每个决策）：

| 来源 | 访问方式 | 关键实测 |
| --- | --- | --- |
| Unsplash | `api.unsplash.com/search/photos`，Access Key | 无 Key 返回 401；`unsplash.com` 自身有 Anubis 反爬，HTML 不可用 |
| Coverr | `api.coverr.co/videos`，`api_key` 或 Authorization | 无 Key 返回 401；页面结果内嵌在 `ng-state`，每页固定 36 条且 `page=2` 被忽略，无法翻页 |
| Mixkit | 页面解析，无 Key | `robots.txt` 为 `Allow: /`；检索入口是路径式 slug `/free-stock-video/<slug>/?page=`（每页 24 条）；详情页 JSON-LD 有 `duration` 与 720p `contentUrl`。注意 `/free-stock-video/search/?q=` 会原样返回首页默认推荐，不能用于检索 |
| VJShi | 外链 | `robots.txt` `Disallow: /so?*`；搜索页返回反爬 JS 挑战；预览带水印、正片按 V 币售卖 |

## Goals / Non-Goals

**Goals:**

- 六个站点在界面上都可见，且每个都给出真实可达的动作（检索 / 外链），不出现「点了没反应」。
- 新增来源不改检索、令牌、导入、落盘、画布任何一段契约。
- 中文关键词在服务端完成翻译，结果可追溯、可标注、可离线验收。
- 页面解析型来源的失败语义与空结果严格区分。

**Non-Goals:**

- 不做多来源聚合检索与统一分页（仍是一次一个来源）。
- 不做视频裁剪/转码、不做音频参与出片。
- 不做 VJShi 的登录态自动化与已购素材导入。
- 不做「一键导入整页 / 批量下载」。

## Decisions

### D1 来源分成三类：`api | html | link`

设置层每个来源新增 `kind`，适配器契约相应分叉：

```js
{
  id, label, kind: 'api' | 'html' | 'link',
  mediaTypes: ['image' | 'video' | 'audio'],
  requiresKey: boolean,
  defaultBaseUrl,
  // api / html 才有
  async search({ query, mediaType, page, perPage, apiKey, baseUrl, fetchImpl }) -> { items, total?, hasMore }
  // link 才有
  externalSearchUrl(query) -> string
}
```

`describeProviders` 对 `kind: 'link'` 的项返回 `{ ok: true, importable: false, searchable: false }`，界面据此渲染成跳转按钮而不是检索框。替代方案是给 link 来源伪造一个 `search` 返回空列表——被否，那会让界面出现「搜不到」的假象。

### D2 Unsplash 走官方 API，并在导入前触发 download 端点

`GET /search/photos?query=&page=&per_page=&orientation=`，鉴权用 `Authorization: Client-ID <key>`。归一化取 `urls.raw/full/regular/small`（图片）、`user.name`、`links.html`、`width/height`。

Unsplash API 指南要求「用户下载时调用 `links.download_location` 以计入统计」，所以**导入前先请求该端点**，用返回的 `url` 作为真实下载地址。这一步放在 `importStockItem` 里对 `provider === 'unsplash'` 分支执行；失败不阻断导入，退回 `urls.full`，但要记一条日志。

替代方案：直接用 `urls.full` 下载。被否——违反来源 API 使用条款，且会丢掉下载统计。

### D3 Coverr 走官方 API，过滤付费项

`GET /videos?query=&page=&page_size=20&urls=true&sort=popular`，Key 用 `api_key` 查询参数（文档给出的两种鉴权之一，比自定义头简单）。归一化取 `hits[].urls.mp4_download || urls.mp4`、`poster/thumbnail`、`duration`、`max_width/max_height`、`is_premium`。

`is_premium: true` 的条目 MUST 过滤掉或标记不可导入——实测搜索页里约 1/7 是 premium，其 mp4 需要订阅。我们选择**过滤**，避免用户点了导入才失败。

HTML 解析方案被否：页面结果只在 `ng-state` 里，翻页靠「Load more」按钮的 XHR，URL 参数被忽略，无法在服务端拿到第 2 页。

### D4 Mixkit 走页面解析，列表页 + 按需详情页

列表：`GET /free-stock-video/<keyword-slug>/?page=<n>`，解析 `data-item-grid--video-player-item-id-value="<id>"` 所在块，取：

> 实测修正：`/free-stock-video/search/?q=<词>` 对任何关键词都返回同一份「Search」默认推荐（24 条固定结果、大小完全一致），
> 看着像有结果但与关键词无关。真实检索入口是路径式 slug（`/free-stock-video/rain/`），所以关键词必须先译成英文再转 slug。

- `id`、标题（`item-grid-video-player__overlay-link` 文本）
- 详情页 `/free-stock-video/<slug>-<id>/`（来源页面，也是导入时补详情的地址）
- 缩略图 `*-thumb-360-0.jpg`、预览 `*-360.mp4`
- `item-grid-video-player--4k` class 作为「有高清变体」的弱信号

详情（只在导入时抓一次）：解析 JSON-LD 的 `contentUrl`（通常是 720p）、`duration`（`PT0M19S`）、`thumbnailUrl`。若详情抓取或解析失败，退回列表页的 360p 变体。

**不做**列表页批量抓详情页（24 条 × 每页 = 24 倍请求），这是额度与条款上的硬边界。

### D5 翻译层独立成纯模块，术语表优先

新增 `server/stock-query.mjs`（可直接单测，不依赖 vite）：

```js
detectCjk(text) -> boolean            // /[\u4e00-\u9fff]/
lookupGlossary(text) -> string | ''   // 内置常用影视/地理/人物词条
async translateQuery({ text, settings, fetchImpl }) -> { query, translatedFrom?, via: 'none'|'glossary'|'model' }
```

顺序：**术语表 → 模型 → 失败**。术语表优先的原因：

1. 离线验收可确定（不依赖模型连通性）。
2. 影视检索里高频词就那么几十个（中国 / 长城 / 故宫 / 沙漠 / 城市夜景 / 人物特写…），命中率高。
3. 模型不可用时仍有兜底，符合「不静默返回默认结果」。

模型走项目已配置的文本模型（`/chat/completions`），prompt 只要 JSON 输出 `{"en":"…"}`；超时 5 秒，失败即降级。翻译只发生在**含 CJK 且来源不是外链**时。

缓存键用译后词；响应里回传：

```js
{ query: 'china', requestedQuery: '中国', translated: { from: '中国', to: 'china', via: 'model' } }
```

界面按 `translated` 渲染「已把『中国』译为 china」；`via: 'none'` 时不渲染任何标注。

替代方案：客户端翻译。被否——会把翻译额度与 Key 暴露到前端，且和「检索全在服务端」的既有边界冲突。

### D6 外链型来源只拼 URL，不进检索与导入

`vjshi` 适配器只有 `externalSearchUrl(query)`：

```
https://www.vjshi.com/so?wd=<encodeURIComponent(query)>   // 实测搜索页真实路由是 /so
```

无关键词时指向 `https://www.vjshi.com/`。`importStockItem` / `searchStock` 在入口按 `kind === 'link'` 直接抛 `bad-request`，双保险（服务端不信前端只给 UI 加判断）。

### D7 解析器是纯函数，0 条目要区分两种原因

```js
parseMixkitSearch(html) -> { items: RawItem[], ok: boolean }
parseMixkitDetail(html) -> { duration?, contentUrl?, thumbnailUrl? }
```

`ok` 的判定：页面里能匹配到 `item-grid__items` 容器或至少一个 `data-test-id` 骨架标记。匹配不到 → `StockError(kind: 'provider', message: '来源结构可能已变化…')`；容器在但没有条目 → 正常空结果。

验收用固定 HTML 快照（从真实响应裁剪后存 `tests/fixtures/`），因此解析器改动不会依赖外网。

### D8 额度保护放在服务端裁剪，客户端只显示

```js
const SOURCE_QUOTAS = {
  unsplash: { perPage: 20, maxPage: 5 },
  coverr: { perPage: 20, maxPage: 5 },
  mixkit: { perPage: 24, maxPage: 3 },
}
```

`searchStock` 按来源裁剪 `perPage` 与 `page` 上限；超出上限直接返回 `hasMore: false`，不再请求来源。理由：Unsplash / Coverr 的 Demo 额度是 **50 次/小时**，一次翻 10 页就能吃掉 20%。Mixkit 是我们自己抓页面，同样要收敛。

### D9 设置层只加字段，不动密钥边界

`STOCK_PROVIDER_DEFAULTS` 变成：

| id | kind | requiresKey | envKey | 默认地址 |
| --- | --- | --- | --- | --- |
| pexels | api | 是 | `PEXELS_API_KEY` | `https://api.pexels.com` |
| pixabay | api | 是 | `PIXABAY_API_KEY` | `https://pixabay.com` |
| openverse | api | 否 | `OPENVERSE_API_KEY` | `https://api.openverse.org` |
| unsplash | api | 是 | `UNSPLASH_ACCESS_KEY` | `https://api.unsplash.com` |
| coverr | api | 是 | `COVERR_API_KEY` | `https://api.coverr.co` |
| mixkit | html | 否 | — | `https://mixkit.co` |
| vjshi | link | 否 | — | `https://www.vjshi.com` |

脱敏、留空沿用、环境变量兜底的逻辑不分叉：`kind`/`requiresKey` 只影响可用性判定与设置页提示文案。`link` 型不需要 `enabled` 开关（它不产生请求），默认常显。

### D10 验收策略：三个脚本扩，不新增真实外网依赖

| 脚本 | 新增覆盖 |
| --- | --- |
| `verify-stock-api.mjs` | Unsplash/Coverr 归一化（mock JSON）、Mixkit fixture 解析、0 条目两种语义、术语表与翻译降级、`link` 来源拒绝检索与导入、perPage/page 裁剪 |
| `verify-stock-ui.mjs` | 7 个来源标签、无 Key 状态、外链按钮打开正确 URL、译词标注、切换来源清空结果、底部「加载更多」在 maxPage 消失 |
| `tests/stock.ts` | `detectCjk`、术语表命中、译词标注文案、`externalSearchUrl` 编码、`parseMixkit` 的 id/标题/变体提取 |

## Risks / Trade-offs

- **Mixkit 改版导致解析断掉** → 解析器纯函数 + 0 条目报「结构可能已变化」而不是空结果；fixture 快照让回归一改就红。
- **Mixkit 条款禁止「用脚本批量下载整个库」** → 只做显式检索、单条导入、不预取详情页；这条写进代码注释与文档，作为后续改动的红线。
- **Mixkit 720p 偶发 403** → 导入时 720 失败自动退回 360；现有的 Content-Type 与大小校验会拦掉错误响应。
- **Unsplash / Coverr Demo 额度 50 次/小时** → D8 裁剪 + 既有 10 分钟缓存 + 显式提交；额度耗尽按 `rate-limit` 提示，不伪装成空结果。
- **中文翻译质量不稳定** → 术语表优先保证高频词确定性；返回译词让用户能自己判断关键词是否被译歪。
- **把外链来源误认为「已支持」** → `kind: 'link'` 的 UI 形态与检索来源明显不同，且详情区常驻「需购买后手动上传」。
- **Coverr premium 条目** → 搜索阶段直接过滤，避免「导入才失败」。

## Migration Plan

- 无需数据库迁移：`stock_imports` 结构不变，来源 id 只是新增取值。
- 设置里的 `stock.providers` 缺省即「未启用」；升级后 Unsplash / Coverr 显示「未配置 Key」，Mixkit 直接可用，VJShi 作为外链常显。
- 回滚：移除四个适配器与翻译层调用，已导入的文件与 `stock_imports` 记录仍是普通素材，不影响画布。

## Open Questions

- 术语表要覆盖到什么规模（先做 50 条高频词，还是直接依赖模型）——不影响契约与任务拆分，可在实现时按实际命中率补。
- 是否给 Mixkit 增加「按分类浏览」而不只是关键词检索——属于后续增强，不在本期。
