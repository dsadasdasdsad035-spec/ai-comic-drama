# Design

## Context

- 路由：`#/p/<proj>/board`，`view` 派生自 hash（`src/shell/nav.ts`）。
- 画布：`App.tsx` 在 `view === 'board'` 时渲染 React Flow + `WorkbenchBar`；顶栏 `EpPicker` 对 `EPISODE_VIEWS` 显示。
- 概览：`OverviewPage` 点集 → `onOpenEpisode(no)` → `setEpNo` + `changeView('board')`。
- 封面数据：`projectShots[]` 含 `keyframe`、`clip`、`episode`、`no`；项目列表 API 已有「第一张 keyframe」思路（`project-hub-sidebar-shell`）。

动机见 `proposal.md`；用户确认**左栏进画布始终先进集目录**。

## Goals / Non-Goals

**Goals:**

- `boardPhase: 'episodes' | 'canvas'`（或等价路由后缀）驱动 UI。
- 新组件 `BoardEpisodeGrid`：卡片 + `resolveEpisodeCover(ep, shots)` 纯函数。
- 单集画布保留现有 Flow/导入/Agent；目录屏轻量、不挂载 Flow。

**Non-Goals:**

- 角色/素材两阶段选集。
- 服务端新字段或缩略图生成 API。
- 替换概览分集列表（可复用封面逻辑，非本变更必须）。

## Decisions

### 1. 状态：`boardPhase` + 导航重置

**选择**：`App` 增加 `boardPhase`，默认 `'episodes'`。`changeView('board')` 从**左栏**调用时强制 `boardPhase='episodes'`。`boardPhase='canvas'` 仅在用户点集卡片或概览 `onOpenEpisode(no)` 时设置。

**备选**：仅用 hash `/board/E02` — 仍可在二次迭代加；首期 state 足够。

### 2. 概览点集

**选择**：`onOpenEpisode(no)` → `setEpNo(no)` + `boardPhase='canvas'` + `changeView('board')`（用户已在概览明示集，可跳过目录）。

**备选**：概览也先进目录 — 与用户「仅左栏方案 1」不一致，故不采用。

### 3. 封面解析 `resolveEpisodeCover(shots, epNo)`

按 `episode === epNo` 过滤 → `no` 自然排序 → 第一条：

1. 非空 `keyframe`
2. 否则非空 `clip`（UI 用 `<video preload=metadata>` 或复用 `captureVideoFirstFrame` 缓存，目录屏懒加载）
3. 否则 `null` → CSS 占位 + `缺首帧` 小字

与 `EpisodeBar`/`OverviewPage` 的集列表合并逻辑一致（`episodes` + shots 并集）。

### 4. 顶栏 `EpPicker`

**选择**：`AppShell` 传入 `showEpPicker={view in EPISODE_VIEWS && !(view==='board' && boardPhase!=='canvas')}` 或等价：`board` 时完全不显示 EpPicker（单集阶段换集走返回目录）。

简化：**整个 `board` 视图隐藏 EpPicker**；单集集号在 `WorkbenchBar` 左侧加「← 集列表」+ `E02` 标签。

### 5. 持久化

- 不新增 localStorage 键；`epNo` 仍随画布存档写入。
- `boardPhase` **不持久化**；左栏进 board 永远 `episodes`（方案 1）。
- 可选：刷新时若在 `board` 且 phase `canvas`，可保持 canvas（`epNo` 已存）— 与方案 1 冲突。**选择**：刷新在 `board` 路由也回落到集目录，除非 URL 带 `E02` 段（若实现 hash 扩展）。

首期：**刷新一律回集目录**，减少状态分叉。

### 6. 文件布局

| 文件 | 职责 |
|------|------|
| `src/board/BoardEpisodeGrid.tsx` | 卡片墙 UI |
| `src/board/episodeCover.ts` | `resolveEpisodeCover`, 排序 |
| `App.tsx` | phase 状态、条件渲染 Flow vs Grid |
| `WorkbenchBar.tsx` | 返回集列表按钮 |
| `theme.css` | `.board-ep-grid`, `.board-ep-card` |

## Risks / Trade-offs

- **[Risk] `workbench-shell` 验收脚本假设顶栏总有 EpPicker** → 画布目录阶段断言无 `.epbar-trigger`，单集阶段断言上下文带集号。
- **[Risk] 视频封面解码慢** → 卡片 lazy、优先 keyframe。
- **[Trade-off] 刷新回目录** → 用户需再点集；符合方案 1。

## Migration Plan

1. 实现 Grid + phase 开关，默认左栏进目录。
2. 调整 Overview `onOpenEpisode` 直达 canvas。
3. 隐藏 board 的 EpPicker，WorkbenchBar 加返回。
4. verify + 更新 overview 用例（左栏仍测 EpPicker 在 chars 等视图）。

## Open Questions

- 是否在 hash 增加 `#/p/x/board/E02` 以支持刷新保持单集 — 可延后，tasks 标为可选。
