# Proposal

## Why

`transition-video-shot-parity` 已在拼装层对齐双镜参考与禁用原生音频，但转场「生成」右侧仍以 `TransitionPanel` 手写 `vp-panel` 呈现：参考列表重复、分区顺序与分镜视频 Tab 不一致，且生成路径缺少 `videoMeta`、统一 blocking 类型与分镜同款生成前校验/toast。用户要求 **界面与功能 1:1** 分镜出片工作台，同时保留接缝、边界与转场级参考排除等能力。

## What Changes

- **共用出片提示词组件**：从 `Inspector.tsx` 抽出或泛化 `VideoPromptPanel`，转场生成区 MUST 使用同一组件（或同文件导出、DOM/CSS 一致），替换手写 `tr-vp` 块。
- **gen-box 结构对齐**：转场 `gen-box vid-box` 内控件顺序与分镜视频 Tab 一致（出片设置 → 预览 → 模型/分辨率 → vid-len → 原生音频禁用块 → vid-note/vid-refs → 本次出片提示词）；转场专有控件（成片时长、边界刷新、继承/排除/增补）收到 **折叠「转场参考与边界」** 或提示词面板内高级区，不在主列表重复铺开展示。
- **单一参考清单**：结构首尾帧、合并参考图/视频、省略项仅在 `vp-refs` 一处列出；移除第二套 `tr-ref-actions` 主列表（操作迁入高级折叠）。
- **功能对齐分镜**：`blocking`/`warnings` 改用与分镜相同的 issue 结构；`generateTransitionVideo` 生成前短路 blocking 并 toast 省略参考；成功出片写入 **转场 videoMeta**（当次 prompt/model/时间）；手改状态下「画面与过渡/声音描述」显示与分镜运动提示词相同的 **不生效 footnote**。
- **底栏文案与状态**：无成片时「生成视频」、有成片「重出视频」、生成中「出片中…」与 footnote 文案与分镜一致；**保留**转场生成中底栏可点「取消生成」（分镜无此项，spec 明确为转场例外）。
- **移除或收起**干扰 1:1 的 `tr-foot` 时间轴摘要至接缝区旁一行，或默认折叠，不再夹在 gen-box 与底栏之间。
- （非目标）不复制分镜 `si-tabs`/画面 Tab 参考编辑、不增加挂载已有视频、不改变双镜合并与 morph 互斥提交规则。

## Capabilities

### New Capabilities

（无）

### Modified Capabilities

- `shot-transition-video-prompt`：出片工作台 UI/交互与分镜视频 Tab 1:1；提示词面板共用组件；分区顺序与底栏文案；blocking 结构；生成前校验、videoMeta、省略 toast；转场专有参考/边界编辑的呈现方式（高级折叠，非第二列表）。

## Impact

- **前端**：`Inspector.tsx`（`VideoPromptPanel` 抽取/泛化）、`TransitionPanel.tsx`、`VideoOutgoingWorkbench.tsx`、`transitionGen.ts`（issue 类型）、`types.ts`（转场 videoMeta）、`App.tsx`（`generateTransitionVideo`）。
- **测试**：`verify-transitions.mjs` 扩展 blocking/issue 与 UI 契约；可选快照或结构探针。
- **Spec**：归档后更新 `openspec/specs/shot-transition-video-prompt/spec.md`。
