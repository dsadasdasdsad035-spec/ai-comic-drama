# Proposal

## Why

提示词案例库功能完整（真实库 24 条、18 轴 354 条分面），但浏览体验不像成品。探查确认这不是主观判断，有三个可指认的结构缺陷：

1. **点一张卡就把整个列表重排。** `.pc-layout.with-detail` 在 ≥1180px 固定占 460px 详情列；1440px 视口下列表可用宽从 896px 掉到 436px，3 列塌成 1 列。
2. **1100–1179px 布局断档。** 三列规则只在 ≥1180 生效，单列降级要到 ≤1099 才触发；这段宽度里详情被塞进 236px 第一列，渲染成窄条。
3. **主动作与普通按钮视觉等同。** `btn-mini primary`（8 处）与 `btn-mini ghost`（45 处，其中案例库 9 处）在样式表里都没有定义。收藏、保存备注、添加分面这些主操作与次要按钮长得一样。

另有两处 token 语义误用：`--accent-ink` 是「实心 accent 底上的墨色」，却被用作半透明 accent-dim 底上的文字色（夜间对比度约 1.3:1），波及所有素材 Tab 的选中态。

案例的本质是**视频参考**，界面却按文本列表组织：卡片里塞 90 字正文预览，封面只有 228px 宽且不表达「这是视频」。

## What Changes

- **详情改为覆盖式右侧抽屉**（`min(520px, 100vw)`），不再占据列表列宽。列表列数在任何宽度、任何选中状态下恒定——同时消灭上述缺陷 1 与 2。
- **卡片重做为画廊式**：封面主导（网格 `minmax(268px,1fr)`），保留标题、单行 meta、最多 3 个分面 chip；**删除 90 字正文预览**；封面加视频角标（不自动播放）。
- **卡片语义修正**：根节点从 `<button>` 改为 `<article>` + 内层 hit 按钮，与 `.hub-card` 既有范本一致。
- **筛选侧栏改行式**：每个值一行（标签 + 占比条 + 条数），轴头增加「全部收起/展开」；选中态用左边框 + accent 文字，不再用 accent-dim 填充。
- **补齐按钮词汇表**：新增 `.btn-mini.primary`（实心）与 `.btn-mini.ghost`（透明），使 53 处既有调用点获得预期层级。
- **修正 token 误用**：accent-dim 底上的文字色从 `--accent-ink` 改为 `--accent`，覆盖素材 Tab、案例来源 Tab、分面选中态等 7 处。
- **补全抽屉行为**：Esc 关闭、body 滚动锁、焦点陷阱、关闭后焦点归还、`aria-modal` + `aria-labelledby`、滑入过渡（遵守 `prefers-reduced-motion`）。
- **修加载态与空态同时出现**：首次加载期间不再同时渲染「案例库还是空的」。
- **计数徽标不再显示错误值**：未打开过 Tab 时不显示 0，改为不渲染。

不在本次范围：导入弹窗与反推面板的**流程**（只做视觉对齐）；案例数据模型、筛选语义、分面推导；侧栏从胶囊改行式之外的筛选交互（不加新的筛选维度）；不改动 `data-*` 测试钩子。

## Capabilities

### New Capabilities

无。

### Modified Capabilities

- `prompt-case-library`: 详情展示方式由「列表内并列一栏」变为「覆盖式抽屉」，并新增三条可观察行为约束（详情不改变列表布局、Esc 关闭并归还焦点、加载期间不显示空态）。

## Impact

- 样式：`src/theme.css` 的 `pc-` 区块（20442–21596）整段重写；新增两个 `btn-mini` 变体；修正 7 处 `--accent-ink` 用法。
- 组件：`src/promptCases/` 下 `PromptCaseGrid`、`FacetFilterRail`、`PromptCaseDetail`、`PromptCaseTab` 结构调整；`ImportDialog`、`ReversePanel` 仅样式对齐；新增 `useOverlayChrome.ts`。
- 容器：`src/AssetBoard.tsx` 的 `caseCount` 改为可空，清理两个死分支。
- 验收：`verify-prompt-cases-ui.mjs` 现有断言必须全绿（行为基线），并新增两条（详情不重排列表、Esc 关闭）。
- 无服务端、无数据库、无依赖变更。
