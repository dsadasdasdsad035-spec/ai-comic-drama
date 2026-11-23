# Tasks

## 1. 案例库存储

- [x] 1.1 在 `server/db.mjs` 的 `SCHEMA` 加全局表 `prompt_cases`（字段见 design D1，唯一键 `(source, source_id)`，无 `project_id`）；验证：删掉临时库后启动，`PRAGMA table_info(prompt_cases)` 列出全部字段，且现有表未被改动（对老库直接启动，`revision` 与项目数不变）
- [x] 1.2 新建 `server/prompt-cases.mjs`，实现案例的列表（按关键词 / 来源 / 模型 / 收藏过滤 + 分页）、按 id 读取、UPSERT（`(source, source_id)` 命中也保留 `favorite` 与 `note`）、更新备注与收藏、删除；验证：`node verify-prompt-cases.mjs --unit` 断言重复 UPSERT 后收藏与备注仍在、分页边界正确
- [x] 1.3 在 `server/prompt-cases.mjs` 强制许可口径：保存时按 `source` 推导 `license`，`reverse-own` 之外一律 `reference-only`，客户端传入的 `license` 被忽略；验证：单测提交 `source=vflow, license=own`，读回为 `reference-only`
- [x] 1.4 把 1.2 的 CRUD 接到 `server/app.ts`：`GET /api/prompt-cases`（列表 + 筛选参数）、`GET /api/prompt-cases/:id`、`PATCH /api/prompt-cases/:id`（备注 / 收藏）、`DELETE /api/prompt-cases/:id`；验证：`curl` 走一遍增查改删，删除不存在 id 返回 404 且响应体是中文可读原因

## 2. 外部来源导入

- [x] 2.1 在 `server/prompt-cases.mjs` 建立来源适配器注册表（`id` / `label` / `enabled` / `preview()` / `fetchItems()`），默认只启用 vflow，其余来源登记但关闭；验证：`GET /api/prompt-cases/sources` 返回每个来源的 `enabled` 与关闭原因，未启用来源直接调预览返回未启用错误
- [x] 2.2 实现 vflow 适配器：拉索引（内存缓存 10 分钟）、按模型 / 分类 / 标题关键词过滤、`preview()` 只回摘要；索引体积上限 12 MB、超时 20s；抓取前用 `server/ingest.mjs` 的 `assertPublicUrl` 校验；验证：用固化 fixture 索引跑 `preview()`，断言过滤与条数上限（60）生效、超限与超时分别返回可读错误
- [x] 2.3 实现 `fetchItems()`：对勾选 id 逐条取正文（单条超时 8s、响应上限 512 KB、并发 4），解析 `prompt / title / referenceModel / sourceUrl / videoUrl / thumbnailUrl / aspectRatio / durationSec`，返回新增与更新计数；验证：fixture 下连续导入两批同一 id，第二次新增 0、更新等于条目数
- [x] 2.4 加路由 `POST /api/prompt-cases/import`（`preview: true` 走预览，否则按 `source` + `ids` 提交），提交阶段拒绝不在预览结果里的 id；验证：提交伪造 id 返回 400 且其余合法条目正常写入，案例库只多出合法条目
- [x] 2.5 在 `verify-prompt-cases.mjs` 补失败路径：来源返回非 JSON、索引超限、单条超时、内网地址被拒；验证：四项各自断言返回可读错误、案例库条数不变
- [x] 2.6 在 `docs/` 补一页来源说明（vflow 的索引与逐条地址、`ai-train=no / use=reference` 的口径、只存外链的原因、其余候选站的实测结论）；验证：按文档里的地址与命令手工跑一遍能复现预览结果

## 3. rea-video 拆解作业

- [x] 3.1 新建 `server/rea-video.mjs`：`resolveReaBin()` 按 `REA_VIDEO_BIN` → 随包二进制 → PATH 顺序探测，跑 `--help` 判定可用并返回版本；不可用返回 `not-installed` 与安装命令；验证：把 `REA_VIDEO_BIN` 指到不存在的路径断言 `not-installed`，指到真实可执行文件断言可用
- [x] 3.2 实现作业队列：作业目录落 `statePath(appRoot, '.rea-jobs', id)`、子进程 `spawn`、并发默认 1（`REA_CONCURRENCY` 可覆盖）、超出排队；验证：连发 3 个 mock 作业，断言同时运行数不超过 1、其余为排队状态
- [x] 3.3 实现超时与停滞：总超时 `max(180s, duration × 8)`、停滞上限 90s、SIGTERM 后 5s 未退出则 SIGKILL；验证：mock 子进程只 sleep 不输出，断言停滞后状态为失败且原因含「没有进展」，进程已退出
- [x] 3.4 实现取消与产物体积上限（512 MB）：取消终止子进程并标记已取消、不写案例；超限删除产物并失败；验证：运行中取消后案例库条数不变，超限用例断言失败原因含体积
- [x] 3.5 实现档位到参数的映射（design D6 的 quick / full 常量表），并把档位会触发的下载项回给前端；验证：断言 quick 档参数包含全部 `--no-*` 开关、full 档不含，`GET` 档位接口返回下载清单与预计体积
- [x] 3.6 实现提示词模板拼装与 VLM 环境注入：**经应用内中转端点** `/api/prompt-cases/vlm-proxy`（只认内部令牌），由服务端用应用自己的 apimart 客户端转发并把 SSE 归一成非流式 JSON；子进程只拿内部令牌，渠道 Key 不出进程。未配置视觉模型时拒绝创建并给可读原因。验证：mock 子进程打印收到的 env，断言作业目录下没有 `.env`、日志与响应不含 Key；真实链路实测 `VLM 已生效`，置信度 0.644 → 0.992
- [x] 3.7 实现产物解析：从 `breakdown.json` 取逐镜时间范围 / 制作方式 / 置信度 / 依据，从 `review_answers.json`（并入后）取两段提示词；制作方式限定在固定分类集合内，集合外的值保留原值并标未知；验证：用一条真实样本固化的 fixture 跑解析，断言逐镜字段齐全、缺提示词的镜头标为缺失而非空串
- [x] 3.8 实现证据帧落盘：把总览图与逐镜关键帧复制到应用可读媒体目录并返回站内地址，单张复制失败只标记该镜证据缺失；验证：fixture 下故意让一张缺失，断言作业仍成功且该镜标注证据缺失
- [x] 3.9 加路由 `POST /api/prompt-cases/reverse`（创建）、`GET /api/prompt-cases/reverse/:id`（轮询）、`DELETE /api/prompt-cases/reverse/:id`（取消）、`POST /api/prompt-cases/reverse/:id/adopt`（写入案例库）；验证：完整走一遍 mock 拆解，`adopt` 后案例库新增一条 `source=reverse-own`、`license=own`

## 4. 素材页案例库界面

- [x] 4.1 在 `src/AssetBoard.tsx` 的 `MaterialTab` 加 `'prompt-cases'`，并在上下文带文案、动作区、内容区分支与 `readInitialMaterialTab` 恢复逻辑四处同时覆盖；验证：刷新页面保持在案例 Tab，切到其他 Tab 再切回时状态正确
- [x] 4.2 新建 `src/promptCases/api.ts` 与 `types.ts`，封装案例列表 / 详情 / 更新 / 删除 / 来源列表 / 导入预览与提交；验证：`npm run build` 的 `tsc --noEmit` 通过
- [x] 4.3 新建 `src/promptCases/PromptCaseGrid.tsx`：卡片网格（封面外链 + `onError` 占位、标题、来源、模型、分类、时长或比例），复用 `BoardListToolbar` 做搜索与分页；验证：外链不可达时显示占位且列表不中断，搜索命中只出现在正文里的词
- [x] 4.4 新建 `src/promptCases/PromptCaseDetail.tsx`：提示词全文、复制、原文链接、作者、许可口径、收藏与备注；反推案例额外渲染逐镜列表（时间范围 / 制作方式 / 置信度 / 依据 / 证据帧），低置信显示待确认；验证：打开反推案例能看到逐镜与证据图，缺证据的镜头显示待确认
- [x] 4.5 新建 `src/promptCases/ImportDialog.tsx`：来源选择（只列已启用）、关键词 / 模型 / 条数、预览列表带勾选、提交后显示新增与更新数；验证：预览后关闭不落库，提交后条数按勾选增加
- [x] 4.6 新建 `src/promptCases/ReversePanel.tsx`：从项目视频库选片、档位选择（含下载影响说明）、发起、轮询进度、取消、完成后预览逐镜并「存入案例库」；验证：mock 后端下完整走一遍，取消后案例库无新增
- [x] 4.7 在 `src/theme.css` 补案例库卡片与详情样式，复用 `asset-video-*` 与 `lexicon-*` 的既有 token，不引入新色值；验证：明暗两种主题下卡片与详情可读（`node verify-theme.mjs` 通过）

## 5. 应用到镜头

- [x] 5.1 在 `src/App.tsx` 增 `applyPromptCase(caseId, slot)`，`slot` 为 `prompt` 或 `videoPrompt`，写入当前选中镜头并更新画布节点；未选镜头时返回可读原因；验证：选中镜头后应用，画布节点文本与项目数据同时更新，刷新后仍在
- [x] 5.2 在案例详情加两个应用按钮，未选镜头时置灰并说明原因；多镜案例（反推案例或文本含多个时间段）写入后 toast 提示可能需要删减；验证：未选镜头时按钮禁用且提示可读，多镜案例写入后有提示
- [x] 5.3 在 `verify-prompt-cases.mjs` 补一条端到端：导入一条案例 → 应用到镜头 → 重新读项目断言字段值；验证：脚本通过且不依赖真实渠道 Key

## 6. 设置与部署

- [x] 6.1 在 `src/settings/` 增「提示词案例 · 反推工具」配置块：可执行文件路径输入、检测按钮（显示实际版本或失败原因）、默认档位、可复制的安装命令；验证：填不存在的路径显示 `not-installed` 与安装命令，填真实路径显示可用
- [x] 6.2 把反推配置接入设置读写（`normalizeCreativeSettings` 同层新增字段，缺省不影响旧设置）；验证：老设置读取后新增字段为默认值，保存后重新读取保持
- [x] 6.3 更新 `DEPLOY-CHECKLIST.md`：新增「rea-video 外部进程依赖」条目（Python ≥ 3.10 + ffmpeg + onnxruntime，桌面端随包、Docker 加 python 层），写明未安装时的降级行为（案例库可浏览，反推不可用）；验证：按清单在干净环境走一遍能判定该依赖是否满足

## 7. 集成验收

- [x] 7.1 扩充 `verify-prompt-cases.mjs` 为总入口：DB CRUD、许可强制、来源导入、拆解作业（mock 子进程）、应用到镜头五段，全部不花真实额度；验证：`node verify-prompt-cases.mjs` 全绿。另加 `verify-prompt-cases-smoke.mjs`：起真实服务进程分四层冒烟（离线路由 / vflow 真实索引 / rea-video 真实拆解 / 浏览器链路），`--offline` 供无网环境，缺失外部依赖记跳过而不失败
- [x] 7.2 回归既有验收：`npm run build`、`node verify-skills-unit.mjs`、`node verify-assets-db.mjs`、`node verify-theme.mjs`、`node verify-board-episode-picker.mjs`；验证：五项均通过，素材页其他 Tab 行为不变
- [x] 7.3 手工验收一次真实链路：导入 20 条 vflow 案例并应用其中一条到镜头；对本机一条短视频跑快速档拆解并存库；验证：两项都成功，拆解结果标出视觉判定是否生效，界面无密钥泄露

## Workflow follow-up

- 需求与实现经项目评审后归档本 change。
- 归档前按项目惯例先 `openspec sync specs`，再 `openspec archive prompt-case-library`。
- `flatkey` 等其他来源作为后续独立 change 评估（数据路径在 robots 的 `Disallow` 下，需先确认授权口径）。

## 8. 后续增量（2026-11-22 追加）

- [x] 8.1 反推面板支持下拉选择视觉模型（默认跟「默认路由 → 视觉」，标出默认项与渠道），选择结果作为 `vlmModelKey` 传给作业创建；验证：`/api/prompt-cases/reverse/health` 返回 `visionModels`，UI 下拉含「跟默认路由」与各具体模型
- [x] 8.2 拆解报告在界面内以**禁脚本沙箱 iframe** 预览：报告与 `shots/` `sfx/` `frames/` `storyboard.jpg` `audio.png` 整份复制到 `prompt-cases/<job>/report/`；验证：报告以 `text/html` 返回、不含 `<script>`、同目录资源 200，浏览器内标题与图片正常渲染
- [x] 8.3 修正 `mimeOf` 对 `html/css/js/json/svg/txt` 的推断（此前一律回落 `image/png`，导致报告被当图片处理、界面白屏）；验证：`curl -I` 报告地址返回 `text/html; charset=utf-8`
- [x] 8.4 修正逐镜提示词来源：`replication` 是复刻路线（route/executor/rule/note）而非提示词，提示词取自 `review.replication` 或 `replication.spec.scene`；界面单独展示「复刻路线」，缺提示词如实标注；验证：真实产物解析出 `code_render / 3 条依据`，`remakeRoute` 有值
