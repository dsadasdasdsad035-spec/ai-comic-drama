# 3D 调度聊天引擎

3D 调度聊天（提示词工作台 → 「3D 调度」）的模型循环有两个实现：

| 引擎 | 说明 |
|---|---|
| `langgraph` | LangGraph 状态图 + 项目自写的 ChatModel 适配器，支持原生 tool calls 与 JSON action 回退。 |
| `pi` | 默认。`@earendil-works/pi-agent-core` 的 `Agent` 负责循环与工具调度，模型调用仍走项目自己的 `/api/text` 代理。 |

两个引擎共用同一批工具实现、试运行门禁、视觉验收、运行上限和镜头隔离规则。切换引擎不改变工作台 UI、线程记录或项目数据。

## 前置条件

`pi` 只对**已声明原生工具调用**的模型生效（见 `src/agent/toolCapabilities.ts` 的 `TOOL_CAPABILITIES`）。当前为：

- `minimax / MiniMax-M3`
- `ark-plan / doubao-seed-2-1-lite-260915`
- `ark-plan / deepseek-v4-flash`
- `ark-plan / kimi-k3`

用其他模型时：

- 设置里选 `pi`：自动回退到 `langgraph`，聊天头部显示「引擎：langgraph（已回退）」，轨迹里记录回退原因。
- 测试/诊断时显式传 `engine: 'pi'`：直接返回可读错误，不静默回退。

## 开启与回退

设置项是 `agentEngine`，默认 `pi`：

```json
{
  "agentEngine": "pi"
}
```

- 设置页「Agent 运行上限」里的「执行引擎」下拉；也可以 `PUT /api/settings` 写入。
- 默认值是 `pi`，但**只在原生工具能力表内的模型上生效**；其他模型会自动回退 `langgraph`，属于预期行为。
- 回退到 LangGraph：在设置页选 `LangGraph`，或写 `{ "agentEngine": "langgraph" }`。
- 删除该字段会让归一化重新回到默认 `pi`。
- 迁移期间也可以只对单轮生效：`runSceneAgent({ ..., engine: 'pi' })`，仅测试脚本使用。

聊天头部与运行结果都会标明本轮实际引擎：

- UI：`[data-agent-engine]` 芯片，例如「引擎：pi」或「引擎：langgraph（已回退）」。
- 结果：`SceneAgentResult.engine` 与可选的 `engineFallbackReason`。
- 事件：`{ type: 'custom', name: 'engine', value: { engine, requested, fallbackReason? } }`。

## 保存与门禁

两个引擎的语义一致：

- 代码只有通过 `run_render` 试运行才会交给工作台草稿。
- `finish` 要求已有通过的试运行和视觉验收（或明确转人工）。
- 不自动保存项目；保存仍需用户操作。
- 取消会终止上游请求和渲染作业，旧代码与旧视频保留。

## 依赖边界

`@earendil-works/*` 只允许出现在：

- `src/agent/pi/`（适配层）
- `src/agent/sceneAgentGraph.ts`（引擎选择器）

`node verify-pi-engine.mjs` 会检查这条边界。上游升级只应改动 `src/agent/pi/`，然后跑：

```sh
node verify-pi-engine.mjs   # 适配层：消息转换、事件编码、错误/取消、schema、依赖边界
node verify-pi-agent.mjs    # 引擎行为：工具顺序、门禁、催促、取消、超时、上限
node verify-agent-graph.mjs # LangGraph 引擎回归
```

## 已知限制

- `/api/text` 没有 token 级正文流，只有「已生成字符数」进度；两个引擎的文本都在轮次结束时整段落地。
- `agent.abort()` 只中止当前模型流与工具 signal，不会自行终止循环；`streamFn` 必须在 `signal.aborted` 时以 `stopReason: 'aborted'` 结束，否则循环会继续。
- 历史压缩（草稿分片折叠）两个引擎各有一份实现，规则必须保持一致：`agentHistory.compactDraftHistory` 与 `pi/compact.ts`。
