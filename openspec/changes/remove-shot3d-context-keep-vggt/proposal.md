# Proposal

## Why

3D 工作台的「参考内容」（`Shot3DContext`、七类选择器、按镜头持久化选择与媒体 brief 管线）让首次打开自动塞满分镜/素材，与「代码 + 聊天驱动调度」的方向相悖；维护成本高，且与分镜出片参考（画布连线）职责重叠。需要整块移除该能力，同时保留 VGGT 几何分析旁路（调度片只读 + 面板内摄取），且不再要求从素材库挑选视频。

## What Changes

- **BREAKING**：移除每镜 `shot_3d_context` / `shot3DContext` 的 UI、持久化写入与代码生成/聊天 manifest；旧项目加载时忽略，保存时剥离该字段。
- 移除 `Shot3DContextPicker`、`shot3dContextCatalog` 驱动的左侧参考板；工作台顶栏不再有「参考内容」折叠与沿用上一镜。
- 代码新鲜度指纹 **不再** 包含 `selectionFingerprint` / `contextFingerprint`；过期仅反映代码、渲染资产、时长与画幅。
- 3D 代码生成与 Agent 聊天 **不再** 自动注入镜头 prompt、台词、cast、分镜图、场景卡勾选等；上下文限于当前 `sceneCode`、运行元数据（镜号、时长、画幅）与用户主动输入（含聊天文字、可选会话级附件，不写回镜头）。
- **保留 VGGT**：分析源仅限 **当前镜调度片（只读）** 与 **本面板会话内摄取** 落盘的站内 MP4；**不** 打开素材选择器、**不** 写入 `shot_3d_context`；摄取成功仅加入 VGGT 下拉，可复制摘要到聊天。
- 摄取 API（`POST /api/shot-3d/ingest-reference` 或等价）保留「落盘到项目 assets」语义，与镜头调度字段解耦。
- 退役 OpenSpec 能力 `shot-3d-context`、`shot-3d-reference-ingest`（需求全部移除）；更新 `scene-blocking-3d`、`scene-agent-chat-ui`、`workbench-chat-context` 中与 3D 参考持久化相关的条款。

## Capabilities

### New Capabilities

（无）

### Modified Capabilities

- `scene-blocking-3d`：删除参考内容选择器、摄取写入 Context、媒体 brief 与选择指纹相关需求；明确 VGGT 视频源边界（调度片 + 面板摄取，无素材选择器）。
- `scene-agent-chat-ui`：3D 聊天不再投影/编辑 `shot_3d_context`；附件为会话级或纯文本，与左侧参考板脱钩。
- `workbench-chat-context`：3D 面附件去向不再是镜头持久化 context。

### Retired Capabilities（归档时从 `openspec/specs/` 移除）

- `shot-3d-context`：整块移除。
- `shot-3d-reference-ingest`：移除「加入本镜参考」；若保留摄取路由，行为归入 `scene-blocking-3d` 的 VGGT/落盘条款。

## Impact

- 前端：`SceneCodeWorkbench.tsx`、`SceneAgentChat.tsx`、`VggtGeometryPanel.tsx`、`contextManifest.ts`、`sceneCodePrepare.ts`、`sceneCodePrompt.ts`、`sceneCodeFreshness.ts`、`shotSync.ts`、`types.ts`、`api.ts`；删除或大幅收缩 `Shot3DContextPicker.tsx`、`shot3dContextCatalog.ts`、`shot3dContext.ts`。
- 服务端：`server/shot3d-ingest.mjs`（语义调整）、`vite.config.ts` 路由。
- 设置/README/docs：去掉「3D 参考板 / 参考摄取进 context」表述。
- 验收：`verify-3d-context.mjs`、`verify-shot-3d-reference-ingest.mjs` 及多个带 `shot_3d_context` fixture 的 agent/workbench 脚本需改写或退役。
