# Tasks

## 1. 数据层：库与会话选库

- [x] 1.1 在 `server/db.mjs` 建 `knowledge_bases(id TEXT PK, name TEXT UNIQUE, upstream_slug TEXT NOT NULL, created_at TEXT)` 与 `knowledge_sessions(dsh_session_id TEXT PK, kb_id TEXT NOT NULL, updated_at TEXT)`；用临时库打开两次验证幂等，并验证 `name` 唯一约束真的拦得住重复插入
- [x] 1.2 加 `knowledge_bases` 的 CRUD 访问器（`listBases` / `createBase` / `renameBase` / `deleteBase` / `getBase`）与 `knowledge_sessions` 的读写（`setSessionKb` / `getSessionKb` / `clearSessionKb`）；单测覆盖「重名被拒」「改 id 不变」「查不存在的库返回空」
- [x] 1.3 写一次性迁移：`knowledge_links` 每行 → `knowledge_bases`（`name=project_name`，`upstream_slug` 原样，`id` 新生成）；迁移前把 `knowledge_links` 全量写成 JSON 快照，成功后写 `settings` 标记键；用临时库验证「迁移后行数一致」「重复启动不重复迁移」「快照存在」
- [x] 1.4 从 `server/project-lifecycle.mjs` 移除 `knowledge_links` 的项目级联；用现有 `verify-project-lifecycle`（或等价断言）验证删项目不再触碰任何知识库表

## 2. 服务端：库维度路由

- [x] 2.1 把 `server/knowledge.mjs` 的 `ensureWorkspace(projectName)` 换成 `createBase(name)` / `resolveBase(kbId)`：创建后回读上游 slug 存 `upstream_slug`；验证「中文/含空格库名能建」「同名被上游拒绝时给出可读错误」「resolveBase 不复用 project 逻辑」
- [x] 2.2 删 `chatStream` 与 `history` 两个客户端方法及其 `kbSessionId` 辅助；`node verify-knowledge.mjs` 里相关断言一并移除，确认没有残留引用（`grep -rn "chatStream\|kbSessionId" server/ src/`）
- [x] 2.3 在 `server/app.ts` 把 6 个知识库路由的作用域从 `requireKnowledgeProject` 换成库维度：`docs` / `upload` / `remove` / `purge` / `search` / `doc` 全部按 `kbId` 取库；新增 `GET/POST /api/knowledge/bases`（列表/创建）、`PATCH/DELETE /api/knowledge/bases/:id`（改名/删除）；用 mock 上游验证「不存在的 kbId 返回 404 且文案说库不存在」
- [x] 2.4 新增 `GET/POST /api/knowledge/session-kb`：读/写某 dsh 会话选定的库，校验 kbId 存在；用 mock 验证「写后能读回」「库被删后读回 null」
- [x] 2.5 删库语义：删 `knowledge_bases` 行 + 清该库的 `knowledge_sessions` + 尽力 `deleteWorkspace(upstream_slug)`，失败进 warnings 不阻塞；验证「上游不可用时仍删成功」「文档池不受影响（对照 mock 的 documents 目录）」
- [x] 2.6 改完跑 `npm run build:server`，用 `stat -f '%Sm' server-build/app.mjs` 与 `stat -f '%Sm' server/app.ts` 确认 bundle 晚于源码

## 3. 工具层：会话作用域

- [x] 3.1 改 `src/agent/knowledgeTools.ts`：作用域依赖从 `projectName` 换成 `sessionId`；`search_knowledge` / `read_knowledge_doc` 按会话查库；**新增 `list_knowledge_bases`**（只读、两态可用、不改选定）
- [x] 3.2 未选库时的返回：结构化说明 + 可用库清单 + 指引（去界面选或说「用 X 库」）；断言「不抛未处理错误」「不退化跨库检索」「文案里列出库名」
- [x] 3.3 选定的库被删除后的检索返回：可读提示要求重新选择；用假 sessionId + 已删 kbId 验证
- [x] 3.4 改 `server/studio-tool-bridge.mjs`：`invoke` 接受并透传 `sessionId`；对 `KNOWLEDGE_TOOL_NAMES` 走「每次现建工具」路径（见 design 决策 4），其它 47 个工具与 `ensureLoaded` 的 project 缓存键**保持不动**；断言「同桥中两个 sessionId 并发调用拿到各自库的结果」
- [x] 3.5 `src/agent/builtinPlatformTools.ts` 注入 `sessionId` 而不是 `projectName` 给知识库工具；`node verify-knowledge-tools.mjs` 与 `verify-agent-tool-coverage.mjs` 通过（工具名清单一致性、专家分组仍在 `read` 组）

## 4. dsh 集成：透传会话 id + 选库控件

- [x] 4.1 改 `server/dsh-plugins/creative-tools/index.js`：从 `exec.agent.session.id` 取会话标识（对齐 `creative-expert` 的 `exec.studioExpertId` 做法），随 `/api/studio/tools/execute` 透传 `sessionId`；用 `tests/creative-tools-plugin.mjs` 的假上游断言 payload 里带 sessionId
- [x] 4.2 **最小验证 UI 插槽链路**：新建 `server/dsh-plugins/knowledge-ui/`，先只注册一个显示静态文字的组件到 `conversation.session.header.actions`；用 `--dump-config` 或实跑宿主确认它真的渲染出来（这一步只验通道，不写选择器）
- [x] 4.3 把 4.2 的组件换成库选择器：下拉列出所有库（调 `/api/knowledge/bases`），当前会话选中项高亮，选择后 `POST /api/knowledge/session-kb`；断言「两个会话分别选不同库互不影响」「选定的库被删后显示为空并提示重选」
- [x] 4.4 插件装载：`server/dsh-bundle.mjs` 增加 `KNOWLEDGE_UI_PLUGIN` 的复制与 `dsh.profile.bundles` 登记，`cordis.patch.yml` 用 `insert:` 挂一行；验证「宿主启动日志无 skipping profile bundle」「插槽组件可见」
- [x] 4.5 降级路径：`slots.register` 包 try/catch，插件挂不上时打日志且不阻塞宿主启动；验证「把插槽名改成不存在的值后宿主仍能起来，知识库工具仍可通过对话选库」

## 5. 前端：知识库视图改全局 + 删问答

- [x] 5.1 `src/shell/nav.ts` 把 `knowledge` 从项目视图组移出；`src/shell/route.ts` 增加全局路由 `#/knowledge`（参照 `#/account` 的 Route kind），`parseHash` 支持它；`node verify-shell-nav.mjs` 通过，且旧链接 `#/p/<项目>/knowledge` 落到全局知识库页而非概览
- [x] 5.2 `src/knowledge/KnowledgeView.tsx` 重写为纯维护：库列表（名称/文档数/上传/改名/删除）、新建库对话框、进入库后的文档清单（上传/移出/彻底删除）；断言「没有提问输入框」「没有消息流」
- [x] 5.3 删除问答相关：`src/knowledge/KnowledgeCitations.tsx`、`stripReasoning.ts` 里的流式归一化、`src/api.ts` 的 `streamKnowledgeChat` / `getKnowledgeHistory` / `parseKnowledgeSseLine`；`grep -rn "streamKnowledgeChat\|getKnowledgeHistory" src/` 无残留
- [x] 5.4 `src/api.ts` 知识库 API 改为库维度：`getKnowledgeBases` / `createKnowledgeBase` / `renameKnowledgeBase` / `deleteKnowledgeBase` / `getKnowledgeDocs(kbId)` / `uploadKnowledgeDoc(kbId, file)` 等；纯函数断言覆盖 URL 拼装与错误解析
- [x] 5.5 删除库的确认文案写明「库内文档不会被从文档池删除」；删除后列表即时刷新；用 mock 上游验证确认/取消两条路径

## 6. 验收与文档

- [x] 6.1 重写 `verify-knowledge.mjs`：库 CRUD 纯函数、slug 回读、错误翻译、迁移幂等；全部断言通过
- [x] 6.2 重写 `verify-knowledge-routes.mjs`：库维度路由集成（列表/创建/改名/删除/上传/移出/purge/search/doc/session-kb），mock 上游零成本
- [x] 6.3 重写 `verify-knowledge-tools.mjs`：3 个工具的作用域契约（未选库、已选库、库被删、schema 无 kbId 参数），mock 上游
- [x] 6.4 重写 `verify-knowledge-edge.mjs`：边界（不支持类型/空文件/超大/并发/中文名/路径穿越）改为库维度
- [x] 6.5 重写 `verify-knowledge-ui.mjs`：知识库视图的浏览器验收（建库→上传→改名→删除→无提问框），mock 上游
- [x] 6.6 新写 `verify-knowledge-session-kb.mjs`：真实上游 + 两会话并发选不同库，断言检索结果互不串味；不涉及 Seedance，零视频成本
- [x] 6.7 删掉依赖自写问答的脚本或改写：`verify-knowledge-ui-real-click.mjs` / `verify-knowledge-real-ui.mjs` / `verify-knowledge-model-tool.mjs` / `verify-knowledge-real.mjs` 按新形态处理（保留可复用的部分，删掉问答段）
- [x] 6.8 更新 `docs/knowledge-base.md`：库独立命名、全局视图、创意会话选库、dsh 插槽方案、删库语义、旧问答历史断点说明；照文档实操一遍验证步骤可执行

## Workflow follow-up

- `openspec sync specs` 后归档本变更（会覆盖主规格的库模型描述）。
- 归档后确认主规格 `knowledge-base` 里不再出现「一个项目对应一个知识库」「问答必须展示引用来源」等已 REMOVED 的条目。
