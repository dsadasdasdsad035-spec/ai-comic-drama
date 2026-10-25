# Tasks

## 1. 布局基础与偏好

- [x] 1.1 新增 `src/inspectorLayout.ts`：实现 `clampInspectorWidth`、`loadInspectorPrefs`、`saveInspectorPrefs`、`defaultTabForShot`、`shotStatusChips`，用动态 import 验证宽度夹取、默认 tab 和 chip 推导
- [x] 1.2 在 `src/theme.css` 增加 `.shot-inspector` 固定头部/单一滚动区/固定操作栏/拖拽把手样式，确认素材卡 `.inspector` 不受影响
- [x] 1.3 在 `InspectorBody` 外层加入 `.shot-inspector` shell（header、tabs、scroll、footer 四个区域），确认素材卡仍走原 `AssetPanel` 且没有 tab

## 2. 头部、Tab 与内容归位

- [x] 2.1 实现固定头部：缩略图、镜号、稳定 ID、画面/视频/配音/提示词/原生音频状态 chip；点击 chip 切到对应 tab
- [x] 2.2 把删除移到右上角溢出菜单并加二次确认，稳定 ID 保留复制入口；验证删除只在确认后执行
- [x] 2.3 把现有 JSX 分成 `画面` / `视频` / `声音` / `更多` 四个 section：画面放镜头参数、当前画面、画面提示词、参考、出图设置、构图标注
- [x] 2.4 视频 tab 放当前视频、运动提示词、出片提示词面板、3D 调度、原生音频、出片设置和挂载视频；确认出片提示词面板仍在视频 tab
- [x] 2.5 声音 tab 放台词/音效、表演、配音、口型；确认原生音频仍留在视频 tab，口型在声音 tab
- [x] 2.6 更多 tab 放镜头 ID/场次、手工参考 URL、3D 上下文入口、孤儿状态和节点坐标；确认高级项不再占据画面主路径
- [x] 2.7 把参考编辑集中到画面 tab，并在更多 tab 保留手工 URL；确认同一组参考不会在多个 tab 重复完整编辑器
- [x] 2.8 删除重复的「配音超过镜头时长」警告，确认只渲染一条

## 3. 折叠、吸底与交互

- [x] 3.1 实现 `InspectorSection` 折叠组件并接入镜头参数、表演、3D 调度、参考、高级；确认默认折叠状态和摘要行
- [x] 3.2 把折叠状态写入偏好并在刷新后恢复；验证展开 3D 后刷新仍展开
- [x] 3.3 实现底部固定操作栏：画面=生成画面、视频=生成视频、声音=生成配音，显示费用和运行/禁用原因；确认滚动后按钮仍可见
- [x] 3.4 实现左边缘拖拽调宽 320–520px、双击复位 360px、宽度持久化；确认画布仍可平移和选中
- [x] 3.5 实现默认 tab 逻辑（有画面→视频，无画面→画面）和用户手动选择后的记忆；确认切镜头不再强制跳页
- [x] 3.6 保证四个 tab 面板挂载但非活动页隐藏，切换 tab 保留提示词草稿和表演输入；验证非活动页音视频暂停

## 4. 无障碍与兼容

- [x] 4.1 给 tab 列表补 `role="tablist"/"tab"/"tabpanel"`、`aria-selected`、`aria-controls`、roving tabIndex 和左右方向键/Home/End
- [x] 4.2 给折叠按钮、吸底操作、溢出菜单补可读标签和 focus-visible 样式；用键盘完成一次 tab 切换和折叠
- [x] 4.3 确认 `verify-video-prompt-preview.mjs` 在有画面镜头上仍能看到出片提示词面板；如默认 tab 或参考位置变化，先切到对应 tab

## 5. 验收与文档

- [x] 5.1 新增 `verify-shot-inspector.mjs`：覆盖四 tab、默认页、状态 chip、吸底操作、拖宽与持久化、折叠与持久化、草稿保留、删除确认
- [x] 5.2 在 `verify-shot-inspector.mjs` 覆盖无画面镜头默认画面页、素材卡无 tab、隐藏 tab 的媒体暂停
- [x] 5.3 更新 `verify-video-prompt-preview.mjs` 的 tab 导航，确认提示词面板、参考 URL 和手改路径仍通过
- [x] 5.4 跑 `npx tsc --noEmit`、`verify-shot-inspector.mjs`、`verify-video-prompt-preview.mjs`、`verify-video-prompt.mjs`、`verify-native-audio.mjs`，确认无回归
- [x] 5.5 在 360px 和 480px 宽度、日间/夜间各截一张 Inspector 验收图，检查无溢出、无遮挡、吸底栏可用
- [x] 5.6 更新 `README.md` 的 Inspector 使用说明为四页结构，并验证文档中的 tab 名称与界面一致

## Workflow follow-up

- 评审通过后先 `/opsx:sync` 同步 `shot-inspector-layout` 和 `shot-video-prompt`，再归档变更。
- 归档后复查主规格 Purpose 与实现是否一致，并更新证据目录。
