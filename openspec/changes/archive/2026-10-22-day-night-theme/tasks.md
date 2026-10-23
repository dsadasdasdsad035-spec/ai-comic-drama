# Tasks

## 1. 语义 Token 与夜间基线

- [x] 1.1 在 `src/theme.css` 补齐语义 token（表面/文字/描边/强调/状态/画布/素材/阴影/focus/minimap/edge/konva），`html[data-theme="day"]` 覆盖为 Paper Studio 配色；验证：日间关键 token 计算值正确，夜间现有 token 值不变。
- [x] 1.2 清理 `theme.css` 重复段落，把 `.char-node`、`.cast-stack`、`.shot-blank`、状态色、阴影等硬编码颜色替换为语义 token；验证：夜间主要区域截图与当前版本一致，日间不再出现深色块。
- [x] 1.3 为日间核心文字/强调色补对比度检查（正文、次文字、muted、accent、按钮文字）；验证：实际背景上均 ≥ 4.5:1，`#38BDF8` 不被日间直接用作强调色。

## 2. 主题状态、启动与切换

- [x] 2.1 新增主题模块：`ThemeMode`、本地键、系统偏好解析、`THEME_COLORS`（React Flow/Konva/边色具体值）、`ThemeProvider` / `useTheme`；验证：无本地偏好时按 `prefers-color-scheme` 解析，手动值优先。
- [x] 2.2 在 `index.html` 的 module 脚本前加入主题初始化脚本，设置根元素主题标识与 `color-scheme`；验证：保存日间后刷新，DOMContentLoaded 时根主题已是日间，首帧无夜间闪烁。
- [x] 2.3 新增顶栏 `ThemeToggle`（日间/夜间两段式，文字 + CSS 图形，`aria-pressed`、键盘、focus ring、粗指针 44px 命中区）；验证：鼠标/键盘均可切换，状态可感知，窄屏标签不消失、不与顶栏操作重叠。
- [x] 2.4 用 `ThemeProvider` 包裹应用并接入持久化与系统监听；验证：切换后 `localStorage` 写入，刷新保持；存储不可用时回落系统/夜间且不阻断页面。

## 3. 画布与原生控件适配

- [x] 3.1 `App.tsx` 的 React Flow `Background` 颜色与 `MiniMap` 的 `nodeColor` / `maskColor` / 背景改为当前主题值；验证：日间背景点、迷你地图和遮罩为浅色，夜间保持原样。
- [x] 3.2 `ShotNode.tsx` 的 Konva 空画布 `fill` 与三分线/安全框 `stroke` 改为主题值；验证：日间空白分镜卡不再出现黑色底，网格可见。
- [x] 3.3 `ShotEdge.tsx` 的硬切/转场/闪回/分支关系色改为主题调色，EdgeChip 的边框与文字同步；验证：日间关系线可辨认，夜间颜色不变。
- [x] 3.4 根元素 `color-scheme` 与 Inspector/设置页原生 select、滚动条、输入控件联动；验证：日间原生控件为浅色外观，夜间为深色。

## 4. 视觉验收与文档

- [x] 4.1 新增 `verify-theme.mjs`（Playwright，临时项目库）：覆盖系统偏好、切换、`aria-pressed`、持久化、早启动主题、对比度、布局不位移、图片无滤镜、390px 标签、项目数据不变、`prefers-reduced-motion`；验证：脚本全部通过。
- [x] 4.2 更新 README 的主题说明与验证命令；验证：文档描述对应实际开关，命令可直接运行。
- [x] 4.3 运行 `npm run build`、`verify-theme.mjs`、`verify-asset-board.mjs`、`verify-project-scope.mjs`；验证：构建通过，主题与既有工作流回归通过。

## Workflow follow-up

- Archive the change after implementation and verification are complete.
