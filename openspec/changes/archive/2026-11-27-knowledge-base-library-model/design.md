# Design

## Context

- 动机与范围见 proposal.md；行为契约见 `specs/knowledge-base/spec.md`。
- 上一轮 `knowledge-base-anythingllm` 已归档，主规格落库（11 条需求），当前实现是**项目级库**：`knowledge_links(project_name PK, workspace_slug)`，`ensureWorkspace(projectName)` 首次进入自动建库，删项目连带删库。
- 三个运行时并存：创意会话由 **dsh 宿主**驱动（41 个子包，iframe `/studio/`）、3D 场景用 **pi agentLoop**（已不可达）、知识库问答是**自写 SSE 累积**（`server/knowledge.mjs` 的 `chatStream` + `src/knowledge/KnowledgeView.tsx`）。
- **工具定义已是唯一真相**：50 个工具产自 `src/agent/builtinPlatformTools.ts` 的 `ToolDef`（zod schema），dsh 经 `server/studio-tool-bridge.mjs` 拿声明、经 `/api/studio/tools/execute` 执行。知识库的两个工具已在其中（实测 catalog 命中 `search_knowledge` / `read_knowledge_doc`）。
- **dsh 有两套可复用的扩展点**（均已核实）：
  1. 工具侧：`tools/pre-execute` 钩子里可往 exec 上挂自定义字段（`creative-expert` 插件用 `exec.studioExpertId = expertId` 透传专家 id）。
  2. UI 侧：`ctx.slots.register({ name, ... }, Component)`。官方 `agent-preset` 插件在 `conversation.session.header.actions` 注册了专家选择器，且其组件 props 直接带 `sessionId`（`AgentPresetSeat({sessionId, useSessions, ...})`）。
- dsh 的 session 是**严格版本化的耐用格式**（`session.v4.jsonl.zstd`，`dsh-session-format` 对未知结构抛 `SessionFormatError`），不适合写入我们自己的业务字段。

## Goals / Non-Goals

**Goals:**

- 库成为独立命名资源，与项目零耦合；一个项目删了不影响任何库。
- 问答收敛到唯一入口（dsh 创意会话），删掉自写 SSE 面板与上游问答历史读写。
- 会话级选库：两个会话可以查不同的库，互不影响；未选就是未选。
- 每层改动都落在已有的、已验证的扩展点上（dsh 插槽、工具桥、zod ToolDef），不发明新协议。

**Non-Goals:**

- 不做库的权限/共享/多租户隔离 —— 单机产品，所有库对所有会话可见（可列举、可选择）。
- 不做跨库联合检索（一次只查一个库）。
- 不迁移旧问答历史进 dsh 会话（上游那 16 条只保留、不再展示）。
- 不统一 pi 与 dsh（3D 场景那条链仍不可达，不在本次范围）。
- 不改 dsh 源码；不改 pi。

## Decisions

### 1. 库的主键用我们自己的 id，上游 slug 只作关联字段

`knowledge_bases(id TEXT PK, name TEXT UNIQUE, upstream_slug TEXT, created_at TEXT)`。

`id` 由本应用生成（`randomBytes(8).toString('hex')` 或 uuid），因为：库名可改（改名不该换 id）、上游 slug 也可能变（撞名后缀、手工重建）。`upstream_slug` 依旧由创建后回读上游得到，绝不反推 —— 这条沿用已归档变更的结论（上游会把 name 归一成 slug 并追加唯一后缀）。

备选「用 upstream_slug 当主键」被否决：库改名后 slug 可能不变，但一旦上游重建（用户在控制台删了再建）就换 slug，主键跟着漂移会把会话选择一起弄丢。

### 2. 会话选库存我们自己的表，不写 dsh session

`knowledge_sessions(dsh_session_id TEXT PK, kb_id TEXT NOT NULL, updated_at TEXT)`。

理由：dsh 的 session 是版本化耐用格式，写自定义字段会撞 `SessionFormatError`（它对未知结构做严格校验），也会在它的格式迁移里被丢掉。存在我们自己库里，代价只是「dsh 会话删除后这一行成为孤儿」。

孤儿清理：启动时扫一遍 `dsh/sessions/*/session.v4.*` 的文件名（会话 id 在目录名里）与表做差，删掉不存在的会话行。扫不到就跳过（不自作主张清空表）。

### 3. 选库入口 = dsh UI 插件，不注入 DOM、不改 dsh 源码

dsh 的 `ctx.slots.register` 是官方扩展点，`conversation.session.header.actions` 正是 `agent-preset` 用来放「专家选择器」的位置。我们在同一插槽注册一个「库选择器」，组件 props 里能拿到 `sessionId`（已在官方插件里核实）。

插件由 `server/dsh-bundle.mjs` 的既有机制装入 profile：目录复制到 `<profile>/node_modules/dsh-plugin-knowledge-ui`，在 profile 的 `package.json` 登记 `dsh.profile.bundles`，由该 bundle 的 `cordis.patch.yml` 用 `insert:` 挂一行。UI 半边按官方契约声明 `exports["./client"]` 与 `dsh.client.{inject,platform}`。

备选「注入 iframe DOM」（`StudioFrame` 已在用 `contentDocument` 做主题桥）被否决：往别人组件的 DOM 里插控件，它一改版就碎，且拿不到 React 的会话状态，只能靠 DOM 事件猜 `sessionId`。

备选「靠对话选库」（模型调 `use_knowledge_base`）**保留但降级为兜底**：用户可以在聊天里说「用运镜手册」，但主路径是界面上的下拉。理由：让用户靠打字完成界面设置是可用性倒退，而且会产生「模型选错库」这类难排查的问题。

### 4. 工具作用域：每次调用现建 3 个知识库工具，不共享可变槽位

`createKnowledgeTools(deps)` 新增 `sessionId` 依赖。桥的 `invoke(name, args, { sessionId, ... })` 命中知识库工具名时，**当场用本次 sessionId 新建一组工具**再执行：

```js
if (KNOWLEDGE_TOOL_NAMES.includes(resolvedName)) {
  const fresh = createKnowledgeTools({ sessionId })   // 3 个 zod 工具，创建代价可忽略
  tool = fresh.find((t) => t.name === resolvedName) ?? tool
}
```

为什么不是可变槽位：桥里已有 `sessionToken` / `studioProject` / `canvas` 三处单槽位，注释里明写「多标签会互相覆盖，属当前单租户架构的已知限制」。计费归属错了只是账目问题，**库选错了会让用户看到 B 库的答案**，性质不同。现建闭包是原子的，代价是每次三份 zod schema —— 微秒级。

备选「把 sessionId 塞进工具参数让模型透传」被否决：参数进模型上下文，等于给模型一个可伪造的越权入口（虽然它不知道别的会话 id，但没有理由暴露）。

### 5. 未选库是显式状态，不默认取第一个

工具与服务端都按「会话 → kb_id」查，查不到就返回结构化说明（列出可用库 + 指引去界面选或说「用 X 库」），不猜、不跨库。

理由：隐式默认会让用户以为在查 A 库、实际查了 B 库，而答案看起来完全正常 —— 这类错误没有报错可循。宁可多一步「先选库」。

### 6. 知识库视图改为全局视图，只做维护

路由从 `#/p/<项目>/knowledge` 改成 `#/knowledge`（参照 `#/account` 的既有先例：与项目无关的全局页单列成一种 Route kind）。左栏入口从「创作」组保留，但不再依赖当前项目。

页面内容：库列表（名称 + 文档数 + 操作）、新建库、重命名、删除（需确认）、进入某个库后是文档清单（上传/移出/彻底删除）。

**删掉**：问答输入框、消息流、引用卡组件（`KnowledgeCitations`）、流式解析、`chatStream` / `history` 两个客户端方法、上游问答历史读写。

### 7. 删库：删映射 + 尽力删上游 workspace，绝不碰文档池

删库时：删本地 `knowledge_bases` 行 → 删该库的 `knowledge_sessions` 行 → 尽力 `deleteWorkspace(upstream_slug)`。上游 workspace 只是一个「文档引用集合」，删它不会删文档池里的文档（上游的 workspace 与文档池是分开的），所以这个动作安全。

失败只记 warning（外部服务挂了不该让用户删不掉库）。界面上说明「库内文档不会被从文档池删除」—— 这条已写进规格。

### 8. 迁移：一次性把 knowledge_links 转成 knowledge_bases

`knowledge_links` 每行 → `knowledge_bases` 一行：`name = project_name`，`upstream_slug` 原样，`id` 新生成。迁移在 `ensureColumns`/建表之后执行一次，以 `settings` 里的标记键把关（与 `LEGACY_ORPHAN_CLEANUP_KEY` 同构）。

迁移后 `knowledge_links` 表保留但不再读写（不 DROP，避免老版本回退时数据不可见；下个大版本再清）。

### 9. 名称撞车：三层各用各的词

- `knowledge_base` / `kb`（我们，含表名、工具名）
- `workspace`（上游 AnythingLLM 的叫法，只出现在 `server/knowledge.mjs` 内部）
- `project`（我们的项目，与库无关）

转换只在 `server/knowledge.mjs` 的 `createBase` / `resolveBase` 里做一次：`kb.id → kb.upstream_slug → 上游 workspace`。界面上不出现 `workspace` 这个词。

## Risks / Trade-offs

- **UI 插件要按 `window.__ModuleLoader__` 格式产出浏览器包**：手写这个格式（`load({id, factory: require => ...})`）能用但脆弱。→ 先做最小验证（一个只显示文字的组件挂到插槽上），确认注入链路通了再写选择器；构建方式沿用官方包的 `exports["./client"]` 约定。
- **dsh 升级会打破插槽名**：`conversation.session.header.actions` 是官方内部插槽，升级可能改名。→ 插件里对 `slots.register` 包 try/catch 并打日志；插件挂不上时降级为「靠对话选库」（`list_knowledge_bases` 仍可用），功能不整体失效。
- **数据库迁移不可逆**：`knowledge_links` → `knowledge_bases` 失败会让库列表空掉。→ 迁移前用 `writeSnapshot` 同款思路留一份 `knowledge_links` 的 JSON 快照；迁移幂等（标记键把关）。
- **旧问答历史断入口**：上游 16 条记录在新界面无处可看。→ 已在规格写明「不删除、不迁移，仅不再从界面访问」；如需保留可去上游控制台查看。
- **并发会话选库**：同一宿主多会话并发时，本次设计靠「每次调用现建工具」保证原子，但 `knowledge_sessions` 的写入仍是 `INSERT OR REPLACE`，同一会话内连点两次选库以最后一次为准（可接受）。
- **删掉自写问答会让 4 套验收脚本失效**：`verify-knowledge-ui-real-click` / `verify-knowledge-real-ui` / `verify-knowledge-model-tool` 依赖自写问答。→ 重写为库维度 + dsh 链路；`verify-knowledge-edge`（边界）与 `verify-knowledge-routes`（路由）保留骨架改维度。
- **工具表重建时机**：`ensureLoaded` 现在按 `${projectName}\0${epNo}` 缓存。知识库工具不再依赖项目，但另外 47 个工具仍依赖（3D/画布）。→ `ensureLoaded` 不动，只在 `invoke` 里对知识库工具做「现建」替换；不要为了知识库去改缓存键。

## Migration Plan

1. 建新表（`knowledge_bases` / `knowledge_sessions`），保留 `knowledge_links`。
2. 跑一次性迁移：`knowledge_links` → `knowledge_bases`，留 JSON 快照，写标记键。
3. 服务端切换路由到库维度；`chatStream` / `history` 先保留但不再被前端调用，确认无引用后删。
4. dsh 插件上线：先工具桥透传 `sessionId`（此时工具仍可用项目作用域兜底），再上 UI 插件选库，最后切换工具作用域为会话库。
5. 前端：知识库视图改全局 + 删问答面板。
6. 回滚：`knowledge_bases` 表保留、`knowledge_links` 未删，旧路由可切回；UI 插件可单独从 profile 的 bundles 摘掉。

## Open Questions

- 库列表是否需要分页/搜索：单机场景库数量通常 < 50，先不做，列表全量渲染。
- 会话选库是否需要「记住上次选的库，新会话默认带上」：本次按规格「未选就是未选」，不做记忆。若实际用起来每次都要选太烦，后续再议。
