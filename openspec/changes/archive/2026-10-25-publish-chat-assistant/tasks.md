# Tasks

## 1. 环节与技能登记

- [x] 1.1 在 `src/api.ts` 的 `Stage` 联合与 `STAGES`、`src/skills/parse.ts` 的 `STAGES`、`vite.config.ts` 的 `Stage` 与 `STAGES` 三处加入 `publish`；在 `src/skills/stages.ts` 的 `STAGE_RUNTIME` 增加 `publish: { maxTokens: 8192, temperature: 0.3, output: null }`。验证：`npx tsc --noEmit` 通过，且 `parseSkillText` 对 `stage: publish` 不再产生「未知环节」issue
- [x] 1.2 在 `src/settings/SettingsPage.tsx` 的 `STAGE_META` 增加一行「发布（发布助手）」，hint 写明「空则沿用文本默认」。验证：启动 dev server 打开设置页，生成环节默认表格出现该行且可保存、刷新后保留
- [x] 1.3 新建 `skills/publish/SKILL.md`，frontmatter 使用 `stage: publish`、`runtime: json-tools`、第 9 条决策中的 tools 与 inputs，正文按现有技能结构写 `## 角色与约束` 与 `## 任务`；正文只写「怎么和用户把发布配置谈拢」「什么该问、什么不该猜」「不能代为公开发布」。验证：`src/skills/registry.ts` 加载后技能出现在列表，`verify-skills-*` 或等价脚本断言 manifest 校验通过、无 parse issue
- [x] 1.4 在 `src/agent/threads.ts` 的 `ChatSurface` 增加 `'publish'`。验证：`npx tsc --noEmit` 通过，且用 `surface=publish` 调用 `saveChatThread` / `loadChatThread` 能往返读写（脚本或单元断言均可）

## 2. 服务端提交意图

- [x] 2.1 在 `server/db.mjs` 的 `SCHEMA` 常量中加入 `publish_intents` 表（字段见 design 第 2 条）与 `state` 索引。验证：对新建临时库与已有旧库分别调用 `openDatabase()`，`PRAGMA table_info(publish_intents)` 都存在该表，旧库不被清空
- [x] 2.2 新建 `server/publish-intents.mjs`：`normalizeIntentConfig`（复用 `normalizeDeliverableConfig`）、`configHash`（规范化后 sha256，键排序稳定）、`stageIntent`、`getIntent`、`confirmIntent`、`cancelIntent`、`sweepIntents`（清理超过 24 小时的 expired/cancelled）。验证：新增 `verify-publish-intent.mjs`，断言同一配置不同键顺序得到同一 hash、`stageIntent` 不创建任何 `publish_jobs` 行
- [x] 2.3 在 `confirmIntent` 里实现三道拒绝：hash 与行内快照不一致、`expires_at` 已过、用行内 config 重跑 `runPreflight` 未通过；三者都标 `expired` 并返回可读原因。验证：`verify-publish-intent.mjs` 各覆盖一条拒绝路径，断言 `publish_jobs` 计数不变
- [x] 2.4 实现 `source: 'assistant'` 的服务端收窄：`targets` 含 `mode: 'publish'` 时拒绝并返回 `assistant_cannot_publish`；`chromeAvailable()` 为假且存在 `draft` target 时拒绝并返回 `no_browser`。验证：`verify-publish-intent.mjs` 断言两条错误码，且手动来源（`manual`）不受限
- [x] 2.5 在 `vite.config.ts` 的发布路由挂载 `POST /api/publish/intents`、`GET /api/publish/intents/:id`、`POST /api/publish/intents/:id/confirm`、`POST /api/publish/intents/:id/cancel`，确认接口只接收 `intentId` 不接受 config。验证：`verify-publish-api.mjs` 增加 intent 段落，断言四个端点状态码与返回结构，并断言 confirm 请求体里带 config 时被忽略（仍按行内快照执行）
- [x] 2.6 在服务启动时调用 `sweepIntents`（与现有 `recoverInterruptedJobs` 同处）。验证：`verify-publish-intent.mjs` 造一条 25 小时前的 cancelled 行，调用 sweep 后该行消失且未误删 staged 行

## 3. 任务来源与可复用预检

- [x] 3.1 让 `POST /api/publish/intents/:id/confirm` 创建任务时写入 `payload: { source: 'assistant', intentId, aiGenerated }`，手动路径写 `payload: { source: 'manual', aiGenerated }`。验证：`verify-publish-intent.mjs` 断言两种来源的任务 `payload.source` 分别为 `assistant` / `manual`
- [x] 3.2 在 `src/publish/types.ts` 给 `PublishJob` 增加可选 `payload?: { source?: 'assistant' | 'manual'; intentId?: string; [k: string]: unknown }`，并确认 `server/publish-jobs.d.mts` 同步。验证：`npx tsc --noEmit` 通过，且 `getJob` 返回的记录能读到该字段
- [x] 3.3 在 `src/publish/PublishRecords.tsx` 与任务抽屉中，对 `payload.source === 'assistant'` 的任务显示「由助手提交」标签，其余保持原样。验证：`verify-publish-ui.mjs` 用 mock 数据造一条 assistant 任务，断言标签出现；再造一条 manual 任务，断言标签不出现
- [x] 3.4 抽出 `runPreflightForIntent`（接收规范化 config + targets + accounts map），供 `confirmIntent` 与现有路由共用，不改变现有 `runPreflight` 签名。验证：`verify-publish-contract.mjs` 全部既有断言仍通过

## 4. 前端宿主适配与工具

- [x] 4.1 新建 `src/publish/PublishChat.tsx`：定义 `PublishSnapshot`、`ConfigPatch`、`PublishWriteResult`、`PublishChatAdapter`（字段见 design 第 1 条），并由 `PublishBoard` 注入 `snapshot`、`applyPatch`、`beginRound`、`undoRound`、`stage`、`connectAccount`。验证：`npx tsc --noEmit` 通过，且 `ConfigPatch` 不包含整份 `DeliverableConfig` 类型（类型层面即可断言）
- [x] 4.2 实现读工具 `read_publish_state` / `read_deliverables` / `read_config` / `read_accounts` / `read_platforms` / `read_preflight` / `read_jobs`，全部走 adapter 而非直接 fetch；结果统一 `boundJson(8000)` 截断并标注 truncated；平台只回 `id/label/modes/manualOnly/verified/coverAspects/limits`，任务只回最近 10 条摘要。验证：单元断言读工具在超大任务表下返回 truncated 标记，且不会返回 cookie / profile 路径
- [x] 4.3 实现配置写工具 `set_targets` / `set_copy` / `set_mode` / `set_cover`，每个都返回 `{ ok, roundId, changes: [{ field, from, to }] }`，并且只通过 `applyPatch` 落配置；不调用 `createJobs`、不调用 packages。验证：脚本断言调用四个写工具后 `/api/publish/jobs` 与 `/api/publish/packages` 请求数为 0，配置确实变化
- [x] 4.4 实现 `stage_submit` 与 `stage_package`：只调 `POST /api/publish/intents`，返回 `{ staged: true, intentId, hash, card }`；工具内不存在任何确认或提交分支。验证：脚本以 mock 服务断言工具全部返回中 `staged` 为 true，且任务计数为 0
- [x] 4.5 实现 `connect_account` 与 `ask_user`：前者复用现有 `connectAccount()` 并返回轮询中的登录会话摘要；后者返回 `{ question, options[] }` 供宿主渲染快捷回复。验证：单元断言 `ask_user` 的 options 长度上限（≤4）与 value 非空；`connect_account` 在无 Chrome 环境返回可读错误而非抛栈
- [x] 4.6 用 `runStageAgent` 装配发布助手运行器（system = 协议 + 技能角色层 + 边界说明，history 取自线程），并在 `ChatThreadShell` 下渲染 `WorkbenchHeader`、`ChatThreadBody`、`WorkbenchEmpty` 的发布版文案。验证：`verify-agent-graph.mjs` 的等价用例（或新增发布用例）断言工具调用→工具结果→最终文本的三段事件顺序正确

## 5. 右栏槽位与布局

- [x] 5.1 新建 `src/publish/PublishDock.tsx`：单一槽位，助手关闭时渲染发布检查、展开时渲染助手；宽度受控值默认 380、可拖 320–560、按 `publish` 记忆；检查器填满槽位宽度而不是固定 300px。验证：`verify-publish-ui.mjs` 断言助手关闭时检查器可见、展开后检查器不渲染、编排区不出现横向滚动（`scrollWidth <= clientWidth`）
- [x] 5.2 在 `WorkbenchChatAside` 增加 `publish` 的 `DATA_ATTRS` 项，并在新建的 `src/publish/publishChat.css` 用 `[data-publish-chat]` 作用域把窄屏断点覆盖为 1200px。验证：`verify-publish-ui.mjs` 在 1210 / 1190 / 900 三个宽度断言助手分别为停靠栏 / 抽屉（带遮罩）/ 全屏，且 1190 时 `.pb` 已是纵向布局
- [x] 5.3 在发布台工具栏接入 `AgentButton`（复用现有组件），在「待发布」页签可用、记录与账号页签禁用并给出 title 原因；开合与宽度沿用现有记忆机制。验证：`verify-publish-ui.mjs` 断言三个页签下按钮的 disabled 状态与 title 文案
- [x] 5.4 待确认卡出现且面板收起时自动展开并滚动到卡片；窄屏自动打开抽屉，关闭遮罩后卡片仍在。验证：`verify-publish-ui.mjs` 用 mock intent 触发，断言面板自动展开、卡片在 DOM 中，关闭遮罩后重新打开仍能定位到同一张卡

## 6. 准备度条与回执卡

- [x] 6.1 新建 `src/publish/ReadinessBar.tsx` 与纯函数 `computeReadiness({ config, platforms, accounts, preflight })`，五格状态为 `ok | warn | danger | not-applicable`，未选平台时后四格为 `not-applicable`。验证：单元断言五个分支（全齐、缺封面、账号未连、预检阻断、未选平台），并断言未选平台时不会出现 `danger`
- [x] 6.2 准备度格点击后展开对应区块并滚动定位（复用现有 `jumpToIssue` 的滚动逻辑风格），不聚焦输入框。验证：`verify-publish-ui.mjs` 点击封面格后断言封面区块展开且 `data-section="cover"` 进入视口
- [x] 6.3 新建 `src/publish/publishReceipts.tsx`，实现配置、预检、账号、任务、待办、交接六类回执，全部基于 `ToolCard` 并带 `data-receipt` 属性；配置回执必须列出 `from → to` 的逐字段变化（最多 6 行，其余折叠为数量）。验证：`verify-publish-ui.mjs` 断言六类回执都能渲染出标题、明细行与动作行，且配置回执不出现「已更新配置」这类无明细文案
- [x] 6.4 实现任务回执的四段步进器（打开后台 / 上传视频 / 填写文案 / 保存草稿），当前步骤取自任务 `stage`，不渲染百分比；待确认与审核中不得显示为已发布。验证：用 mock 任务在 `uploading` / `awaiting_confirmation` / `published` 三个状态断言步进器与状态文案，并断言 DOM 中不存在 `%` 进度元素
- [x] 6.5 新建 `PendingIntentCard`：显示成片版本、逐平台账号与方式、封面与文案摘要、预检结论，以及「只上传草稿、不会公开发布」的反面承诺；确认按钮为次级样式。验证：`verify-publish-ui.mjs` 断言卡片包含成片标识、每个目标平台行、反面承诺文案，且确认按钮不带主色类名

## 7. 统一提交意图与双入口

- [x] 7.1 在 `src/publish/api.ts` 增加 `stagePublishIntent` / `confirmPublishIntent` / `cancelPublishIntent` / `getPublishIntent`，并在 `PublishBoard` 抽出 `submitPublishIntent`：有 `intentId` 走 confirm，否则走现有 `/api/publish/jobs`。验证：`verify-publish-api.mjs` 断言两条路径创建任务的字段、状态与幂等键完全一致
- [x] 7.2 底部按钮与卡片确认共享 `submitting` 状态，任一路径在飞时两个按钮同时 disabled 且文案为「提交中…」。验证：`verify-publish-ui.mjs` 用延迟 mock 断言同时 disabled，结束后恢复
- [x] 7.3 `mode: 'publish'` 时卡片确认先打开现有发布确认弹窗，弹窗确认才调 confirm 接口；`mode: 'draft'` 时卡片即确认。验证：`verify-publish-ui.mjs` 断言 publish 模式下第一次点击不产生请求、弹窗取消后仍无请求
- [x] 7.4 待确认存在时底部计划文字改为「助手已备好 N 个平台 · 待你确认（右栏）」，并且底部按钮仍是页面唯一主色按钮。验证：`verify-publish-ui.mjs` 断言计划文案与主色按钮计数为 1
- [x] 7.5 环境降级：`chromeAvailable` 为假时助手不提供草稿提交，只保留发布包；头部显示常驻说明。验证：`verify-publish-ui.mjs` 用 `browserAvailable: false` 的 mock 断言卡片上不出现「确认上传草稿」，只出现发布包动作，且头部说明可见

## 8. 撤销与澄清

- [x] 8.1 实现 `beginRound` / `undoRound` 的内存快照栈（深度 10），每轮首个写工具前记录配置；回执卡按 `roundId` 提供「撤销这一轮」。验证：单元断言连续三轮改动后撤销第二轮，配置等于第二轮开始前；连续 12 轮后最旧的快照被丢弃
- [x] 8.2 撤销只还原配置，不触达任务与发布记录；撤销后新改动以撤销后配置为基准。验证：单元断言撤销调用前后 `/api/publish/jobs` 请求数不变，且撤销后的下一次 `applyPatch` 结果不包含被撤销字段
- [x] 8.3 澄清路径：多条成片未选中时 `ask_user` 列成片，未给平台时列平台；快捷回复点击即作为下一条用户消息发送。验证：`verify-publish-ui.mjs` 断言候选按钮出现、点击后消息列表新增一条 user 消息且选项文本一致
- [x] 8.4 上下文明确时不追问：当前成片与平台都明确时直接执行，回执写明沿用项。验证：`verify-publish-ui.mjs` 断言该场景下不出现 `ask_user` 卡片，而是直接出现配置回执

## 9. 集成验收与文档

- [x] 9.1 跑通完整助手链路（mock 服务 + 真实 dev server）：选平台 → 改文案 → 缺封面 → 补封面 → 预检通过 → 暂存 → 确认 → 任务出现「由助手提交」。验证：新增 `verify-publish-assistant.mjs` 端到端脚本断言每一步的 DOM 与请求，全流程零真实平台调用
- [x] 9.2 权限负向验收：模型反复调用 `stage_submit` 且未确认时 `/api/publish/jobs` 与 confirm 请求数均为 0；直接请求 assistant 来源的 `mode: 'publish'` 返回 `assistant_cannot_publish`；过期卡确认被拒。验证：`verify-publish-assistant.mjs` 的三条负向断言全部通过
- [x] 9.3 回归现有发布链路：`node verify-publish-contract.mjs`、`node verify-publish-api.mjs`、`node verify-publish-queue.mjs`、`node verify-publish-ui.mjs` 全部通过（含此前快照中的未提交改动）
- [x] 9.4 更新 `README.md` 的发布台章节：助手能做什么、不能做什么（不点最终发布、不标记已发布、不处理验证码）、两阶段确认、撤销范围、环境降级行为，以及 `publish` 环节在设置页的模型绑定。验证：按文档逐条手动操作一遍，记录与实际行为一致
