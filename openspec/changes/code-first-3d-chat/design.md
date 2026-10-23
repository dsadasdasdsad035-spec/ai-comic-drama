# Design

## Context

当前 3D 调度由 `ShotScene`/`ShotBlocking` 驱动，渲染器 `schedule3d.ts` 按结构化布局重建白模；编辑器 `SceneScheduleEditor.tsx` 用 SVG 平面拖拽墙体和角色，聊天 `shotChat.ts` 只允许受限 patch。这个链路已经能稳定生成预演和视频参考，但场景内容被固定为“墙 + 固定物 + 胶囊角色 + 机位关键帧”，选中的角色图、场景图、道具图和分镜生成图只能进入参考板，不能成为 Three.js 材质或背景。

已有约束：

- 项目数据通过 SQLite `shots.extra` 兜底保存未知镜头字段，新增字段不需要建表迁移。
- 浏览器端已有 Three.js、MediaRecorder、`/api/save-video` 和 `/api/frames`；渲染是本地浏览器行为。
- 现有 `scheduleVideo`、`scheduleMeta`、`useScheduleVideoRef`、`useScheduleFrames` 是 Seedance 下游协议，不能改变请求结构。
- 旧项目可能只有 `layout`、`shotScene`、`shotBlocking` 或旧 `scheduleVideo`，必须继续可打开。
- 当前模型表按 `text` / `textPro` / `vision` 等能力路由；没有视频理解模型，也没有独立的代码模型环节。

## Goals / Non-Goals

**Goals:**

- 每个镜头一段 Three.js 代码，代码是场景唯一真相；聊天和手改都直接编辑同一段代码。
- 代码在隔离沙箱里加载选中素材，按镜头时长/画幅试运行、预览和录制本地视频。
- 工作台围绕“参考内容 → 预览 → 聊天/代码”组织，参考内容可选、可预览、可持久化。
- 选中图片和视频关键帧既作为代码素材，也作为媒体 brief 进入代码生成/聊天。
- 旧结构化镜头只读可看，显式转换后才写代码；旧视频、旧参考通路不破坏。
- 代码或素材变化后调度视频明确过期，不能静默用于 Seedance。

**Non-Goals:**

- 不做结构化空间与代码之间的双向同步；代码不是 `ShotScene` 的另一种序列化。
- 不自动把旧 `ShotScene` 转成语义等价的代码；转换是显式的 AI 动作。
- 不恢复角色名单、穿墙、碰撞、空间连续性或运镜路径的自动校验。
- 不把完整视频作为 Three.js 视频纹理逐帧确定性播放；视频在运行时以关键帧进入。
- 不新增云渲染、对象存储、外部代码执行服务或第三方 Three.js 插件市场。
- 不改变 Seedance 视频参考、抽帧参考和计价协议。

## Decisions

### 1. 每镜代码模型与持久化形状

新增：

```ts
type SceneCode = {
  version: 1
  abiVersion: 1
  code: string
  codeHash: string
  source: 'ai' | 'manual' | 'legacy-converted' | 'fallback'
  title?: string
  motionNote?: string
  updatedAt: string
}

type SceneCodeAssetRef = {
  key: string
  url: string
  kind: 'image' | 'video-frame'
  contentHash: string
  label: string
}

type SceneCodeMeta = {
  version: 1
  fingerprint: string
  codeHash: string
  abiVersion: 1
  assets: SceneCodeAssetRef[]
  duration: number
  aspect: string
  width: number
  height: number
  fps: 30
  mode: 'clean'
  renderedAt: string
}

type Shot3DContext = {
  version: 1
  characterIds: string[]
  designIds: string[]
  assetUrls: string[]
  imageUrls: string[]
  videoUrls: string[]
  sceneKeys: string[]
  text: {
    prompt: boolean
    videoPrompt: boolean
    dialogue: 'all' | number[]
    cast: boolean
    marks: boolean
    sizeMove: boolean
  }
  dialogueHash?: string
  updatedAt?: string
}
```

`ShotData` / `ProjectShot` 增加 `sceneCode` / `scene_code`、`sceneCodeMeta` / `scene_code_meta`、`shot3DContext` / `shot_3d_context`。继续放在 `shots.extra`，由 `shotSync.ts` 做 camel/snake 映射，`bizSignature` 纳入这些字段。

选择使用稳定引用而不是复制内容：角色用 `id`，设定卡用 `id`，场次用 `E01-SC02`，手工素材/图片/视频用 URL。URL 失效时显示缺失，不自动替换成别的资源。

**Alternatives considered:** 把选择展开成完整资源快照写入项目。这样刷新后不依赖资源表，但会让项目文件随图片/视频重复膨胀，且资源改名后仍然失真；不采用。

### 2. 最小 ABI 与运行时职责

代码必须定义三个入口：

```js
function init(ctx) {
  // ctx: THREE, scene, camera, renderer, assets, width, height, aspect, duration, shot
}

function renderAt(t, mode) {
  // t: 0..duration 秒；mode: 'clean' | 'review'
}

function dispose() {}
```

约定：

- 运行时创建 `scene`、`camera`、`renderer` 和 canvas，代码在 `init` 中往 `scene` 添加对象、设置 `camera`。
- 每次 `renderAt(t, mode)` 返回后，运行时调用 `renderer.render(scene, camera)`；代码负责更新对象 transform、材质、uniform 和相机。
- 代码不能依赖 `requestAnimationFrame`、`Date.now()` 或随机数来表达动画；动画必须由 `t` 决定。运行时仍会为每帧传入同一个 `t`，不额外注入时钟。
- `dispose` 释放代码创建的几何、材质、纹理、RenderTarget 和事件监听；运行时会再释放 renderer 和 scene 兜底。
- `ctx.assets` 是 `Map<string, SceneAsset>`：

```ts
type SceneAsset = {
  key: string
  kind: 'image' | 'video-frame'
  label: string
  texture: THREE.Texture
  width: number
  height: number
  videoDuration?: number
  frameTime?: number
}
```

视频素材只注入关键帧纹理和元数据，代码可以按 `frameTime` 使用多张纹理，但不能假设有可播放的 `<video>`。这样录制不依赖视频 seek，输出更稳定。

**Alternatives considered:** 让代码自己创建 renderer 和 canvas。自由度高，但父页面无法统一控制 canvas 尺寸、录制和资源释放；不采用。**Alternatives considered:** 在 Web Worker + OffscreenCanvas 中执行。隔离更好，但 MediaRecorder/视频帧/编码链路复杂，且用户代码仍需要 DOM 能力；本期用 iframe。

### 3. 沙箱加载方式：srcdoc + 内联 IIFE 运行时

运行时打包为单文件 IIFE（包含 Three.js core），由构建脚本 `scripts/build-sandbox-runtime.mjs` 用 esbuild 生成 `src/sandbox/runtime.generated.js`，父页面通过动态 `?raw` 导入，按需加载，避免把 1MB+ 代码放进主 bundle。

父页面创建：

```html
<iframe
  sandbox="allow-scripts"
  referrerpolicy="no-referrer"
  srcdoc="<!doctype html><meta http-equiv='Content-Security-Policy'
    content=\"default-src 'none'; script-src 'unsafe-inline' 'unsafe-eval';
    style-src 'unsafe-inline'; img-src blob: data:; media-src blob: data:;
    connect-src 'none'; frame-src 'none'; object-src 'none'; base-uri 'none'\">
    <style>html,body{margin:0;overflow:hidden;background:#111}canvas{display:block}</style>
    <script>...runtime.generated.js...</script>"
></iframe>
```

关键点：

- `sandbox="allow-scripts"` 但不加 `allow-same-origin`，iframe 是 opaque origin，不能读父页面 DOM、localStorage、Cookie 或同源接口。
- 不加 `allow-top-navigation`、`allow-forms`、`allow-popups`。
- CSP 在 srcdoc 内，`connect-src 'none'` 阻断网络；`img-src`/`media-src` 只允许沙箱内创建的 blob/data URL。
- 运行时只接受带本次随机 token 和已知 `type` 的 `message`；父页面同时校验 `event.source === iframe.contentWindow`。
- 用户代码不进入 srcdoc，而是在沙箱内通过 `new Function` 编译；`unsafe-eval` 只存在于沙箱 CSP，不影响主应用。

**Alternatives considered:** `src="/sandbox.html"` 独立页面。需要处理 opaque origin 的 CORS、CSP host 和构建入口，部署更脆弱；不采用。**Alternatives considered:** 主线程 `new Function`。无法阻止代码访问父页面；不采用。

### 4. 素材传输与指纹

父页面负责解析选中资源并读取字节：

- 角色图、设定卡图、项目图片：`fetch(url).arrayBuffer()`。
- 视频：先用 `/api/frames` 抽 3 帧，读取帧图片字节；记录视频时长。
- 图片在父页面按长边上限缩放（建议 2048），避免 GPU 纹理过大；缩放不改变原始文件。
- 每个素材计算 SHA-256 内容哈希，生成稳定键：

```text
character:<id>
design:<id>
asset:<url-hash>
image:<url-hash>
video:<url-hash>:frame:<index>
```

- 父页面通过 `postMessage` 发送 `{ token, type: 'init', assets: [{ key, kind, label, mime, bytes, width, height, videoDuration, frameTime }] }`，`bytes` 使用 transferable。
- 沙箱为每个字节数组创建 Blob URL，加载成 `ImageBitmap`/`HTMLImageElement`，再创建 `THREE.Texture`；不访问网络。
- 缺失或损坏素材不阻止其他素材；运行时报告 `missingAssets`，代码可通过 `ctx.assets.has(key)` 判断。

限制建议：代码 ≤ 200KB；图片 ≤ 16 张；视频 ≤ 4 个、每个 3 帧；单张长边 ≤ 2048（原始超过则缩放）；单次素材总字节 ≤ 48MB。具体数值集中定义，便于调整。

**Alternatives considered:** 直接把项目 URL 传给沙箱加载。opaque origin 下 CORS 和 Cookie 行为不可控，也违反“无网络”的边界；不采用。

### 5. 代码准入、试运行与失败回滚

新增 `sceneCodeSanitize.ts`：

- 去掉 Markdown 代码围栏。
- 大小、空代码、截断标记检查。
- 静态拒绝明显外联/越权：`import(`、`require(`、`fetch(`、`XMLHttpRequest`、`WebSocket`、`importScripts`、`document.cookie`、`localStorage`、`parent.`、`top.`。静态检查只做早失败，真正边界是沙箱。
- 检查文本中是否声明 `init`、`renderAt`、`dispose`。

新增 `sceneCodeRuntime.ts`（父页面控制）与 `sandbox/runtime.ts`（iframe 内）：

1. 创建 iframe，等待 `load`。
2. 发送 `init`，沙箱编译代码、加载素材、执行 `init()`、`renderAt(0)`、`renderAt(duration)`，每步回报。
3. 初始化超时 5s；单帧超时 250ms；整段试运行超时 15s。超时销毁 iframe，重建后回到上一版代码。
4. 成功返回 `ready` 和一张首帧；父页面才把新代码设为当前草稿。
5. 失败返回 `{ phase, message, stack }`；保留旧代码、旧预览、旧视频。

WASM/无限循环/GPU hang 无法在 JS 内可靠中断，因此超时后直接移除 iframe 是唯一可靠恢复方式。

**Alternatives considered:** 只做语法检查，不试运行。LLM 代码经常在运行时才暴露 `THREE` 用法错误；不采用。**Alternatives considered:** 用 diff/patch 应用代码。diff 解析与冲突处理复杂，且用户要求“修改范围更大”；本期统一返回完整代码。

### 6. 预览、时间轴与录制

父页面与沙箱的消息协议：

```ts
type ParentToSandbox =
  | { token: string; type: 'init'; code: string; assets: AssetPayload[]; width: number; height: number; aspect: string; duration: number; mode: 'clean' | 'review' }
  | { token: string; type: 'play' }
  | { token: string; type: 'pause' }
  | { token: string; type: 'seek'; t: number }
  | { token: string; type: 'capture' }
  | { token: string; type: 'record' }
  | { token: string; type: 'cancel' }
  | { token: string; type: 'dispose' }

type SandboxToParent =
  | { token: string; type: 'ready'; width: number; height: number }
  | { token: string; type: 'time'; t: number }
  | { token: string; type: 'frame'; dataUrl: string }
  | { token: string; type: 'progress'; phase: 'render'; value: number }
  | { token: string; type: 'video'; buffer: ArrayBuffer; mime: string }
  | { token: string; type: 'error'; phase: 'compile' | 'init' | 'frame' | 'record'; message: string; stack?: string }
```

预览：

- iframe 内部按容器比例设置 canvas；父页面拖动时间轴时发送 `seek`，沙箱调用 `renderAt(t, mode)` 并渲染。
- 播放用 `setTimeout(1000/fps)` 推进，不依赖 `requestAnimationFrame`（后台标签页会节流）。
- 父页面不能读取 iframe canvas；缩略图通过 `capture` 让沙箱 `toDataURL` 返回。

录制：

- 沙箱使用 `canvas.captureStream(30)` + `MediaRecorder`，按 `t = i/frames * duration` 逐帧调用 `renderAt`，与现有 `schedule3d.ts` 的确定性录制思路一致。
- 录制只接受 `clean` 模式；`review` 仅预览。
- 完成后通过 transferable `ArrayBuffer` 回传；父页面转 dataURL 调 `/api/save-video`，继续走 webm→mp4。
- 取消时沙箱停止 recorder 并丢弃 chunk；父页面不保存，旧 `scheduleVideo` 不变。
- 录制进度按帧回报；父页面关闭/切换镜头时先 `cancel` 再 `dispose`。

### 7. 代码生成与聊天编排

新增 `sceneCodeJob.ts`、`sceneCodeChat.ts`、`sceneCodePrompt.ts`：

- 首次生成：选中上下文 + 媒体 brief + ABI 文档 + 镜头元数据 → code model → `{ reply, code, motionNote? }`。
- 聊天：当前完整代码 + 最近 6 条聊天 + 选中上下文/媒体 brief + ABI 文档 + 用户消息 → code model → 完整新代码。
- 两者都使用设置中的 `sceneCode` 文本环节；未配置时回退文本默认模型，仍无模型则禁用 AI 生成。
- `motionNote` 由模型或用户提供，不声称从代码几何推导；它只用于下游 Seedance 提示词。
- 代码输出失败（截断、空、非代码）时不应用；错误显示在聊天/代码页签。
- 代码模型上下文不包含图片 base64；只包含选择清单、媒体 brief 文本和素材稳定键。

聊天历史只保存在编辑器会话内，不写入项目；项目只保存代码、选择、渲染元数据和可选的 motionNote。

### 8. 媒体 brief

新增 `mediaBrief.ts`：

- 把选中的图片和视频关键帧按标签合成一张或多张参考板（最多 16 格；视频用 3 帧条带）。
- 使用 `vision` 能力调用视觉模型，输出：

```ts
type MediaBriefItem = {
  key: string
  label: string
  kind: 'image' | 'video-frame'
  description: string
  subjects?: string[]
  composition?: string
  style?: string
  camera?: string
}
type MediaBrief = {
  version: 1
  usedVision: boolean
  modelKey?: string
  items: MediaBriefItem[]
  summary?: string
  fingerprint: string
}
```

- 缓存键包含选中素材的内容哈希、标签、brief 版本；图片不变时聊天不重复调用视觉。
- 没有视觉模型时 `usedVision=false`，只发送素材清单和标签；UI 明确“素材未参与理解”。
- 视频在聊天中只走关键帧；`videoVision` 只在首次代码生成时可选调用。原生视频输入若渠道不支持本地文件，则返回明确 `unsupported-video-input` 并回退关键帧，不把视频 base64 写入项目或日志。

**Alternatives considered:** 把每张图直接作为多模态消息发给代码模型。代码模型可能不支持图像；且无法复用视觉 brief 缓存；不采用。

### 9. 工作台状态与布局

新增 `SceneCodeWorkbench.tsx`，替换当前 `SceneScheduleEditor.tsx` 的打开入口。布局：

```text
┌────────────────────────────────────────────────────────────┐
│ 返回 · S01 · 3.0s · 16:9 · 代码状态   [保存] [渲染] [关闭] │
├───────────────┬──────────────────────────┬─────────────────┤
│ 参考内容       │  3D 预览（iframe）        │ 聊天 / 代码      │
│ 角色 场景 道具 │                          │ [聊天] [代码]    │
│ 图片 视频 文本 │                          │ 已选 chips       │
│ 搜索 / 勾选    │                          │ 聊天记录         │
│ 已选列表       │  时间轴 / 播放 / 进度     │ 输入框           │
└───────────────┴──────────────────────────┴─────────────────┘
```

状态：

- `savedCode` / `draftCode` / `context` / `savedContext` / `history` / `future` / `dirty`。
- 首次打开：加载项目 → 读取选择；无选择则按默认上下文；有 `sceneCode` 直接试运行；无代码无 legacy 自动生成；只有 legacy 显示只读预览。
- 保存：试运行当前草稿 → 写入代码、选择、`sceneCodeMeta`（若渲染过）→ 更新 baseline。
- 渲染：用当前草稿/选择渲染 → 成功后保存代码、选择、视频、`scheduleMeta`、`motionNote`。
- 关闭未保存：保存/放弃/继续；`beforeunload` 提示。
- 撤销/重做：代码和选择一起入栈（最多 50 步）；撤销后重新试运行。

窄屏：

- `<= 1100px`：右栏变成可切换的底部面板，参考内容变抽屉。
- `<= 760px`：单列，预览在上，聊天/代码为全宽页签；时间轴保持可达；禁止横向溢出。
- 参考内容选择器沿用现有素材选择器的预览语义：图片缩略图、视频首帧/时长、缺失占位、搜索和数量。

### 10. 旧结构化链路

保留 `shotScene.ts`、`schedule3d.ts`、`shot3dJob.ts` 和 `shotChat.ts` 作为 legacy 代码，不再从新编辑器调用结构化编辑。

- 打开只有 `shotScene`/`shotBlocking`/`layout` 的镜头：用 `resolveShotSceneForProjectShot` + `legacyLayoutToBlocking` 构建只读预览；`buildScheduleScene` 渲染审阅/POV。
- 顶部显示“旧结构化 3D · 只读”，提供“生成代码版本”。
- 转换时把旧结构化 JSON 作为文本上下文交给代码模型，生成代码后试运行；确认后才写 `sceneCode`，旧字段保留。
- 旧 `scheduleVideo` 继续播放；过期判断按新指纹，缺失/不同即过期。
- 旧的 `visualBrief` 不再用于新代码生成；作为 legacy 上下文可选显示。

这样避免自动迁移带来的语义损失，也避免用户已有工作丢失。

### 11. 指纹与下游

新增 `sceneCodeFingerprint.ts`：

```ts
fingerprint = hash({
  abiVersion,
  codeHash,
  assets: assets.map(a => [a.key, a.contentHash, a.kind]),
  duration,
  aspect,
  mode: 'clean',
})
```

- `isScheduleFresh` 分支：有 `sceneCode` 用新指纹；否则走旧 `scheduleFingerprint`。
- `codeHash` 由代码文本计算；`assets` 来自运行时实际注入的素材，不是全部选中项。
- 代码、素材、时长或画幅变化 → 当前镜过期；其他镜头不受影响。
- `useScheduleVideoRef` / `useScheduleFrames` 的现有拦截逻辑复用，只改 freshness 判定。
- 右击“生成调度视频（3D）”在没有打开编辑器时也使用隐藏沙箱渲染；有代码直接渲染，没有代码则先生成/转换。

### 12. 模型配置

- `Cap` 增加 `videoVision`；`Stage` 增加 `sceneCode`、`videoVision`。
- `sceneCode` 属于文本族，设置页新增“3D 代码（生成/聊天）”，默认沿用文本默认模型。
- `videoVision` 只列声明视频理解能力的模型；未配置时首次生成回退关键帧，聊天永远不用它。
- 服务端 `/api/text` 继续处理代码生成；`/api/vision` 处理图片/关键帧；如启用 `videoVision`，新增受控的 `/api/video-vision`，只接受本地已知视频路径和声明能力的模型，失败返回明确错误。
- 当前没有标准方舟视频理解模型/Key 时，`videoVision` 为空，系统仍可完整使用关键帧路径；不把缺失模型伪装成已使用。

### 13. 安全与资源边界

- 沙箱无同源、无网络、无 top navigation、无表单/弹窗；只接受 token 消息。
- 代码大小、素材数量、图片尺寸、渲染分辨率、总时长、执行时间均有硬上限。
- 父页面不把 API Key、项目路径、临时签名 URL 发给沙箱；素材只传字节。
- 项目只保存代码、稳定引用、内容哈希和渲染参数；不保存 blob/dataURL、模型原始响应或沙箱日志。
- 视觉/视频请求沿用现有 Key 解析；日志只记录模型/provider 元数据，不记录 Key。

## Risks / Trade-offs

- **LLM 代码质量不稳定** → 强制试运行、错误可见、保留旧代码、代码页签可手改；失败不保存。
- **代码可能无限循环/耗尽 GPU** → init/单帧/总渲染超时 + 直接销毁 iframe；限制分辨率和代码大小。
- **沙箱不是绝对安全边界** → 无同源 + CSP 无网络 + token 消息 + 不暴露敏感数据；仍提示这是本地执行不可信代码，需保持浏览器更新。
- **失去结构化校验/连续性** → 工作台明确提示；不伪造警告；旧结构化只读。
- **代码难以逐帧确定性** → ABI 以 `t` 为唯一时间源，提示禁止 wall-clock/random；试运行检查首尾帧，但不能保证所有代码都确定。
- **WebGL/MediaRecorder 浏览器差异** → 启动时检测 WebGL 和录制格式；失败给明确错误，保留旧视频。
- **大素材导致传输/纹理压力** → 图片缩放、素材数量/总字节上限、视频只取关键帧。
- **原生视频理解渠道不支持本地文件** → 功能门控 + 回退关键帧；不新增对象存储，不伪造已理解。
- **构建复杂度增加** → 运行时生成脚本纳入 `predev`/`prebuild`，测试前显式构建；生成文件不提交。
- **代码生成成本高于 patch** → 先只做完整替换；后续可在不改 ABI 的前提下加 diff 优化。

## Migration Plan

1. 先加类型、持久化字段、`bizSignature`、`shotSync` 映射；旧字段保持读写，不删除。
2. 加沙箱运行时构建脚本、iframe 客户端、纯函数测试；先用手写固定代码验证预览/录制/超时。
3. 加媒体 brief、上下文选择器和默认选择；旧编辑器仍可用，作为回退入口。
4. 加代码工作台和 App 集成；新镜头走代码，旧镜头显示 legacy 只读。
5. 加代码生成/聊天和模型设置；用 mock 模型跑完整链路。
6. 加 Inspector 过期状态和右击渲染；保留旧 `scheduleVideo` 播放与 Seedance 参考协议。
7. 跑构建、沙箱安全/超时、UI、渲染、Seedance 参考和旧项目回归；视觉验收后再归档。

回滚：代码字段是新增字段，旧数据未删除；回滚前端后旧结构化编辑器仍能读旧字段。已生成的 `sceneCode` 会被旧版本忽略，但不会丢失。沙箱构建脚本和生成文件可删除而不影响旧路径。

## Open Questions

无。原生视频理解的渠道输入能力作为实现前的门控验证；不支持时按已定策略回退关键帧，不改变本设计或规格。
