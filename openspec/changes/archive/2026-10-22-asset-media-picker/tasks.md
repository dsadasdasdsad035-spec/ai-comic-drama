# Tasks

## 1. 媒体归一化

- [x] 1.1 新增 `src/mediaPick.ts`：把 `assets/images/videos` 归一化为统一 `PickItem`，区分项目素材/项目图片/生成图片/视频；验证：用包含空 URL、重复 URL、图片和视频的 fixture 跑纯函数断言。
- [x] 1.2 实现空 URL 过滤、按 URL 去重（项目素材优先）、按 mtime 倒序，以及无标题时生成可读标题；验证：空素材不进入列表，重复 URL 只保留一条，排序稳定。
- [x] 1.3 在归一化层提供 `pickKind(item, currentKind)` 与 `pickTitle(item, currentTitle)`：视频→video、场景/道具沿用、普通图保留/回落 image；手改标题不覆盖；验证：覆盖视频、场景、图片、默认标题、手改标题五组断言。

## 2. 缩略图选择器

- [x] 2.1 新增 `MediaPicker` 弹窗：项目素材/生成图片/视频/手填地址页签、数量、搜索、空状态；验证：分类内容正确，搜索过滤，Esc/关闭可退出。
- [x] 2.2 实现图片网格：懒加载缩略图、标题/类型/尺寸/大小、选中态和大图详情；验证：图片可见，点选只更新详情，加载失败显示错误并禁用确认。
- [x] 2.3 实现视频预览：首帧/播放占位、时长、hover/聚焦静音播放、同一时间只播放一条、详情 controls；验证：悬停播放/移开暂停，切换条目不会多路同时播放，坏视频禁用确认。
- [x] 2.4 实现确认/取消、当前来源和手填 URL：点选不写回，确认才提交；取消保持原卡；当前 URL 不在库时显示可预览的「当前来源」；手填地址实时预览；验证：确认、取消、Esc、当前来源四组断言。
- [x] 2.5 加键盘与焦点管理：网格原生按钮、方向键/Enter、可见 focus、打开聚焦、关闭回到「选择素材」；验证：纯键盘完成一次选择，焦点不丢。

## 3. AssetPanel 接入与样式

- [x] 3.1 将 AssetPanel 的来源 `<select>` 替换为「选择素材」按钮，打开 MediaPicker；保留类型/标题/预览/删除逻辑；验证：按钮可打开选择器，确认后 Inspector 预览更新。
- [x] 3.2 选择确认按 `pickKind`/`pickTitle` 写回 URL、kind、title；视频自动切 video；验证：选视频后卡片和 Inspector 都按 video 渲染，场景卡换普通图仍保持场景。
- [x] 3.3 增加选择器样式：桌面网格+详情、390px 单列/全屏、图片/视频缩略图、选中/错误态；全部使用主题 token；验证：日间/夜间可读，390px 无横向溢出，确认/取消可操作。
- [x] 3.4 更新 README 的素材卡来源选择说明；验证：文档描述与实际按钮、分类和确认行为一致。

## 4. 验证与回归

- [x] 4.1 新增 `verify-media-picker.mjs`（Playwright，临时项目媒体 fixture）：覆盖四类来源、缩略图、搜索、图片/视频预览、确认/取消、自动类型/标题、空 URL、重复 URL、坏资源、键盘和 390px；验证：脚本全部通过。
- [x] 4.2 运行 `npm run build`、`verify-media-picker.mjs`、`verify-asset-board.mjs`、`verify-theme.mjs`、`verify-project-scope.mjs`；验证：构建和既有素材/主题/项目隔离回归通过。

## Workflow follow-up

- Archive the change after implementation and verification are complete.
