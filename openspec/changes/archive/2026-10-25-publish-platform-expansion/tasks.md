# Tasks

## 1. 封面四档

- [x] 1.1 把 `src/publish/types.ts` 的 `CoverAspect` 扩为 `'9:16' | '16:9' | '3:4' | '4:3'`，同步 `server/publish-platforms.mjs` 的 `COVER_ASPECT_ORDER`。验证：`npx tsc --noEmit` 通过，且现有三平台的 `coverAspects` 仍落在四档内
- [x] 1.2 把 `src/publish/publish.css` 的 `.pb-cover-frame.portrait/.landscape` 换成 `data-aspect` 驱动的四档 `aspect-ratio` 规则，同步 `CoverPicker` 的类名用法。验证：四档封面框在预览里比例正确，`verify-publish-ui.mjs` 的封面断言通过
- [x] 1.3 改 `PublishBoard.tsx` 收集所需比例的过滤逻辑，去掉只认两个字面量的判断。验证：选中只要求 3:4 的平台时，封面区只出现 3:4
- [x] 1.4 确认 `server/publish-package.mjs` 的 `aspectSlug()` 能产出 `cover-3x4` / `cover-4x3` 文件名。验证：导出需要 3:4 的发布包后，包内出现 `cover-3x4.*`

## 2. 标题区间与草稿类型

- [x] 2.1 把平台 `limits` 拆为 `titleMax` / `titleMin?` / `titleOptional?` / `descriptionMax` / `tagsMax`，更新现有三平台取值与所有读取点。验证：`npx tsc --noEmit` 与 `node verify-publish-contract.mjs` 通过
- [x] 2.2 在 `server/publish-preflight.mjs` 加标题下限与缺省分支：`titleOptional` 跳过校验、低于下限报「太短」、高于上限报「超长」，两种原因使用不同 issue code。验证：构造 3 字标题分别打到下限 6 与无下限的平台，只有前者阻断且文案含"太短"
- [x] 2.3 给平台记录加 `draftKind: 'server' | 'local' | 'none'`，在预检里校验「声明可存草稿但 draftKind 为 none」的情况并阻断。验证：`verify-publish-contract.mjs` 新增断言覆盖三种组合
- [x] 2.4 让发布台按 `draftKind` 生成保存草稿回执文案（服务端/本机浏览器/不可用三种），并在选保存草稿方式时对不可用平台置灰并说明原因。验证：`verify-publish-ui.mjs` 分别断言三种文案

## 3. 徽标自描述

- [x] 3.1 给平台记录加 `badge: { text, color }`，把现有抖音/B站/头条的缩写与色值从 `PlatformBadge.tsx` 与 `publish.css` 搬进平台表。验证：平台列表、账号页、发布记录的徽标视觉与改动前一致（截图对比）
- [x] 3.2 改 `PlatformBadge` 从传入的平台对象取值，未声明时回退 id 首字母 + 通用样式；删除 `publish.css` 里 `.pb-badge.<id>` 三个色块，改为变量上色的通用规则。验证：临时造一个无 badge 的平台仍在界面上正常显示

## 4. 适配器支持 iframe

- [x] 4.1 给 `runSteps` 的步骤增加可选 `frame` 作用域，执行器在该步骤前用 `frameLocator` 定位，找不到时按 `selectors_changed` 失败。验证：`verify-publish-api.mjs` 新增一个 iframe mock 页，断言在框架内完成上传与填文案
- [x] 4.2 断言 iframe 未出现时的失败路径。验证：mock 页不渲染 iframe，任务以 `selectors_changed` 失败且阶段指向框架等待这一步

## 5. 七个可直接执行平台

- [x] 5.1 加西瓜视频（`xigua`）：16:9、标题 30、server 草稿，后台与头条同族，优先复用头条步骤表。验证：mock 页断言上传、填标题简介、存草稿三步完成且不点最终发布
- [x] 5.2 加小红书（`xiaohongshu`）：3:4 封面、标题 20、`draftKind: local`、正文为富文本可编辑区。验证：mock 页断言标题与正文写入，回执文案说明草稿在本机浏览器
- [x] 5.3 加快手（`kuaishou`）：9:16 封面、`titleOptional: true`、`draftKind: none`。验证：mock 页断言只写描述（标题并入描述前缀），预检不因标题为空阻断
- [x] 5.4 加微信视频号（`wechat-channels`）：4:3 + 3:4 双封面、短标题 6–16、表单在 iframe 内、server 草稿。验证：mock 页断言在 iframe 内完成上传与短标题填写，且先等上传完成再填文案
- [x] 5.5 加知乎（`zhihu`）：16:9、标题 5–50、`draftKind: none`（无草稿入口，自动流程只填表单）。验证：预检断言标题 4 字被阻断、5 字通过
- [x] 5.6 加百家号（`baijiahao`）：16:9、标题 9–30、`draftKind: none`。验证：预检断言 8 字标题被阻断、9 字通过
- [x] 5.7 加大鱼号（`dayu`）：16:9、标题 5–60、`draftKind: none`。验证：预检断言标题越过 60 字被阻断

## 6. 四个人工平台

- [x] 6.1 加微博、企鹅号、网易号、搜狐号为 `manualOnly`，只声明后台地址、文案限制与封面比例，不注册适配器。验证：`verify-publish-contract.mjs` 断言这四个平台不能进入自动队列、不能声明可自动保存草稿
- [x] 6.2 确认发布台对 `manualOnly` 平台只提供打开后台与导出发布包，并在文案里说明原因。验证：`verify-publish-ui.mjs` 断言这四家的保存草稿选项不可选

## 7. 校验脚本与证据

- [x] 7.1 更新 `verify-publish-contract.mjs`：平台数量断言改为按集合校验、覆盖 `limits` 新字段、`draftKind` 组合、`manualOnly` 分层、四档封面。验证：脚本通过
- [x] 7.2 更新 `verify-publish-api.mjs`：为七个新平台各加一份 mock 页与步骤断言，新增 iframe 场景。验证：脚本通过，且每个平台都有"不点最终发布"的断言
- [x] 7.3 更新 `verify-publish-ui.mjs`：四档封面呈现、标题太短/超长文案、三种草稿类型回执、900px 下平台列表不横向溢出。验证：脚本在 5299 端口 dev server 下通过
- [x] 7.4 由 `verify-publish-ui.mjs` 的「截图产出」步骤生成证据截图并断言文件存在：待发布 1440 / 1200 / 900 三档 + 待发布日间 + 平台账号夜/日，共 6 张存入 `openspec/changes/publish-platform-expansion/evidence/`。验证：截图里 15 个平台可辨识、徽标颜色与改动前三个平台一致、日夜主题实际切换（脚本断言 `data-theme`）、900px 下无横向溢出

## Workflow follow-up

- 实现与验证完成后运行 `/opsx:apply` 执行本清单，再 `openspec-sync-specs` 把两个能力的增量同步进主规格，最后 `openspec archive publish-platform-expansion`。
- 海外四个平台（YouTube / TikTok / Instagram / Facebook）另立变更，走官方 OAuth 通道，不在本次范围。
