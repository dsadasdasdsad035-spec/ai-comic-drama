# Proposal

## Why

3D 工作台已从「顶栏 3D 调度、按镜保存」迁移到「素材 → 镜头语言 → 自定义白模、按项目条目保存」，但分镜数据层仍保留整条 3D 调度链路：每镜 `scene_code` / `schedule_video` / `shot_3d_context` 字段、参考内容选择类型、以及一套已被 UI 抛弃的旧几何模块。这些字段没有写入方，却仍在读写映射、提示词拼装和类型定义里出现，让「白模不是分镜的一部分」这件事在代码与 spec 上都说不清。

## What Changes

- **BREAKING** 删除分镜上的全部 3D 调度字段：`ShotData` / `ProjectShot` 的 `sceneCode`、`sceneCodeMeta`、`scheduleMeta`、`scheduleVideo`、`shot3DContext`、`useScheduleFrames`、`useScheduleVideoRef`、`shotScene`、`shotBlocking`、`layout`，以及 `shotSync` 的双向映射。
- **BREAKING** 删除参考内容能力：`Shot3DContext` / `Shot3DContextText` 类型与 `POST /api/project` 的 `shot_3d_context` 字段。
- 删除 legacy 几何栈：`resolveShotSchedule` / `ShotScheduleState`、`scheduleGeometry`（仅保留 `renderSize`）、`shotScene`、`scheduleAI`、`scheduleContext`、`layoutGen`，以及项目级 `sceneLayouts` 与 `SceneLayout` / `ShotScene` / `ShotBlocking` 类型。
- 删除 `promptRender` 中未使用的 `schedule` 参数与 `videoPrompt` 的几何推导运镜兜底（改为只读 `motionNote`）。
- 白模工作台改为显式条目入参（标题、时长、代码、代码元数据、视频），不再把白模伪装成 `ShotNodeType` 读取分镜字段。
- 保留：`LexiconWhiteboxSheet` 及其 `SceneCode` / `SceneCodeMeta` / `ScheduleMeta` / 过期判定、运镜库参照（`lexiconRefKey`）、VGGT 几何页签与参考片摄取。
- 旧项目不做迁移：读取时忽略上述字段，写入时不再产生。

## Capabilities

### New Capabilities

无。本次只做删除与收敛。

### Modified Capabilities

- `scene-blocking-3d`: 按镜 3D 调度的全部要求退役，能力由 `scene-code-runtime` + 镜头语言白模承接。
- `shot-3d-context`: 参考内容选择能力整体退役。
- `scene-code-runtime`: 代码归属从「每个镜头」改为「镜头语言白模条目」，渲染与过期规则不变。
- `shot-3d-reference-ingest`: 摄取入口从 3D 调度工作台迁到白模工作台「几何」页签，且不再写入任何镜头字段或 `Shot3DContext` 草稿。
- `asset-media-picker`: 可作为素材的渲染视频从「3D 调度渲染」改为「白模/镜头语言渲染」。
- `workbench-shell`: 移除 3D 调度视图与它的镜选择器要求。
- `workbench-chat-clear`: 白模聊天线程键从「项目 + 镜头」改为「项目 + 白模条目」。
- `shot-video-prompt`: 出片前阻止原因与附件清单不再涉及 3D 调度过期、调度视频或调度关键帧。

## Impact

- **前端**：`types.ts`、`api.ts`、`shotSync.ts`、`App.tsx`、`SceneCodeWorkbench.tsx`、`LexiconWhiteboxStudio.tsx`、`lexiconWhitebox.ts`、`AssetBoard.tsx`、`promptRender.ts`、`videoPrompt.ts`、`chat-ui` / `agent` 线程键。
- **删除模块**：`scheduleStatus.ts`、`scheduleGeometry.ts`（拆出 `renderSize`）、`shotScene.ts`、`scheduleAI.ts`、`scheduleContext.ts`、`layoutGen.ts`。
- **服务端**：`shot_3d_context` 不再接受；旧列保留但不再读取。无数据库结构变更。
- **验收脚本**：删除依赖已移除模块的脚本，保留 VGGT 摄取脚本。
- **无迁移成本**：旧项目数据留在库中但被忽略，不阻塞打开。
