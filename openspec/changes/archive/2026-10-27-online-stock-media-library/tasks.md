# Tasks

## 1. 数据、设置与验收骨架

- [x] 1.1 在 `server/db.mjs` 新增 `stock_imports` 建表语句与 `upsertStockImport`、`getStockImportByItem`、`findStockImportByUrl`、`listStockImports`，并创建 `verify-stock-api.mjs` 骨架（临时项目根、断言工具）；运行 `node verify-stock-api.mjs`，确认写入后可读、项目 A/B 记录互不可见、按站内地址可查。
- [x] 1.2 新增 `server/stock-settings.mjs`：来源配置归一化、默认关闭、官方 Base URL 兜底、`PEXELS_API_KEY` / `PIXABAY_API_KEY` / `OPENVERSE_API_KEY` 环境兜底、读取脱敏为 `hasApiKey`；在 `verify-stock-api.mjs` 增加设置单元段，覆盖空配置、环境兜底、Key 不回传。
- [x] 1.3 在 `vite.config.ts` 接入 stock 设置（归一化、保存时保留旧 Key、`withKeyStatus` 脱敏），并在 `src/api.ts` 的 `AppSettings` 增加 `stock` 类型；运行 `npx tsc --noEmit`，并在 `verify-stock-api.mjs` 增加临时 dev server 段，验证 `/api/settings` 保存后再读取只返回 `hasApiKey`。

## 2. 来源适配器与检索

- [x] 2.1 在 `server/stock.mjs` 建立来源注册表：来源 id、媒体类型、`requiresKey`、`defaultBaseUrl`、`availability()` 与 Key 解析；运行 `verify-stock-api.mjs`，确认缺 Key、未启用、Openverse 匿名可用三种状态和原因文案正确。
- [x] 2.2 实现 Pexels 适配器（图片 `/v1/search`、视频 `/videos/search`、`Authorization` 头、`large2x` 图片与 ≤1080p 视频变体选择）；用 mock 响应运行 `verify-stock-api.mjs` 的 pexels 段，核对归一化字段、作者/源页面/许可证与下载变体。
- [x] 2.3 实现 Pixabay 适配器（图片 `/api/`、视频 `/api/videos/`、`lang=zh`、`safesearch=true`、`largeImageURL` / `videos.large` 变体）；运行 `verify-stock-api.mjs` 的 pixabay 段，核对中文关键词参数与结果字段。
- [x] 2.4 实现 Openverse 适配器（`/v1/images/`、`/v1/audio/`、可选 Bearer、毫秒时长归一化、`attribution` 与署名判断、音频 `alt_files` 选择）；运行 `verify-stock-api.mjs` 的 openverse 段，核对 CC0 不要求署名、CC-BY 要求署名。
- [x] 2.5 在 `server/stock.mjs` 增加检索缓存（10 分钟、上限 200）与服务端令牌存储（30 分钟、上限 1000、最旧淘汰）；运行 `verify-stock-api.mjs`，确认重复检索不增加 mock 请求次数、命中标记 `cached`、令牌过期后导入被拒。
- [x] 2.6 注册 `GET /api/stock/providers` 与 `GET /api/stock/search`，实现参数校验（关键词至少 2 字符、类型与分页范围）和 `auth | rate-limit | network | provider | bad-request` 错误映射；用本地 mock Base URL 运行 `verify-stock-api.mjs`，确认过短关键词不请求来源、429 不被当作空结果、来源列表可用性正确。

## 3. 导入与来源元数据

- [x] 3.1 在 `server/media.mjs` 增加通用 `saveProjectMedia`（任意扩展名、确定性文件名、`.part` 临时文件后重命名）并给 `mimeOf` 补 `ogg` / `flac`；用临时目录验证写入与重命名，并在 `verify-stock-api.mjs` 验证音频 `/project-assets/` 能按 Range 播放。
- [x] 3.2 在 `server/stock.mjs` 实现导入流水线：令牌解析、变体选择、`assertPublicUrl`、120s 超时、最终重定向地址复核、Content-Type 白名单、流式大小上限（图片/音频 30MB、视频 200MB）与失败清理；用可注入 `fetchImpl` / `assertPublic` 的 mock 运行 `verify-stock-api.mjs`，覆盖成功、私网拒绝、类型不符、超限、超时后不留文件。
- [x] 3.3 注册 `POST /api/stock/import`：只接受 `{ project, token, target }`，拒绝客户端 URL/路径；成功后 upsert `stock_imports`，重复导入返回原地址并标记 `reused`，文件缺失时重新下载；运行 `verify-stock-api.mjs`，确认令牌导入成功、非法参数被拒、重复导入不新增文件、跨项目各自独立。
- [x] 3.4 注册 `GET /api/stock/meta?project=&url=`，未命中的普通素材返回 `meta: null` 而不是错误；运行 `verify-stock-api.mjs`，确认导入素材可查、生成图/手工图查不到、项目隔离。

## 4. 音频素材类型

- [x] 4.1 在 `src/data.ts` 的 `AssetKind` 增加 `audio`，在 `src/mediaPick.ts` 增加 `assetMediaType(kind, url)`、`PickSource` 的 `stock`、`PickItem.mediaType` 三态与 `pickKind` 音频规则；新增 `tests/stock.ts` 并挂到 `verify-skills-unit.mjs`，运行后确认 mp3/wav/ogg 判为音频、mp4 判为视频、普通图判为图片。
- [x] 4.2 在 `src/AssetNode.tsx` 与 `src/Inspector.tsx` 支持音频徽标、播放器与「音频来源」标签，在 `src/theme.css` 增加音频卡片样式；运行 `npx tsc --noEmit`，并在 `verify-stock-ui.mjs` 的音频段确认卡片与 Inspector 都能播放。
- [x] 4.3 在 `src/shotReferences.ts`、`src/shot3dContextCatalog.ts`、`src/App.tsx`、`src/contextManifest.ts` 把「非视频即图片」改成三态：音频不进入图片参考、视频参考、镜头图片清单，单独统计；在 `tests/stock.ts` 增加排除断言并运行 `verify-skills-unit.mjs`，确认音频卡连线后参考集合不变。
- [x] 4.4 扩展 `verify-media-picker.mjs`：在项目素材里加入音频条目，验证音频预览、确认后类型变为 `audio`、取消不写回；运行该脚本确认原有图片/视频用例仍通过。

## 5. 在线素材界面

- [x] 5.1 新增 `src/stock/types.ts`、`src/stock/api.ts`、`src/stock/stockFormat.ts`（来源/结果/错误类型、`/api/stock/*` 调用、许可标签与署名文本、尺寸/时长格式化），并创建 `verify-stock-ui.mjs` 骨架（Playwright + `page.route` 拦截 `/api/stock/*`）；运行 `npx tsc --noEmit` 与 `verify-stock-ui.mjs` 的空壳检查。
- [x] 5.2 实现 `src/stock/StockBrowser.tsx`：来源切换、媒体类型筛选、显式提交检索、分页追加并保留选中、图片/视频/音频预览、作者与许可信息、需署名提示与复制署名、缩略图失败占位、限流/鉴权/空结果状态；运行 `verify-stock-ui.mjs` 的浏览段，确认键入不请求、提交才请求、分页不丢选中。
- [x] 5.3 在 `src/MediaPicker.tsx` 增加「在线素材」页签并嵌入 `StockBrowser`（picker 模式）：在线页签隐藏本地搜索框与本地计数，导入成功后以 `source: 'stock'` 的条目走 `onConfirm`，类型按 `pickKind` 修正；运行 `verify-stock-ui.mjs` 的选择器段与 `node verify-media-picker.mjs`。
- [x] 5.4 在 `src/AssetBoard.tsx` 增加「在线素材库」入口与 library 模式落点选择（素材卡 / 场景设定 / 道具设定），在 `src/App.tsx` 增加 `onAddAssetCard` 回调创建画布素材卡；运行 `verify-stock-ui.mjs`，确认图片可生成场景设定卡、视频生成视频卡、音频生成音频卡、未选项目时导入禁用。
- [x] 5.5 在 `src/settings/SettingsPage.tsx` 增加「素材库」分区：来源启用、Key（password + 已保存占位）、Base URL、可用性徽标与检测按钮，并纳入保存 hash/baseline；运行 `verify-stock-ui.mjs` 的设置段，确认保存后重载只显示「已保存」、环境变量来源显示可用、检测只发一次最小检索。
- [x] 5.6 在 `src/Inspector.tsx` 的素材卡面板按 URL 查询 `/api/stock/meta`，显示来源、作者、许可证与源页面入口，普通素材不显示该区块；运行 `verify-stock-ui.mjs`，确认导入卡显示来源、生成图不显示。
- [x] 5.7 补齐在线浏览器的窄屏、键盘与焦点行为：390px 可滚动与可操作、Esc 关闭并归还焦点、Tab 顺序与选中状态可读、视频同一时间只播一条；运行 `verify-stock-ui.mjs` 的响应式/键盘段。

## 6. 文档与集成验收

- [x] 6.1 新增 `docs/stock-media-library.md`（来源申请 Key、环境变量、检索与导入流程、许可与署名、大小限制、限流与排障），并更新 `README.md` 与 `DEPLOY-CHECKLIST.md` 的模块说明和环境变量表；按文档里的命令逐条执行，确认命令与路径可用。
- [x] 6.2 运行 `npm run build`、`node verify-stock-api.mjs`、`node verify-stock-ui.mjs`、`node verify-media-picker.mjs`、`node verify-skills-unit.mjs`，确认全部通过且没有新增 TypeScript 错误。
- [x] 6.3 确认验收不依赖真实外网：`grep -n "api.pexels.com\|pixabay.com\|api.openverse.org" verify-stock-*.mjs tests/stock.ts` 只出现在默认地址断言或注释中，所有检索/导入请求都走本地 mock 或 `page.route` 拦截。

## Workflow follow-up

- 变更评审通过后按项目惯例归档；归档前先同步主规格（`asset-media-picker`）并确认新能力 `stock-media-library` 的 Purpose 已写入。
- 归档后复跑一次 `node verify-all.mjs stock`，确认真实仓库状态下两个新验收脚本仍可独立通过。
