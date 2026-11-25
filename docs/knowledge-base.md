# 知识库（AnythingLLM 伴生服务）

知识库让每个项目有一个可上传文档、可带引用提问、可被 Agent 按需检索的资料库。它**不是内置功能**：依赖你自己起的一个 AnythingLLM 实例，通过它的 HTTP API 通信。不配置它，其它任何功能都不受影响。

## 为什么要外部服务

文档解析（PDF / docx / odt）、切块、向量化、相似度检索、带引用的问答，是完整的一套 RAG 基础设施。自建要重做解析器、embedder、向量库、引用抽取四件事；AnythingLLM 已经有并且开源可自托管。所以这里只做自己的薄界面，用它的 API。

两个明确不做的：

- **不嵌入它的成品界面**。上游生产模式对静态资源写死 `X-Frame-Options: DENY`，绕过去只能反代剥头，那是把不受控的页面塞进产品外壳。
- **不内置、不代启、不代管版本**。它的 collector 需要 `--cap-add SYS_ADMIN`，镜像与存储以 GB 计，装进桌面安装包不现实。

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

接着在它的 Web 界面里做三件事，缺一不可：

1. **配对话模型（LLM）**。不配的话上传能成功，但问答会失败。填你已有的方舟 / OpenAI 兼容渠道都行。
2. **配向量化模型（embedder）**。默认内置的本地 embedder 就够用，不需要额外 Key。
3. **生成 API Key**（Settings → API Keys），记下来给下一步用。

> 容器访问宿主机上的服务要用 `host.docker.internal`，而不是 `127.0.0.1`。本应用对这两种写法都做了兜底：配置 `host.docker.internal` 时首次连接失败会回退 `127.0.0.1` 重试一次。

## 配置本应用

**方式一：设置页（推荐，自动配好上游模型）**

设置 → 连接与模型 → 知识库，填服务地址（只到端口，不要带 `/api`）与 API Key，点「保存并测试连接」。

这个按钮做两件事：

1. 验证连通性（`/api/v1/auth` + 列库）。
2. **把本应用已配好的 MiniMax 渠道推给上游** —— 通过上游的 `/api/v1/system/update-env` 写入
   `LLMProvider=generic-openai`、`GenericOpenAiBasePath`、`GenericOpenAiModelPref`、
   `GenericOpenAiKey`、`GenericOpenAiTokenLimit`。所以你**不需要**再去 AnythingLLM 界面
   手选模型、手填 Key。

代配失败不影响连接结论（连通性是硬事实，代配是便利功能），界面会说明失败原因并提示手工配置。
本应用如果还没有可用的 MiniMax 渠道，就不做代配，界面提示先去「渠道」页配。

「上游对话模型」字段默认 `MiniMax-M3.1-Flash`。**选它的原因**：实测 `MiniMax-M3` 与
`MiniMax-M2.7` 会在正文前输出 `<think>…</think>` 英文推理块，虽然代码会剥掉，但多耗 token
且偶尔截断；M3.1-Flash 的输出是干净的。

- Key 只存在服务端；再次打开页面只显示「已配置」，不会回显原文。要换直接输入新的，留空表示沿用。
- 「清除已保存的 Key」是显式清空，不受「留空沿用」规则影响。

**方式二：环境变量（容器部署）**

```bash
ANYTHINGLLM_BASE_URL=http://host.docker.internal:3001
ANYTHINGLLM_API_KEY=your-api-key
```

设置库里的值优先，环境变量只填补空缺。哪一项来自环境变量，设置页会标「来自环境变量」——不然表单显示「未配置」而运行时却可用，用户无从判断该改哪边。

`docker-compose.yml` 已透传这两个变量，在 `.env` 里填即可。

## 库和项目的对应关系

**一个项目对应上游的一个知识库（workspace）**。首次打开某项目的知识库视图会自动建库，不需要手工准备。

库标识不能由项目名推导：上游会把 name 归一成 slug（小写、去空格），撞名时还会追加唯一后缀（`hunter` → `hunter-2`）。所以创建后回读上游返回的标识存进 `knowledge_links` 表，之后所有请求只用这个映射。映射丢失时会按 name 找回已有库，不重复创建。

文档是实例级的：同一份文档可以同时挂到多个库。所以移除有两种语义——

| 操作 | 影响 | 用在哪 |
| --- | --- | --- |
| **移出**（默认） | 只解除本项目的挂载，文档留在实例文档池 | 只是不想让这个项目检索到它 |
| **删除**（需确认） | 从实例文档池彻底删除，其它挂载它的项目也会失效 | 文档本身废了 |

## 页面行为

左清单 + 右问答：

- **上传**：可多选。可接受的文件类型由上游 `/v1/document/accepted-file-types` 决定，本应用不维护第二份扩展名清单。单个文件上限 100MB。逐个上传，一个失败不影响其余。
- **问答**：流式返回。有命中时附可展开的引用卡（文档标题 + 命中片段 + 相似度分数）。
- **没命中会明说**：上游在库为空或没检索到内容时仍会返回一段模型自由生成的回答。界面会明确标注「本轮没有命中库内容 —— 上面的回答来自模型自身知识，不是这份知识库的结论」，不会把它包装成知识库结论。
- **历史**：存在上游，按 `sb-<slug>` 分区的会话标识回读。本地不存第二份对话副本。
- **连接失败**：保留上次已知的文档清单，顶部挂一条可重试的连接条，页面不会变成空白。

未配置时整页是引导（地址、Key、上游检查清单），不是报错框。

## Agent 工具

知识库配好后，工作台聊天里有两个只读工具可用：

| 工具 | 作用 | 成本 |
| --- | --- | --- |
| `search_knowledge` | 向量检索当前项目库，返回带分数的片段 | 免费（不上 LLM） |
| `read_knowledge_doc` | 读单个文档全文 | 免费（只读文件） |

**作用域由服务端钉死**：项目名来自聊天上下文，不作为工具参数，模型无法指定别的项目。返回内容分两段——模型只拿到标题、分数与截断片段摘要，完整片段留在工具卡片里。

**不会自动注入**：拆镜、提示词生成、出片等环节都不会在用户不知情时把检索片段塞进提示词。知识库内容进入模型上下文只有两条路径：用户在问答里直接提问，或模型显式调用检索工具。这条约束与聊天上下文透明规则一致。

## 计费

知识库问答消耗的是**上游 AnythingLLM 的模型额度**，不经过本应用的渠道层，因此：

- 不计入本应用的计费与用户钱包；
- 不走本应用的渠道 Key 与模型路由。

如果这个产品将来按用量收费，这是一个已知的免费出口，需要另行设计网关或额度。

## 回滚

清空设置里的服务地址即整体关闭：知识库视图回到配置引导，两个 Agent 工具返回「未配置」说明，其它功能不受影响。`knowledge_links` 表保留不影响任何东西。上游实例可以独立下线。

## 验收

```bash
# 全部免费，不依赖真实上游
node verify-knowledge.mjs          # 纯函数 + 客户端（本地 mock 上游）
node verify-knowledge-routes.mjs   # /api/knowledge/* 路由集成（起真实 server + mock）
node verify-knowledge-tools.mjs    # Agent 工具契约 + 反注入反例
node verify-knowledge-ui.mjs       # 设置面板与视图的浏览器验收

# 需要真实上游（会产生少量上游 LLM token 费用，不涉及 Seedance）
ANYTHINGLLM_BASE_URL=http://127.0.0.1:3001 \
ANYTHINGLLM_API_KEY=xxxx \
SB_PROJECTS_DIR=/tmp/kb-isolated \
node verify-knowledge-real.mjs        # 服务端契约：建库/上传/检索/问答/移出

KB_APP_BASE=http://127.0.0.1:5400 \
node verify-knowledge-real-ui.mjs     # 浏览器：真实问答与引用渲染
```

跑真实验收时**务必**指定 `SB_PROJECTS_DIR` 到临时目录，否则映射表会写进当前项目库。

## 与真实上游的契约差异（2026-11-25 实测）

这些是 mock 验不出来、只有连真实例才会暴露的坑，已在代码里处理：

| 差异 | 症状 | 处理 |
| --- | --- | --- |
| API 在 `/api/v1/*` 而非 `/v1/*` | 打 `/v1/*` 得到 `200 text/html`（SPA 兜底），JSON 解析失败且报错看不出根因 | 客户端统一补 `/api` 前缀 |
| `chat` 模式会启用 Agent | 模型去调 `web-browsing`，撞 10 次工具调用上限，还被网上的同名词条带偏 | 默认模式改为 `query`（纯 RAG） |
| 上传应答没有 `location` | 只认 `location` 会把上传成功的文档静默丢掉 | 缺 location 时回查库详情按 docId/标题补 `docpath` |
| 模型输出含 `<think>…</think>` | 回答里混入英文推理过程 | 服务端与前端各剥一次 |
| 向量片段带 `<document_metadata>` 头 | 引用卡里出现上游内部标注 | 归一化时剥掉 |

## 实现位置

| 位置 | 内容 |
| --- | --- |
| `server/knowledge.mjs` | 上游客户端与纯函数（地址候选、错误翻译、上传表单、应答归一化）；所有上游契约只在这里 |
| `server/knowledge-settings.mjs` | 设置归一化、环境兜底、读取脱敏、保存合并 |
| `server/app.ts` | `/api/knowledge/*` 路由 |
| `server/db.mjs` | `knowledge_links` 表 |
| `src/knowledge/` | 知识库视图与引用卡 |
| `src/settings/hubs/connections/KnowledgePane.tsx` | 设置面板 |
