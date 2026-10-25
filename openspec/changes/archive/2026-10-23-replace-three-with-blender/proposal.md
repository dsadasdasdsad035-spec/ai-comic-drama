# Proposal

## Why

当前每镜 3D 调度是一段在浏览器 iframe 里执行的 Three.js 代码：只有程序化几何与贴图，录制靠 `MediaRecorder` 墙钟推进。它能把机位和粗略走位表达出来，但表达不了真实资产、真实光照和真实镜头参数；而且录制时长会被场景复杂度拖慢，服务端再用 `-t duration` 截断，重场景可能只输出前半段动作。预演因此只能当"给模型看的示意"，不能当"给人看的镜头"。

用户已决定把 Three.js 全部替换为 Blender，让预演成为真正的三维场景，并把渲染移出浏览器以获得帧精确的输出。这是一个明确的取舍：放弃浏览器内的实时预览与秒级反馈，换取真实感、帧精确和可交付的工程文件。

## What Changes

- 每镜场景代码从 Three.js JavaScript 改为 Blender Python（bpy），ABI 由 `init(ctx)/renderAt(t, mode)/dispose()` 改为 `build(ctx)/pose(t, mode)/dispose()`，由宿主逐帧 `frame_set` → `pose` → 渲染。
- 新增本机 Blender 渲染宿主：作业队列、三档渲染（试运行 / 代理预览 / 定稿）、进度上报、取消、超时、健康检查与安装检测，产物直接写项目媒体目录。
- 视频输出改为 PNG 帧序列 + 现有 ffmpeg 编码，帧精确；移除 webm → base64 → JSON 回传这条通路。
- 编辑器预览从"iframe 实时播放"改为"代理片"：打开镜头渲一遍低清代理，时间轴在代理片上拖动；代码或素材变化后代理标脏并重渲。
- 选中素材从内存 `ArrayBuffer` 注入改为落盘到一次性工作目录，代码通过稳定键取路径；键与缺失语义不变。
- **BREAKING**：移除浏览器沙箱（`allow-scripts` iframe + CSP）这条安全边界。bpy 以本机用户权限执行，隔离承诺降级为"本地受信执行 + 静态准入 + 临时工作目录"。
- **BREAKING**：旧结构化 3D 预览退役（`schedule3d.ts` 的渲染部分与 `LegacyScenePreview`）。只带 `shotScene`/`shotBlocking` 的旧镜头不再有 3D 画面，需显式转换成 Blender 代码后才能预览。
- **BREAKING**：`SceneCode.abiVersion` 由 1 升到 2，新增 `runtime` 与 `engineVersion`；旧 Three.js 代码不做运行时兼容，提供一次性 AI 重译为 bpy。
- **BREAKING**：新增运行前置——本机必须安装 Blender 并钉死一个版本；未安装时 3D 生成与渲染禁用并给出可操作提示，手写代码与保存不受影响。
- Agent 的 `run_sandbox` 工具语义改为"申请一次渲染作业"，`capture_frames` 从渲染产物取帧；工具集不新增 shell、文件写入或网络能力。
- 渲染指纹加入运行时标识与引擎版本，切换引擎或升级 Blender 后旧调度视频自动标脏。
- 删除 `three` 与 `@types/three` 依赖、`build:sandbox` 预构建步骤与 749 KB 沙箱运行时产物。

## Capabilities

### New Capabilities

- `blender-render-host`: 本机 Blender 进程的安装检测、作业生命周期（提交/进度/取消/超时/清理）、三档渲染、并发与资源上限、帧精确输出与产物落盘。

### Modified Capabilities

- `scene-code-runtime`: 运行时从浏览器 Three.js 沙箱改为本机 Blender 进程；ABI、素材注入、试运行、预览、安全边界、超时预算与指纹全部随之改变。
- `scene-blocking-3d`: 工作台的代码语言、试运行机制、预览形态改变；旧结构化 3D 的只读预览与迁移要求被替换为"退役 + 显式转换"。
- `scene-agent-runtime`: 沙箱运行与抓帧工具的语义改为渲染作业；工具边界与失败保留规则随执行模型调整。

## Impact

- 删除：`src/sandbox/runtime.ts`、`src/sandbox/runtime.generated.js`、`scripts/build-sandbox-runtime.mjs`、`src/LegacyScenePreview.tsx`、`schedule3d.ts` 的渲染器部分、`SceneScheduleEditor.tsx`（已无引用）。
- 重写：`src/sceneSandbox.ts`（客户端 → 作业客户端）、`src/sceneCodeRender.ts`、`src/sceneCodePrompt.ts`、`src/sceneCodeSanitize.ts`、`src/sceneCodeAssets.ts`、`src/sceneCodeFingerprint.ts`、`src/sceneCodeFreshness.ts`。
- 调整：`src/SceneCodeWorkbench.tsx`（预览、时间轴、生成状态）、`src/agent/sceneAgentTools.ts`、`src/agent/SceneAgentChat.tsx`（文案与状态）、`src/App.tsx`（右键生成与保存通路）、`src/types.ts`（`SceneCode`、`SCENE_CODE_LIMITS`）。
- 新增：`server/blender.mjs`、`scripts/blender/host.py`、`/api/blender/{health,render,progress,cancel}` 路由。
- 数据：`SceneCode` 增加 `runtime`/`engineVersion`，`abiVersion` 升到 2；继续走 `shots.extra`，无需建表迁移；旧 `sceneCode` 标记为待转换。
- 依赖：移除 `three`、`@types/three`；新增运行前置 Blender（不进 npm 依赖）。
- 验证：`verify-code-workbench.mjs`、`verify-chat-first-3d.mjs`、`verify-canvas-code-fallback.mjs` 依赖 Three.js 代码内联，需改为 Blender 前置检查 + 新夹具。
