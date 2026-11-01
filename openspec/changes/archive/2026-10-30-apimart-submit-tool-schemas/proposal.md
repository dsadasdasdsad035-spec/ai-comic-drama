# Proposal

## Why

APIMart 推理模型（如 `gpt-6.1-sol`）在 `/v1/responses` 上校验 function tools 时，要求每个工具的 `parameters` 顶层必须是 `type: "object"`。角色工作台的 `submit_characters` 复用 `characters-v1` 契约，经 JSON Schema 导出后为顶层 `anyOf`（对象外壳或裸数组），网关返回 400，角色 Agent 聊天在发请求阶段即失败。其它工作台 submit 契约多为顶层 object，但缺少统一约束，未来仍可能踩同类坑。

## What Changes

- 为 **模型可见** 的 `submit_characters` 工具参数提供 **单一 object 形状**（`{ characters: [...] }`），满足 APIMart / OpenAI 严格网关。
- 在工具执行 / 契约校验前 **归一化** 模型仍可能返回的裸数组 payload，**不改变** `validateContract` 对两种合法产物的语义。
- 在出口层（或共享 helper）对发往渠道的 tools 做 **断言/归一化**：顶层必须是 `type: "object"`，禁止把 `anyOf`/`oneOf` 原样发给 APIMart Responses。
- 新增验收脚本：遍历所有工作台 `submit_*` 与关键聊天 tools，检查导出 schema 符合渠道要求。
- **不** 改 APIMart 路由、能力表守卫、temperature 等已单独处理的项（除非 tasks 发现硬依赖）。

## Capabilities

### New Capabilities

（无）

### Modified Capabilities

- `chat-agent-runtime`：渠道工具声明 MUST 满足严格 JSON Schema（顶层 object）；角色 submit 归一化不破坏契约校验。
- `model-provider-routing`：APIMart 带 tools 的请求（含 `/responses` 路由）MUST 只提交合规的 function parameters。

## Impact

- `src/skills/contracts.ts` 或 `submit` 路径：`characters-v1` 模型侧 schema 与运行时归一化。
- `src/agent/pi/toolAdapter.ts` / `server/apimart.mjs` / `server/text-tools.mjs`：可选集中 `normalizeProviderToolSchemas(kind)`。
- 验收：`verify-apimart-tool-schemas.mjs`（新）、扩展 `verify-character-chat-attachments.mjs` 或 `verify-workbench-chats.mjs`。
- 角色 / 剧本 / 素材 / 分镜 / 提示词 / 3D / 发布 / 创意聊天：**行为**不变（除角色在 APIMart 推理模型上从「400 失败」变为「可跑通」）。
