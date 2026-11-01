# Tasks

## 1. 角色 submit 声明 schema 与归一化

- [x] 1.1 为 `submit_characters` 提供仅 `{ characters: [...] }` 的 object JSON Schema（复用 `characterItem` 字段），与 union 校验 schema 分离；验证：`node verify-apimart-tool-schemas.mjs` 中 `submit_characters` 顶层 `type === 'object'`
- [x] 1.2 在 `submit_characters` 执行路径增加裸数组 → object 归一化，再调用 `validateContract('characters-v1')`；验证：新增或扩展单测/脚本覆盖数组与 object 两种 arguments 均 `ok: true`
- [x] 1.3 确认 `mergeCharacters` / 角色草稿 UI 行为与改前一致；验证：`node verify-character-chat-attachments.mjs` 通过

## 2. APIMart 出口与 Responses tools

- [x] 2.1 在 `/api/text` APIMart 分支（含 `buildApimartResponsesBody` / `toApimartResponseTools` 前）确保 tools 的 parameters 均为 object，必要时对已知工具应用 declaration override；验证：`verify-apimart-tool-schemas.mjs` 对 outbound 形状断言
- [x] 2.2 扩展 `verify-apimart-errors.mjs` 或新脚本：mock/断言 Responses body 中不含 `anyOf` 顶层 parameters
- [x] 2.3 真实 Key 可选：`gpt-6.1-sol` 角色环节 mock 或 live 冒烟（带最小 tools 含 submit_characters schema）；验证：不再出现 `invalid_function_parameters` / `type: "None"`

## 3. 全工作台 submit 回归

- [x] 3.1 新建 `verify-apimart-tool-schemas.mjs`：bundle 各 stage 的 `submit_*` + 3D/发布/创意关键 tools，断言 parameters 顶层均为 object
- [x] 3.2 跑 `node verify-workbench-chats.mjs` 与 `node verify-pi-agent.mjs`，确认非 APIMart 渠道聊天未回归

## Workflow follow-up

- 归档前同步主规格 `chat-agent-runtime`、`model-provider-routing` delta。
- 若与「已移除能力表守卫」的代码一致，另开变更更新主规格中「必须声明支持原生工具」条文（本变更不包含）。
