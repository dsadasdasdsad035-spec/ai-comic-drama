# Proposal

## Why

聊天当前的“验收通过”来自 5 张沙箱关键帧和视觉模型的清单判断，最终文字又由文本模型自由总结；MP4 是另一条手动渲染链路，聊天从未读取过它。结果就是聊天可能说“场景完成、所有要求符合”，但镜头里实际保存的视频仍是旧版本或内容不同。用户需要聊天结论和最终视频绑定到同一个产物。

## What Changes

- **BREAKING**：`finish` 不再表示“场景完成”，只表示“代码阶段完成”；聊天不能在此之前显示最终完成状态。
- agent 结束后自动进入视频验收阶段：用最终代码、本次已准备的素材/上下文渲染 clean MP4，按镜头有效时长从 MP4 抽 5–9 帧，再用视觉清单验收这些帧。
- 最终验收只使用 MP4 帧，不再用沙箱帧；聊天展示渲染进度、MP4 播放器、每项对应的帧证据和逐项结果。
- 视频验收通过后才原子保存代码、参考内容、MP4 和 `sceneCodeMeta/scheduleMeta`；失败、取消或渲染失败保留草稿和旧项目视频，不用失败产物覆盖镜头。
- 无视觉模型或 MP4 抽帧失败时，视频仍可在聊天中预览，但只能标记“需人工验收”，并提供人工采用/保存入口，不自动判通过。
- 最终聊天文字由结构化结果生成，只报告可验证事实：代码哈希、沙箱结果、MP4 地址/时长、MP4 帧验收的通过项和失败项；不再让文本模型扩写未验证的画面细节。
- 渲染不新增 agent 工具，工具白名单保持不变；渲染、抽帧、视频验收由 agent 结束后的应用编排执行，可取消并有独立进度。
- 旧视频和旧验收卡在代码变化后明确标记失效；代码卡、视频卡和验收卡共享 `codeHash`/`videoUrl`，避免拿旧 review 对新视频。
- 长镜头抓帧覆盖完整时长，不再固定只看 0–4 秒。
- 视频验收失败时只显示失败项和“继续修复”入口，不自动重跑整轮 agent；自动修复循环不在本次范围内。

## Capabilities

### New Capabilities

无。本次行为属于现有 agent 运行时和聊天 UI 的验收语义，不新增独立能力。

### Modified Capabilities

- `scene-agent-runtime`: 修改 `finish` 语义，新增 finish 后的 MP4 渲染、MP4 抽帧、视频帧验收、通过后保存、失败/取消/超时处理和结构化最终结论。
- `scene-agent-chat-ui`: 新增视频渲染进度、MP4 播放器、MP4 帧验收卡片和帧证据；修改完成状态、旧视频/旧 review 失效提示和最终文字生成规则。

## Impact

- 代码：`src/agent/SceneAgentChat.tsx`、`src/SceneCodeWorkbench.tsx`、新的视频验收编排模块，以及 `sceneCodeRender.ts`、`videoFrames.ts`、`agentReview.ts`、`chat-ui` 工具卡和事件类型。
- API：复用现有 `/api/save-video`、`/api/frames`、`/api/vision`；不新增渠道或 Key。
- 数据：通过 `onRendered` 原子写入 `sceneCode`、`shot3DContext`、`sceneCodeMeta`、`scheduleMeta`、`scheduleVideo`；失败时旧数据不变。
- 运行限制：视频渲染和 MP4 帧验收有独立进度、超时和取消；不占用 agent 推理的步骤预算。
- 测试：新增视频验收 mock/真实浏览器测试，更新 agent 图、聊天 UI、代码渲染和工作台回归；覆盖通过、失败、无视觉、渲染失败、抽帧失败、取消、长镜头和旧视频不被覆盖。
