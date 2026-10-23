# Design

## Context

当前 3D 链路（`scene-blocking-3d`，已归档）只有文本输入：

- `SceneLayout` 以 `E01-SC02` 为键，`sceneLayouts` 由同场镜头共享；
- `scheduleContext.ts` 明确只拼文本，参考图只在编辑器抽屉里展示；
- `/api/text` 的 message content 是字符串，模型表没有 `vision` 能力；
- 用户需要分别触发“AI 生成空间”“AI 生成走位”，再保存、渲染。

本变更要改成每镜独立空间，并加入参考板视觉理解、继承上一镜、连续性检查、一键生成和聊天 patch。参考 `proposal.md` 的动机和 `specs/scene-blocking-3d/spec.md` 的行为约束；这里只说明实现选择。

**顺序前提**：`scene-blocking-3d` 已归档到主 spec。本 change 的 spec 已重组为对它的 REMOVED/MODIFIED/ADDED delta；实施前先完成 0.1，确认主 spec 只保留每镜独立语义，不能同时把“场次共享”和“每镜独立”留在生效规格里。

## Goals / Non-Goals

**Goals:**

- 每镜一份可独立编辑、渲染和过期的 3D 空间；同场上一镜作为默认空间种子。
- 用当前帧 + 场景卡 + 角色/道具图 + 全部分镜文本生成；视觉只提供感知锚点，几何仍走校验。
- 打开编辑器即可自动准备结果；用户只用一个“生成 3D 预演”和聊天即可完成常见修改。
- 聊天修改受限、可撤销、可解释，绝不静默改其他镜头。
- 旧项目可迁移，旧视频可播放，旧场次布局不删除。

**Non-Goals:**

- 不做单张图精确深度重建、3D 摄影测量或人脸识别。
- 不做照片级材质、骨骼/口型动画、复杂群演和打斗编排。
- 不做自动视频消费、云端渲染队列、多人协同或聊天历史跨项目共享。
- 不改变干净 POV / 审阅 / Seedance 视频参考的协议；只改变 3D 数据来源和编辑方式。

## Decisions

### 1. `ShotScene` 归属镜头，存进镜头 extra

沿用现有 `SceneLayout` 形状，但语义变为镜头私有：

```ts
type ShotScene = SceneLayout & {
  /** 当前镜头的稳定 shot.id；作为 E01-S01 空间键 */
  id: string
  /** 来源：ai / manual / legacy / fallback */
  source: 'ai' | 'manual' | 'legacy' | 'fallback'
  /** 从哪个镜头继承（可空） */
  seedFrom?: string
}
```

- `ShotData.shotScene?: ShotScene`，`ProjectShot.shot_scene?: ShotScene`，走 `shots.extra`，不新增表。
- `sceneNo` 继续保存，只用于剧本上下文、上一镜查找和 UI 分组，不再作为 `sceneLayouts` 的共享键。
- `sceneLayouts` 表保留为旧数据/模板来源；新编辑器不再写共享布局。
- 选择 shot extra 而不是新表：空间永远和镜头一起读写、一起删除；JSON 约 5~15KB，在现有 `extra` 承受范围内。新表会多一次 join 和一套生命周期。

### 2. 旧场次布局按镜头懒复制

- 读取项目时，如果镜头没有 `shot_scene` 但有同集同场的旧 `sceneLayouts`，在首次打开 3D 编辑器/快捷渲染时复制一份 `ShotScene`：
  - `id = shot.id`
  - `source = 'legacy'`
  - `seedFrom = undefined`
- 不在一开始批量写库，避免打开项目就重写所有镜头；用户保存/渲染时再持久化。
- 多个镜头从同一场布局复制后是独立对象；修改一个不传播。
- 旧 `sceneLayouts` 不删除；迁移失败不阻塞项目读取。

### 3. 同场上一镜作为默认种子

新增 `previousShotFor(project, shot)`：

- 只在同一 `episode + sceneNo` 内查找；
- 优先取镜头顺序上最近的前一镜；
- 如果前一镜没有 `shotScene`，继续向前找，直到找到有空间的一镜；
- 没有则返回 undefined。

生成时：

- 把上一镜 `ShotScene` 作为 `seedScene` 放进提示词，要求“保留未被当前画面否定的墙体/门洞/固定物，只修改当前画面可见部分和机位”；
- 结果不直接复用上一镜对象，必须写当前镜头自己的副本；
- `seedFrom` 记录来源镜头 ID，UI 显示“继承自 S01”。

**为什么不是完全从零：** 每镜从零生成时，AI 会根据单帧重新猜墙门，剪辑时空间会漂移。种子 + 连续性检查能保留“每镜独立”的所有权，同时减少无意义的漂移。

### 4. 相邻镜结构差异检查

保存/生成后比较当前镜头与同场上一镜：

- 场地尺寸差异 > 15%；
- 墙数量变化，或墙中点/角度超过 0.5 米 / 10°；
- 门洞沿墙位置差 > 0.8 米；
- 主要固定物被删除或平移 > 1 米。

只比较结构项，不比材质/颜色；结果作为 warnings：

```ts
type ContinuityWarning = {
  kind: 'size' | 'wall' | 'opening' | 'prop'
  message: string
  previousShotId: string
  diff?: unknown
}
```

UI 在编辑器顶部显示警告和三个动作：`继承上一镜`、`保留当前`、`查看差异`。`继承上一镜` 是一次可撤销的整镜空间替换；`保留当前` 只记录“已知差异”，不阻断渲染。

### 5. 参考板：多图压成一张带标签图

客户端用 Canvas 生成 `ReferenceBoard`（约 1400×1000，JPEG/PNG dataURL）：

```text
+--------------------------+----------------------+
| CURRENT FRAME            | SCENE / SCENE CARD   |
| 当前首帧，最大区域        | 场景空镜或场景卡      |
+--------------------------+----------------------+
| CHARACTER: A             | CHARACTER: B          |
| 角色三视图               | 角色三视图            |
+--------------------------+----------------------+
| PROP: 铁箱               | PROP: 货架            |
+--------------------------+----------------------+
```

- 当前首帧优先；没有 `refImage` 时用候选 `candidates[activeIdx]`，再没有就显示“当前帧缺失”。
- 场景卡取本镜 `shotScene.designId` 或同场匹配的场景卡；角色取 `roster`；道具取 `refIds`/`refExtras` 能匹配到的素材和 `shotScene.props.designId`。
- 标签用英文短标签 + 角色/道具名，避免 VLM 只看到无标签拼图。
- 图片总数默认最多 6 个区域（当前帧 1、场景 1、角色最多 3、道具最多 2）；更多资源进入 manifest 文本，不无限扩图。
- 参考板只由本地项目媒体/生成图合成；不抓外链图片。图片损坏就显示占位。

### 6. `VisualBrief`：只描述看到的，不算米制坐标

```ts
type VisualBrief = {
  version: 1
  usedVision: boolean
  subjects: {
    name?: string
    screen: 'left' | 'center' | 'right'
    depth: 'near' | 'mid' | 'far'
    occludedBy?: string
    facing?: 'camera' | 'away' | 'left' | 'right'
  }[]
  visible: {
    kind: 'wall' | 'door' | 'window' | 'prop' | 'floor'
    side?: 'left' | 'right' | 'back' | 'front'
    description: string
  }[]
  shotSize?: string
  cameraHint?: { height?: 'low' | 'eye' | 'high'; angle?: string; notes?: string }
  composition?: string
  confidence?: number
}
```

- 视觉模型只输出上述感知信息；**不允许**输出 `x/z/米/wall height` 这类绝对几何作为最终结果。
- 文本/几何模型把 brief 当作软约束，与 seedScene、场景卡、prompt、marks 一起生成 `ShotScene + ShotBlocking`。
- 如果视觉模型返回了坐标字段，解析时保留为诊断信息但不作为最终布局输入；以文本/几何结果和几何校验为准。

### 7. 视觉能力、图片传输与缓存

- `Cap` 增加 `'vision'`；`STAGES` 增加 `vision` 环节（或复用“镜头表”作为文本阶段，视觉单独绑定）。设置页提供“视觉模型”一行。
- 新增 `VisionOpts` 和 `/api/vision`（或扩展 `/api/text` 的 messages content 数组）：
  - 输入：`system`、`prompt`、`image`（参考板 dataURL）、`json: true`；
  - 只允许声明 `vision` 能力的模型；
  - 服务端校验 dataURL 大小，限制 4MB，超限拒绝；
  - provider 不兼容时返回明确错误。
- 参考板由客户端生成，只传一张 dataURL；项目文件不保存原始 base64。
- `visualBriefMeta` 保存 `{fingerprint, usedVision, modelKey, createdAt}`；`visualBrief` 保存结构化结果。指纹包含：当前帧 URL/大小、场景卡 ID+图、角色 ID+图、道具 ID+图、prompt/videoPrompt/marks 摘要。相同指纹直接复用是否调用视觉。
- 没有视觉模型/调用失败：`usedVision=false`，生成仍走文本，UI 显示“参考图未参与推理”；不伪造视觉 brief。

**替代方案：** 直接把 6 张图作为多图消息发送。优点是不用做拼图；缺点是 provider 多图能力不一致、成本更高、标签容易丢。参考板是一张图，兼容性和可缓存性更好。

### 8. 生成编排：VisualBrief + 种子 + 一次联合 JSON

```text
shot resources
  -> build ReferenceBoard (client)
  -> vision model -> VisualBrief (cache by fingerprint)
  -> build shot context (manifest + seedScene + brief)
  -> text/geometry model -> {shotScene, shotBlocking, notes}
  -> validate both
  -> repair once
  -> save both + preview
```

- 用一个文本调用同时产出 `shotScene` 和 `shotBlocking`。如果分两次调用，场景与走位容易不一致；联合输出可以在同一上下文里保持机位与墙门的关系。
- 输入上下文包含：
  - 当前镜头全部文本资源（prompt/videoPrompt/台词/说话人/cast/size/move/seconds/marks）；
  - `seedScene`（同场上一镜）；
  - 场景卡/道具/角色设定文本；
  - `visualBrief`（如果视觉可用）；
  - 当前镜已有 shotScene（重生成时作为约束）。
- 输出 JSON 同时含 `scene` 与 `blocking`；客户端分别 sanitize/validate，连接失败的场景不保存。
- 校验与修复沿用现有 `scheduleGeometry`：角色名单、关键帧、墙/物碰撞、路径、视锥。修复一次仍失败则不覆盖旧数据；首次没有旧数据时可以用 `source:'fallback'` 的兜底，并明确提示。
- 修好后的 `shotScene.source='ai'`，`shotBlocking.source='ai'`；seed 来源写 `seedFrom`。

### 9. 一键生成

- 打开编辑器时：
  - 有 shotScene + blocking：直接预览；
  - 缺任意一项：自动启动联合生成（只一次），显示“参考板 -> 视觉 brief -> 空间/走位 -> 校验”步骤；
  - 若已有部分结果，保留旧结果直到新结果校验通过。
- “生成 3D 预演”按钮保留为唯一主动作：重新生成整个 bundle；旧的“AI 生成空间/走位”移到高级菜单。
- MP4 渲染仍然是独立按钮；自动生成不自动消耗视频额度。
- 同场首镜没有 seed 时，用场景卡和文本；没有视觉模型时直接文本。

### 10. 聊天：受限 patch，不做自由 JSON

聊天面板接收：当前 `shotScene + shotBlocking`、当前选中关键帧、上一镜 `shotScene`、`VisualBrief`、最近 6 条对话、本镜 roster。

模型返回：

```ts
type Shot3DChatResult = {
  reply: string
  ops: Shot3DPatchOp[]
}
type Shot3DPatchOp =
  | { op: 'set_camera'; key: number; x?: number; y?: number; lookX?: number; lookY?: number; height?: number; fov?: number }
  | { op: 'move_actor'; key: number; name: string; x?: number; y?: number; face?: number }
  | { op: 'move_wall'; id: string; x1?: number; z1?: number; x2?: number; z2?: number; height?: number }
  | { op: 'add_wall'; wall: SceneWall }
  | { op: 'remove_wall'; id: string }
  | { op: 'set_opening'; wallId: string; index?: number; opening: SceneWallOpening }
  | { op: 'remove_opening'; wallId: string; index: number }
  | { op: 'add_prop'; prop: SceneProp }
  | { op: 'move_prop'; id: string; x?: number; z?: number; rotation?: number }
  | { op: 'remove_prop'; id: string }
  | { op: 'set_floor'; w?: number; h?: number }
  | { op: 'copy_previous_scene' }
  | { op: 'regenerate_scene' }
  | { op: 'regenerate_blocking' }
```

- 客户端对 ops 做二次校验：id 存在、数值有限、墙长/尺寸合法、角色在 roster、patch 后 `validateBlocking` 通过；不合法就整体拒绝，不部分应用。
- 应用成功时保存一个 undo snapshot；聊天结果作为一步撤销。
- 聊天模型不能直接改上一镜/下一镜；`copy_previous_scene` 也只是复制到当前镜。
- 图片意图：
  - 消息包含“这张图/当前画面/首帧/参考图”等，先检查 `visualBriefMeta.fingerprint`；资源变了才重跑视觉，否则复用。
  - 纯参数请求（“FOV 50”）不调用视觉。
- 聊天模型使用设置里的 3D/视觉环节；对话历史只保存在当前编辑器会话，不写项目。

### 11. 每镜指纹与过期

`scheduleMeta` 指纹从 `(sceneLayout, blocking, duration, aspect, mode)` 改为：

```ts
{
  shotId,
  scene: shotScene,
  blocking,
  duration,
  aspect,
  mode,
  renderer: 1
}
```

- 每镜自己的 shotScene 变化只让本镜过期；同场其他镜头不再因“场次布局”自动全部过期。
- 旧 `scheduleMeta` 没有 `shotId`/新指纹版本时视为过期；旧视频保留可播放。
- 干净 POV/审阅/参考视频拦截继续使用现有逻辑，只更换输入来源。

### 12. UI 与状态

- `SceneScheduleEditor` 顶部：
  - 当前镜空间来源徽标：`继承自 S01` / `场次迁移` / `AI` / `手动` / `兜底`；
  - `参考图已参与视觉` / `参考图未参与推理`；
  - 连续性警告条。
- 左侧平面图仍支持高级拖拽/数值编辑；右侧改为“3D 预览 + 聊天”两个页签，聊天为默认页签（少操作路径）。
- 聊天建议 chips：
  - “机位再远一点”
  - “按当前画面重建空间”
  - “沿用上一镜空间”
  - “门往左移”
  - “角色往右走一步”
- “继承上一镜”按钮可直接复制上一镜 shotScene 到当前镜，作为一次撤销操作，并保留 `seedFrom`。
- 关闭/未保存保护、渲染取消、参考图抽屉沿用现有编辑器。

### 13. 规格顺序

- 本 change 的 specs 已作为对已归档 `scene-blocking-3d` 的 delta 重组；实施前先完成 0.1。
- 主 spec 中只保留每镜独立语义；不要再实现或写入 `sceneLayouts` 作为新空间真相源。

## Risks / Trade-offs

- **[单张图无法还原精确深度] →** VLM 只输出 2D/感知锚点，几何由 seedScene + 文本模型 + 校验生成；不承诺照片级空间重建。
- **[每镜独立导致跨镜漂移] →** 默认继承同场上一镜 + 结构差异警告；用户可选择继承或保留差异。
- **[视觉调用成本和延迟] →** 参考板合成一张图、资源指纹缓存、打开时只生成一次、文本修改不重复调用视觉。
- **[模型不支持 dataURL/多模态] →** 显式 `vision` 能力 + provider 校验；不支持时文本回退并标记。
- **[聊天模型输出非法 patch] →** 受限操作 + 二次几何校验 + 原子应用 + 撤销；自由 JSON 一律拒绝。
- **[每镜空间数据变大] →** 限制数组/字段精度，存储 JSON 约 5~15KB；超限拒绝或裁剪并提示。
- **[旧项目规格冲突] →** 实施前先归档 `scene-blocking-3d` 并重写 delta；这是硬前置，不是实现细节。
- **[参考板包含角色/道具图带来隐私/外发风险] →** 只发送到用户配置的视觉模型，不写日志、不保存 dataURL；没有视觉模型时不发图。

## Migration Plan

1. 先归档 `scene-blocking-3d`，把本 change 的规格改成对它的 MODIFIED/REMOVED delta。
2. 增加 `ShotScene`/`visualBrief`/`shot_scene_seed` 类型与镜头 extra 映射；旧场次布局懒复制到镜头。
3. 增加参考板/视觉 brief/vision 模型能力；无视觉模型保持文本路径。
4. 增加联合生成、上一镜 seed、连续性检查、一键打开生成。
5. 增加聊天 patch、撤销、每镜指纹。
6. 更新编辑器 UI、Inspector 状态、README 和回归；旧视频标过期，旧布局和旧视频不删除。
7. 回滚：回退代码即可回到共享场景版本；`shot_scene`/`visual_brief` 是 extra 字段，旧代码忽略；旧 `sceneLayouts` 仍存在。

## Open Questions

无。视觉模型的具体渠道/模型由设置页配置决定；实现默认使用 `vision` 环节，未配置则文本回退，不阻塞规格与任务拆分。

## Verification

2026-10-22 人工视觉验收（每镜 shotScene，干净 POV，无网格/文字/机位标签）：

- 16:9 推镜：`visual-16-push-1792666072427`，4s / 960×540，`/videos/schedule-1792666081973-1b18a8.mp4`。首/中/尾帧：[p16-push-00.png](evidence/p16-push-00.png)、[p16-push-20.png](evidence/p16-push-20.png)、[p16-push-39.png](evidence/p16-push-39.png)。北墙门洞、半高墙、立柱、固定物关系清楚；角色从左侧向中心移动，机位前推；最后一帧无标签遮挡。
- 9:16 摇镜：`visual-9-pan-1792666072427`，3s / 540×960，`/videos/schedule-1792666092290-d8d54b.mp4`。首/中/尾帧：[p9-pan-00.png](evidence/p9-pan-00.png)、[p9-pan-15.png](evidence/p9-pan-15.png)、[p9-pan-29.png](evidence/p9-pan-29.png)。机位固定，注视点横向扫过，门洞/立柱入画，角色从画面中心移向左侧。
- 编辑器聊天/参考图：[editor-chat.png](evidence/editor-chat.png)。每镜空间、继承来源、参考图抽屉、聊天页签与建议 chips 均可见；无视觉模型时明确显示“参考图未参与”。
- 视觉 brief 来源由 `verify-shot-vision.mjs` 验证：配置视觉模型时请求带参考板 dataURL，文本编排包含视觉 brief；纯文本聊天复用缓存；无视觉模型时不调用视觉并在结果中标记 `usedVision=false`。
- 自动测试覆盖每镜独立、旧布局迁移、上一镜 seed、连续性警告、聊天 patch/撤销、过期只影响当前镜、项目隔离；未发现最后一帧遮挡。

结论：每镜独立空间和聊天修改可工作；干净 POV 无文字/辅助线，墙门/固定物关系可读。角色仍是胶囊白模（非目标）。
