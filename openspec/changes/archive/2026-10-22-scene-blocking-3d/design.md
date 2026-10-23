# Design

## Context

当前 3D 链路只有 `src/layoutGen.ts` 的 `ShotLayout`：从单镜 `prompt + cast + size + move` 让文本模型猜一组归一化站位，`src/schedule3d.ts` 用胶囊体、视锥和固定飞入镜头录 3 秒 webm。它没有场景归属，没有墙体/固定物，没有台词、剧本场次、设定卡或标注输入，用户也不能编辑。

现有可复用的基础：

- 项目已有 `episodes[].scenes`（场次、地点、时间、beats、人物、强度、基调）和 `designs`（场景/道具设定卡，含摘要、英文锚点、关键词、图）。
- 镜头已有 `cast`、`dialogue`、`prompt`、`videoPrompt`、`marks`、`size`、`move`、`seconds` 和 `layout`；`ProjectShot` 的未知字段通过 SQLite `shots.extra` 原样往返。
- 出片时长在 `Inspector`/`generateVideoOne` 中被夹到 2~12 秒；3D 视频也应使用同一有效时长。
- `scheduleVideo` 已有本地保存、抽帧、Inspector 预览和 Seedance `reference_video` 通路；参考视频上游已明确要求 2~15 秒、mp4。
- 布局生成使用现有“镜头表（拆镜）”环节模型，不新增设置项。

参考 `proposal.md` 的动机与 `specs/scene-blocking-3d/spec.md` 的行为约束。本文只说明实现选择。

`schedule-video-reference` 曾把 POV/干净渲染列为后续变更的触发条件；本变更承接该后续项，但参考视频请求协议、模型能力判定和 Files API 不改。

## Goals / Non-Goals

**Goals:**

- 场次空间只建一次，同场镜头复用；镜头只负责本镜走位和机位。
- 用现有全部**文本**上下文生成可校验的场景与走位，失败不覆盖有效调度。
- 做一个能真正修改几何的全屏编辑器，而不是只读预览。
- 默认导出从镜头机位出发的干净预演，时长/画幅/视场角与出片参数一致。
- 旧 `layout` 和旧调度视频不丢失，新结果能判断是否过期。

**Non-Goals:**

- 不引入视觉模型从剧照/设定图识别墙体或人物；参考图只作为编辑器人工对照和文本锚点来源。
- 不做照片级材质、角色骨骼/面部动画、布料、复杂群演和打斗编排。
- 不做云端渲染、队列、多人协同、版本历史或跨项目场景库。
- 不改 Seedance 参考视频协议、模型能力判定和 Files API。
- 不让审阅视角视频伪装成出片参考。

## Decisions

### 1. 两套坐标：场景用米，走位用归一化

```ts
export type SceneWall = {
  id: string
  x1: number; z1: number; x2: number; z2: number // 米，场地左上为原点
  height: number
  thickness: number
  openings?: { at: number; width: number; height: number; kind: 'door' | 'window' }[]
}
export type SceneProp = {
  id: string
  name: string
  designId?: string
  shape: 'box' | 'cylinder'
  x: number; z: number // 米，中心点
  w: number; d: number; h: number
  rotation: number // 度
}
export type SceneZone = {
  id: string
  name: string
  x: number; z: number; w: number; d: number
  kind: 'floor' | 'blocked' | 'action'
  color?: string
}
export type SceneLayout = {
  id: string // E01-SC02，项目内稳定键
  episode: number
  sceneNo: number
  sceneSlug?: string
  designId?: string
  w: number; h: number // 米
  walls: SceneWall[]
  props: SceneProp[]
  zones: SceneZone[]
  axis?: { a: { x: number; z: number }; b: { x: number; z: number }; label?: string }
  source: 'ai' | 'manual' | 'fallback'
  updatedAt?: string
}
```

```ts
export type BlockingActor = { name: string; x: number; y: number; face: number }
export type BlockingCamera = {
  x: number; y: number; lookX: number; lookY: number
  height: number // 米
  fov: number // 垂直视场角，度
}
export type BlockingKey = { t: number; actors: BlockingActor[]; camera: BlockingCamera }
export type ShotBlocking = {
  keys: BlockingKey[] // 1~3 个，t 归一化 0~1
  notes?: string
  source: 'ai' | 'manual' | 'legacy' | 'fallback'
  updatedAt?: string
}
```

- 场景几何用米，才能写“墙高 2.8 米、门洞 1.0 米、机位高 1.6 米”，也能直接算走位距离。
- 角色/机位位置归一化，场景尺寸变化时相对构图不漂移，编辑器缩放也简单。
- 相机 `x/y` 允许 `-0.25~1.25`，允许机位在场地外拍全景；角色仍限制 `0~1`。
- `face` 沿用现有约定：`0=向右(+x)`、`90=向下(+z)`，存角度，渲染时转弧度。
- 轴线和分区只影响审阅与构图提示，不参与碰撞。

**替代方案**：全部用归一化——无法表达真实米制距离；全部用米——编辑器缩放和模型输出成本更高，且旧 `layout` 迁移更麻烦。

### 2. 场景布局按 `E{集}-SC{场次}` 复用，镜头只存场次引用

- `SceneLayout.id = "E{episode}-SC{sceneNo}"`；DB 以此唯一键，同场镜头通过 `sceneNo` 找到同一布局。
- 拆镜输出 `scene_no`（整数）与 `scene_slug`（字符串）。`STORYBOARD_BASE` 的 JSON 契约增加字段，`ShotTable` 解析时校验场次号在本集存在；不存在则回退到第 1 场并在 toast 中标明，不伪造场次。
- 旧镜头没有 `scene_no` 时，读出为第 1 场并带 `sceneFallback` 提示（不写回项目，直到用户保存或改绑）。
- 场次改号后旧布局保留，编辑器按 `sceneNo` 找不到对应剧本场次时显示“场次已不存在”，让用户改绑或删除；不自动删除、不自动绑定到近似场次。

**为什么不把布局塞进 `episodes[].scenes`**：现有 `/api/project` 对 episodes 是整表替换，剧本页保存会覆盖布局；独立 `sceneLayouts` 顶层数组和独立表更安全，也能单独保存。

### 3. 持久化：顶层 `sceneLayouts` + 镜头 extra 字段

- `ProjectData` 增加 `sceneLayouts?: SceneLayout[]`。
- SQLite 新增：

```sql
CREATE TABLE IF NOT EXISTS scene_layouts (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  project_id INTEGER NOT NULL,
  layout_id TEXT NOT NULL,
  episode INTEGER,
  scene_no INTEGER,
  layout TEXT NOT NULL,
  sort INTEGER DEFAULT 0,
  updated_at TEXT,
  UNIQUE(project_id, layout_id)
);
```

- `readProject` 把行内的 JSON 展开为对象；`writeProject` 对 `sceneLayouts` 做整表替换，并在写入前用同一套 sanitize 校验，非法数据不落库。
- 镜头新增字段走现有 `shots.extra`，不新增列：
  - `scene_no?: number`
  - `scene_slug?: string`
  - `shot_blocking?: ShotBlocking`
  - `schedule_meta?: { version: 1; fingerprint: string; mode: 'clean' | 'review'; duration: number; aspect: string; width: number; height: number; renderedAt: string }`
- `/api/project` 的 POST 白名单增加 `sceneLayouts`（整体替换）；`/api/project` GET 附带。
- App 在项目加载时把 `sceneLayouts` 放进状态；编辑器保存场景走单独的 `saveSceneLayouts(project, list)`，避免每拖一下都写库。镜头走位随 `patch()` + `mergeProjectShots` 保存，编辑器保存时显式 `await`，不依赖 1.5 秒画布自动同步。

**迁移：**

1. 旧 `layout` 读入时转成单关键帧：`keys=[{t:0, actors, camera:{...,height:1.6,fov:45}}]`，`source:'legacy'`；不删除旧字段。
2. 旧项目没有 `sceneLayouts` → `[]`；打开编辑器或渲染时使用确定性兜底空间（10×8 米、四面墙、一个朝南门洞），`source:'fallback'`，只在内存中使用，不自动写项目。
3. 旧 `scheduleVideo` 保留路径和可播放性；`schedule_meta` 缺失即视为过期。
4. 回滚代码后，新表和新字段不影响旧代码读取；旧 `layout` 仍在，旧视频仍在。

### 4. 生成：两段独立 JSON 调用 + 一次修复

**场景布局生成（`sceneLayoutGen.ts`）**

输入（按预算截断，优先当前场次）：

- 当前集标题/钩子；当前场次的 `no/slug/place/time/beats/characters/intensity/tone`。
- 同场镜头摘要：镜号、景别、运镜、秒数、画面 prompt、台词、cast，最多 30 镜、每镜 160 字。
- 关联场景设定卡（`SceneLayout.designId`，否则按 slug/place 规范化匹配）：`summary_cn`、`prompt_en`、`keywords`。
- 既有布局（如果有）：要求“只修正不推翻”，但用户明确重新生成时允许重写。

输出契约：

```json
{
  "w": 10, "h": 8,
  "walls": [
    { "x1": 0, "z1": 0, "x2": 10, "z2": 0, "height": 2.8, "thickness": 0.18,
      "openings": [{ "at": 6.2, "width": 1.0, "height": 2.1, "kind": "door" }] }
  ],
  "props": [{ "name": "金属货架", "shape": "box", "x": 2.2, "z": 3.1,
              "w": 1.4, "d": 0.5, "h": 2.0, "rotation": 0 }],
  "zones": [{ "name": "表演区", "kind": "action", "x": 3, "z": 3, "w": 4, "d": 3 }],
  "axis": { "a": { "x": 3, "z": 3 }, "b": { "x": 7, "z": 3 }, "label": "对话轴" }
}
```

- 不要求模型输出 id；客户端生成稳定短 id（`w1/p1/z1`），重复调用不改变已有 id（按名称/几何近似匹配），避免 React key 抖动。
- 数组上限：墙 24、固定物 32、分区 12；超出的截断并提示。
- 场景里**不出现角色图内容**；角色只用名字/人数参与空间尺度。

**镜头走位生成（`blockingGen.ts`）**

输入：

- 当前镜头全部文本字段：`no/seconds/size/move/cast/dialogue/prompt/videoPrompt`。
- 所属 `SceneLayout` 的完整 JSON（含墙、洞、固定物、分区、轴线）。
- 角色设定：`lookEn`、`palette`、`keywords`、`role`（只取本镜角色）。
- 关联场景/道具设定卡文本；`refIds`/`refExtras` 能匹配到素材卡时补上标题、类型、`designId`。
- 标注摘要：标注数量、union bbox 的百分比、重心偏左/右/上/下、最大标注区域；不传图片。
- 时长：`effectiveSeconds = clamp(round(seconds), 2, 12)`；如果原秒数被夹取，在提示里写明。
- 运镜：把 `move` 和 `size` 作为明确约束；同时要求模型用关键帧表达，而不是只写一句“缓慢前推”。

输出契约：

```json
{
  "keys": [
    { "t": 0, "actors": [{ "name": "陈默", "x": 0.28, "y": 0.58, "face": 0 }],
      "camera": { "x": 0.5, "y": 0.92, "lookX": 0.45, "lookY": 0.42, "height": 1.55, "fov": 42 } },
    { "t": 1, "actors": [{ "name": "陈默", "x": 0.34, "y": 0.54, "face": 5 }],
      "camera": { "x": 0.5, "y": 0.82, "lookX": 0.45, "lookY": 0.42, "height": 1.55, "fov": 42 } }
  ],
  "notes": "陈默从门边走到货架前，机位缓慢前推..."
}
```

- 角色名单固定为 `unique(cast ∪ 台词说话人)`；模型不能增删。台词说话人不在 cast 时，编辑器显示“台词说话人已加入调度”的提示。
- 说话人/对话关系影响朝向与站位：系统提示要求“说话者面向听者、机位保留双人关系”；但验证只保证几何合法，不保证表演质量。
- 如果镜头无 cast 且无台词，允许空 actors，生成纯空间镜头；但 `key.camera` 仍必须合法。
- 关键帧 1~3 个；`固定` 默认 1 个，其他运镜默认 0/1 两帧；用户可在编辑器加中间帧。

**校验与修复（`scheduleGeometry.ts`）**

- `sanitizeSceneLayout`：丢弃非有限值、尺寸 ≤0、未知 shape、超范围数组；未知字段忽略；损坏字段汇总 warnings，不阻断项目读取。
- `validateBlocking` 分 errors/warnings：
  - errors：角色名不在 roster、重复角色、坐标非有限/越界、关键帧顺序错误、首尾不是 0/1、相机高度/FOV 越界、注视点与机位重合、角色/相机在墙体或固定物实体内部、角色与另一角色半径 0.5 米内重叠。
  - warnings：角色在视锥外、墙体遮挡视线、角色贴着墙/固定物（小于 0.3 米余量）、空 actors、秒数被夹取。
  - 碰撞不只检查关键帧：按 `t=0..1` 每 0.05 采样插值路径，防止中间穿过墙。
- 修复调用：把原始输出和 errors 列表发给同一模型，要求“只输出修复后的 JSON”；最多一次。修复后仍有 errors → 抛 `ScheduleValidationError`，不写库；warnings 可保存但显示。
- 兜底：
  - 场景：`fallbackSceneLayout()`，10×8 米、四面墙、南侧门洞、中心表演区，`source:'fallback'`。
  - 走位：`fallbackBlocking(roster, layout)`，沿用旧 `fallbackLayout` 的左右站位，机位在场地南侧，单关键帧，`source:'fallback'`。
  - 兜底只在用户首次生成或没有有效数据时使用；不伪装成 AI 结果。

**阶段模型**：继续用现有 `stageModelKey(appSettings, 'shot', stagePick)`，与拆镜同一环节；不新增设置项，避免为了 3D 再配一套模型。

### 5. 编辑器：全屏模态 + SVG 平面 + Three.js 预览

新增 `src/SceneScheduleEditor.tsx`，由 App 以全屏模态渲染（覆盖画布/顶栏），状态由 `src/scheduleEditorState.ts` 的 reducer 管理：

```ts
type EditorState = {
  scene: SceneLayout
  blocking: ShotBlocking
  shotSceneNo: number
  mode: 'scene' | 'blocking'
  time: number // 预览秒
  baseline: string // 进入/保存时的 canonical JSON
  past: Snapshot[]
  future: Snapshot[]
}
```

布局：

- 顶栏：镜头号、场次选择、模式切换、AI 生成/重生成、撤销/重做、保存、关闭。
- 左侧：SVG 平面图。场景模式画墙/门洞/固定物/分区/轴线；走位模式叠加角色、朝向、机位、视锥地面投影和路径。
- 右侧：Three.js 预览，可在“审阅视角（可环绕）”与“镜头视角（POV）”间切换；下方数值面板。
- 底部：时间轴（0~有效秒数）、关键帧标记、播放/暂停、当前关键帧选择；走位模式可添加/删除中间帧。
- 右侧抽屉：角色/场景/道具参考缩略图，仅人工对照，不进入模型。

交互：

- SVG pointer events 实现拖拽；`pointerdown` 记录起点，`pointermove` 更新临时几何，`pointerup` 提交一条 undo 记录。拖拽期间不重建 3D 场景，只在 `pointerup`/节流 80ms 后重建。
- 端点/旋转手柄：墙两端拖拽；角色和固定物有旋转手柄；固定物和分区有缩放角点。数值面板可精确输入 x/z/宽/深/高/rotation/height/fov。
- 非法值（空、NaN、负尺寸、墙长为 0）在输入失焦时回退到上一个合法值并提示；不允许写入 state。
- 撤销/重做保存 `{scene, blocking, shotSceneNo}` 快照，最多 50 步；AI 生成结果算一步。
- 未保存离开：`dirty = canonical(state) !== baseline`；关闭按钮弹“保存 / 放弃 / 继续编辑”；`beforeunload` 同样提示。全屏模态期间顶栏不可操作，因此不需要额外的切项目拦截。
- 保存：先 `validateBlocking`（用编辑后的场景）；有 errors 则显示列表并阻止保存；通过后：
  1. `saveSceneLayouts(project, replaceLayout(allLayouts, currentScene))`
  2. `mergeProjectShots(project, [nodeToShot({...node.data, sceneNo, sceneSlug, shotBlocking}, shotId)])`
  3. 回调 App 更新节点/布局，重置 baseline。
  任何一步失败都保留编辑器与未保存状态，显示错误。
- 场次改绑：场次选择只列本集已有场次。确认后更新 `shotSceneNo`；如果新场次已有布局就加载，没有则用兜底空间；旧场次布局不删。保存前影响仅限编辑器。
- 参考图抽屉：当前首帧、关联场景卡图、道具卡图、角色三视图。点击可放大；仅示意，不参与 AI。
- 3D 预览：
  - 用 `buildScheduleScene({layout, blocking, mode:'review', width, height})`；`renderAt(timeSeconds)` 单帧绘制。
  - 预览播放用 `requestAnimationFrame`，按 `performance.now()` 驱动，不录屏。
  - 环绕视角用 `OrbitControls`（three 自带 examples），限制目标为场地中心、缩放范围 0.4~3 倍场地。
  - 镜头视角直接把透视相机放在当前插值机位；没有标签/网格；用于确认构图。
  - 预览重建节流 120ms；组件卸载 `dispose()` 所有 geometry/material/texture 和 renderer。
- 窄屏：<900px 时平面/预览上下堆叠，数值面板折叠；编辑器自身全屏滚动，不横向溢出。

**为什么用 SVG 不用 Konva**：场景元素是少量可聚焦的线/矩形，SVG 原生支持 DOM 键盘焦点、`data-*` 测试定位和 CSS 主题变量；Konva 更适合大量画笔标注，不适合表单式编辑器。

### 6. 渲染：干净 POV 与审阅环绕两种视图

重写 `src/schedule3d.ts`：

```ts
type RenderInput = {
  layout: SceneLayout
  blocking: ShotBlocking
  duration: number
  aspect: string
  mode: 'clean' | 'review'
  width?: number
  height?: number
  showLabels?: boolean // 仅 review 生效
  signal?: AbortSignal
}
```

- **场景几何**：
  - 地面：`PlaneGeometry(w,h)`，米制；干净模式无网格，审阅模式加浅色 grid。
  - 墙体：`wallSegments(wall)` 按 openings 的 `at/width` 排序切段。门洞：下面留空、上方补 lintel；窗洞：上下都补墙，中间留空。每段用 BoxGeometry，中心按墙方向旋转。
  - 固定物：box/cylinder，颜色按 `designId`/名称稳定映射到 4 个中性灰蓝；不贴图。
  - 分区：半透明地面矩形 + 边框；干净模式只保留轻微色块（可选关闭），审阅模式显示名称。
  - 轴线：审阅模式的虚线；干净模式不画。
- **角色**：胶囊 + 头 + 朝向锥（表示脸朝向），无骨骼。按关键帧线性插值位置，朝向角度走最短弧。干净模式无名字标签；审阅模式在头顶显示名字。
- **机位**：审阅模式显示相机盒 + 按 FOV/aspect 计算的线框视锥 + “机位”标签；标签在相机接近观察相机时淡出。干净模式不画相机代理。
- **干净 POV**：透视相机每帧从插值后的 `camera.x/y/height` 出发，`lookAt` 插值注视点，`fov` 插值，`aspect` 跟画幅。相机高度以地面为 0。无网格、文字、手柄、路径线。
- **审阅环绕**：固定 3/4 高机位看向场地中心，慢慢环绕（可选 0 或 0.5 圈）；带网格/名称/路径/机位视锥，便于人工理解空间，但不用于出片参考。
- **运镜**：所有路径由关键帧决定。`move` 只用于生成提示和手持抖动：
  - `手持`：在干净 POV 的机位位置/注视点叠加由 `seed + t` 决定的低幅正弦抖动（约 ±2px 等效角），不改变关键帧端点。
  - 其他 `move` 只做平滑插值，不再固定“前推 0.6 米”。
- **时长/画幅**：
  - `duration` 由调用方传 `effectiveSeconds`（2~12 秒），渲染器不再有默认 3 秒。
  - 长边 960，短边按项目 aspect 取偶数；16:9→960×540，9:16→540×960，4:3→960×720，1:1→960×960。
  - 30fps；`frames = round(duration*30)`，从 0 到 `frames` 逐帧渲染。
- **录制**：
  - 先渲染 t=0，再 `MediaRecorder.start()`。
  - 用 `setTimeout(1000/fps)` 驱动确定帧，而不是只依赖 `requestAnimationFrame`（后台/无头会节流，之前实测会挂起）；每帧检查 `signal.aborted`。
  - 停止后等待 `onstop`，返回 Blob；取消时停 track、dispose，抛 `AbortError`，不保存。
  - 进度回调 `onProgress(0~1)`；编辑器显示进度条和取消按钮。
- **保存/抽帧**：沿用 `saveScheduleVideo`（webm→mp4）和 `extractFrames`。干净模式渲染完成后才允许抽帧/视频参考；审阅模式视频标记为 `review`，下游禁用。
- **洁净度检查**：渲染器提供 `annotations` 参数；干净模式不创建任何 Sprite/text/GridHelper/path Line，而不是创建后隐藏，避免透明对象仍被录进去。

### 7. `motionNote` 与指纹

`motionNoteOf(layout, blocking, duration, move)`：

- 相机：比较首末机位与注视点。位置变化→“从场地 X 侧向 Y 侧移动约 N 米”；高度变化→“升高/降低 N 米”；注视方向变化→“向左/右摇约 N 度”；无变化→“机位固定”。
- 演员：逐人比较首末位置，写“A 从场地 X 侧走到 Y 侧，约 N 米”；原地只写朝向变化（如果有）。
- 时长：`约 N 秒`；`手持` 标注“有呼吸抖动”。
- 不使用固定 0.6 米；所有距离用 `SceneLayout.w/h` 换算。
- 文案是派生数据：渲染时写入 `motionNote`，出片前若 blocking 存在则用当前 blocking 重算，避免旧文案。

指纹：

```ts
scheduleMeta = {
  version: 1,
  fingerprint: hash(canonical({
    layout: sanitizeSceneLayout(layout),
    blocking,
    duration: effectiveSeconds,
    aspect,
    mode,
    renderer: 1,
  })),
  mode,
  duration, aspect, width, height, renderedAt
}
```

- `canonical()` 排序对象键、固定数字精度（米/角度 4 位、归一化 6 位），避免仅因浮点尾差误判过期。
- `hash` 用两个不同种子的 FNV-1a 32 位拼成 16 位十六进制；不引入加密依赖。用于过期判断，不做安全用途。
- `isScheduleFresh(node, layouts, aspect)`：有 `scheduleVideo`、`scheduleMeta`、`meta.mode === 'clean'`、指纹等于当前输入，且 `scheduleMeta` 版本匹配。缺 meta/旧视频/review 视频都返回 false。
- Inspector 显示“已过期 / 仅审阅 / 生效”；过期时提供“重新渲染”按钮。
- `generateVideoOne` 在 `useScheduleVideoRef` 或 `useScheduleFrames` 为真时检查 `isScheduleFresh`；不通过则中止并提示，不把旧视频提交给 Seedance。未使用调度参考时不受影响。
- 场景布局变化后，App 当前的 `sceneLayouts` 已更新，所有同场镜头的 fresh 检查自动变为 false；无需给每个镜头写标记。

### 8. 入口与下游

- Inspector 的 3D 调度区增加：
  - “编辑 3D 调度”按钮（打开全屏编辑器）。
  - 状态徽标：“生效 / 已过期 / 仅审阅 / 未渲染”。
  - 显示实际时长、画幅、场景名；过期/审阅时禁用视频参考与抽帧参考。
- 右键菜单：
  - 保留“生成调度视频（3D）”：缺场次/布局/走位时自动生成（布局用 AI 或兜底，走位用 AI 或兜底），校验后按干净模式渲染；失败不覆盖旧视频。
  - 新增“编辑 3D 调度…”。
  - 保留“调度关键帧作参考”，但只在 fresh clean 视频上可用。
- `genScheduleVideo` 改为：
  1. 取/建布局（缺失时 AI 生成，失败用兜底并 toast）。
  2. 取/建 blocking（校验后保存到节点）。
  3. `renderScheduleVideo({mode:'clean', duration: effectiveSeconds, aspect: projectAspect})`。
  4. 保存 mp4，写 `scheduleMeta`、`motionNote`；按需抽 3 帧。
- `generateVideoOne` 的 `motionNote` 更新为用当前 blocking 计算；其余首帧/多帧/视频参考分支不动。
- `ShotData` / `ProjectShot` / `bizSignature` 增加新字段；`nodeToShot`/`shotToData` 做 snake/camel 映射。`layout` 继续读写但不再作为主数据。
- `ShotTable` 拆镜输出 `scene_no` / `scene_slug`；保存时字段透传，无需新增数据库列。

### 9. 验证策略

- 纯几何/上下文/生成编排用 `verify-3d-geometry.mjs`：通过仓库已有的 `esbuild` 把 `src/scheduleGeometry.ts` / `src/scheduleAI.ts` 打成临时 ESM 后做 Node 断言，不新增测试框架。
- 新增 `verify-scene-blocking.mjs`（Playwright + mock `/api/text` + 真实 3D 渲染）：
  - 拆镜返回 `scene_no`，镜头与场次绑定；同场两镜共享布局。
  - 请求体断言：场景生成包含 beats/place/time/人物/场景卡；走位生成包含台词、说话人、videoPrompt、marks 摘要、seconds、角色 lookEn、场景 JSON。
  - 模型返回编造角色/墙内站位/倒序关键帧 → 修复请求发出；修复失败不覆盖既有数据。
  - 编辑器拖拽角色/机位、数值改高度/FOV、撤销重做、未保存提示、保存后重开恢复。
  - 场景修改后同场镜头显示过期；重新渲染后恢复；过期时开启视频参考被拒。
  - 镜头 2 秒/9:16 渲染：用 ffprobe 断言时长和尺寸；`scheduleMeta.mode='clean'`；审阅渲染标记仅审阅且不能参考。
  - 旧 `layout` 迁移为单关键帧；旧视频标过期；项目 A/B 布局隔离。
- 手工视觉验收：干净 POV 无标签/网格；推镜主体变大、摇镜方向改变；墙/门洞/固定物关系可读；最后一帧无遮挡。
- 回归：`npm run build`、`verify-schedule3d.mjs`、`verify-video-ref-ui.mjs`、`verify-video-ref-api.mjs`、`verify-cast-full.mjs`、`verify-project-scope.mjs`。
- 不新增真实 Seedance 2.0 调用；渲染验证只生成本地 mp4。

## Risks / Trade-offs

- **[AI 布局质量不稳定] →** 结构化输出 + 一次修复 + 可视化编辑器；错误可见、可手改，不静默产出错误几何。
- **[文本上下文过长] →** 当前场次/镜头优先，逐字段截断，关联镜头最多 30 条；超限提示而不是无限拼接。
- **[POV 白模仍可能被 Seedance 学成几何风] →** 干净模式去掉文字/网格；提示词继续声明“只参考走位/运镜，不照搬白模材质”；视频参考保持可选，默认关闭。
- **[场景与镜头数据双写不一致] →** 场景布局独立保存，镜头保存包含 `sceneNo`；过期指纹自动暴露不一致，不自动猜测修复。
- **[MediaRecorder 在后台/无头环境失败] →** 定时器逐帧驱动 + 可取消；失败时保留旧视频并给明确错误；不退回固定 3 秒。
- **[大 JSON 写入 shots.extra] →** 限制墙/物/分区/关键帧数量和字段精度；单镜 blocking 预计 < 8KB。
- **[场次改号导致孤立布局] →** 布局保留并显示孤立提示，用户手动改绑；不自动删除。
- **[旧项目没有场景] →** 兜底空间明确标 `fallback`，不是伪造用户数据；保存后才入库。

## Migration Plan

1. 先落 DB 新表、读写成对、项目 API 白名单和类型；旧项目读出新字段为空，不写任何默认布局。
2. 加布局/走位生成与校验；先不接 UI，用 mock 文本模型验证 JSON 契约和修复。
3. 重写渲染器，保留旧 `layout` 适配；用旧项目验证单关键帧可渲染。
4. 接编辑器与 Inspector/右键入口；保存走乐观并发（单用户）。
5. 接过期语义和下游拦截；最后更新 README 与回归脚本。
6. 回滚：移除 UI 入口即可恢复旧 3D 流程；新表/新字段保留但不读取，旧 `layout`/`scheduleVideo` 未删除。无需数据库降级脚本。

## Open Questions

无。视觉模型提取场景、角色骨骼、多人打斗编排和云渲染均为后续独立变更；不影响本次规格与任务拆分。

## Verification

2026-10-22 人工视觉验收（干净 POV，无网格/名字/机位标签/辅助线）：

- 16:9 推镜：`visual-16-push-1792661138785`，4s / 960×540，`/videos/schedule-1792661148562-58c06f.mp4`。首/中/尾帧见 [p16-push-00.png](evidence/p16-push-00.png)、[p16-push-20.png](evidence/p16-push-20.png)、[p16-push-39.png](evidence/p16-push-39.png)。可看到北墙门洞、半高墙、立柱与固定物；角色从画面左侧向中心移动，机位前推；最后一帧无标签遮挡。
- 9:16 摇镜：`visual-9-pan-1792661138785`，3s / 540×960，`/videos/schedule-1792661158812-9465db.mp4`。首/中/尾帧见 [p9-pan-00.png](evidence/p9-pan-00.png)、[p9-pan-15.png](evidence/p9-pan-15.png)、[p9-pan-29.png](evidence/p9-pan-29.png)。机位不动，注视点横向扫过，角色从右缘进入画面中心再向左移出，门洞/立柱随之入画。
- 审阅视图：见 [review-view.png](evidence/review-view.png)。显示网格、角色名、机位标签和朝房间内的 FOV 视锥；该视图不用于出片参考。

结论：墙/门/固定物关系可读，干净 POV 无文字与辅助线，关键帧驱动的运镜方向正确；角色仍是胶囊白模（本变更的非目标），未发现最后一帧遮挡。真实 Seedance 2.0 冒烟不在本次自动化范围。
