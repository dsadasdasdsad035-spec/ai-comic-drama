# Design

## Context

见 `proposal.md` 的 Why。当前实现有三条约束会直接影响方案：

- **提示词是三层拼出来的**：`src/prompts.ts` 的 BASE、`src/knowledge.ts` 的规则包、各工作台 `generate()` 里的 inline prompt。`RulePack` 只能追加/停用，改不了主体。
- **3D 聊天是唯一的多轮实现**：`SceneAgentChat` 把消息、工具卡、视频验收、代码页签、Blender 会话焊在一起；`ZCodeChatModel` 写死了 3D 身份，并把系统提示塞进 user prompt 文本。
- **五个工作台的草稿都在各自组件的本地 state**：它们已有成熟的合并函数（`mergeCharacters`、`mergeDesigns`、`mergeGenerated`、`mergeProjectShots`）和手改保护（`handEdited`），但没有任何共享草稿层。

用户已选择 **B：每个工作台内嵌聊天，线程独立**，而不是全项目单线程。这个选择决定了：不需要共享草稿层；聊天是工作台的子组件；复用发生在聊天壳、技能数据、工具协议和消息渲染层。

`chat-context-transparency` 仍在规划中（0/16），本设计不绕过它：技能输入和附加内容继续走 manifest，发送前可见。

## Goals / Non-Goals

**Goals:**

- 提示词、输入模板、锁定契约成为可版本化、可覆盖、可审计的技能数据。
- 生成按钮与聊天共用同一套技能正文、输入来源和输出契约，避免两套提示词漂移。
- 每个工作台获得与 3D 同构的聊天能力，但写操作只落在自己的草稿上。
- 线程按项目和工作台隔离、可恢复；大产物只走引用，不进每轮上下文。
- 3D 保留全部既有能力，并从“焊死的组件”变成“通用壳 + scene3d profile”。
- 每个工作台的聊天在首屏回答“助手是谁、改哪个范围、用什么模型、看到了什么、改完是否保存”；窄屏不挤压工作台。

**Non-Goals:**

- 不做全局单线程聊天（方案 A），不引入共享草稿 store。
- 不把一次性生成改成 agent 循环；生成按钮仍是一次模型调用。
- 不新增 Blender、视频、渲染或图像能力。
- 不改变各工作台的保存语义：素材即时落库、剧本显式保存、3D 试运行通过才成草稿。
- 不让技能文件获得代码执行或动态注册工具的能力。

## Architecture

```
skills/<id>/SKILL.md                 代码里的注册表
┌────────────────────────┐      ┌──────────────────────────────────┐
│ frontmatter 声明        │      │ contracts: 校验器 + 锁定提示块    │
│ ## 角色与约束（system） │─────>│ tools:     schema + run + UI     │
│ ## 任务（task 模板）    │      │ stages:    maxTokens/temperature │
└────────────────────────┘      └──────────────────────────────────┘
             │                                  │
             v                                  v
     ┌──────────────────────────────────────────────────┐
     │  技能装载器：内置文件 + 用户覆盖 + 旧规则迁移      │
     └───────────────┬──────────────────────────────────┘
                     │
        ┌────────────┴────────────┐
        v                         v
  一次性执行器                聊天执行器
  （工作台按钮）              （SkillChat）
  system = 角色与约束          system = 协议 + 角色与约束 + 锁定契约
  prompt = 渲染后的任务模板    prompt = 历史 + 本轮任务卡
  json:true + 契约校验         工具循环 + 写草稿 + 宿主合并
        │                         │
        └───────────┬─────────────┘
                    v
             宿主工作台草稿（本地 state）
                    │ 用户确认保存
                    v
              /api/project
```

## Decisions

### D1. 技能是文件数据，契约是代码

**决定**：每个技能一个 `skills/<id>/SKILL.md`，frontmatter 声明机器字段，正文分两节：`## 角色与约束`（进入 system）和 `## 任务`（一次性生成时渲染为 prompt；聊天时作为本轮任务卡）。工具、输出校验器、锁定契约、环节运行参数放在代码注册表里，技能只按 id 引用。

**理由**：

- 文件可以在不重新构建的情况下编辑，符合“不写死”；也能进版本控制、看 diff。
- 工具必须有可执行代码，不能从文件里 eval。技能文件只做数据，边界清楚。
- 保留 system/task 两节，是为了和现有 `system: BASE` / `prompt: inline` 的结构一一对应，迁移时可以做到逐字一致，降低行为漂移。

**备选**：TS 数据模块（要构建，用户不能直接改）；全部放 DB（无法随代码分发默认值、diff 差）。都否决。

示例：

```markdown
---
name: shotlist
description: 把一集剧本拆成可直接生产的镜头表
stage: shot
runtime: json-tools
tools: [read_episode, submit_shots]
inputs: [style, aspect, brief, target]
output: shots-v1
contracts: [shots-v1]
version: 2
---
## 角色与约束
你是分镜师……（原 STORYBOARD_BASE + 拍摄守则）

## 任务
画风：{{style}}
画幅：{{aspect}}
本集内容：
{{brief}}
目标总时长 {{target}} 秒。
（原 ShotTable generate() 里的 task 说明）
```

### D2. 输入模板与两种传输

**决定**：所有占位符必须对应 frontmatter 的 `inputs`；装载器按工作台当前值渲染。一次性生成完整内联；聊天对大输入只内联引用行（例如“原著全文 12,480 字，通过 `read_source` 按集读取”），小输入（画风、画幅、目标时长）直接内联。

**理由**：当前模型协议每轮都会重发历史，把整份原著或全表镜头塞进 system/首轮，会在第 N 轮重复付费并稀释指令。引用行让模型知道输入存在、如何取，同时保持发送前可见。

**阈值**：单输入超过 2000 字符时，聊天传输退化为引用；一次性生成始终内联。阈值是运行参数，不写进技能。

**同一来源保证**：两种传输使用同一份技能正文、同一组输入键值、同一份锁定契约；测试断言核心提示词（角色 + 契约）完全一致。

### D3. 锁定契约按 id 追加

**决定**：`contracts: [shots-v1]` 由运行时解析为“校验器 + 可选锁定提示块”。用户在设置页只能改 `## 角色与约束` 和 `## 任务`，不能改 frontmatter、工具列表和契约。未知契约 id 直接拒绝加载该技能。

**理由**：输出 JSON 形状、代码 ABI、工具协议和安全规则是应用契约；让用户改会直接破坏解析和渲染。把“可编辑提示词”与“不可编辑契约”分开，才能真正既开放又安全。

契约清单（代码）：`script-v1`、`characters-v1`、`designs-v1`、`shots-v1`、`prompts-v1`、`scene3d-code-v1`。每个契约提供 JSON Schema 校验；`scene3d-code-v1` 额外提供 ABI、安全限制和输出说明的锁定块。

### D4. 装载与覆盖：文件默认 + 独立覆盖表

**决定**：`GET /api/skills` 返回“内置文件 + 用户覆盖”合并后的有效技能；覆盖存独立表 `skill_overrides(skill_id, body, base_version, updated_at)`，不写进 `AppSettings` 的单个 JSON blob，避免设置页保存时覆盖技能编辑。恢复默认删除覆盖行。

**理由**：设置页的 `rules` 是一次保存整包的 JSON，技能编辑会更频繁、单条保存更安全；独立表也便于审计版本。

**旧数据迁移**：首次加载时，若 `AppSettings.rules` 中存在与默认不同的文本，客户端用旧常量和旧规则拼出**完整的旧角色/任务文本**，写入覆盖并记录 `migratedFrom`。未改过的规则包不产生覆盖，直接使用新内置文件。迁移只做一次，保留 `presetsVersion`。

**内置升级**：内置 `version` 变化且存在用户覆盖时，设置页显示“基于旧版本的覆盖”提示和差异入口，不静默覆盖。

### D5. 唯一可写技能 + 宿主合并

**决定**：每个线程只有一个宿主技能可写；其他技能只能只读加载。写工具不直接写项目，而是调用宿主提供的 `applyDraft(payload)`，由宿主复用现有合并函数并标记未保存。

```ts
type DraftApplyResult = {
  ok: boolean
  summary: string
  counts?: Record<string, number>
  hash?: string
  error?: string
}

type WorkbenchChatAdapter = {
  surface: 'script' | 'characters' | 'assets' | 'shots' | 'prompts'
  skillId: string
  stage: Stage
  threadKey: { project: string; episode?: number }
  inputs: () => Record<string, unknown>
  ownDraft: () => unknown
  applyDraft: (payload: unknown) => DraftApplyResult
  projectSnapshot: () => Promise<ProjectData>
}
```

宿主映射：

| surface | 宿主技能 | applyDraft 复用 |
|---|---|---|
| script | `script` | 按 `no` 合并分集，保留未返回的集 |
| characters | `character` | `mergeCharacters` |
| assets | `asset` | `mergeDesigns` |
| shots | `shotlist` | `mergeGenerated` + 按 `id` + 当前集 + `handEdited` |
| prompts | `prompt` | `expandAnchors` 后按 `shot.id` 写回当前集 |

**理由**：合并语义属于工作台，不属于技能或工具。放在宿主里，聊天和手动操作共享同一套规则；工具只负责形状校验。3D 的 `onDraftCode` 已经是这个模式。

**原子性**：`applyDraft` 先完整校验再一次性替换草稿；任何一步失败返回原草稿。工具参数不完整、用户取消、模型失败都不得产生半份草稿。

### D6. 读边界：自己的产物读活草稿，上游读已保存项目

**决定**：宿主通过 `ownDraft()` 暴露当前未保存草稿；跨工作台的上游数据从 `projectSnapshot()`（已保存项目）读取。读工具在创建时绑定这组 provider，不直接 fetch `/api/project`。

**理由**：表格里常有未保存的手改。聊天如果读已保存项目，会基于旧数据提交并覆盖手改。反过来，读上游时用活草稿会让跨工作台依赖未保存状态，和“未保存不跨项目”的既有规则冲突。边界固定后，两边都可预测。

**禁止**：读工具不得跨项目、不得读画布残留、不得把未勾选素材当默认值。

### D7. 工具注册表与结果契约

**决定**：工具在代码里注册，技能按名字引用。

```ts
type ToolSpec = {
  name: string
  description: string
  schema: z.ZodType
  effects: 'read' | 'draft'
  artifact?: 'script' | 'characters' | 'designs' | 'shots' | 'prompts' | 'sceneCode'
  run: (args: unknown, ctx: ToolCtx) => Promise<ToolResult>
  ui?: string
}
```

- 宿主技能获得 `read + draft` 工具；只读技能只获得 `read` 工具。
- `ToolResult` 默认 `{ ok, summary, counts?, hash?, refs? }`；大产物不回传。
- 工具名全局唯一，例如 `submit_shots` 与 `submit_prompts` 分开；UI 按工具名注册，未注册时使用通用工具卡。
- `set_scene_code` 的参数修正式（把字面 `\n` 还原）从模型适配层移进该工具自身。

**理由**：模型适配层不应该知道任何具体工具的语义；工具自己负责参数归一化，才能让同一适配层服务六个技能。

### D8. 线程模型与持久化

**决定**：线程键如下，存储用独立表。

| surface | 线程键 |
|---|---|
| script / characters / assets | project |
| shots / prompts | project + episode |
| scene3d | project + shot |

```sql
CREATE TABLE IF NOT EXISTS chat_threads (
  id TEXT PRIMARY KEY,
  project TEXT NOT NULL,
  surface TEXT NOT NULL,
  episode INTEGER NOT NULL DEFAULT 0,
  shot_id TEXT NOT NULL DEFAULT '',
  messages TEXT NOT NULL DEFAULT '[]',
  active_skills TEXT NOT NULL DEFAULT '[]',
  updated_at TEXT NOT NULL
);
CREATE UNIQUE INDEX IF NOT EXISTS chat_threads_key
  ON chat_threads(project, surface, episode, shot_id);
```

- `messages` 只存文本、工具名、参数摘要、结果摘要、产物引用、技能 id/版本；不存帧图、视频二进制、brief 全文、代码全文。
- `active_skills` 存 `{id, mode: 'host'|'readonly', version, source}`；恢复时重新校验技能是否存在，失效则降级并显示提示。
- 项目切换按新项目加载线程；镜头/集切换按新键加载，不共享消息。
- 关闭工作台释放沙箱；运行中的本轮标记取消。重新打开恢复消息和工具摘要，不自动重跑。

**模型历史窗口**：持久化保留完整轨迹（供界面查看），但送给模型的历史只保留最近 12 轮；更早的工具结果替换为一行摘要，读工具的大段返回直接丢弃。窗口大小是运行参数。

**理由**：轨迹是排障资产，上下文是成本。两者分开处理，避免为了省钱删掉用户能看到的记录。

### D9. 通用模型适配层

**决定**：`ZCodeChatModel` 改成通用 JSON-action 适配层：

- system role = 固定协议 + 技能 `## 角色与约束` + 锁定契约。
- user prompt = 历史（不含 system）+ 本轮任务卡。
- 固定协议只包含：只输出 JSON、工具调用格式、禁止伪造结果、不输出 CoT、大产物回引用、参数必须符合 schema。
- 移除“你是 3D 场景 agent”和 `set_scene_code` 特判。
- `system` 必须是真正的 system message，不能像现在这样经 `historyPrompt` 混进 user prompt。

**理由**：这是“技能提示词真正生效”的前提。否则技能正文只是 user prompt 的一段文本，模型的实际身份仍是写死的 3D。

**环节参数**（代码）：

| stage | maxTokens | temperature |
|---|---|---|
| script | 8192 | 0.4 |
| character | 6000 | 0.3 |
| asset | 6000 | 0.3 |
| shot | 8192 | 0.3 |
| prompt | 4096 | 0.3 |
| sceneCode | 12000 | 0.3 |

### D10. 聊天壳与 3D profile

**决定**：从 `SceneAgentChat` 抽出三层：

1. `ChatThreadShell`：`AssistantRuntimeProvider`、Thread/Viewport/Composer、上下文托盘与检查器、工具卡宿主、空态、取消。
2. `useAgentRun`：消息状态、事件 reducer、Abort、运行状态。
3. `ChatToolRegistry`：按工具名注册 UI，通用卡兜底。

`SkillChat` = `ChatThreadShell` + `useAgentRun` + `json-tools` 运行器 + 宿主 adapter。
`SceneAgentChat` = `ChatThreadShell` + `useAgentRun` + `scene3d` 运行器（`runSceneAgent`、Blender deps、`agentVideoAcceptance`、专用工具卡）。

**理由**：3D 的差异不在消息渲染，而在运行器、deps 和产物类型。分享壳、保留运行器，风险最小。让 3D 走通用 stage adapter 会把视频验收塞进通用路径，反而更脆。

**3D 保留清单**（不得回退）：试运行门禁、关键帧、视觉验收及人工回退、MP4 验收、视频采用/重试、代码页签与草稿所有权、镜头隔离、取消/超时/上限。

### D11. 上下文可见性

**决定**：`ContextManifest` 增加三块：

```ts
type ContextManifest = {
  metadata: { no: string; duration: number; aspect: string }
  attachments: ContextAttachment[]
  skill: { id: string; version: number; source: 'builtin' | 'override' }
  inputs: Array<{
    key: string
    label: string
    chars: number
    mode: 'inline' | 'tool'
    required: boolean
  }>
  readAccess: string[]
}
```

- 发送前检查器展示技能来源/版本、输入键值/大小/读取方式、附加项和预计字符数。
- 技能必需输入不可移除；移除会让发送前检查失败，而不是静默改默认值。
- 可选附件可移除；移除后对应读工具返回不可用。
- 自己的草稿始终可见、不可移除。
- 每轮运行后追加一张“本轮上下文”审计卡。

**理由**：技能化会引入更多“模型看到了什么”的来源；不把技能、输入、读权限列清楚，上下文透明度会倒退。

### D12. 设置页与迁移

**决定**：设置页的“技能规则包”升级为技能列表：每个技能显示内置版本、来源（内置/用户覆盖）、可编辑正文、只读锁定契约、恢复默认、与内置版本的差异。frontmatter 字段（工具、输入、契约、环节）只读。

旧 `rules` 的迁移在客户端完成（客户端持有旧常量），迁移后写 `skill_overrides` 并设置 `skillsMigrated`。没有自定义的规则包不生成覆盖。

**理由**：客户端迁移能保证“旧文本逐字保留”，服务端不需要保留历史提示词常量。

### D13. 安全边界

- 技能文件只作为文本读取；不 eval、不动态 import、不执行。
- 技能 id 仅允许 `^[a-z0-9][a-z0-9-]{0,63}$`；只读 `skills/<id>/SKILL.md`；拒绝 `..`、绝对路径、符号链接逃逸。
- 单文件大小上限 64KB；超限拒绝加载。
- 工具来自代码白名单；技能只能引用，不能注册。
- 写工具只能作用于宿主 `artifact`；只读技能不绑定写工具。
- 线程不存 API Key、渠道鉴权头或隐藏推理；模型调用继续走 `/api/text` 代理。

### D14. 工作台聊天的 UX 层级与布局

**现状**：五个工作台共用 `SkillChat`，但首屏是技能 chip、只读技能下拉和“查看将发送”，没有助手名、编辑范围和当前模型。空态仍是 3D 的“生成代码、抓帧验收”，placeholder 仍是剧本示例。面板固定 380px、五个工作台默认展开、没有窄屏规则；检查器只列 key 和字数，写回执不区分显式保存、自动保存和立即落库。用户因此无法在首屏判断“在改什么、看到了什么、存没存”。

**决定**：把聊天从“技能控制台”改成“改稿助手”，按四层组织：

1. **身份与范围**：44px 头部显示助手名（剧本/角色/素材/镜头表/提示词助手）、范围（全剧或第 N 集）和运行状态；当前模型放在紧贴头部的上下文条里（`stageDefaultLabel`），中途换模型标注“下一轮生效”。技能 id、版本、来源收进“本轮发送内容”，不再作为首屏控件。
2. **本轮上下文**：30px 摘要条，例如“原著 8.2k 字 · 75s/集 · 近未来”；超过 2000 字的输入按 D2 变成引用行，条上必须标“按范围读取”；只读技能显示为可卸载的“参考”chip。
3. **轮次与结果**：复用 `step.turn/phase` 做轮次头（运行中显示已生成字符数，完成/失败/已停止各一态）；助手正文 13px、无气泡；读工具合并成一行可展开的“已读取 N 项”；写工具做成回执卡，显示新增/更新/保留手改和保存语义——剧本/镜头表/提示词是显式保存，角色是 1.2s 防抖自动保存，素材是立即落库。失败/取消必须写“草稿未改变”，并给重试。
4. **输入与建议**：输入框 1–6 行自适应；空态按工作台给 3 个示例，点击只预填、不发送；运行中“发送”变“停止”；加载中骨架 + 禁用；失败在对话内给重试，不只靠 toast。

**布局**：默认 400px，可拖 340–600，宽度和开合状态按工作台记忆；≥1440 首次默认打开，窄屏默认收起；≤1180 改为面板内抽屉（`min(420px, 92vw)` + scrim + 焦点陷阱），≤900 全屏 sheet。统一一个 `.workbench-chat-aside`，删除 `.sb-chat` 的重复定义；拖拽条 `role="separator"`，支持方向键和双击复位。

**视觉与可访问性**：正文 13/1.65，工具标题 12，元信息 11，10 只给时间戳和计数；助手正文不加卡，读操作不加卡，只有回执和错误加卡；只保留一个强调色；代码块用 `--code-bg`/`--code-fg` token；面板、入口和拖拽条有可访问名称，轮次状态用一个 `aria-live` 区域，Esc 关闭检查器并归还焦点，尊重 reduced motion。

**数据边界**：新增 `WORKBENCH_PROFILES`（surface → 标题、范围文案、空态、3 个示例、placeholder、保存模式），不扩 `SkillManifest` schema。五个工作台的输入仍全部来自 manifest，缺一个就阻止发送；D11 的 `required/mode` 继续只服务 3D 附件和未来可选输入，本次不做“五个工作台移除输入”。

**理由**：首屏先回答“谁、改哪一集、用什么模型、看到了什么”；把读操作降级、写操作升级，用户才能在一屏内判断这次改动是否可信；可拖拽和窄屏抽屉同时解决“对工作台太宽”和“对对话太窄”。

**非目标**：不做 chat-first 主视图；不自动附加上下文或自动发送示例；不给五个工作台分配五种强调色；不用全屏 modal 做检查器；不新增可选输入 schema。

**验收**：五个工作台 × 日/夜主题 × 1440/1280/1100/900/760 宽度；标题/范围/模型、空态/示例、轮次状态、回执保存语义、检查器实际值和总规模、拖拽/键盘/焦点归还；3D profile 的专用工具卡、验收清单、取消和线程恢复不回退。

## Risks / Trade-offs

- **提示词行为漂移** → 迁移前为五个阶段各写 golden prompt 测试：用固定输入拼装，逐字对比旧 `system + prompt`。阶段 1 保留旧常量和开关，不一致就回退。
- **system/task 分节改变模型行为** → 严格保持“角色进 system、任务进 prompt”的旧结构；真实模型 smoke 对比输出结构，不只对比字符串。
- **两套执行器漂移** → 同一份技能正文、输入来源和契约；测试断言两种传输拼接出的核心提示词一致；输出都过同一契约校验。
- **聊天覆盖手改** → 写工具只提交草稿，宿主复用 `mergeGenerated`/`handEdited`；按 `id` 不按 `no`；原子失败不落半份。
- **读旧数据** → 自己的产物读活草稿，上游读已保存项目；为“表格有未保存手改”写专门测试。
- **上下文成本** → 大输入只给引用；工具结果只回摘要；历史窗口裁剪；单线程激活技能上限 2（宿主 + 1 个只读），工具数按工作台控制在 6 个以内。
- **五处挂载不一致** → 一个 `SkillChat` + 五个 adapter；每个 adapter 只实现 inputs/ownDraft/applyDraft 三个钩子；逐工作台 smoke。
- **聊天 UI 改版影响共享壳** → 先做 P0 文案/头部，再做 P1 布局；五个工作台与 3D 一起回归；3D 专用工具卡、验收清单和视频采用不改。
- **3D 回退** → 3D 放在最后，通用壳先在其他工作台验证；`SceneAgentChat` 的旧路径保留到 parity 清单全部通过；线程恢复只做消息与引用，不重跑。
- **线程膨胀** → 持久化只存摘要和引用；单线程消息数与总字节设上限，超出时从最旧的工具大结果开始折叠，并在界面标注。
- **技能文件被误当脚本** → 数据-only 加载、大小/路径校验、UI 明确“新增写能力必须注册工具”。

## Migration Plan

**阶段 1：技能数据层（不碰聊天）**

- 新建 `skills/*/SKILL.md`，用旧常量逐字填充；新增装载器、契约注册表、`GET /api/skills`、`skill_overrides` 表。
- 五个工作台的 `generate()` 改为读技能并渲染；保留旧常量和 `skillPrompts` 开关。
- 写 golden prompt 测试；迁移旧 `rules`。
- 回滚：关闭开关，恢复旧常量路径；覆盖表不影响运行。

**阶段 2：通用模型层 + 聊天壳（只接剧本）**

- 通用化 `ZCodeChatModel`，抽出 `ChatThreadShell`、`useAgentRun`、`ChatToolRegistry`。
- 实现 `SkillChat` 与剧本 adapter；新增 `chat_threads` 表。
- 验收：剧本生成与聊天共用技能；草稿合并；线程恢复；取消不落半份。
- 回滚：隐藏剧本聊天入口；生成按钮不受影响。

**阶段 3：其余四个内容工作台**

- 依次接角色、素材、镜头表、提示词；每个工作台独立开关。
- 每个 adapter 接现有合并函数；镜头表/提示词按集建线程。
- 验收：手改保留、按 id 合并、读活草稿、只读技能不出现写工具。

**阶段 3.5：工作台聊天 UI 层级（P0/P1）**

- 先落 P0：surface profile、头部/范围/模型、空态与示例、统一入口、移除技能横幅。
- 再落 P1：轮次块、写回执、全高检查器、可拖拽面板与窄屏抽屉。
- 验收：五个工作台 × 日夜主题 × 五档宽度；3D 共享壳回归。
- 回滚：保留旧头部和固定 380 分支一个版本；profile 可关闭。

**阶段 4：3D 归位**

- 抽出聊天壳并让 `SceneAgentChat` 复用；`scene3d` 技能上线（角色层可编辑、ABI/安全锁定）。
- 3D 线程按镜头持久化；关闭释放沙箱、恢复消息与引用。
- 验收：现有 `verify-agent-*` 全部通过；视频验收、代码门禁、镜头隔离不回退。
- 收尾：删除旧聊天壳重复代码、旧提示词常量和开关。

**兼容**：所有迁移幂等；`skill_overrides` 和 `chat_threads` 均为新增表；旧项目与旧设置可回退。没有破坏性数据迁移。

## Alternatives Considered

- **A 全局单线程聊天**：跨阶段连续性好，但需要共享草稿层，且 3D 的镜头隔离会被稀释。用户已选 B；B 的壳和技能数据在以后要转 A 时可复用。
- **技能放 TS 模块**：类型安全，但用户改提示词要重新构建，不满足“不写死”。
- **技能全部放 DB**：默认可编辑，但默认值无法随代码分发和 code review；文件 + 覆盖更合适。
- **所有阶段都走 agent 循环**：统一，但简单生成的成本会翻倍；保留一次性按钮。
- **每轮注入完整技能全文**：简单，但正是 `knowledge.ts` 注释里警告的成本陷阱；两级加载 + 大输入引用更稳。
- **模型自动加载技能**：更“智能”，但技能正文就是 system prompt，自动加载会绕过发送前可见；改为用户确认。
- **工具直接写项目**：省掉 adapter，但会绕过审阅和手改保护；否决。

## Open Questions

无。历史上限、技能激活上限、大输入阈值都是运行参数，可在实现后按实测调整，不改变规格或任务拆分。
