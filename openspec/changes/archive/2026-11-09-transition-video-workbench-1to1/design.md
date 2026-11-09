# Design

## Context

见 `proposal.md`。当前 `TransitionPanel` 在 `gen-box` 内手写 `vp-panel`，参考在 `VideoReferenceList` 与 `tr-ref-actions` 重复展示；`transitionGen` 的 `blocking`/`warnings` 为 `string[]`；`generateTransitionVideo` 未在置 running 前消费 `bundle.blocking`；成功路径不写 prompt 元数据。分镜侧 `VideoPromptPanel` 仍在 `Inspector.tsx` 内，消费 `ShotVideoRequest` + `VideoRequestIssue[]`。

## Goals / Non-Goals

**Goals:**

- 抽取或泛化 `VideoPromptPanel`，分镜与转场共用渲染与编辑流。
- 重组 `TransitionPanel` gen-box DOM 顺序与 `Inspector` 视频 Tab 一致。
- 统一 issue 类型；生成前校验与省略 toast 对齐 `generateVideoOne`。
- 转场 `generated.video`（或等价字段）持久化 `VideoMeta`。
- 转场专有编辑收到 `InspectorSection` 式折叠「转场参考与边界」。

**Non-Goals:**

- 不复刻 `si-tabs`、画面 Tab 参考汇总、挂载已有视频、header chips（可选后续）。
- 不改变 `mergedTransitionShotReferences` 合并语义与 morph 互斥提交规则。
- 不把转场底栏 running 态改为分镜式 disabled（spec 保留取消例外）。

## Decisions

### 1. 组件边界：`OutgoingVideoPromptPanel`

**决定**：新建 `OutgoingVideoPromptPanel.tsx`（或 `VideoPromptPanel.tsx`），导出：

- `OutgoingVideoPromptPanel`：props 含 `summary` 渲染片段、`refs` 列表数据、`issues`、`effective` 文本态、`onPatchOverride`、`videoMeta`、可选 `advancedSlot`（ReactNode，用于转场折叠区）。
- 分镜 `Inspector` 传入 `buildShotVideoRequest` 结果映射。
- 转场传入 `TransitionVideoRequest` 映射 + `advancedSlot` 放排除/边界/刷新。

**备选**：仅转场调用分镜内部函数——拒绝，无法从 `Inspector` 导出 without 循环依赖。

### 2. Issue 类型上提

**决定**：在 `transitionGen.ts` 将 `blocking`/`warnings` 改为 `VideoRequestIssue[]`；字符串消息迁移为既有 code（如 `transition-boundary-missing`）或新增转场 code 表。`verify-transitions.mjs` 断言 code 存在。

**备选**：面板内适配 string——拒绝，阻碍共用组件。

### 3. gen-box 布局

**决定**：`TransitionPanel` 结构：

```
[接缝 / 建议 / 效果…]
label 画面与过渡 (+ footnote)
label 声音描述
label 成片时长（与接缝区一组或紧贴其上）
gen-box vid-box
  … 与 Inspector 11802-1280 同序 …
  OutgoingVideoPromptPanel advancedSlot={TransitionRefBoundarySection}
footer si-foot（文案对齐）
```

删除 `tr-foot` 或降为接缝区一行 `tr-note`。

### 4. `vp-refs` 首尾帧呈现

**决定**：在映射层把 `attachments`（first/last frame）转为 `vp-refs` 前缀项，标签「首帧/尾帧」，与分镜「图N」同一列表；边界路径编辑仅出现在 `advancedSlot`。

### 5. videoMeta 存储

**决定**：扩展 `TransitionGenerated.video`（或并列字段）为 `{ url, …, meta?: VideoMeta }`，成功时写入 `prompt: bundle.prompt`、`modelKey`、`createdAt`、`url`。面板 `videoMeta` 匹配逻辑复制分镜（url 一致才展示）。

### 6. 生成前 gate

**决定**：`generateTransitionVideo` 在 `writeTransition(... running)` 之前调用 `buildTransitionVideoRequest`，若 `blocking[0]` 则 `setToast` + 写 `video.error` + return（mirroring shot `vidState: error`）。

省略 toast：复用 shot 拼接逻辑为共享 helper `videoOmitToasts(request)`。

## Risks / Trade-offs

- **[Risk] 泛化面板 props 膨胀** → `advancedSlot` + 小型的 `summaryExtras` 仅转场使用，分镜 path 保持薄包装。
- **[Risk] MODIFIED spec 与旧「转场出片」折叠区内顺序」冲突** → 本 change 归档后 main spec 以 gen-box 1:1 为准；衔接只读块移入 panel 内 details（与分镜 vp-meta 同级）。
- **[Risk] 用户习惯「生成转场视频」文案** → spec 明确改为分镜文案；必要时保留 title tooltip。

## Migration Plan

1. 先改 `transitionGen` issue 类型与测试（无 UI）。
2. 抽取 `OutgoingVideoPromptPanel`；分镜改用，回归分镜出片。
3. 重组 `TransitionPanel`；删重复列表。
4. `App.tsx` gate + videoMeta。
5. 手动验收 S02 视频 Tab vs 转场生成截图对比；跑 `verify-transitions.mjs`。

回滚：保留旧 `TransitionPanel` 分支 commit，特性无数据迁移（videoMeta 为新增可选字段）。

## Open Questions

（无）
