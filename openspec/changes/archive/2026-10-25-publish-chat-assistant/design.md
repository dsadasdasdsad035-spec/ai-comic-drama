# Design

## Context

动机见 `proposal.md`，行为契约见 `specs/`。这里只记录影响实现方式的现状。

- 发布台的编排与检查都在 `src/PublishBoard.tsx`（约 1073 行），状态是组件内的 `config`、`platforms`、`accounts`、`jobs`、`preflight`；配置改动走 500ms 防抖 `PATCH /api/deliverables/:id/config`，预检走 450ms 防抖 `POST /api/publish/preflight`。
- 底部提交直接调 `createJobs()`（`src/publish/api.ts`），服务端在 `POST /api/publish/jobs` 里重新跑预检后才创建任务；幂等键为「成片 + 平台 + 账号」，`createJob` 命中活动任务时返回 `reused`。
- 队列 `server/publish-queue.mjs` 并发 1，任务状态在 SQLite `publish_jobs`，`payload` 是 JSON 字段且已随 `getJob` 返回，因此「任务来源」可以放进 payload，不需要加列。
- 聊天栈是现成的：`ChatThreadShell`（assistant-ui provider + 视口 + 输入框）、`useAgentMessages`、`runStageAgent`（LangGraph 工具循环，默认 180s 总时长、16 步）、`ZCodeChatModel`（JSON action 协议 + 原生工具两条通道）、`threads.ts`（按 project/surface/episode/shotId 持久化线程）。`ChatThreadKey.surface` 已是 `ChatSurface | string`，新增 surface 不需要改存储。
- `WorkbenchChatAdapter` 是围绕「产物草稿」设计的（`artifact`、`writeTool`、`ownDraft`、`applyDraft`、`saveDraft`），发布台没有这种草稿，直接套会让六个字段里五个是空壳。
- `WorkbenchChatAside` 的拖拽、宽度记忆（340–600）、窄屏抽屉都已实现，但断点写死 1180px，且 `DATA_ATTRS`/`WorkbenchSurface` 是封闭联合。
- 发布台 `publish.css` 在 1200px 把 `.pb` 改成纵向；右栏 `.pb-inspect` 固定 300px。
- `openDatabase()` 每次都会 `db.exec(SCHEMA)`，所以新增表只要写进 `SCHEMA` 常量即可，旧库也会自动建表。

## Goals / Non-Goals

**Goals:**

- 让助手的写入与提交都是**可审计、可撤销、可拒绝**的：任何一次会改变外部状态的动作都能追溯到一份快照，并能在服务端被重新校验。
- 复用现有聊天栈与发布栈，不引入第二套消息渲染、第二套浏览器自动化或第二套任务状态机。
- 让「能做什么」由代码结构决定，而不是靠提示词自我约束。

**Non-Goals:**

- 不接入 ZCode 宿主的 `browser-use` 技能，也不新增任何 Playwright 之外的浏览器能力。助手不感知页面，只操作发布台已经有的 API。
- 不让助手逐屏操作平台后台。适配器步骤表仍是唯一的平台操作路径。
- 不做多成片批量发布、定时发布、多账号并发发布。
- 不持久化撤销栈；刷新后不提供跨会话撤销。

## Decisions

### 1. 新增独立的 `PublishChatAdapter`，不复用 `WorkbenchChatAdapter`

发布助手的宿主接口只包含它真正需要的四件事：

```
type PublishChatAdapter = {
  threadKey: ChatThreadKey                    // surface: 'publish'
  snapshot: () => PublishSnapshot             // 成片 + 当前 config（含未落库改动）
  applyPatch: (patch: ConfigPatch) => PublishWriteResult
  beginRound: () => string                    // 返回 roundId 并记录撤销快照
  undoRound: (roundId: string) => boolean
  stage: (input: StageInput) => Promise<StagedIntent>   // 只落 intent，不建任务
  connectAccount: (platform: string) => Promise<...>
  // UI 需要的只读数据
  platforms: () => PlatformCapability[]
  accounts: () => PublishAccount[]
  preflight: () => PreflightResult | null
}
```

`ConfigPatch` 是窄类型：`{ targets?: Record<string,'select'|'deselect'>; copy?: {...}; cover?: {...}; modes?: {...} }`。不接收整份 `DeliverableConfig`，避免模型用「重写全部配置」的方式覆盖用户的手改。

- 替代方案：把 `publish` 塞进 `WorkbenchChatAdapter`，把 `artifact`/`submit_*` 留空。否决——空实现的接口会让后来的人以为发布台也有产物草稿，也会让 `SkillChat` 里五个分支各加一个 `if (surface === 'publish')`。
- 替代方案：给 `SkillChat` 加泛型参数。否决——泛型只会把同一批分支挪到类型层面，读起来更难。

复用仍然发生在下面一层：`ChatThreadShell`、`ChatThreadBody`、`WorkbenchHeader`、`WorkbenchInspector`、`useAgentMessages`、`runStageAgent`、`ToolCard`、`WorkbenchNotes`。只有「宿主适配」这一层分叉。

`ChatSurface` 增加 `'publish'`，`WorkbenchSurface` **不**增加（它是内置动作与 profile 的键，发布台没有这两样）。

### 2. 两阶段提交落成服务端 `publish_intents` 表

暂存不能只是前端 state：那样「服务端拒绝过期快照」无法实现，刷新后卡片也会消失。

```
POST /api/publish/intents          { deliverableId, targets, config, source:'assistant' }
  -> 服务端规范化 config、计算 hash、跑预检、写一行 publish_intents
  -> { intentId, hash, preflight, card }
POST /api/publish/intents/:id/confirm
  -> 读该行，比对 hash / 过期时间 / 环境能力 / mode 白名单
  -> 用行内 config 快照跑预检 -> 创建任务 -> 回写 job_ids / state
POST /api/publish/intents/:id/cancel
```

表结构（写进 `server/db.mjs` 的 `SCHEMA` 常量）：

```
publish_intents(
  id TEXT PRIMARY KEY,
  deliverable_id TEXT NOT NULL,
  project TEXT NOT NULL,
  episode INTEGER,
  source TEXT,              -- 'assistant' | 'manual-echo'
  config_hash TEXT,         -- 规范化 config 的 sha256
  config TEXT,              -- 规范化后的整份配置（确认为唯一依据）
  targets TEXT,             -- [{platform, accountId, mode}]
  preflight TEXT,           -- 暂存时结论，用于卡片展示
  state TEXT,               -- staged | confirmed | cancelled | expired
  job_ids TEXT,             -- JSON 数组
  created_at TEXT,
  expires_at TEXT,
  confirmed_at TEXT
)
```

三条关键性质：

- **确认用的是行内快照**，不是确认请求里再传的配置。请求体如果带了 config 且 hash 不一致，直接拒绝。
- **过期判定双保险**：`expires_at`（30 分钟）加上「确认时重新预检」，任一不通过都标 `expired` 并返回原因。
- **intent 不是任务**，不进入队列、不影响幂等键；确认后才由现有 `createJob` 建立任务。

- 替代方案：卡片只在前端，确认时把内存 config 发给 `/api/publish/jobs`。否决——服务端只能再算一次 hash 跟请求体里那个自己比，等于没校验；刷新即丢卡。
- 替代方案：暂存时就创建 `draft` 状态任务，确认才入队。否决——`publish_jobs` 的 `draft` 已经表示「已建任务」，复用它会让任务台账出现一批没提交的空任务，也会污染幂等判定。

### 3. 助手来源由服务端强制收窄，不靠提示词

`POST /api/publish/intents` 在 `source === 'assistant'` 时：

- `targets[].mode === 'publish'` → 400 `assistant_cannot_publish`。助手只能产生 `draft` 或 `package` intent。
- `chromeAvailable()` 为假且存在 `draft` target → 400 `no_browser`，提示只能导出发布包。
- 不提供任何写 `published` 状态、调用适配器 `submitFinal` 的入口。`mark-published` 路由保持人工调用，助手工具表里没有对应项。

- 替代方案：只在 system prompt 里写禁止。否决——模型可以因为上下文污染或截断而漏读，服务端校验是唯一有保证的边界。
- 替代方案：在适配器层拦住 assistant 来源。否决——适配器不该知道调用方是谁，它只处理页面。

### 4. 唯一提交意图：`submitPublishIntent`

底部按钮与卡片确认都调 `src/publish/api.ts` 里的同一个函数：

```
submitPublishIntent({ deliverableId, targets, config, intentId? })
  -> intentId ? POST /intents/:id/confirm : POST /jobs
  -> 返回 { jobs, preflight? }
```

- 卡片路径不额外传 config：确认接口只认 intent 行。
- 底部按钮路径沿用现有 `/api/publish/jobs`，`payload.source = 'manual'`。
- 两条路径都先在 `PublishBoard` 里置 `submitting=true`，禁用底部按钮与卡片按钮；服务端幂等键兜底并发。
- `mode: 'publish'` 时卡片确认后仍打开现有确认弹窗（规格要求），弹窗确认才真正发 `/intents/:id/confirm`。

- 替代方案：卡片确认直接复用 `/api/publish/jobs`。否决——那就没有 intent 行可校验，两阶段退化成装饰。

### 5. 右栏单槽位，断点对齐 1200px

- `.pb-inspect` 与助手共用 `src/publish/PublishDock.tsx` 包裹层；槽位宽度是一个受控值（默认 380，可拖 320–560，`localStorage` 记忆），检查器填满槽位而不是固定 300px。
- 复用 `WorkbenchChatAside`，新增 `surface="publish"` 与 `DATA_ATTRS.publish`；在 `publishChat.css` 里用 `[data-publish-chat]` 作用域把断点覆盖为 1200px（组件默认 1180），避免 1180–1200 出现「右坞还以为自己是栏、编排区已经纵向」的死区。
- 助手展开时右栏不再渲染 `pb-inspect`；收起时恢复。宽屏下编排区宽度从 `1412 - 248 - 380 - 7 ≈ 777px` 起，四段布局不需要重排。
- 待确认卡出现且面板收起时，`PublishBoard` 调 `setPublishChatOpen(true)`，并把卡片滚进视口。这是唯一允许自动展开的场景。

- 替代方案：底部控制台。否决——发布台已经有吸底 CTA，再加一条横向对话区会吃掉本就不多的垂直空间。
- 替代方案：把检查器做成可折叠的细条，助手常驻。否决——检查器的内容本身需要 300px 才可读，细条会退化成符号。

### 6. 回执卡复用 `ToolCard`，澄清用 `ask_user` 工具

六类回执（配置、预检、账号、任务、待办、交接）都渲染成 `ToolCard` 变体，新增 `data-receipt` 属性区分类型。待确认卡是独立组件 `PendingIntentCard`，因为只有它需要长生命周期的服务端状态与确认按钮。

澄清不做新的消息 part：新增 `ask_user` 工具，返回 `{ question, options: [{ value, label }] }`，宿主渲染成带按钮的卡片；点击后把该选项当作下一条用户消息发送。这样澄清也可持久化、可回放。

- 替代方案：新增 `suggestions` part 类型。否决——要在 `sceneAgentTypes`、`agentMessageReducer`、`useAgentMessages`、序列化层各加一个分支，而工具卡已经能承载「问题 + 选项」。
- 替代方案：把候选平台写进助手正文。否决——用户要点两次（复制再发送），而且正文会随历史裁剪丢失。

### 7. 撤销用内存快照栈

`beginRound()` 在每轮首个写工具前记录 `{ roundId, config }`；回执卡按 `roundId` 提供「撤销这一轮」，只还原到该轮开始前。栈深 10，不落库。

- 替代方案：把快照写进线程或独立表。否决——刷新后撤销一个半小时前的配置，会和用户后来手改的内容冲突；撤销的价值在「刚刚那一下」，不在历史。
- 替代方案：用 `config` 的 undo/redo 栈覆盖用户手改。否决——那会变成一个没边界的历史系统，超出本次范围。

### 8. 准备度是纯函数，不新增接口

`computeReadiness({ config, platforms, accounts, preflight, health })` 返回五格状态。数据全部来自 `PublishBoard` 已有 state：

- 目标：`selectedTargets.length > 0`
- 文案：主标题非空且无 `copy` 相关阻断
- 封面：所需比例 ⊆ `config.cover` 的键
- 账号：每个选中平台存在 `connected` 账号
- 预检：`preflight?.blocking.length === 0`

没有选中平台时，其余四格返回 `not-applicable`（灰色），不是 `warn`。

- 替代方案：让模型总结「还差什么」。否决——每次都要一次模型调用，且会和真实预检不一致；预检是唯一权威。

### 9. 技能与工具清单

新增 `skills/publish/SKILL.md`，frontmatter 与现有技能同构：

```
stage: publish
runtime: json-tools
tools: [read_publish_state, read_deliverables, read_config, read_accounts,
        read_platforms, read_preflight, read_jobs,
        set_targets, set_copy, set_mode, set_cover,
        stage_submit, stage_package, connect_account, ask_user]
inputs: [deliverable, config, readySummary]
output: publish-plan-v1
```

技能正文只写「怎么和用户把发布配置谈拢」与「什么该问、什么不该猜」，权限边界写在协议层与服务端，不指望技能正文兜底。

`publish` 环节需要登记到四处环节清单，否则技能 frontmatter 校验会报「未知环节」：`src/api.ts` 的 `Stage` 与 `STAGES`、`src/skills/parse.ts` 的 `STAGES`、`vite.config.ts` 设置归一化用的 `Stage` 与 `STAGES`、`src/skills/stages.ts` 的 `STAGE_RUNTIME`（`output: null`，聊天没有结构化产物契约），以及 `src/settings/SettingsPage.tsx` 的 `STAGE_META`（否则设置页无法给助手选模型）。

- 替代方案：复用 `creative` 环节，不改任何清单。否决——发布助手的模型选择与创意反推绑在一起，用户调其中一个会莫名其妙影响另一个；而且设置页会出现两个语义无关的功能共用一个环节。
- 替代方案：给助手开放 `retry_job` / `cancel_job` / `mark_published`。否决——重试与取消是任务回执上的宿主按钮（用户点，不需要模型理解）；标记已发布是规格禁止项。

### 10. 任务来源放进 `payload.source`

`createJob` 已把 payload 原样存入并随 `getJob` 返回。助手创建的任务写 `payload: { source: 'assistant', intentId, aiGenerated }`，手动路径写 `source: 'manual'`。记录页与抽屉读 `job.payload.source` 显示标签。

- 替代方案：加 `source` 列。否决——为一个只用于展示的字段改表，收益低于成本。

## Risks / Trade-offs

- **[模型可能把配置改错，而回执读起来像成功]** → 每轮快照 + 撤销；回执必须列出「从什么改成什么」，不接受「已更新配置」这种无信息回执；`ConfigPatch` 限制了可写字段，模型无法整份覆盖。
- **[intent 表带来新的生命周期与垃圾数据]** → `expires_at` 30 分钟，启动时与每次暂存前清理 `expired`/`cancelled` 超过 24 小时的行；intent 不参与任何队列或状态机，清理不影响任务。
- **[助手与 500ms 防抖保存竞争，导致「卡片里的配置」和「落库的配置」不一致]** → 确认路径只认 intent 行内快照，不读 `deliverables.config`；确认成功后宿主用返回值刷新成片配置，避免界面显示旧值。
- **[180s 聊天轮次装不下上传]** → 提交工具立即返回 `jobIds`，任务在队列里跑，回执通过现有 3s 轮询更新；模型从不等待上传完成。这是该设计里最简单也最容易做错的一点，任务里单列。
- **[窄屏 1200 断点与聊天组件默认 1180 不一致]** → `publishChat.css` 用作用域覆盖，测试覆盖 1210 / 1190 / 900 三个宽度。
- **[助手上下文可能被平台表与历史任务撑大]** → 读工具默认返回摘要（平台只回 id/label/limits/modes/manualOnly/verified；任务只回最近 10 条）；大结果走 `boundJson(8000)` 截断并标注。
- **[新增 15 个平台的表单让助手一次写很多字段]** → `set_targets` 接受批量但只表达「选/不选」，不改文案与封面；批量操作回执汇总数量，逐条 diff 最多显示 6 行。

## Migration Plan

无数据迁移：

1. 先上服务端：`publish_intents` 表（`SCHEMA` 常量，`openDatabase` 对旧库自动建表）+ intent 路由 + `source` 校验。此时前端不使用，行为不变。
2. 再上前端：`PublishDock` 与检查器槽位改造，助手入口默认收起；此时助手不可用但布局可回归。
3. 打开助手：`publish` 技能、工具、回执卡、准备度条。
4. 记录页来源标签（纯展示，最后上）。

回滚即 revert 前端；`publish_intents` 表可保留（无代码读取即无害），也可手工 `DROP TABLE`。多成片批量发布、跨会话撤销、助手操作平台页面均已明确排除，需要时另立变更。
