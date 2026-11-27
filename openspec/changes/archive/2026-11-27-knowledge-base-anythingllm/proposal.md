# Proposal

## Why

项目资料现在只存在于本机文件夹与对话里：世界观、运镜手册、参考资料、剧本原文都没有一个可检索的落点。人要翻文件，Agent 只能读到被手工附加进上下文的那一段。已有的 `chat-context-transparency` 已经把「模型只能看到人明确选择的内容」定成硬规则，因此缺的不是再塞点文本，而是一个**按需检索、命中结果可见**的知识来源。

AnythingLLM 自带文档解析、切块、向量化与带引用的问答，是一个成熟的外部知识服务。本变更把它接成本应用的可选伴生服务，不做内置、不做整站嵌入。

## What Changes

- 左栏「创作」组新增视图「知识库」（`#/p/<项目>/knowledge`），入口常驻可见；未配置时页面显示配置引导而不是报错。
- 库粒度采用**项目即库**：每个项目对应 AnythingLLM 的一个 workspace。因为 workspace 名会被上游归一成 slug（撞名时还会追加后缀），首次创建后回读 `slug` 并存进映射表，之后只用映射，不假设项目名与 slug 可互相推导。
- 首段（A）交付人用页面：本项目文档清单、多文件上传、带 `sources` 引用的问答面板、问答历史回读。内容来源**只有手工上传**，不从项目数据灌入，也不做同步与陈旧检测。
- 次段（B）交付 Agent 工具：`search_knowledge`（向量检索，不经 LLM）与 `read_knowledge_doc`（取全文），作用域固定当前项目，注册进只读工具组。
- **BREAKING** 不做生成前自动注入：拆镜、提示词、出片等环节 MUST NOT 在用户不知情时把检索片段塞进提示词。检索只在模型显式调用工具时发生。
- 不嵌入 AnythingLLM 成品界面：上游对静态资源写死 `X-Frame-Options: DENY`，本变更只做自己的薄 UI，通过它的 HTTP API 通信。
- 设置页「连接与模型」枢纽新增「知识库」面板：服务地址与 API Key；Key 只回报「有没有」，与 DTK、渠道 Key 的处理一致。`ANYTHINGLLM_BASE_URL` / `ANYTHINGLLM_API_KEY` 作为空位兜底，设置库优先。
- 服务端代理全部请求：Key 只留在服务端，浏览器拿不到；回环地址显式绕开系统代理；`host.docker.internal` 首次失败时回退 `127.0.0.1`（复用 DTK 的候选地址兜底）。
- 项目删除时级联删除对应 workspace，文档保留在实例文档池（其它项目若挂载同一文档不受影响）。

## Capabilities

### New Capabilities

- `knowledge-base`: 项目级知识库的配置、文档入库与移出、带引用的问答，以及给 Agent 的检索工具契约与作用域边界。

### Modified Capabilities

（无。运行时、外壳与渠道路由的既有需求不变：新视图沿用同一条导航清单，新工具沿用同一套原生工具调用契约。）

## Impact

- 前端：`src/shell/nav.ts`（`ViewId` 加 `knowledge`，`NAV_ITEMS` 创作组加一项）、`src/App.tsx`（视图分支）、新增 `src/knowledge/*`（列表、上传、问答）、`src/settings/settingsNav.ts` + 新 `KnowledgePane`、`src/api.ts`（`/api/knowledge/*` 客户端）。
- 服务端：新增 `server/knowledge.mjs`（代理客户端、slug 映射、地址候选、错误翻译）、`server/app.ts`（路由）、`server/db.mjs`（`knowledge_links` 表）、`server/project-lifecycle.mjs`（删除级联）。改完必须 `npm run build:server`。
- 数据：新增 `knowledge_links(project_name, workspace_slug)` 一张表；文档正文与向量全部留在 AnythingLLM 侧，本项目不存副本。
- 依赖与部署：新增一个**可选**的外部服务（AnythingLLM，默认 `127.0.0.1:3001`）。桌面安装包不内置、不代启；容器部署通过 `docker-compose.yml` 透传两个环境变量。未配置时本应用其余功能完全不受影响。
- 计费：知识库问答在 AnythingLLM 内部调用它自己的模型，token **不计入本应用账本**。若将来按用量收费，这是一个已知的免费出口。
- 验收：纯函数断言（slug 映射、候选地址、错误翻译、上传参数拼装）加本地 mock AnythingLLM 的路由集成；不依赖真实上游、零成本。
