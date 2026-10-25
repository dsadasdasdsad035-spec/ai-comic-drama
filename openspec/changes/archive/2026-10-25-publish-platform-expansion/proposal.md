# Proposal

## Why

发布台目前只声明了抖音、B 站、头条三个平台，而实际可用于视频发布的中文平台有十余个。用户在发布前必须逐个平台打开后台手工上传，发布台省下的重复劳动在平台数量一多就重新出现。

扩到多平台不是加数据行那么简单。现有模型在四处硬编码了「只有三个平台」的假设：封面比例被写死成 `9:16 | 16:9` 两个枚举值，标题只有上限没有下限也不能缺省，草稿只有「服务端草稿」一种含义，适配器执行器不支持 iframe 表单。小红书的 3:4 封面与浏览器本地草稿、快手没有独立标题、视频号的 6–16 字短标题与 iframe 表单，都会在这四处同时撞墙。所以先把模型改对，再加平台。

## What Changes

- **封面比例扩到四档**：`9:16 | 16:9 | 3:4 | 4:3`。连带更新比例排序表、发布台按目标平台筛选封面的逻辑、封面预览框的比例样式、以及发布包里的封面文件命名。
- **标题限制从单一上限改为区间**：`titleMax` 必填，`titleMin` 与 `titleOptional` 可选。视频号 6–16 字、知乎 5–50 字、百家号 9–30 字、大鱼号 5–60 字、快手无独立标题都由这条表达。预检 MUST 同时校验下限与上限。
- **草稿语义分三类**：`draftKind: 'server' | 'local' | 'none'`。小红书是浏览器本地草稿，清理浏览器数据即丢失；快手未确认有草稿。界面 MUST 按类型给出不同表述，MUST NOT 让用户以为本地草稿已存到平台。
- **适配器执行器支持切换 iframe 上下文**：视频号的发布表单在 `micro/content/post/create` 内嵌 iframe 里。
- **平台元数据自描述**：徽标缩写与徽标配色从三个写死的 id 移入平台能力表，新平台不再需要改前端组件与 CSS。
- **新增 12 个平台**：西瓜视频、小红书、快手、微信视频号、知乎、百家号、大鱼号直接进入可执行列表；微博、企鹅号、网易号、搜狐号因为没有公开的表单结构证据，落为 `manualOnly`，只提供打开后台与导出发布包。
- **BREAKING（内部结构）**：`CoverAspect` 类型从二元联合扩为四元；`limits.title` 拆成 `titleMax` / `titleMin` / `titleOptional`；`verify-publish-contract.mjs` 里 `PLATFORMS.length === 3` 的断言失效。

## Capabilities

### New Capabilities

无。

### Modified Capabilities

- `platform-publishing`: 平台能力注册的字段模型扩展（封面四比例、标题区间、草稿类型），新增平台清单与「无证据平台降级为人工」的规则，适配器执行器支持 iframe。
- `publish-workbench`: 封面选择器按目标平台比例呈现、草稿保存后的表述按 `draftKind` 区分、标题上下限的阻断文案区分「太短」与「超长」。

## Impact

- 服务端：`server/publish-platforms.mjs`（能力表扩到四比例与标题区间，新增 `badge`、`draftKind`）、`server/publish-adapters.mjs`（新适配器、`runSteps` 支持 frame）、`server/publish-preflight.mjs`（标题区间校验、草稿类型校验）、`server/publish-package.mjs`（封面文件名支持 `3x4` / `4x3`）。
- 前端：`src/publish/types.ts`（`CoverAspect` 扩为四元）、`src/publish/CoverPicker.tsx`（四档比例与提示文案）、`src/publish/PlatformBadge.tsx`（从平台表读缩写与配色）、`src/publish/publish.css`（四档封面框样式与平台徽标配色）、`src/PublishBoard.tsx`（封面比例筛选、草稿表述、标题校验文案）、`src/publish/AccountsPanel.tsx`（登录入口对新平台可见）。
- 校验脚本：`verify-publish-contract.mjs`（平台数量与字段断言）、`verify-publish-api.mjs`（新增平台的步骤表 mock 与 iframe 场景）、`verify-publish-ui.mjs`（封面四档、标题下限阻断、草稿表述）。
- 不改动：队列并发模型、任务状态机、幂等键、发布包目录结构、账号与登录机制（新平台继续复用现有的本机浏览器 profile 弹窗登录）、海外平台（YouTube / TikTok / Instagram / Facebook 走官方 OAuth 通道，属于后续独立变更）。
