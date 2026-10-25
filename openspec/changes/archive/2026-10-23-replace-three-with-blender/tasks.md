# Tasks

## 1. 前置实测与决策

- [x] 1.1 安装并定位 Blender（`PATH`、`/Applications/Blender.app/Contents/MacOS/Blender`、环境变量覆盖），记录实际版本号；验证：健康检查脚本能打印路径与版本
- [x] 1.2 用最小 bpy 脚本在 `--background --factory-startup` 下分别实测 Workbench / EEVEE / Cycles，渲染 10 帧 @320p / 540p / 1080p，记录成功率与每帧耗时；验证：三组产物 PNG 可打开，耗时写入决策记录
- [x] 1.3 按 design.md 决策规则定下默认引擎、代理帧率、采样与三档预算，写入环境变量默认值；验证：健康检查与作业参数能读到这些默认值

## 2. Blender 渲染宿主（服务端）

- [x] 2.1 新增 `server/blender.mjs`：可执行文件定位、版本探测、`BLENDER_MIN_VERSION`/`BLENDER_MAX_VERSION` 校验；验证：`/api/blender/health` 返回 path/version/ok，无 Blender 时 `ok:false` 且含安装指引
- [x] 2.2 实现作业队列与作业目录 `.blender-jobs/<jobId>/{assets,frames,out}`，并发上限 2、超出排队；验证：并发提交 3 个作业时第 3 个为 queued，三个目录互不重叠
- [x] 2.3 编写 `scripts/blender/host.py`：读 `job.json`、加载代码、调用 `build`/`pose`、逐帧渲染、按行输出 JSON 进度、异常以非零码退出；验证：夹具脚本渲染 3 帧，进度行数与产物帧数一致
- [x] 2.4 实现素材落盘与只读保护（写入 `assets/` 后 `chmod 0444`，清单进 `job.json`）；验证：脚本写入素材失败，原始项目图片哈希不变
- [x] 2.5 实现取消、超时与崩溃清理（终止进程树、删除作业目录、保留旧视频）；验证：取消后无新 mp4、无残留目录、无 Blender 进程
- [x] 2.6 实现帧序列编码与抽帧，复用现有 ffmpeg 与 `/videos`、`/generated` 落盘；验证：6 秒 30fps 产出 180 帧、时长 6.0s，抓帧与第 2.4s 帧一致
- [x] 2.7 实现 `/api/blender/{render,progress,cancel}` 路由与参数校验；验证：非法时长、画幅或档位被拒绝且不启动进程
- [x] 2.8 在 README 补 Blender 安装、版本要求、作业目录与清理说明；验证：按文档从零装好到健康检查通过

## 3. 代码契约与准入

- [x] 3.1 更新 `src/types.ts`：`SceneCode` v2（`runtime`、`engineVersion`、`abiVersion: 2`）、`SceneCodeMeta` 新字段、渲染预算常量；验证：`tsc --noEmit` 通过，旧记录归一化为 `runtime: 'three'`
- [x] 3.2 重写 `sceneCodeSanitize.ts`：Python 入口检查（`build`/`pose`）、危险导入与调用黑名单（`os`/`subprocess`/`socket`/`eval`/`bpy.ops.wm` 等）、字节上限；验证：单测覆盖缺入口、危险导入、超长代码三类拒绝
- [x] 3.3 改写 `sceneCodePrompt.ts`：bpy ABI、钉死版本、可运行最小模板、禁用项与错误回传约定；验证：提示词快照包含版本号与 `build`/`pose`
- [x] 3.4 改写 `sceneCodeAssets.ts`：产出落盘清单（路径替代字节内存），保留稳定键与缺失语义；验证：缺失素材进 `missingAssets`，正常素材路径可读
- [x] 3.5 改写 `sceneCodeFingerprint.ts` / `sceneCodeFreshness.ts`：纳入 `runtime`、`engineVersion`、fps 与帧数；验证：改引擎版本后当前镜过期，其他镜头不受影响

## 4. 编辑工作台

- [x] 4.1 用作业客户端替换 `SceneSandbox`（提交/进度/取消/抓帧），删除 iframe 加载路径；验证：打开镜头触发代理渲染并显示逐帧进度
- [x] 4.2 实现代理片预览与时间轴：播放 mp4、拖动映射到代理帧、缺帧时触发单帧渲染；验证：拖到 2.4s 显示对应帧，改代码后代理标脏并可重渲
- [x] 4.3 更新工作台状态与文案：来源、引擎版本、试运行状态、过期徽标、Blender 不可用禁用态；验证：无 Blender 时生成与渲染按钮禁用且文案含指引
- [x] 4.4 旧结构化镜头与旧 `abiVersion: 1` 代码的只读视图 + “转换为 Blender 代码”动作；验证：转换前不可渲染，转换成功后写入 v2 代码并进入撤销栈
- [x] 4.5 移除 `LegacyScenePreview` 与 `schedule3d.ts` 渲染器（保留 `scheduleGeometry` 数据助手），删除 `SceneScheduleEditor.tsx`；验证：旧镜头打开不崩、页面无 3D 画布、`tsc` 无未用引用
- [x] 4.6 设置页增加一次性执行模型告知（代码以本机用户权限运行、无浏览器沙箱）；验证：首次启用 3D 时可见，确认后不再重复弹出
- [x] 4.7 工作台 UI 回归：三栏布局、窄屏堆叠、日间/夜间、按钮可达名；验证：playwright 脚本覆盖布局与禁用态，无横向溢出

## 5. Agent 与出片通路

- [x] 5.1 `sceneAgentTools.ts`：`run_sandbox` 改为 `run_render`（trial 档），`capture_frames` 从渲染产物取帧；验证：mock agent 图跑通提交→渲染→抓帧→验收→finish
- [x] 5.2 更新 agent 提示词与聊天文案（工具名、渲染进度、失败阶段）；验证：轨迹里能看到作业 id 与帧进度，不出现“沙箱”措辞
- [x] 5.3 `App.tsx` 右键生成与保存改走渲染作业并写回 `scheduleVideo`/`scheduleFrames`/meta；验证：端到端生成一个镜头并落盘 mp4
- [x] 5.4 下游过期拦截：开启 `reference_video` 或抽帧参考时，过期视频被拦下；验证：手工构造过期 meta，生成入口返回明确错误

## 6. 清理与集成验证

- [x] 6.1 移除 `three`、`@types/three`、`build:sandbox` 脚本与 `runtime.generated.js`；验证：`npm ls three` 为空，`npm run build` 通过
- [x] 6.2 改写 `verify-code-workbench.mjs`、`verify-chat-first-3d.mjs`、`verify-canvas-code-fallback.mjs`：Blender 前置检查 + bpy 夹具，缺 Blender 时 skip 并说明；验证：有/无 Blender 两种环境都能跑完
- [x] 6.3 新增端到端验收：4 秒山/男女/双剑环绕场景，产出 120 帧 mp4、4 张关键帧与验收清单；验证：人工确认画面、时长与运镜
- [x] 6.4 性能与资源回归：并发 2 作业时界面可操作、磁盘与内存受控、取消后无残留；验证：观测记录写入变更说明
- [x] 6.5 全仓一致性检查：无 Three.js 运行时与“沙箱”残留措辞，`openspec validate` 通过；验证：`grep` 清单为空，校验命令通过

## Workflow follow-up

- 归档前先同步主规格（`scene-code-runtime`、`scene-blocking-3d`、`scene-agent-runtime`、新建 `blender-render-host`）。
- 归档本变更并复核主规格内容。
