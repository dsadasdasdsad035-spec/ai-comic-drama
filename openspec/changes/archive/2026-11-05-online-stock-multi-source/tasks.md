# Tasks

## 1. 来源注册表与设置层

- [x] 1.1 在 `server/stock-settings.mjs` 的 `STOCK_PROVIDER_DEFAULTS` 增加 `kind`（`api|html|link`）字段，并为已有三个来源补 `kind: 'api'`；验证 `node verify-stock-api.mjs` 的设置段仍全绿
- [x] 1.2 注册 `unsplash` / `coverr`（`kind: 'api'`，`requiresKey: true`，envKey 分别为 `UNSPLASH_ACCESS_KEY`、`COVERR_API_KEY`）与 `mixkit`（`kind: 'html'`，`requiresKey: false`）、`vjshi`（`kind: 'link'`，`requiresKey: false`）；验证 `resolveStockProvider` 对四个新 id 都能返回默认地址且不抛错
- [x] 1.3 让 `redactStockSettings` 对无 Key 的 `html`/`link` 来源不输出「未配置 Key」类字段，并保持 Key 原文不回传；验证新增断言在 `verify-stock-api.mjs` 设置段通过
- [x] 1.4 在 `describeProviders` 里按 `kind` 输出 `searchable` / `importable`，`link` 型直接 `ok: true` 且不需要 `enabled`；验证 mock settings 下 7 个来源的可用性快照符合设计表

## 2. 中文关键词翻译

- [x] 2.1 新增 `server/stock-query.mjs`，实现 `detectCjk(text)` 与 `lookupGlossary(text)`（首批 50 条影视/地理/人物高频词）；验证 `tests/stock.ts` 中 CJK 检测与术语命中断言通过
- [x] 2.2 在 `stock-query.mjs` 实现 `translateQuery({ text, settings, fetchImpl })`：术语表优先、模型兜底、5 秒超时、失败返回 `via: 'none'`；验证注入 mock `fetchImpl` 的三个分支（命中/模型成功/超时）在单测里全绿
- [x] 2.3 在 `searchStock` 接入翻译：仅对含 CJK 且 `kind !== 'link'` 的请求翻译，缓存键改用译后词，响应追加 `requestedQuery` 与 `translated`；验证相同译词的中英文两次检索第二次命中 `cached: true`
- [x] 2.4 补充翻译失败的返回文案与降级路径（不调用默认推荐、不返回空结果假象）；验证 `verify-stock-api.mjs` 的翻译降级断言通过

## 3. Unsplash 图片来源

- [x] 3.1 实现 `unsplashAdapter.search`（`/search/photos`，`Authorization: Client-ID`，映射 `urls.raw/full/regular`、作者、`links.html`）；验证 mock JSON 归一化后的 item 字段齐全且 `variants` 非空
- [x] 3.2 在 `importStockItem` 增加 Unsplash 分支：导入前请求 `links.download_location` 取真实下载地址，失败退回 `urls.full` 且不阻断；验证 mock 下两条路径都能落盘成功
- [x] 3.3 为 Unsplash 增加额度裁剪（`perPage` 20、`page` 上限 5）与 401/429 错误映射；验证 `verify-stock-api.mjs` 中超出上限不再请求来源、429 返回 `rate-limit`

## 4. Coverr 视频来源

- [x] 4.1 实现 `coverrAdapter.search`（`/videos?query=&page=&page_size=&urls=true`，Key 走 `api_key` 参数，取 `urls.mp4_download || urls.mp4`、`poster`、`duration`、尺寸）；验证 mock 响应归一化为带 token 的 `StockItem` 列表
- [x] 4.2 过滤 `is_premium: true` 的条目并在 `hasMore`/`total` 上保持自洽；验证含 premium 的 mock 页返回的条目全部可下载
- [x] 4.3 增加 Coverr 额度裁剪与 401/429 映射；验证 `verify-stock-api.mjs` 中 Coverr 段全绿

## 5. Mixkit 页面解析来源

- [x] 5.1 从真实响应裁剪并落两个 fixture：`tests/fixtures/mixkit-search.html`、`tests/fixtures/mixkit-detail.html`；验证 fixture 能被读入且不含超大二进制
- [x] 5.2 实现 `parseMixkitSearch(html)`（id、标题、详情 slug、thumb、360 预览、4K 标记）与 `parseMixkitDetail(html)`（JSON-LD 的 `contentUrl`、`duration`、`thumbnailUrl`）；验证 fixture 解析出 ≥20 条且首条 id/标题与快照一致
- [x] 5.3 实现 `mixkitAdapter.search`（路径式 slug `/free-stock-video/<slug>/?page=`、24 条/页、`maxPage` 3；`?q=` 的 `/search/` 页会返回默认推荐，不能用于检索）；验证 mock `fetchImpl` 收到正确的 URL 编码与页码，中文词不会直接拼进 slug
- [x] 5.4 解析 0 条目时区分「容器缺失 → `kind: 'provider'` 结构变化」与「容器存在但无条目 → 正常空结果」；验证两条断言在 `verify-stock-api.mjs` 各自命中
- [x] 5.5 导入时按需抓一次详情页补 720p 与时长，720 下载失败退回 360；验证 mock 详情成功、详情失败、720 403 三种情况都以 360 或 720 成功落盘

## 6. VJShi 外链来源

- [x] 6.1 实现 `vjshiAdapter.externalSearchUrl(query)`（无词回首页，有词拼 `/so?wd=`）；验证 `tests/stock.ts` 中中英文词的编码断言通过
- [x] 6.2 在 `searchStock` 与 `importStockItem` 入口按 `kind === 'link'` 直接拒绝；验证 `verify-stock-api.mjs` 中检索与导入都返回 `bad-request` 且未发起任何 fetch

## 7. 前端来源切换与标注

- [x] 7.1 扩展 `src/stock/types.ts` 与 `src/stock/api.ts`：`StockProviderId` 七个取值、`kind/searchable/importable`、`requestedQuery/translated`；验证 `npm run build` 的 `tsc --noEmit` 通过
- [x] 7.2 `StockBrowser` 支持 `link` 型来源：渲染「去光厂搜索」按钮、无检索框与导入按钮、常驻「需购买后手动上传」提示；验证 `verify-stock-ui.mjs` 中外链按钮 href 含编码后的关键词
- [x] 7.3 结果区渲染译词标注（`translated.via !== 'none'` 时显示），切换来源时清空标注与结果；验证 `verify-stock-ui.mjs` 的标注与清空断言通过
- [x] 7.4 `hasMore` 为 false 时「加载更多」消失，`perPage` 按来源裁剪；验证 `verify-stock-ui.mjs` 在 maxPage 场景下按钮不可见

## 8. 设置页、文档与集成验收

- [x] 8.1 `SettingsPage` 素材库分区补新来源提示（Unsplash/Coverr 的 Key 申请入口、Mixkit 无需 Key、VJShi 需购买后上传）；验证 `verify-stock-ui.mjs` 的设置段能读到四个新卡片
- [x] 8.2 更新 `docs/stock-media-library.md`：来源表、翻译说明、Mixkit 抓取边界与条款红线、VJShi 外链说明、四类错误排障；验证文档里的 `node verify-*.mjs` 命令逐条可执行
- [x] 8.3 跑全量离线验收 `node verify-stock-api.mjs && node verify-stock-ui.mjs && node verify-media-picker.mjs && node verify-skills-unit.mjs`，确认全绿

## Workflow follow-up

- 在真实网络下人工确认 Mixkit 检索与导入各一次（零 Key 链路），记录耗时与失败情况。
- 拿到 Unsplash / Coverr Key 后再人工确认这两个来源的检索、翻页与导入。
- 归档变更，让规格同步到 `openspec/specs/stock-media-library/spec.md`。
