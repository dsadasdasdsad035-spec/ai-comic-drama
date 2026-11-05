# Proposal

## Why

在线素材库目前只接了 Pexels、Pixabay、Openverse 三个来源，而实际创作中最常用的 Unsplash、Mixkit、Coverr 不在列表里；国内用户习惯用中文关键词（例如「中国」），但 Coverr 搜「中国」返回 0 条、Mixkit 会静默回退成首页默认推荐，用户会把「无关结果」当成「搜索结果」。同时用户提到的光厂（VJShi）内容按 V 币售卖、预览带水印且搜索页被 robots 与反爬拦截，不能也不应被自动抓取。

## What Changes

- 新增三个检索来源：**Unsplash**（官方 API，需 Access Key）、**Coverr**（官方 API，需 Key）、**Mixkit**（无公开 API，按用户显式检索抓取页面并解析，零 Key 可用）。
- 新增**中文关键词自动翻译**：输入含中文时在服务端翻译成英文再检索，结果里回传原始词与译词，界面显式标注；翻译不可用时提示而不是静默返回默认结果。
- 新增**外链型来源**（VJShi 光厂）：出现在来源列表里，但不参与检索与导入，只提供按当前关键词拼好的外部搜索入口，并明确提示「需购买后手动上传」。
- 来源列表与设置页扩展为 7 个来源；新增 `kind`（API / 页面解析 / 外链）与可用性原因，让「没有 Key」「结构解析失败」「外链型不可导入」这三种状态互相区分。
- **BREAKING**（对内部契约，不影响已有用户数据）：`StockProviderId` 联合类型扩为 7 个；`/api/stock/search` 响应新增 `query` 与 `translated` 字段；`/api/stock/providers` 每项新增 `kind`。
- 不改变已有契约：导入仍然只接受服务端令牌，下载校验、去重、`stock_imports` 侧表、素材卡落点规则全部复用。

## Capabilities

### New Capabilities

（无）

### Modified Capabilities

- `stock-media-library`: 来源注册表从 3 个扩到 7 个，并把来源分成「API / 页面解析 / 外链」三类；新增中文关键词翻译与译词标注的要求；新增页面解析型来源的失败语义（解析不到条目必须报结构异常，不得报空结果）；新增外链型来源的行为边界（不可检索、不可导入）。

## Impact

- `server/stock-settings.mjs`：`STOCK_PROVIDER_DEFAULTS` 增加 `unsplash`、`mixkit`、`coverr`、`vjshi`，各自声明 `envKey`、`requiresKey`、默认地址与外链模板。
- `server/stock.mjs`：适配器注册表增加三个检索适配器与一个外链适配器；新增 HTML 解析器（纯函数，输入 HTML 字符串）；检索入口增加翻译步骤与 `translated` 字段；导入入口对 `linkOnly` 来源直接拒绝。
- 新增 `server/stock-query.mjs`（或等价模块）：中文检测、术语表兜底与模型翻译调用，纯函数便于单测。
- `src/stock/types.ts`、`src/stock/api.ts`、`src/stock/StockBrowser.tsx`：类型扩展；外链型来源渲染成「去光厂搜索」按钮；结果区显示译词标注。
- `src/settings/SettingsPage.tsx`：素材库分区自动覆盖新来源，补 Mixkit（无 Key）与 VJShi（外链说明）的提示文案。
- 测试：`verify-stock-api.mjs` 增加三个来源的 fixture 解析、翻译分支、外链拒绝导入；`verify-stock-ui.mjs` 增加外链按钮、译词标注、无 Key 状态；`tests/stock.ts` 增加中文检测与译词拼接。全部离线可跑。
- 依赖与外部系统：需要出网访问 `api.unsplash.com`、`api.coverr.co`、`mixkit.co`、`assets.mixkit.co`；Unsplash 与 Coverr 各需一个 Key（Demo 额度 50 次/小时），Mixkit 与 VJShi 不需要 Key。
