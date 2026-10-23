# Design

## Context

当前主题只有一套深色，定义在 `src/theme.css` 的 `:root`；`index.html` 没有主题初始化，`src/main.tsx` 直接挂载 App。CSS 里既有语义变量，也有大量硬编码颜色：约 42 个 hex、131 个 rgba；React 侧约 24 个 hex，集中在 React Flow 背景点/MiniMap、Konva 空白画布与三分线、镜头关系边和关系色。

这些颜色里有三类不能只靠 CSS 变量解决：

1. **React Flow**：`Background`、`MiniMap` 的 `nodeColor` / `maskColor` / `background` 是 JS 属性。
2. **Konva**：canvas 的 `fill` / `stroke` 不解析 CSS 变量，必须传具体颜色值；`ShotNode` 的空画布和三分线是典型。
3. **关系边**：`ShotEdge` 在 SVG 与 EdgeLabel 的 inline style 里使用关系色，需要日间版本。

同时 `theme.css` 有重复段落，日间覆盖如果直接追加，容易被后面的重复规则反超。因此这次先做 token 化整理，再加主题层。

## Goals / Non-Goals

**Goals:**

- 用一套语义 token 承载 Night 与 Day，Night 视觉不变，Day 是暖纸底而非反色。
- 顶栏切换控件清楚、可键盘操作、状态不只靠颜色。
- 首次跟随系统，手动选择持久化，启动前应用，无闪烁。
- 画布、React Flow、Konva、关系边、原生控件全部跟随主题。
- 两套主题都通过可读对比度检查，窄屏标签不消失。
- 图片/视频保持原色，主题只改 chrome。

**Non-Goals:**

- 不按时间自动切换，不做按项目保存主题，不做高对比/护眼等第三套主题。
- 不改布局、字体、间距或组件结构；不引入外部字体。
- 不对分镜图片、视频、用户标注做反色或滤镜。
- 不重构非颜色相关的样式体系。

## Decisions

### 1. 用语义 token + `data-theme` 分层，不做组件级主题覆盖

`src/theme.css` 的 `:root` 继续作为 Night 的默认值，新增 `html[data-theme="day"]` 覆盖语义 token。组件 CSS 只引用语义变量，不再自己判断主题。

核心 token：

```css
--bg, --bg-2, --panel, --panel-2
--line, --line-2
--text, --text-2, --muted
--accent, --accent-dim, --accent-ink
--ok, --warn, --danger, --*-dim
--canvas, --canvas-dot
--node-bg, --node-head, --media-bg
--shadow-pop, --focus-ring
--minimap-bg, --minimap-node, --minimap-mask
--edge-cut, --edge-transition, --edge-flashback, --edge-branch
--konva-blank, --konva-guide
```

Day 的关键值：

| Token | Night | Day |
|---|---|---|
| `--bg` | `#070B11` | `#F4F1EA` |
| `--panel` | `#0E1620` | `#FFFDF8` |
| `--canvas` | `#070B11` | `#EDE8DE` |
| `--line` | `#1D2B3A` | `#D8D0C3` |
| `--text` | `#DBE7F3` | `#1D2733` |
| `--muted` | `#7D93AB` | `#5D6B79` |
| `--accent` | `#38BDF8` | `#0E7490` |
| `--accent-ink` | `#04121B` | `#FFFFFF` |
| `--shadow-pop` | 黑色 45% | 暖棕 18% |

日间 accent 不能用 `#38BDF8`：它在浅底上约 1.9:1。`#0E7490` 在 `#FFFDF8` 上约 5.3:1；日间正文约 13.4:1、次文字约 6.7:1、muted 约 4.8:1。

**理由**：组件不需要知道主题，主题只在一处切换；Night 值原样保留，避免视觉回归。

**替代方案**：给 `.theme-day .card` 之类写两套组件规则。覆盖点多、容易漏、后续新组件会继续漏；放弃。

**替代方案**：只用 `light-dark()`。浏览器支持已较好，但还需要为 Konva/JS 提供具体值，且当前项目没有统一的 `color-scheme` 基础；先显式 `data-theme` 更可控。

### 2. 主题状态：启动前脚本 + React Context

新增 `ThemeMode = 'day' | 'night'`，本地键 `storyboard-theme`。解析顺序：

```
localStorage 有效值
  > prefers-color-scheme: light ? day : night
```

`index.html` 在 module 脚本前放一个内联脚本，读取并存值，立即设置：

```html
<html data-theme="day|night" style="color-scheme:light|dark">
```

这样首帧就是正确主题，不会先渲染 Night 再切 Day。`ThemeProvider` 读取根元素已有的 `data-theme` 作为初始 state，避免 React 首渲染和 DOM 不一致；切换时同时更新根属性、`color-scheme`、`localStorage` 和 context。

- 没有保存过偏好时，监听 `matchMedia('(prefers-color-scheme: light)')` 的变化，系统切换时跟随。
- 用户一旦手动选择，停止跟随系统，手动值优先。
- `localStorage` 异常用 try/catch 吞掉，当前会话仍可切换。

**替代方案**：只在 `main.tsx` 挂载前设置。首帧可能已经在 module 加载前画出；内联脚本更可靠。

### 3. CSS 与 JS 的颜色来源分开，但集中管理

- CSS 用 `var(--token)`。
- React Flow / Konva 用 `src/theme.ts` 导出的 `THEME_COLORS` 具体值（hex/rgba），由 `useTheme()` 取当前主题。
- `ShotEdge` 的关系色也走 `THEME_COLORS`，日间使用更深的关系色；EdgeLabel 的 border/color 同步。
- `Background color`、`MiniMap nodeColor/maskColor/background` 用当前主题值。
- `ShotNode` 的 `KRect fill` 与三分线 `stroke` 用 `konvaBlank` / `konvaGuide`。

**理由**：Konva 不能解析 CSS 变量；把 JS 需要的少量颜色集中到一个对象，避免散落在组件里。CSS 和 JS 会有少量同值重复，但都由设计 token 派生，测试会覆盖关键表面。

**替代方案**：运行时 `getComputedStyle` 读取 CSS 变量。单一来源更纯，但每次主题切换要读多个变量，且 Konva 需要在渲染前拿值；当前项目不值得增加这层运行时复杂度。

### 4. 先 token 化，再加日间覆盖

落地顺序必须是：

1. 把硬编码颜色替换为语义 token，Night 视觉不变。
2. 清理 `theme.css` 重复段落，确保同一声明只出现一次。
3. 加 `html[data-theme="day"]` 覆盖。
4. 加开关和启动脚本。

重点硬编码：

- `.char-node`（`#0f1b2a` / `#2a3d55` / `#3d81c9` / `#e6edf5` / `#7d93ab` / `#16283c` / `#5f7f9f`）。
- `.cast-stack`（白色描边、`#16283c`、`#cfe3f7`）。
- `.shot-blank`（`#0b1220` / `#131c2b`）。
- `ShotEdge` 的 cut/transition/flashback 颜色。
- `App.tsx` 的 `Background color`、`MiniMap` 三个颜色。
- `ShotNode.tsx` 的 Konva 空画布 `#0b1220` 和四条白色三分线。
- `theme.css` 里重复的 char board、sched-row、shot-still 等段落。

**理由**：如果先加日间覆盖，再慢慢清硬编码，会出现“日间模式里零散黑块”，测试也很难定位。

### 5. 切换控件放在顶栏，保留文字标签

`ThemeToggle` 放在顶栏 `spacer` 之后、任务中心/导出之前：

- `role="group"` + `aria-label="显示模式"`。
- 两个原生按钮「日间」「夜间」，各带一个小 CSS 图形（太阳/月亮），不依赖外部图标库。
- 当前项 `aria-pressed="true"`，并用背景色 + 文字色 + 边框同时区分，不做纯颜色状态。
- 视觉高度 30px；粗指针设备用媒体查询把可点击区域补到 44px。
- 顶栏变窄时保持标签，不隐藏成空白按钮；必要时整组换行。
- 切换即时生效，不弹 Toast；按钮状态就是反馈。

**理由**：两个选项比单图标循环更明确；保留文字可避免“太阳/月亮图标含义”歧义，也符合无障碍要求。

### 6. 原生控件与媒体

根元素设置 `color-scheme: dark` / `light`，让 select、滚动条、输入控件跟随主题。图片/视频/用户标注不应用 CSS filter 或反色；它们属于内容，不属于 chrome。

### 7. 验证策略

新增 `verify-theme.mjs`（Playwright，临时项目库，不调用真实模型）：

- `emulateMedia({ colorScheme: 'light' | 'dark' })` 且无本地偏好时，首屏分别是 Day/Night。
- 点击切换后检查根主题标识、`aria-pressed`、`localStorage`。
- 刷新后保持选择；`DOMContentLoaded` 时根主题已是保存值（无闪烁的早期证据）。
- 日间正文/次文字/强调色计算对比度 ≥ 4.5:1。
- 切换前后主要卡片、Inspector、时间线 `getBoundingClientRect` 不变。
- 日间下 React Flow 背景/MiniMap/Konva 容器使用日间颜色；图片 `filter` 为 none。
- 390px 宽度下切换标签仍可见，顶栏不重叠。
- 打开项目切换主题后，`GET /api/project` 的 shots/designs/assets 不变。
- `prefers-reduced-motion` 下过渡时长接近 0。
- `npm run build` 与现有 `verify-asset-board.mjs` / `verify-project-scope.mjs` 回归。

## Risks / Trade-offs

- **硬编码颜色漏改** → 先 token 化并做日间截图巡检；重点检查 Canvas、MiniMap、Konva、关系边和 `.char-node`。
- **CSS 重复段落导致覆盖失效** → 先清理重复声明，再追加日间覆盖；用 computed style 验证关键表面。
- **首屏闪烁** → 内联脚本在 module 前设置；测试在 DOMContentLoaded 读取根属性。
- **CSS/JS 颜色漂移** → JS 颜色集中在一个 `THEME_COLORS` 对象，关键表面用测试校验；不在组件里散写 hex。
- **日间强调色对比不足** → 固定使用 `#0E7490` 一类深青，不用 `#38BDF8`；在验收里计算实际对比度。
- **顶栏变挤** → 保留文字、允许换行；390px 宽度作为验收点。
- **用户期待自动按时间切换** → 明确非目标；当前只做系统偏好 + 手动记忆。
- **localStorage 不可用** → try/catch 回落系统/夜间，不阻断页面。

## Migration Plan

1. 只做 token 化，Night 视觉保持不变，跑现有构建和回归。
2. 加入 `html[data-theme="day"]`、`ThemeProvider`、启动脚本和开关。
3. 改 React Flow / Konva / 关系边颜色，跑日间视觉巡检。
4. 加 `verify-theme.mjs`，覆盖系统偏好、持久化、对比度、布局稳定和窄屏。
5. 回滚：移除开关和 day 覆盖即可回到当前 Night；没有数据库或项目数据迁移，`localStorage` 偏好残留不影响旧逻辑。
