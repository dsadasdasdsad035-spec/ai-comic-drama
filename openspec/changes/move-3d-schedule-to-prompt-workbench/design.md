# Design

## Context

现状与约束（动机见 `proposal.md`，行为契约见 `specs/`）：

- 画布右击菜单有三个 3D 动作：`编辑 3D 调度…`、`生成调度视频（3D）`、`调度关键帧作参考`（`src/App.tsx:3455-3490`）。它们分别调用 `openScheduleEditor`、`genSceneCodeVideo`、`genSceneCodeVideo(id, true)`。
- 3D 工作台是全局 overlay，由 `App` 用 `editorNodeId` / `editorNode` 渲染（`src/App.tsx:3589`），保存和渲染回调直接改画布节点并整条写回 `project.json`（`saveEditor` / `applyEditorRender`）。
- 右侧 Inspector 的「3D 调度」区块显示预览、过期状态、`useScheduleVideoRef` / `useScheduleFrames` 开关和 `motionNote`（`src/Inspector.tsx:1264-1400`）；「更多」页签还有「打开 3D 调度」（`src/Inspector.tsx:1463`）。
- 提示词工作台只读 `ProjectShot`，有自己的 `shots` 草稿、保存和聊天；它没有画布节点，但镜头可能还没推到画布（`src/PromptTable.tsx`）。
- 出片附件解析在 `collectShotReferences`：角色、相邻分镜、`asset-` 素材依次解析，**视频素材被显式跳过**（`src/shotReferences.ts:234`）。`buildShotVideoRequest` 只把 `scheduleVideo` 当成特殊参考视频（`src/videoPrompt.ts:223`、`:306`），连线视频素材不会进入请求。
- 3D 渲染由 Blender 子进程完成，MP4 落在 `public/videos`（`server/blender.mjs:331`）；`/api/media` 已经扫描该目录（`vite.config.ts:3653`），素材选择器的「视频」分类已经能列出来并确认成视频素材。
- 数据层：`ShotData` 有 `sceneCode` / `shot3DContext` / `scheduleVideo` / `scheduleFrames` / `motionNote` / `useScheduleVideoRef` / `useScheduleFrames`；`ProjectShot` 用 snake_case 对应这些字段；`mergeShots` 只跳过 `undefined`，所以部分字段写回是安全的（`server/data.mjs:124`）。
- 现有规格 `scene-blocking-3d` 要求 Inspector 预览和 3D 参考通路；`shot-video-prompt` 要求附件由「镜头连线、3D 参考开关和音色参考」决定。本变更需要改这两处以及 `asset-media-picker`。

## Goals / Non-Goals

**Goals:**

- 3D 调度的唯一入口在提示词工作台，画布右击和 Inspector 不再调用 3D 工作台。
- 3D 保存只写当前镜的 3D 字段，不能覆盖提示词工作台里未保存的提示词、描述、表演或台词草稿。
- 提示词工作台能显示该镜 3D 状态（未建/已渲染/已过期）和最新渲染的查看入口。
- 出片参考视频改由分镜连线的视频素材提供；图片 4 张额度不变，视频不占图片额度。
- 渲染的 MP4 作为普通本地视频进入素材选择器，确认后成为 `video` 素材，可再连线到分镜。
- 删除画布和 Inspector 上的 3D 入口与专用参考开关，不改变 Blender 渲染引擎、代码生成、3D 聊天和按镜持久化的能力。

**Non-Goals:**

- 不做 Seedance 出片后的自动视觉验收，不因 3D 渲染发起或拦截 Seedance 任务。
- 不做多视频素材参考；首期只提交第一条连线视频，其余在面板列出但不发送。
- 不自动把旧 `useScheduleVideoRef` / `useScheduleFrames` 迁移成素材连线。
- 不改变 3D 工作台的三栏布局、代码 ABI、Blender 版本要求、渲染时长/画幅规则。
- 不把 3D 调度接进提示词技能或自动改写提示词。

## Decisions

### 1. 3D 工作台由提示词工作台承载，入口和状态一起搬

`PromptTable` 新增每镜的「3D 调度」列/按钮和 `editorShotId` 状态，内部 `React.lazy` 加载现有 `SceneCodeWorkbench`，以 overlay 方式渲染。`App` 删除 `editorNodeId` / `editorNode` / `saveEditor` / `applyEditorRender` 和全局 overlay。

为什么不是继续由 `App` 承载、只把按钮搬到提示词：

- 提示词工作台有自己的 `shots` 草稿，3D 保存后需要立刻更新本地状态；如果编辑器仍在 `App`，就要额外建立一条「编辑器 → 提示词草稿」的回传通道，容易和提示词的整表保存互相覆盖。
- 项目镜头可能不在画布上，`App` 的编辑器只认 `nodes` 里的画布节点；放回提示词侧可以合成为一个临时 `ShotNodeType`，不要求先推到画布。
- 代价是提示词路由卸载时编辑器也会关闭，所以增加一个离开保护（见决策 7）。

`SceneCodeWorkbench` 需要的节点：

```
selected shot
  -> shotToData(ProjectShot, base ShotData)
  -> synthetic ShotNodeType { id: shot.id, data: { shotId: shot.id, ... } }

editorNodes =
  canvasNodes（保留 asset/char 卡，供 linkedAssetsFor 解析连线素材）
  + 本集所有 ProjectShot 的 synthetic shot 节点
  去重键：shotId；画布已有同 shotId 时优先用画布节点（保留 refIds/media）
```

这样，已在画布上的镜头仍能解析连线素材；没上画布的镜头也能打开 3D，只是没有画布连线素材，仍可使用项目级 designs/assets 和角色。

被否掉的替代方案：把 3D 编辑器改造成只接收 `shotId`、自己按项目加载。改动更大，且会复制 `SceneCodeWorkbench` 已有的项目/媒体加载逻辑。

### 2. 3D 保存只写 3D 字段，走部分合并

`onSave` / `onRendered` 不调用现有整条 `nodeToShot`，而是构造只含 3D 字段的 `Partial<ProjectShot>`：

```
{
  id: shot.id,
  scene_code, shot_3d_context, scene_code_meta,
  schedule_video, schedule_meta, motion_note,
  ...(frames ? { schedule_frames } : {})
}
```

写回时先读当前项目，把 patch 合进完整镜头列表再调用 `mergeProjectShots`（服务端 `mergeShots` 只跳过 `undefined`，未提供的提示词/描述/表演字段保持原值），同时用同一份 patch 更新 `PromptTable.shots` 的本地状态。不能只传一条：`mergeShots` 会把未出现在入参里的镜头标成 `orphan`。

明确不写：`keyframe_prompt`、`video_prompt`、`video_prompt_override`、`desc`、`performance`、`dialogue`、`use_schedule_video_ref`、`use_schedule_frames`、`keyframe`、`clip`。

为什么不用现有 `nodeToShot`：它会把节点上的 `prompt` / `videoPrompt` / `refIds` / `media` 一起写回；在提示词工作台打开编辑器时，节点上的提示词可能是旧的/兜底值，会把用户未保存的提示词草稿覆盖掉。

保存失败时：不更新本地 `shots`，编辑器保持打开并显示错误；这和现有 `scene-blocking-3d` 的保存失败语义一致。

### 3. 提示词工作台显示 3D 状态，不内嵌第二套预览器

- 状态复用 `resolveShotSchedule`（`src/scheduleStatus.ts:24`）：`未渲染 / 生效 / 仅审阅 / 已过期`，输入用 `shotToData(shot, base)`、`shot.id`、`sceneLayouts`、`projectAspect`。
- 表格新增窄列「3D」：状态 chip + `打开` 按钮；有 `scheduleVideo` 时给一个「查看」链接，直接打开 MP4。编辑器 overlay 本身就是完整预览，不在表格里再塞 `<video>`，避免二十行同时解码。
- 渲染仍由编辑器里的显式按钮触发；状态和预览只用于人工审阅，不自动判定提示词或视频。

替代方案：在行内展开一个视频预览。会显著增加表格高度，且和 3D 编辑器已有预览重复，不采纳。

### 4. 参考视频来自连线视频素材，独立于图片额度

在 `shotReferences.ts` 新增 `collectVideoReferences`，只处理 `asset-` 节点：

```
refIds 顺序 -> node(id) -> data.kind === 'video' -> data.url
missingMedia / 节点不存在 -> missing
去重键：url
```

`collectShotReferences` 继续跳过视频素材，不改图片 4 张额度和排序逻辑。

`buildShotVideoRequest` 的调整：

- 删除 `useVideoRef = Boolean(d.useScheduleVideoRef && d.scheduleVideo)`。
- `const videoRefs = collectVideoReferences(...)`；`const primaryVideo = videoRefs.refs[0]`。
- `mode`：`native` > `primaryVideo`（video）> 有图（ref）> `first`。
- `video` 附件用 `primaryVideo`，`purpose: '运动/机位'`；新增 `omittedVideos`（首期只提交第一条的原因）。
- 有视频时不再取 `firstFrame`；图片仍作为 `reference_image`，由 `buildVideoPayload` 的「全模态参考」分支处理。
- 删除 `scheduleFrames` 注入、`schedule-stale` 阻塞、`video-ref-missing` 警告。
- 新增 `video-asset-missing` 阻塞（连线视频文件缺失，不能静默变成无视频请求）；保留 `video-ref-unsupported` 警告（模型不支持视频参考，提交会失败）。
- `nativeMode && primaryVideo` 继续阻塞，文案改为「原生音频只能用参考图模式，请取消视频素材参考」。
- `fingerprintOf` 用 `videoRefs.map(r => r.url)` 替代 `scheduleVideo` / `useScheduleVideoRef` / `useScheduleFrames`；保留 `motionNote`。
- 参考提示词只写运动限定：

```
参考 @视频1 的运动、机位与节奏；
画面风格、人物外观、场景与道具以参考图和文字为准。
```

这样即使用户选的是 3D 白模调度视频，也不会要求 Seedance 照搬白模画风。

服务端 `buildVideoPayload` 已经支持 `referenceVideos`（`server/video.mjs:122-136`），本次不新增字段；前端 `startVideo` 继续只送 `request.video` 一条。多视频支持留到后续变更。

### 5. 旧 3D 参考字段保留但不再生效

- `ShotData` / `ProjectShot` / `bizSignature` / `nodeToShot` / `shotToData` 继续保留 `useScheduleVideoRef`、`useScheduleFrames`、`scheduleFrames`、`scheduleVideo`、`motionNote`，避免旧项目读写出错。
- 出片拼装不再读取这些字段做参考；只有 `motionNote` 仍作为文字提示拼进正文（它是文本，不是附件，且最终正文在 Inspector 可见）。
- 旧 `scheduleVideo` 仍可播放、可被选为素材；旧 `useScheduleVideoRef: true` 不会自动提交。需要在发布说明里告诉用户：把渲染好的 MP4 选成素材并连线到分镜。
- 3D 编辑器的「渲染后抽帧」复选框移除；`CodeEditorRendered` 可继续返回 `frames` 供适配器存 `schedule_frames`，但不再设置 `use_schedule_frames`。

### 6. 素材选择器不需要新的发布动作

Blender 渲染已经写入 `public/videos`，`/api/media` 的 `videos` 分支按 mtime 扫描该目录（`vite.config.ts:3653`），`MediaPicker` 的「视频」页签已经能预览、确认并把素材类型改成 `video`（`src/mediaPick.ts`、`src/MediaPicker.tsx`）。

因此本次只做验证与必要的路径兜底：

- 确认 `renderSceneCode` 的最终 MP4 与 trial/proxy 产物都在 `/videos`，而不是项目私有目录。
- 如果实现时发现项目级媒体路径变化，扩展 `/api/media` 的扫描目录；否则不改接口。
- 不在渲染完成后自动创建素材卡或自动连线；用户必须显式确认，避免把审阅视频误当参考。

### 7. 删除调用点，保留引擎

| 位置 | 删除 |
|---|---|
| `src/App.tsx:3455-3490` | 右击菜单 `scheduleEdit` / `schedule3d` / `schedref` |
| `src/App.tsx:1654-1710` | `openScheduleEditor` / `saveEditor` / `applyEditorRender` |
| `src/App.tsx:1467-1651` | `genSceneCodeVideo` / `genScheduleVideo`（只服务右击菜单） |
| `src/App.tsx:3589` | 全局 `SceneCodeWorkbench` overlay |
| `src/Inspector.tsx:1264-1400` | 「3D 调度」区块、预览、两个参考开关、`motion-hint` |
| `src/Inspector.tsx:1463` | 「打开 3D 调度」按钮 |
| `src/SceneCodeWorkbench.tsx:1330` | 「渲染后抽帧」复选框 |

提示词侧的离开保护：`PromptTable` 通过 `onEditorDirtyChange` 把编辑器 dirty 状态交给 `App`，`changeView` 在 `view === 'prompts' && promptEditorDirty` 时 confirm，和剧本页的 `scriptDirty` 保护一致。这样从提示词切到画布不会静默丢掉未保存的 3D 代码。

`Inspector` 的 `onOpenSchedule` prop 删除；`resolveShotSchedule` 只保留给提示词侧的 3D 状态和 `motionNote` 推导。`shouldBlockCanvasCodeRender` 不再有运行时调用方（纯函数保留，现有回归脚本仍覆盖）。

## Risks / Trade-offs

- **旧项目失去自动 3D 视频参考**：这是有意的 BREAKING。缓解：保留旧字段和 MP4 文件；提示词 3D 面板显示旧视频；发布说明给出「选成素材 → 连线分镜」的操作路径。
- **提示词表格变重**：3D 编辑器是 lazy overlay，不进入首屏；表格只多一个窄列和状态 chip。
- **合成节点丢失画布连线素材**：`editorNodes` 合并真实画布节点并优先使用同 `shotId` 的画布节点；只有未上画布的镜头使用合成节点，此时本来也没有画布素材连线。
- **部分写回与提示词整表保存竞争**：3D 保存只写 3D 字段并在成功后同步本地 `shots`；提示词保存仍发整表，但本地 `shots` 已含最新 3D 字段，不会回写旧值。编辑器是 overlay，提示词保存按钮在其下方不可操作。
- **过期 MP4 仍可被选为素材**：素材选择器只认文件，不认 3D 指纹。缓解：提示词 3D 面板持续显示「已过期」；如果后续需要，可在素材卡标题/元数据里带过期标记，但不阻塞选择。
- **首期只支持一条视频**：多视频素材连线只取第一条。面板必须列出其余视频和原因，避免用户误以为都发送了。
- **视频素材分辨率/时长不匹配**：Seedance 对参考视频有时长/大小限制；本次沿用现有服务端切片和错误提示，不在前端做新的预检，除非实现时发现请求会被整批拒绝。
- **删除 Inspector 3D 区块后 motionNote 不可见**：最终正文仍在 `VideoPromptPanel` 的「本次出片提示词」里可见；3D 面板也显示 motionNote，避免来源不可追溯。

## Migration Plan

- 无数据库迁移：旧字段、旧 MP4、旧 3D 数据全部保留。
- UI 迁移：删除画布/Inspector 入口；提示词工作台新增入口和状态列；旧项目打开后 3D 数据照常可编辑、可重渲。
- 参考迁移：旧 `useScheduleVideoRef` / `useScheduleFrames` 不再生效。需要继续使用旧调度视频的用户，在素材卡里选择该 MP4 并连线到分镜；不自动迁移，避免在用户不知情时改变出片请求。
- 回滚：恢复画布/Inspector 入口和 `videoPrompt.ts` 的 3D 参考分支即可；数据字段和文件都没删，回滚不需要迁移。
- 验证：
  - 新增 `verify-prompt-3d-workbench.mjs`：提示词入口、未上画布镜头、画布/Inspector 无入口、3D-only 保存不覆盖提示词草稿、状态 chip。
  - 新增 `verify-video-asset-ref.mjs`：单视频、多视频只取第一条、图片额度不变、缺失视频阻塞、模型不支持警告、旧 3D 开关不生效。
  - 扩展素材选择器验证：渲染 MP4 出现在视频分类并可确认成 `video` 素材。
  - 回归 `verify-schedule3d.mjs`、`verify-video-ref-*.mjs`、`verify-video-prompt-preview.mjs`，更新仍然引用已删除入口的断言。
  - `openspec validate move-3d-schedule-to-prompt-workbench --strict`。
