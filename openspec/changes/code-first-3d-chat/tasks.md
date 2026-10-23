# Tasks

## 1. 数据模型与持久化

- [x] 1.1 在 `src/types.ts` 增加 `SceneCode`、`SceneCodeAssetRef`、`SceneCodeMeta`、`Shot3DContext`，并给 `ShotData` 增加 `sceneCode`、`sceneCodeMeta`、`shot3DContext`；验证：`npx tsc --noEmit` 通过，旧字段不受影响。
- [x] 1.2 在 `src/api.ts` 的 `ProjectShot` 增加 `scene_code`、`scene_code_meta`、`shot_3d_context` 及 camelCase 兼容字段；验证：类型检查通过，旧项目 GET 返回不丢字段。
- [x] 1.3 更新 `src/shotSync.ts` 的 `bizSignature`、`nodeToShot`、`shotToData`，加入代码、选择、渲染元数据和 motionNote；验证：保存后重新 GET，camel/snake 双向映射一致。
- [x] 1.4 新增 `src/shot3dContext.ts`：选择 sanitize、去重、默认选择、台词索引 + `dialogueHash`、沿用上一镜选择；验证：Node 断言空选择、默认选择、台词变化、重复 URL、缺失资源。
- [x] 1.5 新增 `src/sceneCodeFingerprint.ts`：代码 SHA-256、素材内容哈希、稳定键、渲染指纹；验证：同一输入指纹稳定，改代码/素材/时长/画幅任一均变化，素材顺序不影响结果。
- [x] 1.6 新增 `verify-code-api.mjs`：临时项目保存代码、选择、渲染元数据，重读断言；项目 A/B 隔离；旧 `shot_scene`/`shot_blocking` 字段保留；验证：脚本全部通过。
- [x] 1.7 在 `server/db.mjs` 和 `/api/project` 的写入路径补回归断言，确认新字段仍走 `shots.extra` 且不被白名单丢弃；验证：`verify-code-api.mjs` 通过，无需新建表或迁移旧库。

## 2. 沙箱运行时与录制

- [x] 2.1 增加 `esbuild` 开发依赖和 `scripts/build-sandbox-runtime.mjs`，把 `src/sandbox/runtime.ts`（含 Three.js core）打成单文件 IIFE 到 `src/sandbox/runtime.generated.js`；加入 `build:sandbox`、`predev`、`prebuild`；验证：`npm run build:sandbox` 生成文件且包含 Three.js，生成文件不提交。
- [x] 2.2 实现 `src/sandbox/runtime.ts` 的核心 ABI：创建 renderer/scene/camera、编译代码、执行 `init`、`renderAt`、`dispose`，每帧由运行时渲染；验证：用固定示例代码在 Playwright 中看到立方体，`renderAt(0)` 与 `renderAt(duration)` 均可渲染。
- [x] 2.3 在运行时实现素材加载：接收字节数组、创建 Blob/ImageBitmap/Texture、注入 `ctx.assets`、支持视频关键帧元数据、缺失素材报告；验证：角色图可作为纹理，缺失键不阻塞其他素材。
- [x] 2.4 实现父页面 `src/sceneSandbox.ts`：srcdoc CSP、`sandbox="allow-scripts"`、随机 token、消息校验、iframe 销毁/重建；验证：伪造 token 和未知消息被忽略。
- [x] 2.5 实现初始化/单帧/总试运行超时和错误回滚；验证：无限循环在超时后 iframe 被销毁，上一版代码仍可运行。
- [x] 2.6 实现预览控制：`play`/`pause`/`seek`/`capture`，父页面不直接读 canvas；验证：拖动到 2.4 秒时沙箱收到对应 `t`，抓帧返回图片。
- [x] 2.7 实现沙箱内录制：`captureStream(30)` + MediaRecorder、逐帧 `renderAt`、进度/取消、ArrayBuffer 回传；父页面接 `/api/save-video`；验证：`verify-code-render.mjs` 用 ffprobe 断言时长/尺寸，取消后无新文件且旧视频保留。
- [x] 2.8 新增 `src/sceneCodeSanitize.ts`：去代码围栏、大小/空代码/截断检查、必需入口检查、明显外联/越权静态拒绝；验证：语法错误、缺 `renderAt`、超大代码、`fetch`/`parent` 调用均被拒绝。
- [x] 2.9 新增 `src/sceneCodeAssets.ts`：解析选择、读取字节、缩放图片、计算内容哈希、生成稳定键、视频关键帧；验证：重复 URL 去重、缺失 URL 标记、图片长边上限生效。
- [x] 2.10 新增 `verify-code-sandbox.mjs`：覆盖立方体渲染、纹理、网络请求被 CSP 阻止、父页面访问失败、初始化/单帧超时、token 伪造、代码过大；验证：脚本全部通过。
- [x] 2.11 在 `README.md` 增加 ABI 示例、沙箱安全边界、代码/素材上限和录制行为；验证：按文档示例代码可运行，限制值与实现一致。

## 3. 参考内容与媒体理解

- [x] 3.1 新增 `src/shot3dContextCatalog.ts`：收集角色、场景、道具设定、项目素材、当前首帧/候选、项目生成图片、视频和镜头文本；验证：fixture 断言分类、数量、去重、缺失项。
- [x] 3.2 新增 `src/Shot3DContextPicker.tsx`：分类页签、搜索、缩略图/视频首帧预览、多选、已选列表、空状态和缺失状态；验证：Playwright 选择图片/视频/场景/道具，路径不作为唯一条目。
- [x] 3.3 在选择器实现文本页签：prompt、videoPrompt、逐句台词、cast、景别/运镜/秒数、标注摘要；验证：只选第二句台词时 payload 只含该句和说话人。
- [x] 3.4 实现默认选择、清空、全选当前分类、沿用上一镜选择，并按镜头持久化；验证：刷新恢复、项目 A/B 隔离、资源删除后显示缺失。
- [x] 3.5 新增 `src/mediaBrief.ts`：把选中图片和视频关键帧合成带标签参考板，调用 `vision`，归一化 `MediaBrief`，按内容指纹缓存；验证：mock `/api/vision` 断言标签、条目、缓存命中不重复请求。
- [x] 3.6 实现视频关键帧提取与缓存：调用 `/api/frames`，每个视频最多 3 帧；聊天只使用关键帧；首次生成可选 `videoVision`，不支持时回退并标记；验证：mock 断言聊天不发视频理解请求。
- [x] 3.7 实现媒体/上下文限制：图片 16 张、视频 4 个、单图长边 2048、单次素材总字节上限；超限提示并拒绝新增；验证：边界测试和错误文案。
- [x] 3.8 新增 `verify-3d-context.mjs`：覆盖分类、搜索、图片/视频预览、坏图禁用、文本逐句、默认/沿用/刷新/项目隔离、超限和窄屏；验证：脚本全部通过。
- [x] 3.9 在 `README.md` 说明参考内容选择、默认项、媒体 brief、视频关键帧和隐私边界；验证：文档步骤与 UI 行为一致。

## 4. 代码生成、聊天与模型配置

- [x] 4.1 在 `src/api.ts`、`vite.config.ts`、`Settings.tsx`、`ModelSelect.tsx` 增加 `videoVision` 能力和 `sceneCode` / `videoVision` 环节；`sceneCode` 走文本族，`videoVision` 只列声明视频理解的模型；验证：设置页可选择并保存，`/api/text` 使用 `sceneCode` 键，未配置时有明确回退。
- [x] 4.2 新增 `src/sceneCodePrompt.ts`：系统提示词、ABI 文档、素材清单、选择文本、媒体 brief、当前代码/上一镜代码的上下文拼装；验证：prompt 含选中项和稳定键，不含 base64/dataURL。
- [x] 4.3 新增 `src/sceneCodeJob.ts`：首次代码生成，调用 `sceneCode` 模型、解析 JSON、去围栏、试运行，成功返回代码草稿；验证：mock 成功/失败/取消三条路径，失败不写代码。
- [x] 4.4 新增 `src/sceneCodeChat.ts`：当前代码 + 最近 6 条聊天 + 选中上下文/媒体 brief + 用户消息，返回完整代码和说明；验证：mock 返回完整代码，旧代码只在试运行成功后替换。
- [x] 4.5 实现代码结果解析与错误分类：截断、空代码、非 JSON、缺入口、运行错误、超时；验证：每类返回可读错误且不应用代码。
- [x] 4.6 新增 `verify-code-ai.mjs`：覆盖 prompt 上下文、无 base64、成功生成、聊天改写、失败回滚、取消、无代码模型；验证：脚本全部通过且不发真实网络请求。
- [x] 4.7 在 `README.md` 说明 `sceneCode`/`videoVision` 模型前置、原生视频渠道限制和关键帧回退；验证：未配置模型时文档描述的错误与 UI 一致。

## 5. 代码工作台

- [x] 5.1 新增 `src/SceneCodeWorkbench.tsx` 外壳：顶部镜号/时长/画幅/代码状态、三栏布局、保存/渲染/关闭；验证：Playwright 桌面布局截图中参考内容、预览、聊天/代码同时可见。
- [x] 5.2 实现窄屏布局：参考内容抽屉、右栏底部页签、单列堆叠；验证：900px 和 760px 无横向溢出，预览和时间轴可用。
- [x] 5.3 接入 iframe 预览、播放/暂停/拖动/抓帧、渲染进度和错误状态；验证：拖动时间轴画面变化，错误显示不崩溃。
- [x] 5.4 接入参考内容选择器、已选 chips 和聊天输入区；验证：移除 chip 后下一条聊天 payload 不含该素材，未选项不静默发送。
- [x] 5.5 实现聊天页签：发送/取消、代码试运行、成功应用、失败保留旧代码、错误提示；验证：mock 聊天成功/失败两条路径。
- [x] 5.6 实现代码页签：可编辑代码、运行、保存、撤销/重做、dirty 状态和关闭前保存/放弃/继续；验证：连续修改后撤销/重做正确，未保存关闭有提示。
- [x] 5.7 实现首次打开状态：无代码无 legacy 自动生成；有代码直接展示不自动调用；只有 legacy 显示只读预览和转换入口；验证：三条路径均不重复生成。
- [x] 5.8 在 `App.tsx` 接入新工作台的 `onSave`/`onRendered`，保存代码、选择、视频、`scheduleMeta` 和 motionNote；验证：重新打开项目字段完整，旧图片/视频不被覆盖。
- [x] 5.9 新增 `verify-code-workbench.mjs`：覆盖布局、窄屏、选择、聊天应用/失败、代码页签、撤销、保存重开、自动生成三条路径；验证：脚本全部通过并保存截图证据。
- [x] 5.10 在 `README.md` 增加工作台布局、聊天/代码页签、保存与撤销说明；验证：文档步骤能完成一次“选素材→生成→聊天改写→保存”。

## 6. Legacy、过期与下游

- [x] 6.1 新增 `src/LegacyScenePreview.tsx`：用 `resolveShotSceneForProjectShot` + `legacyLayoutToBlocking` + `buildScheduleScene` 渲染只读旧结构化镜头；验证：旧 fixture 可播放/拖动，界面不写 `sceneCode`。
- [x] 6.2 实现“生成代码版本”显式转换：用旧结构化 JSON + 当前选择生成代码，试运行成功并经确认后写 `sceneCode`；验证：成功写入，取消不改变旧字段和视频。
- [x] 6.3 扩展 freshness：`isScheduleFresh` 有 `sceneCode` 时比较代码哈希、ABI、素材指纹、时长、画幅；Inspector 显示来源/过期；验证：改代码/素材/时长/画幅分别触发过期，其他镜头不变。
- [x] 6.4 修改 `App.genScheduleVideo` 右击渲染：有代码用隐藏沙箱渲染，无代码先生成，legacy 用旧渲染器；验证：`verify-code-render.mjs` 覆盖三条路径，ffprobe 通过。
- [x] 6.5 复用 `useScheduleVideoRef`/`useScheduleFrames` 拦截，确认过期/审阅/legacy 不静默提交；验证：拦截 `/api/seedance`，fresh clean 代码视频才带参考。
- [x] 6.6 调整 `motionNote`：由代码生成或用户编辑，UI 标明不是几何自动推导；出片仍可拼进 prompt；验证：旧“0.6 米”文案不再自动出现，手改可保存。
- [x] 6.7 新增 `verify-code-freshness.mjs` 并更新 `verify-3d-freshness.mjs`、`verify-video-ref-ui.mjs` 的前置渲染步骤；验证：过期徽标、参考开关禁用、重渲恢复全部通过。
- [x] 6.8 更新 `.verify-scene-blocking.mjs` 或拆出 legacy 回归，确认旧项目、旧视频、旧 `layout` 不再要求结构化编辑；验证：旧 fixture 打开不崩，只读状态和转换入口可见。
- [x] 6.9 在 `README.md` 说明 legacy 只读、显式转换、代码/素材过期和 Seedance 参考规则；验证：文档描述的旧项目路径与测试一致。

## 7. 集成与验收

- [x] 7.1 运行 `npm run build`、`npm run build:sandbox`、`npx tsc --noEmit`，确认主应用和沙箱产物都能构建。
- [x] 7.2 运行 `verify-code-api.mjs`、`verify-code-sandbox.mjs`、`verify-code-render.mjs`、`verify-3d-context.mjs`、`verify-code-ai.mjs`、`verify-code-workbench.mjs`、`verify-code-freshness.mjs`，确认新链路全部通过。
- [x] 7.3 回归 `verify-schedule3d.mjs`、`verify-video-ref-api.mjs`、`verify-video-ref-ui.mjs`、`verify-project-scope.mjs`、`verify-theme.mjs`、`verify-asset-board.mjs`、`verify-media-picker.mjs`、`verify-shot-scene-api.mjs`，确认旧 3D、Seedance 参考、项目隔离和素材选择无回归。
- [x] 7.4 人工视觉验收：桌面和 900px 窄屏、图片纹理场景、聊天重写、代码错误/超时、legacy 只读、日间/夜间主题；确认无横向溢出、无空白预览、错误可见；把截图或视频路径记录到变更说明。
- [x] 7.5 运行一次真实代码模型和真实渲染（不使用 mock）：首次生成、聊天改写、保存、重开、渲染 mp4、Seedance 视频参考开关；验证：ffprobe 时长/尺寸正确，项目字段完整，未配置模型时回退提示正确。

## Workflow follow-up

- 评审通过并完成 7.1~7.5 后归档本变更。
- 归档前手动更新 `openspec/specs/scene-blocking-3d/spec.md` 的 Purpose，概括为“每镜 Three.js 代码 + legacy 兼容”；OpenSpec 归档同步会保留旧 Purpose，不能依赖 delta 自动改写。
- 若原生视频理解渠道无法接收本地视频，保留 `videoVision` 配置和关键帧回退，不把对象存储上传纳入本次范围。
- 若真实代码模型输出经常截断或无法稳定通过试运行，另开变更评估代码 diff、分段生成或更强代码模型，不在本次扩大范围。
