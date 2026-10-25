# Proposal

## Why

3D 调度现在有两个入口：画布分镜右击菜单和右侧 Inspector。它和「写提示词、选参考、出片」不在同一条工作流里——用户要先在画布找到镜头、右击打开工作台，再回 Inspector 勾「用 3D 调度视频作参考」。而视频参考已经有更通用的素材卡与连线机制：素材选择器可以选择视频，视频素材可以连到分镜。把 3D 调度入口收进提示词工作台、把 3D 专用参考开关换成连线视频素材，可以让「生成提示词 → 3D 预演审阅 → 选视频素材 → 出片」在一条线上完成，同时删掉画布上分散的入口。

## What Changes

- 提示词工作台为每镜新增「3D 调度」入口，复用现有 Blender 3D 工作台；渲染后的 MP4 在提示词侧可预览，并作为普通本地视频出现在素材选择器的「视频」分类。
- 删除画布分镜右击菜单的「编辑 3D 调度…」「生成调度视频（3D）」「调度关键帧作参考」三个动作。
- 删除右侧 Inspector 的「3D 调度」区块、调度视频预览、`useScheduleVideoRef` / `useScheduleFrames` 开关，以及「更多」页签里的「打开 3D 调度」。
- **BREAKING** 出片参考视频改为来自分镜连线的视频素材：连线一个视频素材卡即作为 `reference_video`。不再使用镜头的 `scheduleVideo` 作为特殊参考，也不再使用调度关键帧作图片参考。
- 保留 `sceneCode`、`shot3DContext`、`scheduleVideo`、`scheduleFrames`、`motionNote` 数据；3D 调度仍按镜头保存，渲染仍走 Blender 子进程。
- 提示词工作台显示该镜的 3D 调度状态（未建 / 已渲染 / 过期）与最新渲染预览；3D 渲染只用于人工审阅，不自动判定提示词或视频，不产生 Seedance 视频成本。
- 3D 工作台从提示词侧保存时只写 3D 字段，不得覆盖提示词工作台里未保存的提示词草稿。
- 明确不做：Seedance 出片后的自动视觉验收；多视频素材参考（首期只取第一条连线视频）；3D 调度自动生成或改写提示词。

## Capabilities

### New Capabilities

（无）

### Modified Capabilities

- `scene-blocking-3d`: 3D 调度入口从画布右击与 Inspector 迁到提示词工作台；Inspector 预览与专用参考开关移除；渲染产物仍按镜保存，并可作为普通视频素材被选择。
- `shot-video-prompt`: 参考视频来源从 3D 调度开关改为分镜连线的视频素材；移除调度关键帧参考与相关矛盾提示；附件清单、模型能力提示和旧字段兼容随之调整。
- `asset-media-picker`: 3D 渲染的 MP4 在素材选择器视频分类中可见、可预览、可确认成视频素材，选择后素材类型为视频。

## Impact

- 画布：`NodeContextMenu` 删除三个 3D 动作；Inspector 删除 `schedule` 区块与打开入口；`App.tsx` 的 `editorNodeId` / `editorNode` / `saveEditor` / `applyEditorRender` 不再服务画布，改由提示词工作台持有。
- 提示词：`PromptTable` 新增 3D 调度入口、状态/预览与 3D-only 写回；需要为未上画布的镜头合成 `ShotNodeType`。
- 3D 引擎：`SceneCodeWorkbench`、`SceneAgentChat`、Blender 渲染链路不变；保存路径改为只写 3D 字段，避免和提示词草稿互相覆盖。
- 出片：`collectShotReferences` / `buildShotVideoRequest` 增加视频素材解析；`video` 槽位改由连线视频提供；删除 `useScheduleVideoRef` / `useScheduleFrames` 的请求分支、提示词图注与阻塞原因；服务端 `referenceVideos` 上限沿用现有 3 段。
- 素材：`/api/media` 已扫描 `public/videos`，预计不改接口；媒体选择器已有视频分类，需要验证渲染产物出现并可确认。
- 兼容：旧镜头的 `use_schedule_video_ref` / `use_schedule_frames` 保留字段但不再生效；旧 `scheduleVideo` 仍可播放、可被选为素材；不自动迁移成素材连线。
