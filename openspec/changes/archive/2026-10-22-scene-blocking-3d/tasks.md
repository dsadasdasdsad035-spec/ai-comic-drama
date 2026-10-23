# Tasks

## 1. 数据模型与几何内核

- [x] 1.1 在 `src/types.ts` 增加 `SceneLayout`、`SceneWall`、`SceneProp`、`SceneZone`、`ShotBlocking`、`BlockingKey`、`ScheduleMeta`，并给 `ShotData` 增加 `sceneNo` / `sceneSlug` / `shotBlocking` / `scheduleMeta`；在 `src/api.ts` 的 `ProjectShot` / `ProjectData` 增加 snake_case 字段与 `sceneLayouts`；验证：`npx tsc --noEmit` 通过，旧字段不受影响。
- [x] 1.2 新增 `src/scheduleGeometry.ts`：实现场景 sanitize（丢 NaN/零尺寸/未知 shape、数组上限）、走位校验（角色 roster、坐标/高度/FOV、关键帧顺序、墙/物实体碰撞）、按 0.05 采样插值路径碰撞、兜底场景与兜底走位；验证：先写 `verify-3d-geometry.mjs` 用本地 esbuild 打包后用 Node 断言非法字段、墙内站位、路径穿墙、合法修复。
- [x] 1.3 在同一模块实现关键帧插值、朝向最短弧、米制距离/方向计算、`motionNoteOf`、canonical JSON、双 FNV 指纹与 `isScheduleFresh`；验证：测试断言固定/推/摇/升降文案、无固定“0.6 米”、指纹随布局/走位/时长/画幅/模式变化且键序无关。
- [x] 1.4 新增 `src/scheduleContext.ts`：按预算拼场景上下文（集/场次/beats/地点/时间/人物/强度/基调/相关镜头/场景卡）与镜头上下文（台词与说话人、cast、prompt、videoPrompt、景别、运镜、秒数、marks bbox/重心、角色 lookEn、道具卡、素材标题）；不把图片像素或 dataURL 放进提示词；验证：在 `verify-3d-geometry.mjs` 增加 fixture，断言各字段出现、超长被截断、dataURL 被排除。
- [x] 1.5 增加 `rosterOf(cast, dialogue)`：去重 cast 与台词说话人，保留顺序；验证：测试覆盖空 cast、旁白无说话人、说话人不在 cast、重复名字。

## 2. 项目持久化与镜头场次

- [x] 2.1 在 `server/db.mjs` 增加 `scene_layouts` 表、读取时展开 JSON、写入时按项目整表替换并执行场景 sanitize；旧库启动自动建表；验证：用临时项目连续写入/读取两种布局，重启进程后仍在，非法布局被拒。
- [x] 2.2 在 `vite.config.ts` 的 `/api/project` POST 白名单加入 `sceneLayouts`，类型必须为数组；GET 返回；`src/api.ts` 增加 `saveSceneLayouts(project, layouts)`；验证：POST 空数组、非法类型、两个项目各自保存后 GET 不串数据。
- [x] 2.3 更新 `src/shotSync.ts`：`bizSignature` 包含 `sceneNo` / `sceneSlug` / `shotBlocking` / `scheduleMeta`；`nodeToShot` / `shotToData` 做 camel/snake 双向映射，旧 `layout` 继续透传；验证：`npx tsc --noEmit` 通过，并用 API 保存后重新 GET 断言字段完整。
- [x] 2.4 在 `src/App.tsx` 项目加载时读取 `sceneLayouts` 和项目 `aspect`，项目切换/未选项目时重置；暴露给 Inspector/编辑器与快捷渲染；验证：项目 A/B 切换后布局和画幅按项目显示，不保留 A 的布局。
- [x] 2.5 更新 `src/prompts.ts` 的 `STORYBOARD_BASE` 输出契约，增加每镜 `scene_no` / `scene_slug`；`ShotTable` 拆镜时解析并校验场次号属于本集，缺失或非法回退第 1 场并 toast 标明；验证：mock 三种输出（合法、缺失、越界）后保存，镜头字段分别正确/回退且有提示。
- [x] 2.6 在 `shotSync` 或 `scheduleGeometry` 增加旧 `layout` → 单关键帧 `ShotBlocking` 的适配：保留角色/机位，补 `height=1.6`、`fov=45`、`source='legacy'`；旧 `scheduleVideo` 无 `scheduleMeta` 时视为过期；验证：读取旧镜头后编辑器/渲染能拿到单帧走位，旧视频路径不被清空。
- [x] 2.7 新增 `verify-scene-blocking-api.mjs`：临时项目写入场景布局、镜头场次/走位/`scheduleMeta`，重读断言；空项目返回 `sceneLayouts: []`；项目 A/B 隔离；旧 `layout` 适配；验证：脚本全部通过。

## 3. AI 生成与校验

- [x] 3.1 新增 `src/scheduleAI.ts` 的场景生成：构造 system/prompt、解析模型 JSON、补稳定局部 id、按名称/几何近似匹配已有 id、限制数组数量；验证：测试用两份近似输出断言 id 不抖动、超限被截断、未知字段被忽略。
- [x] 3.2 在 `scheduleAI.ts` 实现走位生成：使用 `scheduleContext` 的完整文本上下文、场景布局 JSON、角色/道具设定和 `rosterOf`；prompt 明确“只能使用这些角色”“关键帧表达运镜”“台词说话人面向听者”；验证：测试断言提示词含台词、speaker、videoPrompt、marks 摘要、seconds、lookEn、场景 JSON，且不含 `data:image`。
- [x] 3.3 实现生成编排的注入式 `ask()`：调用、解析、`validateBlocking` / `sanitizeSceneLayout`、一次修复、二次校验；修复仍失败时抛带 issues 的错误，返回结果带 `warnings`；验证：测试 fake `ask` 断言首次非法会发第二次修复请求、第二次合法才返回、第二次非法不返回。
- [x] 3.4 给 `src/api.ts` 的 `callText` 增加可选 `AbortSignal`，编辑器取消时中止；场景/走位生成只在结果通过校验后替换现有数据，失败/超时/取消不改旧数据；首次无数据时允许兜底并标 `source='fallback'`；验证：测试模拟 abort 和 reject，断言旧对象引用保持不变。
- [x] 3.5 新增 `verify-3d-ai.mjs`：用本地 esbuild 打包 `scheduleAI.ts` / `scheduleContext.ts` 后跑 Node 断言，覆盖场景/走位上下文、角色 roster、修复一次、取消、兜底和数组上限；验证：脚本全部通过且不发起真实网络请求。
- [x] 3.6 在设置页模型逻辑中确认 3D 生成继续使用 `stageModelKey(settings,'shot',stagePick)`，不新增模型配置；验证：mock `/api/text` 的请求 `modelKey` 与镜头表拆镜一致。

## 4. 3D 渲染器与快速出片

- [x] 4.1 重写 `src/schedule3d.ts` 的场景构建：米制地面、按 `openings` 切段并补门楣/窗台的墙体、box/cylinder 固定物、半透明分区、审阅轴线；验证：用含门洞/窗洞的 fixture 断言墙段数量与开口位置，渲染截图能看到洞口。
- [x] 4.2 实现角色/机位关键帧插值：胶囊+头+朝向锥、最短弧转向、审阅模式的相机盒/真实 FOV 视锥/名称标签/路径；验证：t=0/0.5/1 采样位置与朝向符合关键帧，标签在相机靠近时淡出。
- [x] 4.3 实现两种视图：`clean` 从插值后的镜头机位输出，无网格/文字/手柄/路径，POV 相机的 fov/aspect 正确；`review` 使用固定 3/4 环绕视角并显示标注；`手持` 只叠加确定性微抖；验证：两种模式的场景对象清单与截图不同，clean 中无 Sprite/GridHelper。
- [x] 4.4 实现有效时长与画幅：`effectiveSeconds = clamp(round(seconds),2,12)`；长边 960、短边按项目 aspect 取偶数；30fps；验证：2s 9:16 和 6s 16:9 的渲染参数与 ffprobe 结果一致，1s/20s 显示夹取提示。
- [x] 4.5 实现确定性录制：先渲染首帧再 `MediaRecorder.start()`，用 `setTimeout(1000/fps)` 逐帧推进，支持 `onProgress`、`AbortSignal`、取消不保存；验证：录制 2s 视频时长在 1.9~2.2s，取消后无新文件且旧视频保留。
- [x] 4.6 渲染后写入 `scheduleMeta`（fingerprint/mode/duration/aspect/width/height/renderedAt）和按当前 blocking 计算的 `motionNote`；验证：重新打开项目字段完整，修改布局后 `isScheduleFresh` 变 false。
- [x] 4.7 改 `App.genScheduleVideo` 与右键“生成调度视频（3D）”：缺场次/布局/走位时用 `scheduleAI` 生成，失败用兜底并 toast；用 clean 模式渲染、保存 mp4、按需抽帧；不覆盖旧视频当新结果失败；验证：mock 成功/失败两条路径，失败时旧 `scheduleVideo`/`scheduleMeta` 不变。
- [x] 4.8 新增 `verify-3d-render.mjs`：Playwright 打开项目、mock 文本模型、右键渲染、ffprobe 断言 mp4 时长/尺寸，断言 `scheduleMeta.mode='clean'`、`motionNote` 非固定 0.6 米、旧 `verify-schedule3d.mjs` 同步更新并通过；验证：脚本全部通过。

## 5. 全屏编辑器

- [x] 5.1 新增 `src/SceneScheduleEditor.tsx` 全屏模态：从 Inspector“编辑 3D 调度”和右键“编辑 3D 调度…”打开；加载项目场次/镜头/设定，焦点进入编辑器，Esc/关闭有未保存三选一，`beforeunload` 提示；验证：Playwright 打开/关闭，未保存提示出现，继续编辑不丢数据。
- [x] 5.2 实现场景模式 SVG 平面：墙端点拖拽、门/窗洞口数值编辑、固定物拖拽/旋转/缩放、分区拖拽、场地尺寸、场景卡选择；验证：拖动墙端点和固定物后平面/3D 预览更新，数值面板同步。
- [x] 5.3 实现走位模式：角色拖拽、朝向旋转、机位拖拽/注视点/高度/FOV 数值、关键帧 0/1 选择、添加/删除中间帧、时间轴 scrub/播放；验证：改起始/结束位置后 POV 预览随 scrub 变化，关键帧增删正确。
- [x] 5.4 实现编辑合法性：空值/NaN/负尺寸/墙长 0 回退并提示；角色/机位碰撞即时标红但允许继续调；保存前用 `validateBlocking` 阻止 errors；验证：输入非法值后 state 不产生 NaN，墙内站位保存被拒并列出问题。
- [x] 5.5 实现 reducer 的 undo/redo（最多 50 步）、baseline/dirty、保存/取消；保存显式 `saveSceneLayouts` + `mergeProjectShots`，任一步失败保留会话；验证：连续修改后撤销/重做正确，保存后重开恢复，取消恢复原值，模拟保存失败不关闭。
- [x] 5.6 接入 AI 场景/走位生成：有既有结果时二次确认“重新生成”；使用当前未保存场景生成走位；生成中可取消；失败/取消不覆盖；生成结果作为一步 undo；验证：mock 两次生成，确认框、取消、失败三条路径均保持旧数据。
- [x] 5.7 增加 3D 预览（审阅环绕 / 镜头 POV）、播放/暂停、参考图抽屉、窄屏上下堆叠与主题 token 样式；验证：编辑器在日间/夜间可读，900px 无横向溢出，预览可切换且不泄漏 WebGL/geometry。
- [x] 5.8 新增 `verify-scene-blocking.mjs`：覆盖打开编辑器、场次绑定、场景复用、拖拽/数值、撤销/重做、未保存提示、保存/重开、AI 生成取消、参考图抽屉和 `/api/text` 上下文断言；验证：脚本全部通过。

## 6. 过期语义与下游

- [x] 6.1 Inspector 增加 3D 状态徽标（生效/已过期/仅审阅/未渲染）、编辑按钮、实际时长/画幅/场景名；过期或审阅时禁用视频参考与抽帧参考并说明原因；验证：三种状态渲染正确，禁用状态不可勾选。
- [x] 6.2 修改 `generateVideoOne`：`useScheduleVideoRef` / `useScheduleFrames` 前检查 fresh clean 视频，不通过则中止并提示；`motionNote` 用当前 blocking 重算，不再信任过期文案；验证：拦截 `/api/seedance`，过期/审阅时没有请求，fresh clean 时请求带正确字段。
- [x] 6.3 场景布局保存后，同场所有镜头立即显示过期；重新渲染后仅当前镜恢复，其他镜仍过期；验证：两个同场镜头改场景后状态正确，分别重渲后逐个恢复。
- [x] 6.4 旧项目打开不崩：无 `sceneLayouts` 用兜底空间、旧 `layout` 可编辑、旧 `scheduleVideo` 可播放但标过期；验证：临时旧项目 fixture 通过 API/编辑器检查。
- [x] 6.5 扩展 `verify-scene-blocking.mjs` 或新增 `verify-3d-freshness.mjs`：覆盖过期徽标、参考开关禁用、过期提交被拦、重渲恢复、审阅不可参考、旧项目；同步更新 `verify-video-ref-ui.mjs` 的前置渲染步骤；验证：脚本全部通过。
- [x] 6.6 更新 `README.md`：说明场景级布局、镜头走位、全屏编辑器、有效时长/画幅、干净 POV 与审阅模式、过期规则和旧项目兼容；验证：按文档步骤能完成一次“生成布局→编辑器修改→渲染→出片参考”。

## 7. 集成与回归

- [x] 7.1 运行 `npm run build`、`node verify-3d-geometry.mjs`、`node verify-3d-ai.mjs`，确认类型、纯函数和生成编排全部通过。
- [x] 7.2 运行 `node verify-scene-blocking-api.mjs`、`node verify-3d-render.mjs`、`node verify-scene-blocking.mjs`、`node verify-3d-freshness.mjs`，确认新链路全通过。
- [x] 7.3 回归 `verify-schedule3d.mjs`、`verify-video-ref-api.mjs`、`verify-video-ref-ui.mjs`、`verify-cast-full.mjs`、`verify-project-scope.mjs`，确认旧 3D 抽帧、Seedance 视频参考、角色图和项目隔离无回归。
  - 注：`verify-cast-full.mjs` 依赖工作区外的 `../manga-pipeline/projects/recycle/project.json`，当前环境不存在，脚本在读取 fixture 前退出；改用 `verify-cast-ui.mjs` 覆盖角色节点/占位/角色连线/时间线并跑通，其余四个脚本均通过。
- [x] 7.4 人工视觉验收：至少检查一个 16:9 推镜和一个 9:16 摇镜；确认墙/门/固定物关系清楚、干净 POV 无标签网格、主体按关键帧移动、最后一帧无遮挡；把截图或视频路径记录到变更说明。

## Workflow follow-up

- 评审通过并完成 7.1~7.4 后归档本变更。
- 若 POV 预演仍让 Seedance 明显学到白模风格，另开变更评估“纯剪影/线框参考”或视觉提示词，不在本次扩大范围。
