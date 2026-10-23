# Tasks

## 0. 规格基线

- [x] 0.1 先归档已完成的 `scene-blocking-3d`，确认 `openspec list --specs` 出现 `scene-blocking-3d` 主 spec；随后把本 change 的 spec 重组为对 `scene-blocking-3d` 的 MODIFIED/REMOVED/ADDED delta（移除场次共享、参考图 human-only；加入每镜独立/视觉/聊天）。验证：`openspec validate --strict` 通过，主 spec 不再同时要求“同场共享”和“每镜独立”。
- [x] 0.2 在代码开工前记录替代关系：本变更的 `ShotScene`/视觉/聊天语义取代 `scene-blocking-3d` 的共享场景与纯文本路径；验证：README 或变更说明里能查到这行，实现清单不再引用 `sceneLayouts` 作为新写入源。

## 1. 视觉能力与服务端

- [x] 1.1 在 `src/api.ts`/`vite.config.ts` 增加 `vision` Cap、`vision` 生成环节与模型能力标记；设置页增加视觉模型选择；验证：未配置视觉模型时 3D 仍可文本生成，配置后可选中。
- [x] 1.2 新增视觉接口（或扩展 `/api/text` 的 content 数组）：接受参考板 dataURL、system/prompt、json；只允许声明 vision 能力的模型；限制图片大小/超时/错误；验证：mock provider 发送图片内容数组，非 vision 模型被明确拒绝。
- [x] 1.3 新增 `VisualBrief` 类型与解析器：主体 screen/depth/遮挡、可见墙门/固定物、景别/机位线索；丢弃/标记米制坐标字段；验证：纯函数测试覆盖合法 brief、空 brief、带绝对坐标的越权输出。
- [x] 1.4 增加无视觉模型/视觉失败的回退：文本生成结果标 `usedVision=false`；失败不伪造 brief；验证：断网/500/超时三种情况都有明确来源标记。

## 2. 每镜空间数据与迁移

- [x] 2.1 在 `src/types.ts`/`src/api.ts` 增加 `ShotData.shotScene`、`ProjectShot.shot_scene`、`shotSceneSeed`、`visualBrief`、`visualBriefMeta`；验证：`npx tsc --noEmit` 通过，旧字段不变。
- [x] 2.2 更新 `src/shotSync.ts`、`server/db.mjs`、`/api/project`：shotScene/visualBrief 走镜头 extra；`bizSignature` 包含这些字段；旧 `sceneLayouts` 仍可读但新编辑器不写；验证：保存/重读字段完整，项目 A/B 隔离。
- [x] 2.3 实现旧场次布局懒迁移：镜头无 shotScene 时从同集同场 `sceneLayouts` 复制独立副本，source=legacy；不删除旧布局；验证：同场两镜迁移后改 S01 不影响 S02，旧布局仍在。
- [x] 2.4 实现 `previousShotFor`：只在同集同场向前找最近的有 shotScene 的镜头；无则空；验证：首镜、跨场、上一镜无空间、连续空格四组用例。
- [x] 2.5 改 `scheduleFingerprint`/`isScheduleFresh` 基于当前镜 shotScene + blocking；旧 meta 标过期；验证：改 S01 只让 S01 过期，S02 不变。
- [x] 2.6 更新 Inspector/快捷渲染取空间来源：优先 shotScene，旧 layout 迁移；验证：旧项目可打开、可渲染，不读取其他镜头布局。

## 3. 参考板与完整资源

- [x] 3.1 实现参考板合成：当前首帧/active candidate、场景卡、roster 角色、关联道具；带英文标签、缺失占位、最多 6 区、限制尺寸；验证：用含坏图/缺帧/多角色的 fixture 生成参考板，区域数量与标签正确。
- [x] 3.2 实现当前镜资源 manifest：prompt/videoPrompt/台词/说话人/cast/size/move/seconds/marks/场景卡/角色/道具/关联素材；图片不以 dataURL 进入文本；验证：请求文本包含全字段、不含 base64。
- [x] 3.3 实现视觉 brief 缓存：资源指纹包含当前帧、场景卡、角色图、道具图、prompt/videoPrompt/marks；相同指纹复用，资源变化重新调用；验证：两次生成只调用一次视觉，改首帧后重新调用。
- [x] 3.4 实现 `seedScene` 提示词：上一镜空间作为硬参考但只保留未被当前画面否定的结构；验证：有 seed/无 seed 的请求文本不同，结果写当前镜副本。

## 4. 联合生成与一键流程

- [x] 4.1 新增 `generateShotBundle`：视觉 brief + seedScene + 全资源 -> `{shotScene, shotBlocking}` 一次 JSON；分别 sanitize/validate；失败修复一次；验证：mock 合法/首轮非法/二次非法三组用例。
- [x] 4.2 生成失败/取消/超时不覆盖旧 shotScene/blocking/video；首次无数据用 fallback 并标 source；验证：旧对象引用不变，fallback 有来源。
- [x] 4.3 打开编辑器自动准备：缺 shotScene/blocking 时自动启动一次 bundle；已有则直接显示；MP4 仍需显式点击；验证：首次打开只发一次生成，二次打开不发模型请求，渲染不自动开始。
- [x] 4.4 加“生成 3D 预演”唯一主动作，旧的分开 AI 场景/走位入口降为高级；验证：点击一次完成两段结果生成。
- [x] 4.5 实现相邻镜结构差异检查（尺寸/墙/门/主要固定物）；warnings 不阻断；UI 提供继承上一镜/保留当前/查看差异；验证：差异大/正常/无上一镜三种状态。
- [x] 4.6 显示空间来源与视觉使用：继承自 Sxx / 迁移 / AI / 手动 / 兜底，视觉参与/未参与；验证：编辑器与 Inspector 都能看到。

## 5. 聊天改 3D

- [x] 5.1 编辑器右侧增加聊天页签和消息列表，默认建议 chips；聊天只绑定当前镜头；验证：切换镜头/关闭重开不串消息，其他镜头数据不变。
- [x] 5.2 定义 `Shot3DPatchOp` 操作集合（camera/actor/wall/opening/prop/floor/copy_previous/regenerate）；聊天模型返回 `{reply, ops}`；验证：非法 op 被拒绝，未知字段忽略。
- [x] 5.3 实现 patch 原子应用：先校验 id/数值/墙尺寸/角色 roster，再整体 validateBlocking；失败不部分应用；成功作为一步 undo；验证：合法 patch/穿墙 patch/不存在 id/撤销四组用例。
- [x] 5.4 实现按图聊天：消息含“当前画面/首帧/参考图”时检查 brief 指纹，资源变化才重跑视觉；纯参数请求不调用视觉；验证：按图/纯文本/缓存命中三种调用次数。
- [x] 5.5 聊天失败/取消不覆盖当前空间；回复中说明原因；验证：模型 500、abort、非法 JSON 三组。

## 6. 渲染、测试与文档

- [x] 6.1 渲染链路改用当前镜 shotScene；干净 POV/审阅/时长/画幅/取消逻辑不变；验证：2s 9:16 与 4s 16:9 的 mp4 尺寸/时长正确，审阅仍不可参考。
- [x] 6.2 新增 `verify-shot-scene-api.mjs`：每镜独立、旧布局迁移、seedFrom、visualBrief 持久化、项目隔离；验证：全部通过。
- [x] 6.3 新增 `verify-shot-vision.mjs`：参考板标签/缺图、vision mock、brief 解析、缓存、无视觉回退；验证：全部通过且不真实调用视觉模型。
- [x] 6.4 新增 `verify-shot-3d-chat.mjs`：一键生成、继承/差异警告、聊天 patch/撤销/非法拒绝、按图调用次数、其他镜头不变；验证：全部通过。
- [x] 6.5 更新 `verify-scene-blocking-api.mjs`/`verify-3d-render.mjs`/`verify-scene-blocking.mjs`/`verify-3d-freshness.mjs` 以适配每镜 shotScene；验证：新链路回归通过，旧 shared-scene 断言被替换。
- [x] 6.6 更新 README：每镜独立空间、参考板/视觉 brief、继承上一镜、连续性警告、一键生成、聊天 patch、视觉模型配置与无视觉回退；验证：按文档完成一次“打开 -> 自动生成 -> 聊天改机位 -> 渲染”。
- [x] 6.7 人工视觉验收：至少一个 16:9 推镜和一个 9:16 摇镜，确认参考板/视觉 brief 来源可见、每镜空间独立、聊天改机位后画面变化、最后一帧无遮挡；记录截图/视频路径。

## 7. 集成回归

- [x] 7.1 运行 `npm run build`、`verify-shot-scene-api`、`verify-shot-vision`、`verify-shot-3d-chat`，确认类型与新链路通过。
- [x] 7.2 回归 `verify-3d-render`、`verify-scene-blocking`、`verify-3d-freshness`、`verify-schedule3d`、`verify-video-ref-api`、`verify-video-ref-ui`、`verify-project-scope`，确认 POV/审阅/过期/视频参考/项目隔离无回归。
- [x] 7.3 回归 `verify-theme`、`verify-asset-board`，确认新增聊天/参考板/编辑器样式在日间/夜间和窄屏可读。

## Workflow follow-up

- 0.1 已归档 `scene-blocking-3d` 并完成规格 delta 重组；可以实施/归档本变更。
- 全部任务和人工视觉验收通过后归档本变更。
- 若视觉模型实际不可用，先以文本-only 回退交付，并把视觉部分标为后续变更，不伪造参考图参与。
