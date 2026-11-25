# Tasks

## 1. 数据与服务端客户端

- [x] 1.1 在 `server/db.mjs` 新增 `knowledge_links(project_name TEXT PRIMARY KEY, workspace_slug TEXT NOT NULL, created_at TEXT)`；用临时库打开两次验证表存在且重复建表不报错
- [x] 1.2 在 `server/knowledge.mjs` 落纯函数：`kbBaseCandidates(base)`（回环不走代理、`host.docker.internal` 回退 `127.0.0.1`）、`translateKbError(e)`（连接拒绝 / 403 / collector 离线 / slug 不存在 / 未配置模型）、`buildUploadForm(...)`（Buffer + 文件名 + `addToWorkspaces`）；扩展 `verify-knowledge.mjs` 覆盖三者并跑通
- [x] 1.3 设置存取：`baseUrl` / `apiKey` 写入 `settings.app`，读取时 env 兜底并只回报 `hasApiKey` / `keyFromEnv`；在 `verify-knowledge.mjs` 断言设置库优先、凭据不回传原文
- [x] 1.4 实现上游客户端 `ensureWorkspace` / `listDocs` / `uploadDoc` / `removeDocs` / `purgeDocs` / `chatStream` / `history` / `search` / `readDoc`，全部收敛在 `server/knowledge.mjs`；用本地 mock AnythingLLM 验证建库回读 slug、上传带库、SSE 原样透传、历史带 `apiSessionId`
- [x] 1.5 在 `server/app.ts` 挂载 `/api/knowledge/*`（settings / test / docs / accepted-types / upload / remove / purge / chat / history / search / doc），上传按 `Content-Length` 预拒绝超 100MB；跑 `npm run build:server` 并用 `stat -f '%Sm' server-build/app.mjs` 确认 bundle 晚于源码

## 2. 设置页

- [x] 2.1 `src/settings/settingsNav.ts` 在 connections 枢纽加 pane `knowledge`，新增 `src/settings/hubs/connections/KnowledgePane.tsx`；打开设置页可看到入口且切换不报错
- [x] 2.2 面板实现地址与 Key 输入、保存、「测试连接」、以及「先去 AnythingLLM 配好对话模型与 embedder」检查清单；用 mock 上游验证保存后 Key 只显示为「已配置」，失败时显示翻译后的原因
- [x] 2.3 新增 `docs/knowledge-base.md`：部署 AnythingLLM、创建 API Key、两种配置方式（设置页 / 环境变量）、回滚方式（清空地址即关闭）；照文档从零配一遍并确认页面从引导态进入可用态

## 3. 知识库视图（A 段：人用）

- [x] 3.1 `src/shell/nav.ts` 的 `ViewId` 加 `knowledge`、`NAV_ITEMS` 创作组加「知识库」项，`src/App.tsx` 加视图分支；`node verify-shell-nav.mjs` 通过，手点左栏可达且面包屑正确
- [x] 3.2 新增 `src/knowledge/` 页面骨架与 `src/api.ts` 客户端，实现四种状态：未配置（引导页）、连不上（保留上次清单 + 可重试连接条）、首次进入自动建库、正常；用 mock 上游逐一触发验证，页面均不空白
- [x] 3.3 文档清单 + 多文件上传 + 单文件失败不影响其它文件；`accept` 从 `/api/knowledge/accepted-types` 生成；用 mock 上游验证三个文件中有一个失败时另两个仍出现在清单
- [x] 3.4 两种移除：默认「移出本库」，二次确认的「彻底删除」带跨项目影响提示；取消确认后文档与挂载不变（mock 断言无删除请求发出）
- [x] 3.5 问答面板：SSE 增量渲染、`sources` 渲染为可展开引用卡（标题 + 片段 + score）、无命中时明确标注「本轮没有命中库内容」；重开视图按 `sessionId` 回读历史，清空走 `reset`
- [x] 3.6 `src/theme.css` 补知识库页样式（清单两栏、引用卡、连接条、引导态），窄宽度下两栏收起为单栏；1440px 与 1100px 目视检查无逐字换行
- [x] 3.7 新增 `verify-knowledge-ui.mjs`（mock 上游 + 5273 dev server）覆盖：未配置引导、上传、移出、问答引用、未命中提示；跑通并记录结果

## 4. Agent 工具（B 段：机器用）

- [x] 4.1 在 `builtinPlatformTools.ts` 注册 `search_knowledge` / `read_knowledge_doc`，项目名由 `BuiltinPlatformCtx.projectName` 注入、不作为工具参数；断言工具 schema 中不存在项目或库字段
- [x] 4.2 工具结果分两段：模型只拿 title/score/截断片段摘要，完整片段留给工具卡片；断言模型可见文本不含完整 chunk
- [x] 4.3 `expertToolGroups.ts` 把两个工具归入 `read` 组并加入 `DEFAULT_EXPERT_PLATFORM_TOOLS`；`node verify-agent-tool-coverage.mjs` 通过，且工具不出现在「生成（有成本）」组
- [x] 4.4 未配置 / 连不上 / 库为空三种情况下工具返回可读说明而不是抛错；mock 上游覆盖三态并断言 `ok:false` 带原因
- [x] 4.5 反例断言：拆镜与单镜出片的请求体积中不出现知识库片段 —— 在知识库有内容时触发一次 dryRun payload 检查，确认提示词只由既有来源拼成

## 5. 生命周期与集成

- [x] 5.1 `server/project-lifecycle.mjs` 删除项目时尽力删除对应 workspace 并清理映射，失败返回 warning 不阻塞；用 mock 上游验证「上游可用」与「上游不可用」两条路径
- [x] 5.2 `docker-compose.yml` 透传 `ANYTHINGLLM_BASE_URL` / `ANYTHINGLLM_API_KEY`，`deploy/.env.example` 补注释；跑 `node verify-deploy-env-merge.mjs` 通过
- [x] 5.3 端到端 mock 集成：建库 → 上传 → 检索 → 问答带引用 → 移出 → 删项目；`node verify-knowledge.mjs` 与 `node verify-knowledge-ui.mjs` 全绿
- [x] 5.4 真实服务验收（2026-11-25 完成）：本地起 AnythingLLM（`mintplexlabs/anythingllm`，generic-openai → MiniMax-M3.1-Flash + native embedder + LanceDB），`verify-knowledge-real.mjs` 9/9、`verify-knowledge-real-ui.mjs` 7/7 全过；上传 md + PDF、问答答出「雨夜巷口」「三枚黄铜符牌」、引用片段命中真实文档。验收中发现并修掉三处真实契约差异（API 前缀 `/api/v1`、默认模式须为 `query`、上传应答无 `location`），详见 design.md 第 6 节

## 6. 上游对话模型自动配置（追加需求）

- [x] 6.1 `server/knowledge.mjs` 增加 `applyLlmConfig`：用 camelCase 键名调上游 `/api/v1/system/update-env`；断言「下划线键名被静默丢弃（error 仍 false）」这个真实坑
- [x] 6.2 `server/app.ts` 连接测试路由顺便推送本应用 MiniMax 渠道配置；推送失败不改连接结论，无可用渠道时跳过并给出指引
- [x] 6.3 设置面板增加「上游对话模型」字段（默认 `MiniMax-M3.1-Flash`）与推送结果反馈；`llmModel` 走知识库设置层，遵循「未提交=保留」
- [x] 6.4 真实容器验证：干净未配置上游 → 调本应用连接测试 → 5 项配置写入 → 上传后问答答出「镇、锁、焚」并带 1 条引用
- [x] 6.5 文档 `docs/knowledge-base.md` 说明代配行为、为何默认 M3.1-Flash（M3/M2.7 输出 `<think>`）

## Workflow follow-up

- `openspec sync specs` 后归档本变更。
- 归档后确认主规格 `knowledge-base` 的 Purpose 已落库，不是占位符。
