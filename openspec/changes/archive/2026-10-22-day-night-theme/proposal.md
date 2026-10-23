# Proposal

## Why

当前工作台只有一套深色主题：白天在明亮环境里看画布、卡片和 Inspector 会反光、刺眼；同时主题色既有 CSS token，也有大量硬编码深色（`theme.css` 约 42 个 hex、131 个 rgba，React 组件里约 24 个 hex），所以单纯加一组 CSS 变量会在日间模式留下黑块。需要先把颜色语义化，再提供可记忆的日间/夜间切换，让同一套工作流在两种光线下都可用。

## What Changes

- 建立语义主题 token：表面、描边、文字、强调、状态、画布、素材底、阴影、focus ring；夜间值保持现有 Cinema Dark，新增日间 **Paper Studio**（暖纸底、墨色文字、深青强调）。
- 顶栏增加「日间 / 夜间」两段式切换，带文字与太阳/月亮图形；支持键盘、可见 focus ring、`aria-pressed`，状态不只靠颜色区分。
- 首次打开跟随系统 `prefers-color-scheme`；手动切换写入本地存储，后续优先用户选择；在 React 挂载前应用主题，避免首屏闪白/闪黑。
- 设置 `data-theme` 与 `color-scheme`，让原生 select、滚动条和表单控件跟随主题。
- 把 React Flow 的背景点、MiniMap、Konva 空白画布与三分线、镜头关系边色改为主题感知；分镜图片/视频保持原色，不参与反色。
- 保留夜间主题现有视觉和布局，不更换字体、间距或组件结构。
- 增加主题验证：两套配色的对比度、切换持久化、刷新无闪烁、画布/Inspector/时间线和窄屏可用。

不包含：自动按时间切换、按项目保存主题、额外主题（高对比/护眼等）、重新设计信息架构或组件布局。

## Capabilities

### New Capabilities

- `theme-switching`: 定义夜间/日间两套语义主题、顶栏切换、系统偏好与本地持久化、无闪烁启动，以及画布/Konva/React Flow 的主题覆盖。

### Modified Capabilities

无。

## Impact

- 代码：`src/theme.css`（token 与日间覆盖）、`src/App.tsx`（主题状态/切换、React Flow 颜色）、`src/ShotNode.tsx`（Konva 空画布与网格）、`src/ShotEdge.tsx`（关系色）、`index.html`（启动前主题脚本）、新增主题模块/切换组件。
- 数据：仅新增浏览器 `localStorage` 偏好键；不改项目数据库、API 或项目内容。
- 验证：新增或扩展 Playwright/构建检查，覆盖两套主题、持久化、刷新、窄屏和对比度；现有功能回归。
- 兼容性：夜间主题视觉保持不变；未保存过偏好的用户按系统主题初始化，没有系统信号时回落夜间；项目数据和已有画布状态不受影响。
