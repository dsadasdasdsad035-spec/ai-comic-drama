# Proposal

## Why

知识库现在从属于项目：`knowledge_links` 用 `project_name` 做主键，库标识由项目名派生（首次进入自动建库），删项目连带删库。这带来三个实际限制：

- **不能起名**：库名等于项目名，无法建「运镜手册」「通用参考资料」这种跨项目复用的资料库。
- **不能建多个**：一个项目只能有一个库，设定、参考、剧本原文混在一起，检索互相污染。
- **问答有两套**：知识库页有一套自写的 SSE 问答面板，创意会话（dsh）另有一套能做工具调用的会话。同一件事两种实现、两套历史、两套上下文模型。

`knowledge-base-anythingllm` 已交付并归档（29/29，真实上游验收通过）。现在把库从项目里拆出来，并把问答收敛到唯一的聊天入口。

## What Changes

- **BREAKING** 库改为独立命名的资源：用户建库时起名，库有稳定 `id`、唯一 `name`、以及回读自上游的 `upstream_slug`。库 MUST NOT 从属于项目，MUST NOT 由项目名派生。
- **BREAKING** 知识库视图从项目视图改为全局视图（`#/knowledge`），只承载维护：库列表、新建/重命名/删除库、库内文档上传/移出/彻底删除。**移除自写问答面板与问答历史**。
- **BREAKING** 问答统一到 dsh 创意会话：新增「知识库」会话模式（agent-preset），会话头提供库选择器，选定后工具作用域即为该库。
- 工具作用域从「当前项目」改为「当前会话选定的库」：`search_knowledge` / `read_knowledge_doc` 按会话隔离，新增 `list_knowledge_bases` 供模型在未选库时列出可选项。
- 未选库时工具返回可读说明（列出可用库并指引选择），MUST NOT 抛未处理错误、MUST NOT 退化成跨库检索。
- 删除项目不再影响任何库；库的生命周期与项目完全无关。
- 保留原有限制：检索结果 MUST NOT 在生成环节被自动注入提示词；凭据只在服务端；类型以上游声明为准；移出与彻底删除仍是两种语义。

## Capabilities

### New Capabilities

（无）

### Modified Capabilities

- `knowledge-base`: 「一个项目对应一个知识库」改为「库是独立命名资源」；文档上传目标从项目库改为选定库；工具作用域从项目改为会话选定的库；删除项目不再级联清理库。
- `knowledge-base`: 移除「问答必须展示引用来源」与「问答历史由上游保存」——自写问答面板下线，引用由 dsh 的工具结果呈现，历史归宿主会话。
- `knowledge-base`: 新增「知识库视图只做维护」「创意会话按会话选库」两条需求。

## Impact

- 数据：`knowledge_links(project_name PK)` → `knowledge_bases(id PK, name UNIQUE, upstream_slug)` + `knowledge_sessions(dsh_session_id PK, kb_id)`。现有 `desktop-host-probe` 库需迁移成同名独立库，其 16 条上游问答历史变为无入口（不删除，仅不再展示）。
- 服务端：`server/knowledge.mjs` 把 `ensureWorkspace(projectName)` 换成库 CRUD；删 `chatStream` / `history`；`server/app.ts` 六个路由的作用域校验换成库维度，新增库 CRUD 与会话选库路由；`server/project-lifecycle.mjs` 去掉 `knowledge_links` 级联。
- 工具：`src/agent/knowledgeTools.ts` 作用域参数由 `projectName` 换成 `sessionId`，新增 `list_knowledge_bases`；`server/studio-tool-bridge.mjs` 的 `invoke` 传 `sessionId`，`ensureLoaded` 不再按项目重建工具表。
- dsh：`server/dsh-plugins/creative-tools/index.js` 从 `exec.agent.session.id` 取会话标识并透传；新增一个 dsh UI 插件，经 `ctx.slots.register({ name: 'conversation.session.header.actions' })` 注册库选择器（与官方 `agent-preset` 插件同一机制，不改 dsh 源码）。
- 前端：`src/knowledge/` 删问答面板与引用卡，改为库列表与文档维护；`src/api.ts` 知识库 API 改为库维度；`src/shell/nav.ts` / `route.ts` / `App.tsx` 把知识库改为全局视图。
- 验收：现有四套脚本中依赖自写问答的（`verify-knowledge-ui-real-click`、`verify-knowledge-real-ui`、`verify-knowledge-model-tool`）需按新形态重写；`verify-knowledge-edge` 与 `verify-knowledge-routes` 改为库维度。
