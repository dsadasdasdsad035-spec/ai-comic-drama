# Design

## Context

- 目标组件：`src/OutgoingVideoPromptPanel.tsx`（分镜视频 Tab 与转场生成模式共用）、`src/Inspector.tsx` 视频 Tab 的 `gen-box vid-box`、`src/TransitionPanel.tsx` 的生成区与效果区。
- 现状高度（360px 宽、可视区 799px）：分镜视频 Tab 内容 1455px，其中提示词面板 698px、AI 扩写 231px；转场生成 1482px / 875px；转场效果模式 31 个预设按钮占 367px。
- 现有 4 套折叠实现：`si-section`（`details` + `InspectorPrefs.collapsed`）、`vp-disclosure`（按钮 + `data-open` + 本地 `useState`）、`vp-refs-disclosure`（原生 `details` + `onToggle` 同步）、`tr-advanced`（原生 `details` + 本地 `open`）。`Inspector.tsx` 里已有注释说明原生 `details` 状态与 React 状态会打架。
- 折叠偏好已持久化在 `storyboard-inspector-v1`（`src/inspectorLayout.ts`），带 `normalizePrefs` 容错，可直接扩展新键。
- 转场 spec 要求两处面板共用同一组件与 DOM 类名（`vp-panel` / `vp-summary` / `vp-refs` / `vp-issue` / `vp-text` / `vp-meta`），因此本次只改折叠外壳与区块编排，不改这些类名与 props 契约。

## Goals / Non-Goals

**Goals:**

- 一个折叠原语同时服务四个使用点，折叠后的摘要行能独立表达状态。
- 分镜视频 Tab 默认态把「提示词 → 生成视频」压缩到一屏内。
- 转场生成与效果模式沿用同一套视觉与交互，不出现第二套折叠。
- 折叠状态可持久化；阻断项永不因折叠而消失。

**Non-Goals:**

- 不改请求拼装、附件判定、计费、模板渲染、手改/旧快照逻辑。
- 不动底部主 CTA 的位置、文案与禁用条件。
- 不动画布卡片、连线 chip、顶部工具条。
- 不重做面板的窄屏断点或拖拽改宽逻辑。

## Decisions

### D1：新增受控 `Fold` 原语，替换四种折叠外观

采用一个受控组件：`open` 由外层状态决定，`onToggle` 写回；`button` 带 `aria-expanded` 与 `aria-controls`，标题行右侧放摘要与箭头。不使用原生 `details`，因为摘要行内容随状态变化，且原生 `open` 与 React 状态同步已在现有代码中留下坑。

被替代的形态：

| 旧实现 | 新形态 |
|---|---|
| `si-section` | 保留 `details` 语义的对外类名，内部换成 `Fold` |
| `vp-disclosure` | `Fold` + `data-open` 继续输出，保持测试选择器可用 |
| `vp-refs-disclosure` / `tr-advanced` | `Fold`，不再各自处理 `onToggle` |

备选：Radix Collapsible（依赖已在 `package.json`）。放弃原因是每个实例都要额外的 Provider 与动画协调，收益不足以抵消改动面；纯 CSS 折叠 + `aria-expanded` 已满足可访问性。

### D2：折叠键与默认值

在 `InspectorPrefs.collapsed` 增加两个键：

- `videoSettings`：默认 `true`（折叠）
- `motionPrompt`：默认 `true`（折叠）

`提示词` 面板默认展开，`参考与槽位` 改为默认折叠（原先「条目 ≤4 自动展开」在窄屏会把一屏占满）。`normalizePrefs` 对缺失键回落默认值，旧 localStorage 无需迁移。转场的「参考与边界」维持组件内状态，不跨边记忆。

备选：把所有折叠都塞进一个 `foldedSections: string[]`。放弃原因是现有 `CollapsibleSection` 联合类型已被多处引用，改成数组会扩散改动。

### D3：AI 扩写改为锚定浮层

入口是提示词摘要行内的一个 `AI 扩写` 按钮，浮层用 `position: fixed` 按入口的 `getBoundingClientRect()` 定位，宽度取面板宽度减内边距，`max-height: 60vh` 内部滚动。打开时监听 `pointerdown`（外部关闭）与 `Esc`，关闭后把焦点交回入口按钮。不做焦点陷阱，因为它不是模态对话框。

备选：做 Portal + Radix Popover。放弃原因是首期没有嵌套弹层与碰撞翻转的强需求，`fixed` + 手动定位足够，且能避免在拖动改宽时重新挂载。

### D4：issue 分层呈现

- `blocking`：常驻在提示词区顶部，逐条渲染（现有 `gen-error`），不进入任何折叠；即使提示词区被折叠，也在摘要行下方保留一行可见提示。
- `warnings`：默认合并为一行「N 条提示」，展开后逐条渲染 `gen-warn`。

理由：`blocking` 会禁用底部主按钮，用户必须能立刻看到原因；`warnings` 数量可能到 3 条、占 100px 以上，适合合并。

### D5：效果预设两段式，白名单固定

常用段固定为 4 项：叠化、黑场淡出、白场淡入、推移。其余按 `transitionPresets` 现有分组收进「全部预设」折叠区。`presetId`、`xfade` 映射与 `transitionOut.effect` 持久化都不变。

备选：按最近使用排序常用段。放弃原因是引入新持久化状态、结果不可预测，测试也难以固定断言。固定白名单可测试、可解释。

### D6：类名与测试契约保持

新增 `fold`、`fold-head`、`fold-title`、`fold-meta`、`fold-chevron`、`fold-body` 六个类；`vp-panel` / `vp-summary` / `vp-refs` / `vp-issue` / `vp-text` / `vp-meta` / `data-video-prompt-panel` / `data-open` 继续输出。现有验证脚本依赖的选择器不失效。

### D7：高度验收改用「同屏可见」而不是 scrollHeight 比值

spec 的真实要求是「提示词正文与底部主按钮同时可见，不滚动即可从提示词走到生成」。最初的 `scrollHeight / clientHeight < 1.1` 是个二手指标，在 360×800 下被成片预览的固有高度（16:9 视频约 184px）撑破：即使把折叠做到极致，正文区仍是 596 / 448 = 1.33。

压缩预览或改窄屏断点都超出本 change 的 Non-Goals（不动主 CTA、不重做窄屏断点）。因此验收改为两条可解释的断言：

- 360×800 下 `[data-video-prompt-text]` 与底部主按钮同时位于视口内；
- 打开/关闭 AI 扩写浮层前后，`.vp-panel` 高度不变（不产生跳动）。

## Risks / Trade-offs

- [默认折叠出片设置会让用户找不到模型/分辨率] → 摘要行必须固定展示「模型 · 分辨率 · 秒数 · 估价」，整行可点击展开，且模型切换后摘要即时更新。
- [折叠导致告警被忽略] → `blocking` 常驻；`warnings` 计数行在折叠态也显示。
- [浮层被面板滚动容器裁切] → 用 `fixed` 定位并在滚动/改宽时关闭浮层，避免半截浮层。
- [预设两段式藏得太深] → 常用段固定 4 项覆盖高频场景；「全部预设」折叠区保留原分组标题，展开后位置不跳。
- [共用组件改动同时影响分镜与转场] → 两条路径的验证脚本必须一起跑；DOM 类名不变以保证断言。
- [高度目标变成脆弱的像素断言] → 只断言「正文与主按钮同屏」与「开关浮层不改正文高度」，不断言具体像素；不再用 `scrollHeight / clientHeight` 比值（成片预览的固有高度会让它恒大于 1）。

## Migration Plan

无数据迁移。旧 `storyboard-inspector-v1` 通过 `normalizePrefs` 补齐新键；转场边界与提示词配置不受影响。回滚只需还原 `OutgoingVideoPromptPanel.tsx`、`Inspector.tsx`、`TransitionPanel.tsx`、`inspectorLayout.ts` 与样式改动，不动项目数据。

## Open Questions

无。
