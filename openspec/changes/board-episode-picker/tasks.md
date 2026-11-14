# Tasks

## 1. 集封面与列表数据

- [x] 1.1 新增 `src/board/episodeCover.ts`：`resolveEpisodeCover`、`listBoardEpisodes(episodes, shots)`；`node verify-board-episode-picker.mjs` 内 bundle 断言封面优先级
- [x] 1.2 新增 `BoardEpisodeGrid.tsx` 卡片墙（镜数、标题、目标时长、封面懒加载）；无项目时空态

## 2. 画布两阶段（App）

- [x] 2.1 `boardPhase` 状态：左栏 `changeView('board')` 置 `episodes`；点卡片置 `canvas`+`setEpNo`；验证左栏进画布不见 `.react-flow`
- [x] 2.2 `view==='board' && phase==='episodes'` 只渲染 Grid；`canvas` 渲染现有 Flow+WorkbenchBar；刷新在 board 回落 `episodes`
- [x] 2.3 概览 `onOpenEpisode`：`setEpNo`+`boardPhase='canvas'`；验证点 E02 直达 Flow

## 3. 外壳与工具条

- [x] 3.1 `board` 视图隐藏顶栏 `EpPicker`（角色/素材仍显示）；验证 `verify-project-overview` 点集后画布行为
- [x] 3.2 `WorkbenchBar`（或画布头）加「返回集列表」：`boardPhase='episodes'`，`fitView` 可选重置；单集显示 `formatEpisodeLabel(epNo)`

## 4. 画布能力门控

- [x] 4.1 集目录屏禁用或隐藏导入、分镜 Agent、连播等仅单集能力；进入单集后恢复；验证目录屏无 `data-shots-chat`（若适用）

## 5. 样式与验收

- [x] 5.1 `theme.css` 集卡片网格样式；窄屏单列/双列断点
- [x] 5.2 `verify-board-episode-picker.mjs`：左栏双阶段 + 概览直达；`npm run build` 通过

## Workflow follow-up

- 归档前 `openspec validate board-episode-picker --strict`；可与 `canvas-episode-source` 一并归档或分次 apply。
