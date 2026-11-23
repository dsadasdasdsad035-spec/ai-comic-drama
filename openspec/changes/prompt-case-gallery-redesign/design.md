# Design

## Context

见 `proposal.md` — Why。实现前需要知道的现状：

- 案例库样式全部在 `src/theme.css` 的单一连续区块（20442–21596，106 个 `pc-*` 类），无独立 CSS 文件、无 Tailwind（`src/promptCases/` 属原生 CSS 阵营）。
- Token 体系完整且日夜双主题：`--accent-dim` / `--accent` / `--accent-ink` 三分，`--dur-fast/base/slow` + `--ease`，`--shadow-card`，`--fs-*` 五档，`--r-*` 四档，`--sp-*` 五档。
- `.hub-card` / `.hub-card-hit`（17573–17613）是本仓库最完整的卡片范本：article 外壳 + 内层按钮 + `translateY(-2px)` hover + token 化过渡 + `focus-visible` 用 `--focus-ring`。
- 🔴 案例详情浮层**并非完全缺失**：`asset-tabs` 里「提示词案例」的 Tab 选中态这个bug也是最明显的。
- `.btn-mini` 基础类只定义透明底 + `--line-2` 边 + `--muted` 字；`.btn-mini.primary`（8 处调用）与 `.btn-mini.ghost`（45 处调用）**在样式表中不存在**。
- `--accent-ink` 语义是「实心 accent 底上的墨色」（夜间 `#04121b`），但被用作半透明 `--accent-dim` 底上的文字色，夜间对比度约 1.3:1。已做对的参照：`.lex-scope button.on`（2824）用 `color: var(--accent)`。
- `verify-prompt-cases-ui.mjs` 依赖一批 `data-*` 钩子与 `.pc-*` 类名（列表见下），改名即红。

## Goals / Non-Goals

**Goals**

- 点开任意案例时列表完全不重排（用户视线不被夺走）。
- 任何视口宽度下都不出现「详情被压成窄条」。
- 卡片一眼是「视频参考」而不是「文本条目」。
- 所有交互态（Tab 选中、分面选中、主/次按钮）有明确视觉层级，日夜两套主题都可读。

**Non-Goals**

- 不改筛选语义、分面推导、数据模型。
- 不改导入「预览 → 提交」两步流程与反推作业流程。
- 不引入 Tailwind 或新的 CSS 组织方式（继续在 `theme.css` 的 `pc-` 区块内）。
- 不抽全局 `Modal`/`Chip`/`EmptyState` 原语——那是跨模块重构，超出本次范围。

## Decisions

### D1. 覆盖式右侧抽屉取代第三列

详情改为 `position: fixed` 右侧抽屉 + backdrop，宽度 `min(520px, 100vw)`。

**为什么不是 modal**：案例详情需要与列表并读（挑一条、比一条），居中弹窗会遮住列表上下文。右侧抽屉保留左侧画廊可见，符合「画廊优先」的浏览节奏。

**代价**：抽屉盖住右侧部分卡片。可接受——关闭即恢复，且列表位置不丢失。

`pc-layout` 恢复为纯两列（侧栏 + 网格），`with-detail` 变体与 1180/1099/1100 三条与详情相关的 media query 全部删除，只保留侧栏自身的断点。

### D2. article + 内层 hit 按钮

照抄 `.hub-card` 结构。当前 `CaseCard` 根是 `<button>` 却含 `<h3>`/`<div>`/`<img>`，违反 content model；改为 `<article className="pc-card">` + `<button className="pc-card-hit">`。

**为什么不保持 button 根**：读屏与回车语义不可靠，且无法容纳后续的次级操作按钮（如卡片上的收藏）。

### D3. 卡片信息降为三层，删正文预览

结构：封面（16:9，`object-fit: cover`）→ 标题（2 行截断）→ 单行 meta（模型 · 分类 · 镜数）→ 分面 chip ≤3 + `+N`。

删除 `pc-card-preview`（90 字正文）：它是「像文本列表」的主因，且正文在详情里完整可读，列表不需要它。分面上限保持 3（`cardFacets` 默认值），因 `verify-prompt-cases-ui.mjs:94-98` 断言了这个数。

封面加视频角标（小 ▶），表达「这是视频参考」，但**不自动播放**——用户已明确选择只显示封面，避免滚动时起播与带宽开销。

### D4. 网格 228 → 268px

画廊优先意味着单卡更宽、列数更少。1600px 视口下从 4 列变 3 列，封面面积增大约 38%。

### D5. 筛选值改行式 + 占比条

每个值一行：`标签(flex:1) | 轨道条(56px) | 条数(等宽数字)`。条宽按**本轴最大值**归一化，让「这个值在这一轴里有多常见」一眼可见。

轴头加一个「全部收起/展开」，因为 18 轴全展开后侧栏比列表还长（现有实现只默认展开有数据的轴，仍需一键收拢）。

选中态：`border-left: 2px solid var(--accent)` + `color: var(--accent)`。不再用 accent-dim 填充——填充会与行式布局的条重叠，视觉变脏。

### D6. 修 token 语义而非新增 token

把 accent-dim 底上的文字色统一改为 `var(--accent)`：夜间 `#38bdf8` 在 `--panel-2` 上对比度足够，白天 `#0e7490` 同样。`--accent-ink` 只保留在**实心** accent 底上（`.btn.primary`、新的 `.btn-mini.primary`）。

**为什么不新增 `--accent-on-dim`**：那会让 token 数量继续膨胀，而 `--accent` 字色 + dim 底本来就是这个体系里已存在的正确用法（`lex-scope`）。

### D7. 补 `.btn-mini.primary/.ghost`

```css
.btn-mini.ghost { color: var(--muted); border-color: transparent; }
.btn-mini.primary { background: var(--accent); border-color: var(--accent); color: var(--accent-ink); font-weight: 600; }
```

`.ghost` 视觉近零变化（`btn-mini` 本就是透明底），`.primary` 让 8 处主动作终于有实心层级。不碰 `.btn-primary`（3 处使用、从未定义，属独立历史问题）。

### D8. 抽屉行为层抽本地 hook

新建 `src/promptCases/useOverlayChrome.ts`：Esc 关闭 + body 滚动锁 + 焦点陷阱 + 焦点归还。

**为什么不抽全局**：仓库里已有 4 处各自实现的焦点陷阱（`MediaPicker:426`、`Preview:407`、`NewProjectDialog:30`、`PromptDialog:45`），风格不一。抽公共层会牵动它们，超出本次范围。本地 hook 先让案例库做对，将来可作迁移范本。

焦点陷阱复刻 `MediaPicker.tsx:426-452` 的做法（Tab 循环、首尾 focus）。

### D9. loading 网关

`PromptCaseGrid` 增 `loading` prop；`loading && !cases.length` 时只渲染加载态。`PromptCaseTab` 把现有 `loading` 状态下传。

### D10. 视觉对齐只动 token 化的间距

导入弹窗与反推面板：padding / gap 归到 `--sp-*`，按钮用新补的变体，字号归到 `--fs-*`。**不改结构、不改 `data-*`、不改流程**。

## Risks / Trade-offs

- **抽屉遮住右侧卡片**：关闭即恢复，且列表位置不变。若用户想「边比边看」可宽屏下先记下再关。
- **删正文预览可能损失扫读线索**：标题 + 分面 chip + 模型已足够判断「要不要点开」；正文在详情里第一屏可见。
- **行式筛选比胶囊高**：18 轴×平均 5 值，全展开会很长。用「默认只展开有数据的轴 + 一键收起」控制，与现有策略一致。
- **改 `--accent-ink` 会波及 `.asset-tabs`**：这是修 bug 不是改风格——当前所有素材 Tab 的选中态在夜间几乎不可读。改后统一用 `--accent` 字色。
- **测试契约脆弱**：`verify-prompt-cases-ui.mjs` 强依赖 `data-*` 与部分类名。改版必须逐条核对保留清单，否则验收全红。

## Migration Plan

1. 纯前端改动，无数据迁移；`npm run build` 后刷新即生效。
2. 回滚：还原 `src/theme.css` 的 `pc-` 区块与 `src/promptCases/` 四个文件即可，无服务端状态。
3. 无宿主重启需求（不进 `server-build`）。

## Open Questions

无。
