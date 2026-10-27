# Proposal

## Why

3D 调度聊天目前把「循环」和「产品语义」焊在一起：`runSceneAgent` 直接依赖 LangGraph 的 `StateGraph`，并用两个自写 `BaseChatModel` 适配器（JSON action 与原生 tool calls）拼出模型调用。循环本身没有产品价值，却占了最容易出错的部分——工具顺序、取消、超时、历史压缩、事件去重。项目真正要守的是 12 个受控工具、渲染试运行门禁、视觉验收和每镜隔离。

`pi` 的 `@earendil-works/pi-agent-core` 正好只提供这一层：浏览器可打包、自定义工具、稳定事件流、`abort()`、可注入 `streamFn`，MIT，解包约 271 KB 且无 Node 内建依赖。把它放在现有 `runSceneAgent` 门面之后，可以用一个小适配层换掉自维护循环，同时保留 LangGraph 作为回退。现在做是因为 3D 是唯一已有窄门面和真实工具循环语义的聊天面；其余工作台聊天走的是技能 + `submit_*` 草稿协议，不是同一个问题。

## What Changes

- 在 `runSceneAgent` 内增加引擎接缝，新增 `pi` 引擎并作为默认引擎；模型不在原生工具能力表时自动回退 LangGraph。
- 设置页新增「执行引擎」下拉，可在 pi 与 LangGraph 之间显式切换。
- 新增 `src/agent/pi/` 适配层：`streamFn`（复用现有 `/api/text` 代理）、12 个工具的 `AgentTool` 定义、pi 事件到现有 `AgentEvent` 的映射、取消与总超时。
- `pi` 引擎第一版只对能力表内声明原生工具调用的模型启用；其余模型继续走 LangGraph 的 JSON action 路径，不做 JSON→toolCall 翻译。
- 工具执行固定为顺序模式，`finish` 返回终止信号，保持「试运行 → 抓帧 → 验收 → finish」的既有门禁语义。
- 运行轨迹标明实际使用的引擎，便于审计和对比。
- 新增对齐测试：同一组 mock 输入分别跑两个引擎，比较可观察事件序列与工具结果；再跑一次真实 Blender 验收。
- 引入 `@earendil-works/pi-agent-core` 精确版本依赖；所有上游 import 只允许出现在 `src/agent/pi/`。
- **BREAKING**：默认引擎由 LangGraph 改为 pi。能力表内的模型会走新循环；其他模型自动回退，行为与升级前一致。

不在本次范围：其他工作台/发布/创意聊天；`/api/text` 协议与渠道路由；删除 LangGraph；聊天 UI 改版；pi 的 provider 体系（继续使用项目自己的模型代理）。

## Capabilities

### New Capabilities

（无）

### Modified Capabilities

- `scene-agent-runtime`: 把「多步工具循环」从具体实现提升为引擎无关契约，新增引擎选择与回退、pi 引擎的门禁/取消/隔离要求，以及实际引擎的可审计性。现有需求（服务端代理、最小工具集、试运行门禁、上限、视觉验收、镜头隔离、事件分组、取消终止、基线代码）保持不变。

## Impact

- 代码：`src/agent/sceneAgentGraph.ts`（拆出门面与 LangGraph 实现）、`src/agent/SceneAgentChat.tsx`（仅引擎展示与调用签名）、新增 `src/agent/pi/*`、`src/agent/agentEngine.ts`。
- 依赖：`package.json` / `package-lock.json` 增加 `@earendil-works/pi-agent-core`（精确版本）；Vite 可能需要 `optimizeDeps` 或打包验证。
- 测试：新增 pi 引擎 mock 对齐脚本；扩展现有 `verify-agent-graph.mjs` 的共享场景；真实验收沿用山/男女/双剑/环绕场景。
- 规格：`openspec/specs/scene-agent-runtime/spec.md` 将新增引擎相关需求；其他能力规格不受影响。
