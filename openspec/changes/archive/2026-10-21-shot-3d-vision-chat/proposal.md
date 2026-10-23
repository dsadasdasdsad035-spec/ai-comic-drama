# Proposal

## Why

当前 3D 调度虽然已有场景/走位数据和编辑器，但生成链路只吃文本：分镜首帧、角色图、场景卡和道具图只放在编辑器里供人看，没有进入模型；用户还要打开编辑器、分别触发两次 AI、保存、再渲染。实际要的是**每镜自己的 3D 空间**，由当前分镜的提示词、参考图和全部资源动态生成，并通过聊天持续修改，而不是让用户先搭空间再调数值。

## What Changes

- **BREAKING**：3D 空间归属从“按集/场次共享”改为“每镜独立”。每个镜头拥有自己的 `shotScene`（墙、门、固定物、分区、轴线、尺寸）；修改 S01 不再影响 S02。现有场次布局只作为迁移来源。
- 每镜默认以**同集同场上一镜的 shotScene 作为空间种子**，再结合当前首帧和本镜资源修改；没有上一镜时才从场景卡/场次文本生成。生成后与上一镜做结构性差异检查，差异大只警告，不阻断。
- 新增视觉输入：把当前帧、场景卡、出场角色、关联道具合成一张带标签的**参考板**，由视觉模型输出 `VisualBrief`（2D 位置、遮挡、可见墙门、景别/机位线索）；文本/几何模型再把 brief + 全部文本资源映射成 `ShotScene + ShotBlocking`。视觉模型不直接输出米制坐标。
- 当前分镜的完整资源进入生成编排：`prompt`、`videoPrompt`、台词、说话人、`cast`、景别、运镜、秒数、标注、首帧/候选、角色设定、场景/道具设定、关联素材。图片按资源指纹缓存，避免重复视觉调用。
- 新增**一键生成**：打开 3D 编辑器时，如果本镜还没有 shotScene/blocking，自动走“参考板 -> 视觉 brief -> 场景与走位 -> 校验 -> 预览”；有结果则直接展示。渲染仍是显式动作，避免自动消耗视频额度。
- 新增**聊天改 3D**：编辑器右侧聊天面板，用户用自然语言改当前镜的空间/机位/走位。模型只返回受限的 3D patch（set_camera/move_actor/move_wall/regenerate 等），客户端校验后应用并进入撤销栈；聊天不改其他镜头。
- 新增视觉模型能力：模型表增加 `vision` 能力/环节；文本代理支持图片内容或新增视觉接口；本地图片按尺寸/数量限制转 data URL。没有视觉模型时回退为文本-only，并明确提示参考图未参与推理。
- 语义清理：已归档的 `scene-blocking-3d` 中的“同场共享布局”“参考图只作人工对照”由本变更的 delta 删除；主 spec 只保留每镜独立、视觉 brief 和聊天编辑语义。
- 不包含：单图精确深度重建、人脸识别、骨骼/口型动画、复杂群演编排、多人协同聊天、云端渲染队列、自动替用户消耗视频额度。

## Capabilities

### New Capabilities

无。

### Modified Capabilities

- `scene-blocking-3d`: 把场次共享布局改为每镜独立的 ShotScene；把参考图从人工对照改为参考板/视觉 brief；加入上一镜种子、连续性检查、一键生成、完整分镜资源编排和聊天 patch。

## Impact

- 数据：镜头新增 `shot_scene`、`shot_scene_seed`、`visual_brief`、`visual_brief_meta`；`sceneLayouts` 退为迁移/模板来源；旧场次布局按镜头复制或首次打开时懒复制。`scheduleMeta` 指纹改为基于本镜 shotScene。
- 代码：`src/types.ts`、`src/api.ts`、`src/shotSync.ts`、`server/db.mjs`、`src/App.tsx`、`src/Inspector.tsx`、`src/SceneScheduleEditor.tsx`、`src/scheduleContext.ts`、`src/scheduleAI.ts`、`src/scheduleGeometry.ts`、`src/schedule3d.ts`；新增参考板、视觉 brief、3D 聊天 patch/校验模块。
- 服务端：`vite.config.ts` 的 `/api/text` 增加图片内容或新增 `/api/vision`；图片读取、缩放、data URL 转换、尺寸/数量/超时限制；模型选择支持 `vision` 能力。
- 设置：新增视觉模型环节与能力标记；3D 生成/聊天可继续复用现有镜头表模型，或单独绑定 3D 推理模型。
- 依赖：需要确认实际支持图像输入的方舟/第三方视觉模型；不新增对象存储。参考图仍只从项目媒体目录和本地生成物读取。
- 验证：新增每镜隔离/继承/差异警告、参考板与视觉 brief（mock 视觉接口）、完整资源请求、一键生成、聊天 patch/撤销/非法拒绝、旧项目迁移、无视觉模型回退；保留现有 POV/审阅/过期/视频参考回归。
- 顺序风险：`scene-blocking-3d` 当前 44/44 但未归档。实施/归档本变更前，必须先归档它并在 main spec 上做 REMOVED/MODIFIED，或显式废弃该变更；否则“场次共享”和“每镜独立”会同时存在于规格中。
