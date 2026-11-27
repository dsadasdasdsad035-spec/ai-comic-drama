# Design

## Context

- 动机与范围见 proposal.md；行为契约见 `specs/knowledge-base/spec.md`。
- 本仓库的外接服务先例是 DTK：设置库存地址与 Key、服务端代理、环境变量兜底、`host.docker.internal` 与 `127.0.0.1` 双栈候选（`server/ingest.mjs` 的 `dtkBaseCandidates`）。本设计沿用同一套形状，不另发明。
- 服务端出网规则：境外站点必须走 `getExternalFetch()`（`server/apimart-network.mjs`）；但 AnythingLLM 通常在本机或宿主容器上，走系统代理会必然失败。
- AnythingLLM 的契约（已核对上游源码）：API Key 走 `Authorization: Bearer`；workspace 以 slug 寻址；`POST /v1/document/upload` 为 multipart 且可带 `addToWorkspaces`；`POST /v1/workspace/:slug/chat` 与 `/stream-chat` 接受 `sessionId`、`reset`、`attachments`，返回 `sources`；`POST /v1/workspace/:slug/vector-search` 不经 LLM 返回带 `score` 的 chunk；`GET /v1/workspace/:slug/chats?apiSessionId=` 回读历史。
- 上游生产模式对静态资源写死 `X-Frame-Options: DENY`，其成品界面不可被嵌入。
- 已有的 `chat-context-transparency` 规则生效中：模型输入必须可见、且只来自人的显式选择。生成环节自动注入在规则上不成立。

## Goals / Non-Goals

**Goals:**

- 用最少的本地状态换来一个可用的项目级知识库：一张映射表，正文与向量全部留在上游。
- 凭据、网络边界与错误翻译都收在服务端一层，前端只认本应用的 `/api/knowledge/*`。
- 未配置、连不上、首次建库三种非成功态都有确定的界面，不靠报错框兜底。
- A 段（页面）与 B 段（Agent 工具）共用同一份服务端客户端，工具不与页面各写一套。

**Non-Goals:**

- 不做 AnythingLLM 的内置、代安装、代启动或版本管理。
- 不做项目数据（剧本/角色/设定）自动灌库与陈旧检测 —— 本轮只支持手工上传。
- 不做跨项目检索、跨库联合查询或知识库共享视图。
- 不把知识库问答做成工作台 Agent 聊天（无工具调用、无草稿写回、无线程记录）。
- 不做知识库 token 的应用侧计费。

## Decisions

### 1. 外部服务 + 本应用薄 UI，不走 iframe 也不自建 RAG

上游能 iframe 的唯一办法是反代剥掉 `X-Frame-Options`，那会把一个我们无法控制的页面塞进产品外壳，主题、路由、鉴权都对不上，且上游改版即碎。自建切块 + 向量库则要重做解析器、embedder、检索与引用，收益与工作量都不成立。

选择：只做自己的页面，用它的 HTTP API。备选「反代 iframe」与「自建 RAG」均否决。

### 2. 项目 ↔ 库的映射落一张表，slug 由上游决定

`knowledge_links(project_name TEXT PRIMARY KEY, workspace_slug TEXT NOT NULL, created_at TEXT)`。

上游会把 workspace name 归一化成 slug，并在撞名时追加唯一后缀（`hunter` → `hunter-2`），所以「项目名 = 库标识」不成立；创建后回读 `slug` 存表，之后所有请求只用 `workspace_slug`。备选「用项目名实时推导 slug」会在撞名时把两个项目指向同一个库，这个错误的代价是数据串库，比多一张表贵得多；备选「存进 settings JSON」会让删除项目的级联变成字符串操作，也不好查。

项目无映射时，`GET /api/knowledge/docs` 走「确保存在」：查表 → 无则创建 → 回读 → 写表。并发首次进入用 `INSERT OR IGNORE` + 重查收敛，不引入锁。建库返回 400（同名已存在，常见于映射丢失）时按 name 在列表里找回，不重复建库。

### 3. 全部请求经服务端代理，Key 不出服务端

浏览器只调 `/api/knowledge/*`。理由有三：Key 不能进页面（与渠道 Key、DTK Key 同规矩）；上游未开 CORS，浏览器直连会被拦；出网必须由服务端决定走不走代理。

设置读取只返回 `{ baseUrl, hasApiKey, keyFromEnv }`，与 `redactCreativeSettings` 同构。

### 4. 回环地址显式绕开代理，容器形态回退宿主机名

地址解析分两类：主机为 `127.0.0.1` / `localhost` / `::1` 时直接 `fetch`（不走 `getExternalFetch`）；其它主机才用 `getExternalFetch()`。`host.docker.internal` 首次连接失败时按 DTK 的方式替换成 `127.0.0.1` 重试一次，反之不猜。

错误翻译单独成纯函数，覆盖：连接拒绝 → 「服务没有启动或地址不对」；403 → 「API Key 无效」；上游 `collector` 离线 → 「文档解析服务未就绪，请检查 AnythingLLM 容器状态」；slug 不存在 → 「知识库已被上游删除，将自动重建」。

### 5. 上传用原始字节转发，不在本应用实现 multipart 解析

前端把文件以 `application/octet-stream` POST 到 `/api/knowledge/upload`，文件名放查询参数，元数据放头；服务端读成 Buffer 后包成上游的 multipart（`FormData` + `Blob`，外加 `addToWorkspaces=<slug>`）。

这样不必引入 multipart 解析器，也不必把文件读成 base64（100MB 文件 base64 会膨胀 33% 且多一次内存拷贝）。单个上限 100MB，与既有 `readBody` 的上限用法一致。

可接受类型不硬编码：`GET /api/knowledge/accepted-types` 透传上游 `/v1/document/accepted-file-types`，选择器 `accept` 从它生成。

### 6. 问答走上游 SSE 原样透传，历史只存上游

`POST /api/knowledge/chat` 把请求体转发到 `/v1/workspace/:slug/stream-chat`，SSE 逐块转发给浏览器（不改协议、不解析事件）。前端按上游事件形状累积文本与 `sources`。

会话分区用确定性 `sessionId = sb-<workspace_slug>`，不新增本地状态：重开视图用 `GET /v1/workspace/:slug/chats?apiSessionId=sb-<slug>` 回读，与上游一致。清空历史用 `reset: true` 的单次调用（上游没有独立的清空接口，已核对）。

上游 `sources` 为空时，界面按 spec 明确标注「本轮没有命中库内容」，不把它当知识库结论。备选「本地再存一份消息」被否决：两套真相必然漂移。

**真实上游验收后修正的三处**（2026-11-25，真 AnythingLLM + MiniMax-M3.1-Flash）：

1. **API 前缀是 `/api/v1/*`，不是 `/v1/*`**。打 `/v1/*` 会被上游前端 SPA 兜底成 `200 text/html`，解析 JSON 失败时的报错完全看不出根因。现在 `request()` 统一补 `/api` 前缀，内部调用点仍写 `/v1/...`。
2. **默认问答模式是 `query` 而不是 `chat`**。`chat` 会启用 Agent，模型可能去调 `web-browsing` 撞到工具调用上限，还被网上的同名词条带偏（实测「沈砚」被查到同名网剧）。`query` 是纯 RAG，1-2 秒返回且只依据库内容。
3. **上传应答里没有 `location`**，只有 `id`/`url`；`location`（`custom-documents/…json`）只出现在 workspace 详情的 `docpath` 里。旧归一化只认 `location`，会把上传成功的文档静默丢掉。现在缺 location 时回查库详情按 docId/标题补齐。

另外两处输出清洗：模型经上游会输出 `<think>…</think>`（英文推理）并混进正文，上游把向量片段包进 `<document_metadata>` 头。两者都在服务端（非流式）与前端（流式）各剥一次，`verify-knowledge.mjs` 对两侧函数做一致性断言。

### 7. 页面不是 Agent 聊天，因此不进统一聊天运行时

知识库问答是一次委派给外部服务的检索问答：没有工具声明、没有模型循环、没有草稿写回、没有线程记录。`chat-agent-runtime` 约束的是应用内工作台聊天（3D 调度、五个工作台聊天、发布助手），本页面不在其列。渲染上复用 `chat-ui/ChatText` 的 Markdown 能力，但不复用 `useAgentMessages` 与运行时。

这一点是本设计最需要写死的边界：如果以后要给问答加「把结论写回剧本」之类的动作，它就必须迁到统一运行时，而不是在页面里长出第二套循环。

### 8. Agent 工具复用同一客户端，作用域由服务端注入

B 段在 `builtinPlatformTools.ts` 注册两个只读工具：

- `search_knowledge({ query, topN? })` → `/api/knowledge/search`
- `read_knowledge_doc({ docName })` → `/api/knowledge/doc`

项目名由 `BuiltinPlatformCtx.projectName` 注入，**不作为工具参数暴露**，模型没有办法指定别的项目。返回分两段：模型只拿到 title/score/截断片段摘要，完整片段留给工具卡片（符合运行时「模型可见与界面可见分离」的要求）。工具进 `READ` 组与 `DEFAULT_EXPERT_PLATFORM_TOOLS`，不进 `GENERATE`。

### 9. 删除项目时尽力清理，失败不阻塞

`deleteProject` 在数据库事务提交后，调用知识库客户端删除 workspace；失败只记录并作为 warning 返回给界面提示，不回滚删除。文档留在实例池，其它项目挂载的同一文档不受影响。

### 10. 验收用本地 mock 上游

`verify-knowledge.mjs`：纯函数断言（slug 映射、候选地址、错误翻译、上传表单拼装、工具作用域注入）+ 起一个假上游（Node http）覆盖「建库/上传/列表/检索/SSE 转发/删除」路径。不依赖真实 AnythingLLM，零成本、可进 CI。

## Risks / Trade-offs

- **上游改接口**：AnythingLLM 的 `/v1` 是稳定面但非冻结。→ 所有上游调用收敛在 `server/knowledge.mjs` 一个文件，字段映射集中；版本探测用 `GET /v1/auth` 与 `/v1/system` 做连通性判断，失败信息带上游原文。
- **它自己要配 LLM 与 embedder**：用户第一次配好地址和 Key 后仍可能问答失败，因为上游没配模型。→ 设置面板给检查清单；错误翻译把上游的「no model」类错误翻成「请先到 AnythingLLM 设置里配置对话模型」。
- **文档解析服务（collector）离线**：内置 collector 是独立进程，容器异常时上传会报「processing API not online」。→ 单独翻译该错误，不混进「上传失败」。
- **问答不计费**：上游用自己的 Key 调模型，token 不进本应用账本。→ proposal 已列为已知限制；若将来收费，需要另行设计网关或额度。
- **删除项目时上游不可用**：映射记录已删但 workspace 残留。→ 返回 warning；界面上提示可在 AnythingLLM 控制台手工删除。
- **撞名 → slug 被追加后缀**：两个同名 workspace 不可能共存，但映射丢失时重复建库会留下 `hunter-2` 这类孤儿。→ 建库 400 时按 name 找回已有库，不重复创建；孤儿库仍需用户在控制台手工清理。
- **100MB 全量进内存**：单文件上传会在服务端驻留一份 Buffer。→ 上限写死 100MB，超限在读取前按 `Content-Length` 直接拒绝。

## Migration Plan

1. 部署可选服务（用户自备）：`docker run -p 3001:3001 mintplexlabs/anythingllm`，在其界面里配好对话模型与 embedder，创建 API Key。
2. 本应用：设置 → 连接与模型 → 知识库，填地址与 Key → 「测试连接」。或容器部署时给 `ANYTHINGLLM_BASE_URL` / `ANYTHINGLLM_API_KEY`。
3. 首次打开某项目的知识库视图会自动建库，无需手工准备。
4. 回滚：清空设置里的地址即整体关闭（页面回到配置引导）；`knowledge_links` 表可保留，不影响其它功能。上游实例可独立下线。

## Open Questions

- 文档清单是否需要分页：当前按上游返回的整份列表渲染，项目级文档量通常有限；若实测超过数百份再引入分页或搜索过滤。
- 是否允许同一项目挂载多个 workspace（把通用资料库共享给多个项目）：本轮明确不做，spec 也把作用域钉死为单库；若以后要做，映射表需要从一对一改为一对多。
