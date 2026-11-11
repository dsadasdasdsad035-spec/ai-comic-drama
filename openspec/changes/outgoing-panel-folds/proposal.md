# Proposal

## Why

出片面板默认态需要滚动约 1.8 屏才能从提示词走到「生成视频」：分镜视频 Tab 的内容高 1455px、可视区 799px，其中「本次出片提示词」独占 698px、里面的「AI 扩写」块 231px；转场生成模式同样是 1482px / 875px。真正花钱的两个动作（一键模板渲染、生成视频）被模型选择、原生音频、挂载视频、参考明细等低频项隔开，主次不分。

同时面板内并存 4 套折叠实现（`si-section`、`vp-disclosure`、`vp-refs-disclosure`、`tr-advanced`），箭头、摘要行与状态持久化都不一致，用户无法形成「哪里能收」的稳定预期。

## What Changes

- 引入统一折叠原语：单行摘要条（标题 + 关键状态 + 箭头）+ 就地展开，折叠状态持久化到 `storyboard-inspector-v1`。
- 分镜视频 Tab 重新分区并确定默认态：出片设置（折叠）、提示词（展开）、参考与槽位（折叠）、运动提示词（折叠）。
- 「AI 扩写」从常驻区块降级为一行按钮 + 浮层；浮层内保留文本模型选择、一键模板渲染、与模型改稿、清除模板层四个元素。
- 多条 `warnings` 合并为一行可展开提示；`blocking` 永不进入折叠区。
- 转场生成模式沿用同一套折叠语言与摘要行；效果预设改为「常用 4 项 + 全部预设」两段。
- **不改动**：请求拼装结果、附件判定、计费、模板渲染与手改/旧快照逻辑、底部主 CTA 的位置与禁用条件、画布卡片与连线 chip。

## Capabilities

### New Capabilities

（无）

### Modified Capabilities

- `shot-video-prompt`: 新增面板折叠态与摘要条需求，明确默认展开项、AI 扩写浮层，以及 blocking 不可折叠。
- `shot-transition-video-prompt`: 「出片信息分区顺序」与「转场共用分镜出片提示词面板」按折叠态改写，保留既有分区内容与底栏主操作。
- `shot-transition-effect-presets`: 预设展示从单段全量改为常用 + 全部两段，目录规模与全部可达性不变。

## Impact

- `src/OutgoingVideoPromptPanel.tsx`：折叠壳、摘要行、issue 合并、AI 扩写浮层。
- `src/Inspector.tsx`：视频 Tab 分区与出片设置折叠；底栏不动。
- `src/TransitionPanel.tsx`：生成模式分区与效果预设两段。
- `src/inspectorLayout.ts`：新增折叠键、默认值与持久化归一化。
- `src/theme.css`：统一 fold 样式，收敛现有 4 套折叠外观。
- 验证：`verify-video-prompt-preview.mjs`、`verify-transitions-ui.mjs`、`verify-shot-inspector.mjs` 增加折叠态、浮层与 blocking 可见性断言。
