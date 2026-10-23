# Tasks

## 1. Agent 基础与依赖

- [x] 1.1 增加 `@langchain/core`、`@langchain/langgraph`、`@assistant-ui/react`、`zod` 依赖，并规划 agent 面板懒加载；验证：`npm install`、`npx tsc --noEmit` 通过，主画布首屏不包含 agent chunk。
- [x] 1.2 新增 `src/agent/sceneAgentTypes.ts`：定义 `AgentMessage`、`AgentMessagePart`、`SceneAgentState`、工具结果和验收清单类型；验证：`npx tsc --noEmit` 通过。
- [x] 1.3 新增 `src/agent/sceneAgentEvents.ts`：把 LangGraph `streamEvents` 映射成 `AgentEvent`（tool_start/tool_end/model/text/done/error），并限制事件大小；验证：Node 单测覆盖事件顺序、toolCallId 匹配和未知事件忽略。
- [x] 1.4 使用 mock model/mock tools 建立 Agent 图测试骨架，不调用真实模型；验证：`node verify-agent-graph.mjs` 的 smoke 用例通过。

## 2. LangGraph 模型、工具与图

- [x] 2.1 实现 `src/agent/zcodeChatModel.ts`：继承 `BaseChatModel`，实现 `bindTools`、JSON action 提示、调用 `/api/text`、解析 `content`/`tool_calls` 为 `AIMessage`；验证：mock `/api/text` 返回文本和工具调用两种结果。
- [x] 2.2 实现工具集 `src/agent/sceneAgentTools.ts`：`get_shot_context`、`set_scene_code`、`run_sandbox`、`capture_frames`、`review_frames`、`finish`；工具只接收当前镜上下文，不提供 shell/网络/保存；验证：Node 测试覆盖合法参数、越权和错误返回。
- [x] 2.3 实现 `src/agent/sceneAgentGraph.ts`：StateGraph + ToolNode + gate；确保 set_scene_code 后需要 sandbox，trial 失败才允许修复，review 失败才允许再修，finish 必须通过 trial/review；验证：mock 图测试覆盖成功、首帧失败、修复成功、达到上限。
- [x] 2.4 实现修复/验收上限、总超时、工具超时、取消和清理沙箱；验证：测试覆盖 3 次代码修复、2 次 review、取消后无后续工具、旧代码不变。
- [x] 2.5 工具上下文只读当前镜头和当前选中素材，禁止修改其他镜头/项目素材；验证：测试断言其他镜头数据和其他素材不变。
- [x] 2.6 把 `SceneSandbox` 封装为 agent 可用会话：trial、seek、capture 多个时间点、dispose；验证：抓取 0/1/2/3/4 秒帧，取消/失败后释放 iframe。
- [x] 2.7 `review_frames` 调用 `askVision`，要求结构化清单（山体/两人/男女可区分/双剑/对打/环绕/正对两人）；无视觉模型时返回 `needsHumanReview`；验证：mock vision 通过/部分失败/无模型三条路径。
- [x] 2.8 将 mock 图扩展到完整工具链，验证工具事件、代码摘要、5 帧和清单；验证：`verify-agent-graph.mjs` 全部通过。
- [x] 2.9 在 `README.md` 说明 LangGraph 浏览器内架构、工具边界、模型前置和 `code-first-3d-chat` 归档前置；验证：文档示例命令与实现一致。

## 3. assistant-ui 聊天渲染

- [x] 3.1 新增 `src/agent/SceneAgentChat.tsx`，懒加载 assistant-ui，使用 `ExternalStoreRuntime` 接收消息、`onNew`、`isRunning`、`onCancel`；验证：打开 agent 面板才加载 chunk，关闭后释放。
- [x] 3.2 实现 `AgentMessagePart` 到 assistant-ui 消息的转换：text、tool-call、tool-result、code、frames、review；工具结果按 toolCallId 回填；验证：Node/Playwright 断言 parts 顺序和状态。
- [x] 3.3 用 `makeAssistantToolUI` 实现工具卡片：run_sandbox 状态/错误、capture_frames 缩略图、review_frames 清单、set_scene_code 仅显示 hash/行数；验证：各工具卡在 UI 中出现。
- [x] 3.4 接入 `Thread`、`Message`、`Composer`，保留参考内容 chips、发送快捷键、取消按钮和代码页签跳转；验证：输入、发送、取消、查看代码均可用。
- [x] 3.5 适配现有日间/夜间主题、900px/760px 窄屏和键盘焦点；验证：截图无横向溢出，工具卡片/缩略图/清单可读。
- [x] 3.6 实现失败/取消/超时状态的聊天提示和重试入口，保留旧代码；验证：图测试和 UI 测试覆盖。
- [x] 3.7 迁移 `SceneCodeWorkbench` 聊天页签到 assistant-ui，旧自定义 chat log 不再渲染；验证：`rg "cw-msg|cw-chat-log"` 仅剩非聊天用途或移除，现有 chat 测试更新。
- [x] 3.8 更新 `README.md` 的聊天渲染说明：工具卡片、代码摘要、帧、验收清单、无 chain-of-thought；验证：文档描述与 UI 一致。

## 4. 验收场景

- [x] 4.1 新增固定场景 fixture：山体/地形、一名男人和一名女人、两把剑、对打动画、相机环绕并始终 lookAt 两人中点，4 秒 16:9；作为 mock agent 的 `set_scene_code` 输入；验证：沙箱运行成功并产出 5 帧。
- [x] 4.2 实现 `verify-agent-3d-duel.mjs` mock 模式：脚本化工具调用，验证 agent 轨迹、代码、帧、清单和 4 秒 mp4；验证：不调用真实模型，脚本通过。
- [x] 4.3 实现真实模型模式（`AGENT_REAL=1`）：使用当前设置的 `sceneCode` 模型跑同一 prompt，保存 codeHash、5 帧、视频和清单；验证：真实模型成功或明确失败原因。
- [x] 4.4 实现视觉初筛与人工验收：自动检查山/两人/双剑/环绕/正对，人工查看关键帧和 mp4 作为最终判定；验证：清单 JSON 包含逐项状态。
- [x] 4.5 新增 assistant-ui Playwright 验收：工具卡顺序、running→done/error、代码摘要、帧缩略图、验收清单、取消；验证：`verify-agent-chat-ui.mjs` 全部通过。
- [x] 4.6 保存验收截图/视频/清单到 `openspec/changes/agentic-3d-scene-chat/evidence/`；验证：文件存在且 README 记录路径。
- [x] 4.7 在 `README.md` 增加“山/男女/双剑/环绕”验收步骤和 mock/真实模型命令；验证：按文档可复现测试。

## 5. 集成与回归

- [x] 5.1 运行 `npm run build`、`npx tsc --noEmit`，确认主应用与 agent chunk 构建通过。
- [x] 5.2 运行 `verify-agent-graph.mjs`、`verify-agent-3d-duel.mjs`、`verify-agent-chat-ui.mjs`，确认 mock/真实/UI 全部通过。
- [x] 5.3 回归 `verify-code-*`、`verify-schedule3d.mjs`、`verify-video-ref-ui.mjs`、`verify-project-scope.mjs`、`verify-theme.mjs`，确认旧代码工作台、视频参考和项目隔离无回归。
- [x] 5.4 人工检查：工具卡片、代码失败保留、取消、日间/夜间、900px、山/男女/双剑/环绕视频；验证：截图/视频/检查记录写入变更说明。

## Workflow follow-up

- 实施前先完成/归档 `code-first-3d-chat`，它已经完成 58/58 但仍未归档；本变更修改同一聊天入口和工作台状态。
- 如果真实模型不能稳定遵循 JSON tool 协议，增加原生 function-calling adapter 或更强代码模型，不改变图/工具/UI 契约。
- 归档前确认 `agentic-3d-scene-chat` 的 mock 与真实模型验收都通过；视觉初筛不作为最终裁判。
