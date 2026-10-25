# Proposal

## Why

成片目前只能在预览里导出为 MP4/SRT，下载后要手工到抖音、B站、头条逐个上传、重填标题与封面，且导出结果只存在于组件内存，刷新即丢。国内平台没有面向普通创作者的统一发布 API，真正的缺口是「本机账号会话 + 一次编排 + 可追踪回执」，而不是再做一个上传按钮。现在已有稳定的合成产物与任务台账，是把发布链路补齐的合适时点。

## What Changes

- 新增「发布」工作台，作为顶栏项目视图，跟随当前项目与集；内含「待发布 / 发布记录 / 平台账号」三个页签。
- 新增「成片版本」：每次导出成功写入一条可追踪的成片记录；支持导入已导出的本地 MP4，不强制重新合成。
- 新增平台目标：V1 支持抖音、B站、头条；每个平台一个默认账号，数据模型预留多账号但 UI 不暴露。
- 新增账号授权：本机 Chrome 持久化 profile，扫码或可视窗口登录，定期健康检查，登录失效明确提示。
- 新增发布编排：主文案 + 分平台覆写、9:16 / 16:9 封面、发布前预检（阻断与警告两级）、三种发布方式（保存草稿 / 立即发布 / 导出发布包）。
- 新增自动草稿：导出成功后可自动排队上传并在平台草稿箱或人工确认页停下；MUST NOT 自动点击最终发布。
- 新增发布回执：统一状态模型、逐平台时间线、只重试失败目标、任务中心 `publish` 类型与失败角标。
- **不做**：V1 不做无人值守自动公开发布、定时发布、多账号并行、平台数据回收、自动互动，也不承诺任何平台官方 API 或「防封」能力。

## Capabilities

### New Capabilities

- `publish-workbench`: 成片版本与发布编排的界面行为，覆盖成片选择/导入、主文案与分平台覆写、封面、发布前预检、发布确认、发布记录与单平台回执。
- `platform-publishing`: 平台能力注册、账号会话、执行适配器、发布状态机、幂等与单目标重试，以及导出发布包的兜底路径。

### Modified Capabilities

- `workbench-shell`: 项目视图集合从七个扩展为八个（新增「发布」），并约束发布页的上下文带、窄宽度收起与主强调操作。
- `project-context`: 项目视图枚举增加「发布」，发布配置与发布记录按项目隔离，切换项目不得串数据。

## Impact

- 新增前端：`src/PublishBoard.tsx`、`src/publish/`（成片、文案、预检、封面、状态）、`src/publish.css` 或并入 `src/theme.css`。
- 新增服务端：`server/publish.mjs`（数据层）、`server/publish-platforms.mjs`（能力注册与适配器）、`server/publish-browser.mjs`（本机 Chrome 会话与上传），配套 `.d.mts`。
- 修改前端：`src/App.tsx`（视图与导航）、`src/Preview.tsx`（导出成功入口）、`src/tasks.ts` 与 `src/TaskCenter.tsx`（发布任务）、`src/api.ts`（发布 API 类型）。
- 修改服务端：`vite.config.ts` 注册 `/api/deliverables`、`/api/publish/*` 路由；`server/db.mjs` 增加 `deliverables`、`publish_accounts`、`publish_jobs`、`publish_attempts` 表（CREATE IF NOT EXISTS，纯增量）。
- 依赖：复用已有 `playwright-core` 与本机 Chrome，不新增浏览器下载；封面裁切与媒体探测复用本机 ffmpeg。
- 数据与安全：账号 profile 落在本地忽略目录，cookie/token 不写数据库、不进日志、不上传服务器；无凭据时明确回退到发布包。
- 验证：新增 `verify-publish-contract.mjs`、`verify-publish-api.mjs`、`verify-publish-ui.mjs`；真实平台上传只做人工清单，不进自动化测试。
