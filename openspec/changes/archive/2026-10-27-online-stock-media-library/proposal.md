# Proposal

## Why

现在素材只能来自项目内已生成、已上传或 3D 调度渲染的产物。想找一张真实场景参考、一段空镜视频或一段环境音，必须离开应用去外部图库下载，再回来手填地址或上传，链路是断的，也没有来源与授权记录。公开图库提供稳定的检索 API 与可商用许可，适合直接接进素材环节。

## What Changes

- 新增在线素材源适配器：Pexels（图片/视频）、Pixabay（图片/视频）、Openverse（图片/音频），统一为同一套搜索结果结构；后续接入自有素材服务只需新增 adapter。
- 新增服务端接口：来源列表、检索、导入、来源元数据查询。检索由服务端代查并做短 TTL 缓存；导入只接受服务端签发的令牌，服务端重新解析下载地址并做 SSRF、类型、大小、超时校验。
- 素材选择器新增「在线素材」来源页签：按来源与媒体类型筛选，缩略图列表、详情预览、授权信息，确认后下载到项目并写回素材卡。
- 素材页新增「在线素材库」入口：同一套浏览组件，导入时可落到项目素材卡，图片还可落到场景/道具设定卡。
- 素材类型扩展 `audio`：在线音频可下载、可预览、可管理中转；本期明确不参与镜头画面参考、不进入成片音轨。
- 设置页新增「素材库」分区：每个来源的启用开关、Key、可选 Base URL 与可用性状态；Key 只存本地设置库与环境变量，不回传前端。
- 新增 `stock_imports` 侧表保存来源、作者、许可与归属信息，避免画布素材表整表回写时丢失来源记录。
- 不包含：BGM/音效轨混音、镜头音频参考、TTS 音色样本接入、私有素材服务实现、外链热用（只下载到项目）、多来源聚合分页。

## 假设

- 首期面向公开图库，不面向公司私有素材服务；但 adapter 契约按可插拔设计，后续接自有服务不改 UI 与导入链路。
- 「场景 / 道具」不是在线图库的分类，而是导入落点：检索按图片/视频/音频组织，导入时再决定作为场景设定、道具设定还是普通素材。
- 在线素材一律下载到 `projects/<项目>/assets/`，不使用热链；项目数据与素材同生命周期。
- 音频本期只作为可预览的项目素材入库，不接入成片音轨，也不作为镜头参考。

## Capabilities

### New Capabilities

- `stock-media-library`: 在线素材来源注册、服务端检索与归一化、令牌化导入与下载校验、幂等去重、来源元数据持久化、设置与密钥边界，以及音频素材的使用边界。

### Modified Capabilities

- `asset-media-picker`: 来源分类新增「在线素材」；媒体类型预览与类型自动修正扩展到音频；音频条目可预览但不作为画面参考。

## Impact

- 服务端：新增 `server/stock.mjs`（adapter 注册表、检索归一化、缓存、令牌、下载校验）；`server/db.mjs` 新增 `stock_imports` 表与读写；`server/media.mjs` 增加通用项目媒体写入（保留原图片函数）；`vite.config.ts` 增加 `/api/stock/*` 路由、设置归一化与 `mimeOf` 音频扩展。
- 前端：新增 `src/stock/`（API、类型、共享浏览组件）；`src/MediaPicker.tsx` 增加在线页签；`src/AssetBoard.tsx` 增加在线素材库入口；`src/data.ts` / `src/mediaPick.ts` / `src/AssetNode.tsx` / `src/Inspector.tsx` 支持 `audio`；`src/App.tsx` / `src/shotReferences.ts` / `src/shot3dContextCatalog.ts` / `src/contextManifest.ts` 显式排除音频参考；`src/settings/SettingsPage.tsx` 增加素材库分区；`src/theme.css` 增加浏览与音频卡片样式。
- 数据：新增 `stock_imports` 表（按项目 + 来源 + 条目去重）；设置结构新增 `stock` 字段，旧数据缺省即全部来源关闭。
- 外部依赖：Pexels API、Pixabay API、Openverse API；均走服务端 HTTP，不新增 npm 依赖，不引入对象存储凭据。
- 文档与验收：README 增加在线素材说明；新增 `docs/stock-media-library.md`；新增 `verify-stock-api.mjs`、`verify-stock-ui.mjs`，并扩展 `verify-media-picker.mjs` 覆盖音频类型；所有验收默认不依赖真实外网（adapter 用本地 mock 与注入依赖）。
