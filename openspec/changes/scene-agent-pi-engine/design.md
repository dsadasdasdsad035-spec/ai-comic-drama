# Design

## Context

见 `proposal.md` 的 Why。当前实现的关键事实：

- 门面是 `runSceneAgent(input: RunSceneAgentInput): Promise<SceneAgentResult>`（`src/agent/sceneAgentGraph.ts`），唯一调用方是 `SceneAgentChat.tsx`。
- 门面内部直接构造 LangGraph `StateGraph`（`agent → tools → gate`），用 `streamEvents` 驱动事件桥。
- 两个模型适配器都继承 LangChain `BaseChatModel`：`ZCodeChatModel`（JSON action）与 `NativeToolChatModel`（原生 tool calls），底层都是 `callTextStream('/api/text')`。
- 12 个工具用 `DynamicStructuredTool` + zod 定义，全部通过 `SceneAgentDeps` 操作当前镜头；工具内部已有试运行/验收/上限的领域事件。
- 事件消费端是 `createAgentEventBridge()` → `AgentEvent` → `applyAgentEvent()`，UI 只认这套事件。
- `/api/text` 的 SSE 只发 `meta / progress / tool_call_delta / done / error`，没有 token 级正文增量。
- 运行环境：Node 22.23（Docker 同为 22），浏览器内运行 agent；项目禁止浏览器持有渠道 Key。

## Goals / Non-Goals

**Goals:**

- 在门面后引入可切换引擎，默认行为完全不变。
- 新引擎只替换「循环 + 模型调用/工具调度 + 事件产生」，复用现有工具实现、门禁、上限、草稿与验收链路。
- 两个引擎之间可以按轮切换，线程记录仍可恢复。
- 上游依赖只落在 `src/agent/pi/`，可整体删除而不影响产品语义。

**Non-Goals:**

- 不引入 pi 的 provider 体系；模型调用继续走 `/api/text`。
- 不改 `/api/text` 协议，不做 token 级流式输出。
- 不改造其他工作台聊天、发布聊天或创意聊天。
- 不删除 LangGraph，不在本变更切换默认引擎。
- 不做多 agent / subagent、MCP、工具市场。

## Decisions

### D1：门面保留，引擎实现下沉

`runSceneAgent` 保留现有签名与 `SceneAgentResult` 形状，内部改为：

```
runSceneAgent(input)
  └─ selectEngine(input) -> 'langgraph' | 'pi'
       ├─ runSceneAgentLangGraph(input)   // 现有实现整体搬移
       └─ runSceneAgentPi(input)          // 新增
```

理由：UI 与测试只依赖门面；迁移可以逐轮进行，回退只需改选择结果。替代方案是把引擎注入 `SceneAgentChat`，那会把选择逻辑扩散到 UI，且线程切换语义更难保证。

引擎选择规则（按优先级）：

1. `input.engine`（测试/诊断用）显式指定。
2. `settings.agentEngine`（新增，默认 `'pi'`，设置页可改）。
3. 无配置 → `'pi'`。

`'pi'` 生效前检查模型能力：用现有 `resolveToolProtocol()` 判定；若结果不是 `native`，则回退 `'langgraph'` 并在轨迹里记 `engineFallbackReason: 'model-not-native'`。若配置显式 `'pi'` 且能力不满足，返回可读错误（对齐 spec 的「显式强制新引擎」场景）。

### D2：新引擎用 pi `Agent`，自写 `streamFn` 包 `/api/text`

pi 的 `Agent` 接受注入的 `StreamFn`，因此可以完全绕开 `pi-ai` 的 provider 与鉴权：

```
Agent({
  initialState: { systemPrompt, model: placeholderModel, tools },
  streamFn: piStreamFn(ask, modelKey),
  convertToLlm,           // 复用现有历史压缩思路
  beforeToolCall,         // 顺序 + 取消检查
  finishTurn,             // 复刻 gate 的「催促继续」语义
  toolExecution: 'sequential',
})
```

`piStreamFn` 的职责：

- 把 pi 的 `TranscriptContext` 消息转成项目 `ProviderChatMessage[]`，调用 `callTextStream`。
- 把 `finishReason` / `toolCalls` 合成为合法的 `AssistantMessage`（`role / content / api / provider / model / usage / stopReason / timestamp`），通过 `AssistantMessageEventStream` 依次推 `start → text_start → text_delta（整段或分片）→ text_end → toolcall_end* → done`。
- 失败不能 throw：按 pi 契约编码成 `error` 事件 + `stopReason: 'error' | 'aborted'`。

**已由 spike 验证的硬约束**：`agent.abort()` 只中止当前模型流与工具 signal，**不会自行终止循环**。若 `streamFn` 忽略 `options.signal`，abort 后循环会继续调度并重复执行工具（初版 spike 复现了无限循环）。所以 `streamFn` 必须在进入时检查 `signal.aborted`、流式过程中监听 abort，并以 `stopReason: 'aborted'` 的 `error` 事件结束；pi 只把 `aborted` / `error` 当作硬退出。

替代方案是直接用 `pi-ai` 的 OpenAI 兼容 provider 指向 `/api/text`。否决原因：代理不是 OpenAI 兼容端点（SSE 事件形状不同），且会把 Key/渠道鉴权语义从服务端漏进浏览器侧配置。

### D3：工具语义复用，只换外壳

12 个工具的「函数体」保持不变，新增一层 `AgentTool` 定义：

- 参数 schema 用 TypeBox（pi 的要求），从现有 zod schema 手工映射；参数校验仍以现有 `checkSceneCode` 等函数为准。
- `execute()` 返回 `{ content: [模型可见摘要], details: { ...给 UI 的结构 } }`；`content` 只放摘要和必要提示，帧 URL、代码正文、草稿行数放 `details`。
- 这样 `modelFacingResult()` 的裁剪逻辑从「事后剥离」变成「构造时就分离」，模型看不到 data URL 和整段代码。
- `finish` 返回 `terminate: true`。

替代方案是保留 `DynamicStructuredTool` 并包一层适配器。否决原因：pi 的类型要求 `AgentTool` 的 `execute` 签名（`toolCallId, params, signal, onUpdate`），包一层只是把同样的映射搬到更隐蔽的位置，且无法利用 `details` 的 UI 分离。

### D4：事件映射新建，不改造现有桥

新增 `src/agent/pi/events.ts`，把 pi 的 `AgentEvent`（`agent_start / turn_start / message_* / tool_execution_* / turn_end / agent_end`）映射成项目 `AgentEvent`：

| pi | 项目 |
|---|---|
| `turn_start` | `agent_step(phase='start')` |
| `message_update` + `text_delta` | `text_message_start/content` |
| `message_end`（assistant） | `agent_step(phase='end', text)` + `text_message_end` |
| `tool_execution_start` | `tool_start`（参数经 `sanitizeToolInput`） |
| `tool_execution_end` | `tool_end` |
| `agent_end` | 无（门面统一收尾） |

不去改 `createAgentEventBridge()`：它绑定的是 LangGraph 的 `run_id` 语义，混用会让去重键变复杂。两套映射并存，输出同一种 `AgentEvent`，下游 `applyAgentEvent` 不变。

`thinking_*` 事件一律丢弃，保持「不展示隐藏推理」的既有规范。

### D5：上限与取消沿用门面层，不交给引擎

- 总超时仍由门面的 `setTimeout + abort` 控制；pi 的 `agent.abort()` 取代 `controller.abort()` 的传播路径。
- 代码尝试/验收次数仍由工具内部计数（`session.attempts` / `session.reviewAttempts`），新引擎不重复实现。
- `gate` 的「没有工具调用就催促」改为 `finishTurn`：返回 `{ action: 'continue' }` 并注入一条催促消息；返回 `{ action: 'end' }` 的条件与现有 `session.finished || session.terminalError` 一致。

这样「上限」只有一份真相，不会出现两个引擎计数不同导致的验收差异。

### D6：依赖用精确 npm 版本，不用 submodule

`package.json` 写 `"@earendil-works/pi-agent-core": "1.4.0"`（无 `^`），lockfile 锁定。理由：

- 上游公开面小（`Agent` + 类型），MIT，1.x。
- npm 版本带 tree-shaking 保证，仓库自带浏览器冒烟脚本。
- submodule 会要求自行构建、失去发布产物的可验证性，且本地补丁会永久 drift。

如需 vendored 快照，也必须保持「只读 + 适配层承接差异」，不得直接改上游源码。

### D7：先做浏览器打包 spike，再动生产代码

在写任何生产代码前，先用一个临时入口验证：

- Vite 能打包 `@earendil-works/pi-agent-core`，无 `node:` 内建残留。
- 产物体积增量可测量。
- 假 `streamFn` 下工具顺序、`abort()`、`terminate`、事件顺序符合预期。

Spike 不通过则停止，不在生产代码里引入依赖。这是唯一能提前证伪「浏览器内直接换循环」的动作。

## Risks / Trade-offs

- **上游 API 漂移** → 所有 import 限定在 `src/agent/pi/`；对齐测试固定上游版本；升级时只跑该目录的测试。
- **`abort()` 不终止循环** → `streamFn` 必须自身 abort 感知并以 `stopReason: 'aborted'` 结束；对齐测试覆盖「工具执行中取消」。spike 已复现过忽略 signal 导致的无限循环，作为回归用例保留。
- **没有 token 级流式** → 新引擎也只能整段/分片落地文本；接受这一点，不为此改 `/api/text`。UI 的「已生成 N 字符」进度仍可用 `onProgress` 驱动。
- **工具并行默认值** → 显式设 `toolExecution: 'sequential'`；对齐测试覆盖「同时请求试运行与抓帧」。
- **两个引擎行为漂移** → mock 对齐测试作为门禁；任何工具语义变更必须同时通过两个引擎的同一场景。
- **pi 的 `fold` 历史与现有 `compactDraftHistory` 不等价** → 先复用压缩规则，把结果转成 pi 消息；对齐测试里对比「折叠后模型可见消息」的关键字段，不要求逐字相同。
- **回退后线程不一致** → 线程记录只存 UI 消息与摘要，不存引擎内部状态；切换引擎不重放历史工具调用。
- **依赖体积** → 只引入 `pi-agent-core`，不引入 `pi-ai` 的 provider 数据；spike 中记录实际增量，超过阈值则暂停并重新评估。

## Migration Plan

1. 依赖与 spike：加精确版本依赖，跑浏览器打包与假流验证（不接生产路径）。
2. 抽门面：把现有 LangGraph 实现原样搬到 `runSceneAgentLangGraph`，`runSceneAgent` 变选择器；全量跑 `verify-agent-graph.mjs`，确认零行为变化。
3. 实现 `src/agent/pi/`：`streamFn`、`tools`、`events`、`engine`。
4. 对齐测试：同一组 mock 场景双引擎运行，比较工具序列、草稿、帧、验收、取消、超时。
5. 真机验收：山/男女/双剑/环绕，4 秒 16:9 clean，保存代码、关键帧、视频与清单。
6. 文档与默认值：记录如何切换引擎；默认已按产品决定设为 pi，模型不在能力表时自动回退 LangGraph。

回滚：把 `agentEngine` 设回 `langgraph` 或移除适配目录与依赖；线程与项目数据不受影响。

## Open Questions

- 切换默认引擎的判定标准（连续多少次真机验收通过、哪些模型覆盖）留到本变更验收后再定，不影响当前设计与任务拆分。
