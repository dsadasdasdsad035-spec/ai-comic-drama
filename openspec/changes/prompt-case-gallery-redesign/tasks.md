# Tasks

## 1. Token 与按钮词汇表（`src/theme.css`）

- [x] 1.1 新增 `.btn-mini.primary`（实心 `--accent` 底 + `--accent-ink` 字 + 600 字重）与 `.btn-mini.ghost`（muted 字 + 透明边）定义，位置紧邻 `.btn-mini`；在浏览器确认案例库「收藏」「添加分面」「保存备注」三处呈现实心主按钮
- [x] 1.2 把 7 处 accent-dim 底上的 `color: var(--accent-ink)` 改为 `color: var(--accent)`：`.asset-tabs > button.on`（2522）、`.pc-source-tabs > button.on`、`.pc-facet-value.on`、`.pc-selected-facets .pc-facet-chip.on`、`.pc-kind.ai`、`.pc-shot-toggle`、`.pc-status.running/.queued`；日夜两套主题下逐个核对选中态文字可读
- [x] 1.3 删除重复定义的 `.pc-check`（20869 与 21505 两处冲突，仅保留后者语义）；确认导入弹窗的勾选行布局未变

## 2. 卡片与网格

- [x] 2.1 重构 `CaseCard`：外层 `<article className="pc-card">` + 内层 `<button className="pc-card-hit">`，保留 `data-prompt-case-card` 与 `aria-pressed`；hover/focus 用 `translateY(-2px)` + `--shadow-card` + `--dur-*`（照 `.hub-card` 范本）；确认键盘 Tab 能聚焦且回车触发
- [x] 2.2 删掉卡片正文预览（`pc-card-preview` 节点与样式），meta 收成单行（模型 · 分类 · 镜数）；封面加视频角标（`has-video`，不自动播放）；确认 `verify-prompt-cases-ui.mjs:94-98` 的分面徽标 ≤3 断言仍成立
- [x] 2.3 网格改 `minmax(268px, 1fr)`、gap 16；在 1600/1280/1100/900/390 五个宽度下确认无横向滚动、封面比例稳定
- [x] 2.4 给 `PromptCaseGrid` 加 `loading` prop：`loading && !cases.length` 时只渲染加载态；`PromptCaseTab` 下传现有 loading；确认首屏不再同时出现「正在读取案例库…」与「案例库还是空的」
- [x] 2.5 重排两种空态（筛选为空 / 真空库）：文案与 `data-prompt-case-empty` 钩子不变，改成图标位 + 主次按钮的排版；确认筛选为空时仍列出单项命中数

## 3. 筛选侧栏

- [x] 3.1 `.pc-facet-value` 改行式网格（标签 flex:1 | 56px 轨道条 | 等宽条数），条宽按本轴最大值归一化；`FacetFilterRail` 计算每轴最大值并传入内联宽度
- [x] 3.2 选中态改 `border-left: 2px solid var(--accent)` + `color: var(--accent)`，去掉 accent-dim 填充；确认 `aria-pressed` 与 `disabled` 语义不变
- [x] 3.3 轴头加「全部收起 / 全部展开」按钮，与现有「默认只展开有数据的轴」并存；确认 `data-facet-axis` / `data-facet-value` 钩子全部保留
- [x] 3.4 移动端抽屉内复用同一组件，检查抽屉内行式布局不溢出（390px 宽）

## 4. 详情抽屉

- [x] 4.1 新建 `src/promptCases/useOverlayChrome.ts`：Esc 关闭 + body 滚动锁 + 焦点陷阱（复刻 `MediaPicker.tsx:426-452` 的 Tab 循环）+ 关闭后焦点归还；只服务案例库
- [x] 4.2 `PromptCaseDetail` 加抽屉壳：`pc-detail-scrim` + `pc-detail-drawer`（`role="dialog"` + `aria-modal` + `aria-labelledby` 指向标题），宽度 `min(520px, 100vw)`，滑入用 `--dur-base var(--ease)`
- [x] 4.3 `PromptCaseTab` 删除 `pc-layout.with-detail` 第三列渲染，改为在 `pc-layout` 之后条件渲染抽屉；删除 1180/1099/1100 三条与详情相关的 media query，只保留侧栏断点；确认任何宽度下详情都不再进入网格
- [x] 4.4 重排抽屉内层级：媒体 → 标题+meta → 分段区块（提示词全文 / 分类分面 / 逐镜拆解 / 备注），区块标题统一 `--fs-xs` + `--muted` + 上分隔线；区块**全部默认展开**
- [x] 4.5 动作区：`.pc-apply-actions` 吸底，`.pc-detail-actions`（收藏第一 + 删除）留头部；确认 `verify-prompt-cases-ui.mjs` 对这两处的 `.first()` 选择仍命中预期按钮

## 5. 视觉对齐（导入 / 反推）

- [x] 5.1 `pc-import-*` 与 `pc-reverse-*` 的 padding/gap/字号归到 `--sp-*` / `--fs-*`，按钮改用补齐后的 `.btn-mini.primary/.ghost`；`mp-dialog` 外壳与 `.pc-import-ok`、`.pc-tier` 类名不动
- [x] 5.2 确认导入弹窗的预览→提交两步流程与反推作业轮询行为无变化（只改视觉）

## 6. 容器清理（`src/AssetBoard.tsx`）

- [x] 6.1 `caseCount` 初始值改 `null`，未打开过 Tab 时不渲染徽标数字（不再显示错误的 0）；确认打开 Tab 后数字正确（真实库 24 条）
- [x] 6.2 删除从未置 true 的 `caseLoading` 死分支与从未递增的 `caseRefresh`；确认 `tsc --noEmit` 无未使用变量告警

## 7. 验收

- [x] 7.1 `npm run build` 通过（含 `tsc --noEmit`）
- [x] 7.2 `node verify-prompt-cases-ui.mjs` 现有断言全绿（这是改版的行为基线）
- [x] 7.3 在该脚本新增两条断言：① 打开详情后 `[data-prompt-case-card]` 数量不变；② 按 Escape 后 `[data-prompt-case-detail]` 消失
- [x] 7.4 `node verify-prompt-cases-taxonomy.mjs` 与 `node verify-skills-unit.mjs` 保持通过
- [x] 7.5 手动核对日夜两套主题的选中态对比度、抽屉动效与 `prefers-reduced-motion`、五个宽度下的布局
- [x] 7.6 视觉终审：截图画廊 / 抽屉 / 筛选栏（日夜各一组）做验收。`documents:visual-judge` 因供应商不可用无法启动，按协议改由本人逐张审图，发现并修掉三处真实缺陷（抽屉未撑满高度导致吸底条悬空、夜间遮罩对比不足、无封面占位太空洞），修后复检通过

- [x] 7.7 新增常驻脚本 `verify-prompt-cases-layout.mjs`：五宽度（1600/1280/1100/900/390）断言无横向滚动、打开详情列数与卡片数不变、抽屉撑满且不超视口；实跑全绿

## Workflow follow-up

- 归档本变更：`openspec archive prompt-case-gallery-redesign --yes`
