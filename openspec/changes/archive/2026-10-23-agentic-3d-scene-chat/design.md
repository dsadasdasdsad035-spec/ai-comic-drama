# Design

## Context

当前 3D 聊天接口：

```text
SceneCodeWorkbench
  -> runSceneCodeChat()
  -> runSceneCodeJob()
  -> callText("/api/text", json:true)
  -> 解析 { reply, code, motionNote }
  -> 沙箱试运行
  -> 失败时带错误再请求一次
```

限制：

- 聊天只有 `{ role, text }`，没有工具事件和结构化结果；
- `/api/text` 没有 tools/streaming；
- 模型看不到沙箱首帧、关键帧和视觉验收结果；
- 长链路靠一次文本修复，失败后只能重新发送。

现有代码优先工作台已经提供 `SceneSandbox`、`SceneCode`、`sceneCodeMeta`、素材/选择、过期和保存链路；本变更只替换聊天编排和聊天渲染，不重写 3D 运行时。

## Goals / Non-Goals

**Goals:**

- 浏览器内 LangGraph 图编排多步 agent，工具执行可见、可取消、有次数上限。
- 模型 Key 继续只在服务端；浏览器只调用本地代理。
- 聊天用 assistant-ui 的结构化 parts 展示工具、代码摘要、帧和验收清单。
- 用固定“山 + 男女双剑对打 + 环绕”场景做 mock 和真实模型验收。
- 不改变保存/渲染由用户显式触发的规则。

**Non-Goals:**

- 不把 LangGraph 搬到服务端，也不使用要求 LangGraph Server 的 assistant-ui LangGraph 适配器。
- 不做多 agent 协作、长期线程记忆、跨设备会话或模型 token 逐字流式。
- 不开放任意 shell、文件系统、网络或 MCP 工具。
- 不让 agent 自动保存、自动出片或修改其他镜头。
- 不把 chain-of-thought 当聊天内容展示。

## Decisions

### 1. LangGraph 在浏览器内运行

图、工具和状态都在浏览器，模型请求通过 `/api/text` 代理。

理由：

- `run_sandbox`、`capture_frames` 必须访问 iframe 沙箱和当前画布状态；
- 服务端图需要 WebSocket/interrupt/resume 才能回调浏览器工具；
- 模型 Key 仍由服务端持有，浏览器只发 prompt。

**替代方案：** 服务端 LangGraph + 客户端工具回调。可做，但要跨进程中断恢复、工具鉴权和双份状态；本期不采用。

### 2. 不使用 assistant-ui 的 react-langgraph 适配器

`@assistant-ui/react-langgraph` 依赖 LangGraph Server/Studio。当前图在浏览器内，不能直接接。

采用：

```text
LangGraph graph.streamEvents()
  -> AgentEventBridge
  -> assistant-ui ExternalStoreRuntime
```

UI 只依赖我们定义的 `AgentMessage` / parts，LangGraph 事件在桥里转换。以后如果图迁到 LangGraph Server，可以替换成原生适配器，聊天组件不用重写。

### 3. ZCodeChatModel 用 JSON action 协议适配现有文本模型

`/api/text` 当前不是 tools/streaming API，不能直接给 LangChain 的 native tool calling 使用。

新增 `ZCodeChatModel extends BaseChatModel`：

- `bindTools(tools)` 保存工具 schema；
- 每次调用把 system、历史、工具 schema 和当前状态摘要拼成 JSON 提示；
- 调 `/api/text` 的 `json:true`；
- 解析 `{ content, tool_calls: [{ id, name, args }] }` 成 `AIMessage`；
- 没有 tool_calls 时按普通文本结束；
- 未来 provider 原生支持 function calling 时，加一个 adapter，不改图/工具/UI。

工具调用 id 由适配器生成稳定 id；工具结果按 id 回填。

### 4. 固定 StateGraph + ToolNode，图控制硬门禁

状态：

```ts
type SceneAgentState = {
  messages: BaseMessage[]
  code?: string
  codeHash?: string
  trial?: { ok: boolean; error?: string; firstFrame?: string }
  frames?: { t: number; dataUrl: string }[]
  review?: {
    passed: boolean
    usedVision: boolean
    items: { label: string; ok: boolean; reason?: string }[]
  }
  attempts: number
  reviewAttempts: number
  finished: boolean
}
```

图：

```text
START
  -> context（把当前镜头/选择/旧代码放进 system 上下文）
  -> agent（ZCodeChatModel）
       |-- tool_calls -> tools
       |-- final text -> gate
  -> tools -> gate
  -> gate:
       code 未试运行 -> 要求 agent 调 run_sandbox
       trial 失败且 attempts < 3 -> 回 agent 修复
       trial 成功但无 review -> 要求 capture_frames/review_frames
       review 失败且 reviewAttempts < 2 -> 回 agent 修复
       review 通过且 finish -> END
       超过上限 -> END(error)
```

`finish` 工具本身校验：

- `trial.ok === true`；
- `review.passed === true`，或视觉不可用时明确标记 `needsHumanReview`；
- 否则返回错误给模型，不能结束。

这比 `createReactAgent` 更可控，也避免模型自行调用保存/渲染工具。

### 5. 工具集只在浏览器执行

| 工具 | 作用 | 主要限制 |
| --- | --- | --- |
| `get_shot_context` | 返回当前镜头、选中素材、旧代码摘要 | 只读当前镜头 |
| `set_scene_code` | 提交完整代码草稿 | 大小/静态检查；不直接应用 |
| `run_sandbox` | 试运行当前草稿 | 复用 SceneSandbox；init/单帧/总超时 |
| `capture_frames` | 按时间抓帧 | 最多 5 帧；需 trial 成功 |
| `review_frames` | 视觉清单验收 | 需已抓帧；无视觉模型返回未验证 |
| `finish` | 声明场景完成 | 需 trial/review 通过 |

工具结果包含结构化摘要：

```ts
{ ok, summary, data? }
```

代码内容不放进聊天事件，只返回 `codeHash/lineCount`；帧返回缩略图 URL/dataURL；验收返回清单。

取消/超时：

- 外部 `AbortSignal` 传入模型调用、沙箱和视觉请求；
- 图总时限建议 5 分钟；工具单步 30 秒；代码修复最多 3 次，视觉验收最多 2 次；
- 取消时关闭沙箱、停止后续工具，保留上一版代码/视频。

### 6. assistant-ui 用 ExternalStoreRuntime

消息状态由我们自己的 chat store 持有，assistant-ui 只负责渲染：

```ts
type AgentMessage = {
  id: string
  role: 'user' | 'assistant'
  parts: AgentMessagePart[]
  status?: 'running' | 'complete' | 'error' | 'cancelled'
}

type AgentMessagePart =
  | { type: 'text'; text: string }
  | { type: 'tool-call'; toolCallId: string; toolName: string; args: unknown; result?: unknown; status: ToolStatus }
  | { type: 'code'; codeHash: string; lineCount: number }
  | { type: 'frames'; frames: { t: number; url: string }[] }
  | { type: 'review'; items: ReviewItem[] }
```

`useExternalStoreRuntime` 接收 `messages`、`onNew`、`isRunning`、`onCancel`；工具结果按 `toolCallId` 回填到同一个 part。

组件：

- `Thread` / `Message` / `Composer`：assistant-ui primitives；
- `makeAssistantToolUI` 注册每个工具卡片；
- `RunSandboxToolUI` 显示 running/error/通过；
- `CaptureFramesToolUI` 渲染缩略图组；
- `ReviewToolUI` 渲染勾选清单；
- `SetSceneCodeToolUI` 只显示 hash/行数和“查看代码”；
- 代码、帧、清单以自定义 part/tool UI 渲染，不拼 Markdown。

不展示模型内部推理；只显示工具参数摘要和结果。assistant-ui 默认主题不直接启用，使用现有 `--panel / --line / --accent` token 包一层。

### 7. 聊天布局与工作台联动

- 保留左侧参考内容、目标镜头状态和代码页签；
- 右侧聊天改为 agent 面板，context chips 仍在输入框上方；
- 用户发送消息时把当前选择和镜头 ID 传给图；图只操作当前镜头；
- 代码草稿、预览、渲染仍由工作台现有状态控制；tool result 只提供摘要；
- 保存/渲染按钮保持人工触发；agent 不自动保存；
- agent 运行中禁用同一镜头的第二次发送，提供取消；
- 关闭工作台时 abort 图、沙箱和视觉请求。

### 8. 验收场景与测试

固定场景 prompt：

```text
山顶平台/山谷，背景有山。
一名男人和一名女人，各持一把剑，互相攻防。
至少一次挥剑和一次格挡/闪避。
镜头从远处环绕飞行约 120 度，始终 lookAt 两人中点。
时长 4 秒，16:9，clean。
```

验收清单：

```text
mountain
two_people
man_woman_distinct
two_swords
duel_pose
orbit_motion
camera_faces_pair
duration_4s_aspect_16_9
no_runtime_error
```

测试分两层：

1. **mock graph**（CI）
   - 脚本化 `ZCodeChatModel` 调用 `set_scene_code`、`run_sandbox`、`capture_frames`、`review_frames`、`finish`；
   - 使用固定的山/两人/双剑/环绕代码 fixture；
   - 断言工具事件顺序、状态、代码摘要、5 帧、清单、取消和修复上限。
2. **真实模型**（手动/半自动）
   - 真实 LangGraph 图跑固定 prompt；
   - 抓帧后视觉初筛，人工看关键帧和 mp4；
   - 保存 codeHash、5 帧、4 秒 mp4、清单 JSON。

自动视觉判断不能单独判定性别/双剑；视觉结果作为初筛，人工为最终验收。

### 9. 依赖与加载

新增：

```text
@langchain/core
@langchain/langgraph
@assistant-ui/react
zod
```

不使用 `@assistant-ui/react-langgraph`。

agent 工作台面板懒加载，避免 LangGraph/assistant-ui 进入画布首屏。生产构建检查包体；必要时单独 chunk。

### 10. 与在途变更协调

`code-first-3d-chat` 目前已完成但未归档，本变更修改同一聊天入口。实施前先完成/归档它，确保 `sceneCode`/`SceneSandbox` 和聊天行为的主 spec 已落定。`shot-neighbor-references` 只影响参考集合，不阻塞本变更。

## Risks / Trade-offs

- **模型不遵循 JSON tool 协议** → 适配器给出明确协议、工具 schema、最多 3 次修复；失败不写代码。
- **LangGraph 包体大** → agent 面板懒加载，按需 import。
- **assistant-ui 默认样式冲突** → 用 primitives/自定义 tool UI，复用现有 token。
- **浏览器内图无法持久化线程** → 本期只保留编辑器会话；长期记忆后续再做。
- **视觉验收误判** → 视觉只做初筛，人工最终验收；无视觉模型时标记未验证。
- **模型费用和循环** → 3 次代码修复、2 次验收、5 分钟总时限；每步显示进度和取消。
- **工具越权** → 工具表固定，不提供 shell/网络/保存；代码仍走沙箱。
- **长工具结果膨胀聊天** → 代码只给 hash，帧给缩略图，工具结果有大小上限。
- **与未归档代码优先变更冲突** → 实施前先归档/确认 `code-first-3d-chat`。

## Migration Plan

1. 先完成/归档 `code-first-3d-chat`，确认 3D 代码运行时和聊天入口稳定。
2. 加依赖、`AgentEvent` 类型和 mock 图；先不替换生产聊天。
3. 实现 `ZCodeChatModel`、工具和 StateGraph，用手写 fixture 跑通 sandbox/frames/review。
4. 接入 assistant-ui ExternalStoreRuntime 和 tool UI；懒加载 agent 面板。
5. 替换现有纯文本聊天，保留代码页签和保存/渲染人工门禁。
6. 加 mock 验收、真实模型验收和回归。
7. 文档更新；归档前确认 `code-first-3d-chat` 已处理。

回滚：保留旧的 `runSceneCodeChat` 简单路径作为 feature flag/fallback；关闭 agent 面板即可回到一次性代码生成，不影响已保存代码和视频。

## Open Questions

无。LangGraph 在浏览器内运行、assistant-ui 使用 ExternalStoreRuntime、视觉只做初筛，均已确定。
