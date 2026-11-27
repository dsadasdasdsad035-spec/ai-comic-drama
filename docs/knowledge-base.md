# 知识库（AnythingLLM 伴生服务）

知识库是**独立命名的资料库**：你自己建一个库、起个名字、往里传文档；创意会话里按需检索它。它**不是内置功能**：依赖一个 AnythingLLM 实例，通过它的 HTTP API 通信。不配置它，其它任何功能都不受影响。

两件事先说清楚，因为它们决定了后面所有设计：

- **库与项目无关**。库不因项目创建，也不因项目删除而消失。一个库可以给任意多个项目/会话用。
- **问答只在创意会话里**。知识库页只做维护（建库、上传、清理），没有提问框，也不存问答历史。

## 为什么要外部服务

文档解析（PDF / docx / odt）、切块、向量化、相似度检索，是一整套 RAG 基础设施。自建要重做解析器、embedder、向量库三件事；AnythingLLM 已经有并且开源可自托管。所以这里只做自己的薄界面，用它的 API。

两个明确不做的：

- **不嵌入它的成品界面**。上游生产模式对静态资源写死 `X-Frame-Options: DENY`，绕过去只能反代剥头，那是把不受控的页面塞进产品外壳。
- **不当作必须品**。不配置它时，只是这三个工具不可用，其它功能照常。

## 部署上游

```bash
# 官方镜像，默认端口 3001
export STORAGE_LOCATION=$HOME/anythingllm
mkdir -p $STORAGE_LOCATION && touch "$STORAGE_LOCATION/.env"
docker run -d --rm -p 3001:3001 \
  --cap-add SYS_ADMIN \
  -v ${STORAGE_LOCATION}:/app/server/storage \
  -v ${STORAGE_LOCATION}/.env:/app/server/.env \
  -e STORAGE_DIR="/app/server/storage" \
  mintplexlabs/anythingllm
```

桌面版（`npm run desktop:dev` / 打包应用）不需要这一步：应用自带一份 AnythingLLM 运行时，随机端口启动，地址与 Key 由应用注入（`SB_BUILTIN_KNOWLEDGE=1` 时环境变量覆盖设置库，设置页那两格变只读）。

外部实例要在它的 Web 界面里配两件事：

1. **向量化模型（embedder）**。默认内置的本地 embedder 就够用，不需要额外 Key。
2. **生成 API Key**（Settings → API Keys），填给本应用。

> 容器访问宿主机上的服务要用 `host.docker.internal`，而不是 `127.0.0.1`。本应用对这两种写法都做了兜底：配置 `host.docker.internal` 时首次连接失败会回退 `127.0.0.1` 重试一次。

## 配置本应用

设置 → 连接与模型 → 知识库，填服务地址（只到端口，不要带 `/api`）与 API Key，点「保存并测试连接」。

外部实例下这个按钮还会**把本应用已配好的 MiniMax 渠道推给上游**，所以你不需要再去 AnythingLLM 界面手选模型。代配失败不影响连接结论（连通性是硬事实，代配是便利功能）。

内建实例（桌面版）由应用自己配好，这两项不需要填。

也可以走环境变量（容器部署 / 测试）：

```bash
ANYTHINGLLM_BASE_URL=http://host.docker.internal:3001
ANYTHINGLLM_API_KEY=your-api-key
```

设置库里的值优先，环境变量只填补空缺。例外是内建实例：`SB_BUILTIN_KNOWLEDGE=1` 时环境变量**覆盖**设置库 —— 否则设置库里残留的旧地址（比如早先填过的 docker 端口）会盖掉应用注入的真地址，表现为「配置好了但永远连不上」。

## 库的模型

```sql
knowledge_bases(id TEXT PK, name TEXT UNIQUE, upstream_slug TEXT, created_at TEXT)
knowledge_sessions(dsh_session_id TEXT PK, kb_id TEXT, updated_at TEXT)
```

三个要点：

1. **主键是本应用生成的 `kb_<16hex>`**，不是上游 slug。库可以改名（不改 id），上游 slug 也可能因手工重建而变 —— 拿 slug 当主键会让会话选择跟着漂移。
2. **库名唯一**。重名建库直接拒（409），文案说「名称已被占用」。
3. **上游标识回读后落库**，绝不反推：上游会把 name 归一成 slug（小写、去空格），撞名时追加唯一后缀（`hunter` → `hunter-2`）。

旧版本按项目建库时的 `knowledge_links(project_name, workspace_slug)` 会在首次启动时一次性迁成独立库（`name = project_name`），迁移前把原表全量 JSON 存进 settings，成功后写标记键，重复启动不重迁。`knowledge_links` 表保留不删，只是不再读写。

## 页面：只做维护

入口是**全局路由 `#/knowledge`**，不需要先开项目。旧书签 `#/p/<项目>/knowledge` 会落到同一个全局页。

页面是「左库列表 + 右文档清单」：

| 操作 | 说明 |
| --- | --- |
| 新建库 | 输入名字。名称重复被拒并说明 |
| 改名 | 保留 id 与上游 slug，会话选择不受影响 |
| 删除库 | 需确认，文案明确「库内文档不会被从文档池删除」。删本地行 + 清会话选择 + 尽力删上游 workspace |
| 上传 | 进某个库后上传。可接受类型由上游 `/api/v1/document/accepted-file-types` 决定，本应用不维护第二份扩展名清单。单文件上限 100MB，按 Content-Length 预拒绝。逐个上传，一个失败不影响其余 |
| 移出 | 只解除与当前库的挂载，文档留在实例文档池 |
| 删除文档 | 从文档池彻底删除；其它也挂了同一份文档的库会一并失效（确认文案写明） |

列表里的文档数是**实时回查上游**的，不在本地复制清单 —— 复制必然漂移。某个库的上游 workspace 被手工删了，那一项显示「上游已丢失」，其它库照常显示。

## 创意会话里选库

会话头部有一个「知识库」下拉（dsh 插槽 `conversation.session.header.actions`，与专家选择器同一个位置）：

- 列出所有库（带文档数）；选中项高亮
- 选定结果写在 `knowledge_sessions`，**按会话隔离**：两个会话可以选不同的库
- **未选就是未选**，不默认取第一个，不退化成跨库检索
- 选过的库被删掉时显示「已失效，请重选」

插件挂不上时（比如上游改了插槽名）降级为「靠对话选库」：模型可以调 `list_knowledge_bases` 列出可选项，用户说「用 X 库」后由界面写入。插件 `apply()` 全程 try/catch，注册失败只打日志，不阻塞宿主启动。

## Agent 工具

三个只读工具，都免费（上游 vector-search 不经 LLM）：

| 工具 | 作用 | 成本 |
| --- | --- | --- |
| `list_knowledge_bases` | 列出所有库（名称、id、文档数）。不改选定 | 免费 |
| `search_knowledge` | 向量检索**当前会话选定的库**，返回带分数的片段 | 免费 |
| `read_knowledge_doc` | 读该库里某份文档的全文 | 免费（只读文件） |

**作用域由服务端钉死**：工具 schema 里没有任何库、项目或会话字段 —— 模型没有入口指向别的库。会话标识由宿主注入（`exec.agent.session.id` → 工具桥 `invoke({sessionId})`），模型看不到也改不了。

为什么桥对这三个工具「每次调用现建」：工具表按 `${projectName}\0${epNo}` 缓存，而知识库作用域是会话级的。复用缓存表会让同项目里两个标签页互相覆盖，先选的那个会话拿到**另一个库**的结果 —— 这不是账目误差，是错误答案。

**越库读取也在服务端拦**：上游 `/v1/document/:name` 只认文件名不认库，读全文前会先确认这份文档挂在该会话选定的库里，否则 404。

**模型只看到摘要**：命中片段给模型前截到 600 字，全文留在工具卡片里给用户看。

**不会自动注入**：拆镜、提示词生成、出片等环节都不会在用户不知情时把检索片段塞进提示词。知识库内容进入模型上下文只有两条路径：模型显式调用检索工具，或用户把工具结果作为后续输入引用。

## 计费

检索（`search_knowledge` / `read_knowledge_doc`）**不经过 LLM**，零 token。回答任务的成本属于创意会话本身的模型调用，与知识库无关。

## 回滚

清空设置里的服务地址即整体关闭：知识库页回到配置引导，三个工具返回「未配置」说明，其它功能不受影响。`knowledge_bases` / `knowledge_sessions` 表保留不影响任何东西；上游实例可以独立下线。

## 验收

```bash
# 全部免费，自带 mock 上游，零成本
node verify-knowledge.mjs            # 纯函数 + 客户端 + 数据层（CRUD / 迁移幂等）
node verify-knowledge-bases.mjs      # 库维度路由（CRUD / 文档 / 会话选库 / 删库语义）
node verify-knowledge-routes.mjs     # 横切契约（设置 / 类型 / 上限 / 越库 / 错误码）
node verify-knowledge-tools.mjs      # 三个工具的作用域（未选 / 已选 / 库被删 / 并发不串味）
node verify-knowledge-edge.mjs       # 边界（类型 / 空文件 / 超大 / 并发 / 中文名 / 穿越）
node verify-knowledge-ui.mjs         # 浏览器：建库 → 上传 → 改名 → 删库，且没有提问框
node verify-knowledge-ui-plugin.mjs  # 选择器插件：插槽注册 / 降级 / bundle 装载
node tests/creative-tools-plugin.mjs # 宿主插件透传 sessionId（含伪造防护）

# 需要真实上游（零 LLM token：只跑检索，不跑问答）
ANYTHINGLLM_BASE_URL=http://127.0.0.1:3001 \
ANYTHINGLLM_API_KEY=xxxx \
SB_PROJECTS_DIR=/tmp/kb-isolated \
node verify-knowledge-real.mjs       # 建库 / 上传 / 检索 / 库隔离 / 移出

# 真实上游 + 活着的应用实例（库维度端到端）
KB_APP_BASE=http://127.0.0.1:59252 node verify-knowledge-agent-real.mjs
KB_APP_BASE=http://127.0.0.1:59252 node verify-knowledge-session-kb.mjs   # 两会话选不同库

# 真实开发模式桌面端（npm run desktop:dev + 内置实例，不搭桩）
KB_APP_BASE=http://127.0.0.1:<端口> node verify-knowledge-desktop-real.mjs
```

桌面端的端口这样找：

```bash
lsof -nP -a -p $(pgrep -f server/desktop-entry.mjs) -iTCP -sTCP:LISTEN
```

`verify-knowledge-desktop-real.mjs` 是唯一一条**完全不搭桩**的验收：真实 Electron 进程、
真实内置 AnythingLLM、真实 collector 解析与向量化。它只做维护与选库，不做问答，
所以零 LLM token。

跑真实验收时**务必**指定 `SB_PROJECTS_DIR` 到临时目录，否则库表会写进当前项目库。

## 与真实上游的契约差异（实测）

这些是 mock 验不出来的坑，已在代码里处理：

| 差异 | 症状 | 处理 |
| --- | --- | --- |
| API 在 `/api/v1/*` 而非 `/v1/*` | 打 `/v1/*` 得到 `200 text/html`（SPA 兜底），JSON 解析失败且报错看不出根因 | 客户端统一补 `/api` 前缀 |
| 上传应答没有 `location` | 只认 `location` 会把上传成功的文档静默丢掉 | 缺 location 时回查库详情按 docId/标题补 `docpath` |
| 向量片段带 `<document_metadata>` 头 | 片段里出现上游内部标注 | 归一化时剥掉（模型与界面两头都要干净） |
| `/v1/document/:name` 只认纯文件名 | 传 `custom-documents/x.json` 一律 404 | 剥目录前缀；标题查不到时在清单里按 title 反查落盘名 |
| `/v1/document/:name` 不回正文 | 只拿到元数据，`pageContent` 为空 | 同机部署时直接读 `documents/` 目录里的 JSON；读不到退回元数据 |
| 中文文件名被 slugify | 清单里显示成 `.md-<uuid>.json` | 标题优先取 `metadata.title`（JSON 字符串），回退 filename |
| `system/update-env` 只认 camelCase | 用环境变量名（`LLM_PROVIDER`）会被静默过滤，`error` 仍是 false | 客户端只发 camelCase 键 |
| **上游允许同名 workspace** | 重复建同名库不报 400，而是给 slug 加后缀（`69493` → `69493-88109941`） | 「同名不堆重复库」由本地 `name UNIQUE` 守（路由先 `getKnowledgeBaseByName`），不能指望上游拒绝 |
| 上传后立刻检索常常 0 命中 | collector 解析是异步的 | 验收脚本要轮询等命中，不要一次断言 |

## 实现位置

| 位置 | 内容 |
| --- | --- |
| `server/knowledge.mjs` | 上游客户端与纯函数（地址候选、错误翻译、上传表单、应答归一化）；所有上游契约只在这里 |
| `server/knowledge-settings.mjs` | 设置归一化、环境兜底、读取脱敏、保存合并 |
| `server/app.ts` | `/api/knowledge/*` 路由（库 CRUD / 会话选库 / 文档 / 检索 / 读全文） |
| `server/db.mjs` | `knowledge_bases` / `knowledge_sessions` 表与访问器；旧表一次性迁移 |
| `src/knowledge/KnowledgeView.tsx` | 全局知识库页（只做维护） |
| `src/settings/hubs/connections/KnowledgePane.tsx` | 设置面板 |
| `src/agent/knowledgeTools.ts` | 三个 Agent 工具（作用域=会话选定的库） |
| `server/studio-tool-bridge.mjs` | 桥：知识库工具按 sessionId 现建 |
| `server/dsh-plugins/knowledge-ui/` | 会话头部与 hero 的库选择器（dsh 插槽插件，走 `slots.inject`） |

插槽这块有两个只有真实宿主才会暴露的契约：

1. **必须 `ctx.slots.inject(key, cb)`**。直接 `ctx.slots.register()` 会在插件激活时抛
   `slot "..." is not declared (a parent entry's children table must declare it)` ——
   别的包声明的 child slot 只在它的 entry 存活期间「已声明」。
2. **空白会话不渲染头部**。`conversation.session.header` 在 `session.blank` 时收到
   `hideChrome: true`，`header.actions` 整块不渲染。「新会话 → 先选库」是最主流的路径，
   所以还要挂 `conversation.hero.options`。
