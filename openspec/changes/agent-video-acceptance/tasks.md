# Tasks

## 1. 视频验收编排与类型

- [x] 1.1 增加视频验收类型：`AgentVideoPart`、`AgentVideoReviewPart`、阶段状态和 `render_failed/save_failed/extract_failed/vision_unavailable/review_failed/cancelled/timeout` 错误码；验证：`npx tsc --noEmit` 通过。
- [x] 1.2 新增视频验收编排模块，依赖注入 render/save/extract/review/persist；验证：假依赖单测断言调用顺序为 render → save → extract → review → persist，且只在需要时持久化。
- [x] 1.3 实现全时长抽帧：短镜头 5 帧、长镜头 9 帧，时间点包含 0 和有效时长；验证：单测覆盖 4 秒、8 秒、12 秒，时间点均匀且来自 MP4。
- [x] 1.4 实现独立进度、超时和取消，渲染/抽帧/验收都响应 AbortSignal；验证：单测覆盖超时和取消，均不调用 persist 且返回明确状态。
- [x] 1.5 实现保存门禁：MP4 帧验收全部通过才调用 persist；未通过、无视觉模型、抽帧失败、渲染失败、取消和保存失败都保留旧数据；验证：单测覆盖每种状态和保存失败重试。
- [x] 1.6 实现确定性最终文字：从 `codeHash`、视频 URL/时长、MP4 帧时间点和逐项结果生成，不依赖文本模型自由补写；验证：单测覆盖通过、未通过、需人工验收三种输出。

## 2. 聊天 UI 与会话状态

- [x] 2.1 新增 `VideoCard` 和 `VideoReviewCard`，展示渲染进度、MP4 播放器、MP4 帧缩略图/时间点、逐项结果和“帧来自 MP4”标识；验证：组件或 mock 聊天测试能看到播放器、帧证据和来源标签。
- [x] 2.2 在 agent finish 后接入视频阶段：finish 卡片改为“代码阶段完成”，视频验收完成前不显示“场景完成”；验证：mock 聊天测试断言顺序为 finish → render → extract → video review → final，且取消按钮在视频阶段仍可用。
- [x] 2.3 增加最终状态和结构化文字：通过/未通过/需人工/已保存/保存失败分别有明确状态；验证：更新 `verify-agent-chat-ui.mjs` 或新增 mock 测试覆盖所有状态。
- [x] 2.4 给代码、视频和验收卡带 `codeHash`；代码变化后旧视频/旧验收显示过期；验证：mock 测试提交新代码后旧卡出现过期标识，新卡使用新哈希。
- [x] 2.5 增加“继续修复”和“人工采用/保存”入口，不自动重跑 agent；验证：测试点击继续修复只预填失败项/发起用户可见的新一轮，点击人工采用才调用 persist。

## 3. 持久化、旧视频和单一路径

- [x] 3.1 让 `prepareAgent` 返回本次运行的 `Shot3DContext` 快照，并把它传给视频验收；验证：类型检查通过，测试断言运行中修改工作台上下文不会改变本次视频保存的快照。
- [x] 3.2 在工作台实现 `onVideoAccepted`：用本次代码、上下文快照、MP4 和元数据原子写入 `sceneCode`/`shot3DContext`/`sceneCodeMeta`/`scheduleMeta`/`scheduleVideo`；验证：测试保存后代码哈希、视频元数据和 MP4 地址三者一致。
- [x] 3.3 工作台「最近视频」按 `isSceneCodeFresh` 显示生效/已过期/需重渲，过期时禁止静默作为参考；验证：测试改代码后旧视频显示过期，重渲后恢复生效。
- [x] 3.4 画布右键「生成调度视频（3D）」在工作台存在未保存草稿时提示先保存或在编辑器渲染；验证：测试未保存草稿时不会调用旧代码渲染，保存后可正常出片。
- [x] 3.5 失败、取消、超时和保存失败不覆盖旧视频/旧元数据；验证：测试每种失败后项目中的代码哈希和视频 URL 保持原值。

## 4. 集成、真实验收与文档

- [x] 4.1 新增 `verify-agent-video-acceptance.mjs`：用 mock render/extract/review 覆盖通过、未通过、无视觉、抽帧失败、渲染失败、取消和保存失败；验证：脚本全部通过。
- [x] 4.2 真实浏览器验收：固定山/男女/双剑/环绕 4 秒场景走 finish → MP4 → MP4 抽帧 → 视觉验收 → 保存；验证：聊天显示 MP4 播放器、帧证据和最终文字，代码哈希与视频元数据一致，保存截图/记录。
- [x] 4.3 长镜头验收：8 秒或 12 秒场景使用 9 帧并覆盖结尾；验证：证据中包含末段帧和对应验收项，不再只抓 0–4 秒。
- [x] 4.4 失败矩阵：渲染失败、抽帧失败、无视觉模型、视频验收未通过、取消、超时、保存失败；验证：每种状态都有可读文案，旧视频不变，可重试或继续修复。
- [x] 4.5 回归：`npm run build`、`npx tsc --noEmit`、`verify-agent-graph.mjs`、`verify-agent-chat-ui.mjs`、`verify-agent-chat-failure.mjs`、`verify-code-workbench.mjs`、`verify-code-render.mjs`、`verify-theme.mjs`；验证：全部通过。
- [x] 4.6 更新 README：说明 finish 只结束代码阶段、MP4 帧最终验收、通过才保存、失败保留旧视频和未采用 MP4 不清理；验证：文档与命令/行为一致。

## Workflow follow-up

- 归档前确认 `scene-agent-runtime` 与 `scene-agent-chat-ui` 主 spec 同步了新的 finish/视频验收语义。
- 归档时保留真实 MP4、MP4 帧、视频验收和失败矩阵证据。
