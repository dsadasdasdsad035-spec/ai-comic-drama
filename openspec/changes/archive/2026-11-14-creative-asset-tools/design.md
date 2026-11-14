# Design

## Context

物料分散在四个相互独立的形状里，没有统一 id：

| 分类 | 数据源 | 稳定标识 | 体量 |
|---|---|---|---|
| `characters` | `project.characters` | `id`（`CharacterSheet.id`） | 小 |
| `scenes` / `props` | `project.designs`（`kind` 区分） | `id`（`DesignSheet.id`） | 中 |
| `assets` | `project.assets` | **无 id，只有 `url`** | 中～大 |
| `whitebox` | `project.lexiconWhitebox` | `id`（`LexiconWhiteboxSheet.id`） | `sceneCode.code` 可达上千行 |

读工具通过 `WorkbenchChatAdapter.projectSnapshot()` 拿项目快照（`createStageToolSet`），创意会话由 `createReadAdapter` 注入，已带缓存与 `getProject()` 回源。运行时对模型可见内容做裁剪的唯一入口是 `modelFacingResult()`，但那只处理 `run_render` / `capture_frames`；物料工具应在自身返回里就控制体积，而不是依赖该函数。

## Goals / Non-Goals

**Goals:**

- 一次调用回答"项目里有什么"，成本与项目规模无关（默认只回计数）。
- 两次调用内从"有这个东西"走到"它的完整记录"。
- 白模代码永不因为"顺手带上"而挤爆上下文。

**Non-Goals:**

- 不做跨项目聚合；工具始终只读当前顶栏项目。
- 不接管 `read_shots`、分镜成片或磁盘媒体目录。
- 不提供看图能力；素材只回路径。

## Decisions

### 1. 聚合两级：`inventory` + `detail`，而不是一类一工具

新增 `read_asset_inventory` / `read_asset_detail` 两个工具，覆盖五个分类。

- **为什么不按分类拆成五个 `read_*`**：分类是封闭集合，拆开会把 5 个工具名塞进每个专家的白名单与设置页分组，而它们的参数形状完全相同（`category` + 过滤）。一个 `category` 枚举比五个名字更容易被模型正确选择。
- **为什么不只做一个"全量 dump"**：`assets` 与 `whitebox` 的体量不受控，全量返回必然触发截断，模型拿到的还是残缺数据。
- **为什么不复用 `read_designs` 加 `includeAssets`**：`designs` 是场景/道具设定卡（发布前工作区），`assets` 是素材库（含视频/音频/表情总图），两者在项目里是并行数据源（见 `ProjectData` 注释）。合并会长期含混，且破坏既有 `read_designs` 的过滤语义。

### 2. key 由 inventory 生成并原样回传

`read_asset_inventory` 的每一行都带 `key`；`read_asset_detail` 只接受这个 `key`，不要求模型自己拼。

- 素材卡没有 id，`key` 取 `url`。
- 其余分类 `key` 取各自 `id`。
- **为什么不在 detail 里用 `ref="kind:id"` 字符串**：模型拼串容易出错，而错法（比如用 `title` 代替 `id`）不会报错、只会静默查不到。把拼装责任留在服务端，detail 只需 `category` + `key` 两段。
- 代价：`key` 在不同分类可能重名（例如角色 id 与设计 id 恰好相同）。因为 `category` 是必填参数，不存在歧义。

### 3. 白模代码默认不加载，显式请求且截断

`read_asset_detail` 的 `includeCode` 默认 `false`。

- 默认返回 `title` / `seconds` / `motionNote` / `hasVideo` / `codeHash` / `codeChars`，足以判断"这条白模是不是我要的"。
- `includeCode: true` 时返回代码，超过 20000 字符截断，并在响应里同时给出 `truncated: true` 与 `chars`（原始长度）。选 20000 而不是沿用 `boundJson` 的 8000，是因为白模代码的最小可用单元是一整段 `build_scene()` 函数，切在函数中间没有价值；宁可让调用方明确看到"被截断了，要分段读"，也不要给一段无法使用的残片。
- **为什么不新增 `read_whitebox_code` 单独工具**：那会让 `whitebox` 分类在 inventory 里出现两种读取路径，模型需要先判断"要不要第二个工具"。`includeCode` 一个布尔开关更简单。

### 4. 内置运镜库只给计数

`inventory` 返回 `counts.cameraLexicon`，并在提示里指向 `list_camera_lexicon`。

- 内置预置库是静态资源（`cameraLexicon.ts` 打包进前端），全项目通用，不属于"项目物料"。
- 但它常被模型误认为"项目里有白模"，所以给出条数 + 明确指引，避免模型把预置库和 `whitebox` 混为一谈。

### 5. 过滤参数保持最小

`inventory` 只提供 `category` / `includeRows` / `kind` / `q` / `limit`。不提供排序、分页 offset、字段选择。

- 排序对"有什么"没有帮助；`limit` 截断时返回总数，已经够判断要不要收窄 `q`。
- `kind` 只在 `assets` 上有意义；其它分类传入时忽略而非报错，避免模型为了"保险"每次都传。

### 6. 工具注册三处，行为一处

工具实现写在 `stageTools.ts` 的 `createStageToolSet` 内（与其它 read 工具同处），并通过 `readByName` 注册；`builtinPlatformTools.ts` 的 `builtinPlatformToolNames()` 只加名字，不重复实现。

- 专家设置页的 `ALL_PLATFORM_TOOLS` 直接吃 `builtinPlatformToolNames()`，因此加名字即自动出现在「读项目」分组。
- `KNOWN_TOOL_IDS` 加名字后，`read_` 前缀会自动进 `READ_TOOL_IDS`，只读技能拿不到写工具这条规则无需改动。

## Risks / Trade-offs

- **[key 用 url，素材卡改名即失效]** → `url` 是素材卡唯一的稳定字段，且素材卡不随项目重命名变化；inventory 每次都实时返回 `key`，模型不使用跨轮缓存的 key 即可规避。
- **[默认只回计数可能导致模型多跑一轮]** → 用返回里的 `next` 提示明确告诉模型下一步调什么，把"多一轮"变成"有指引的一轮"；对比全量 dump 省下的 token，这笔交换是值得的。
- **[20000 字符仍可能不够]** → 响应同时给 `chars` 与 `truncated`，模型可据此告知用户代码过长、需要人工查看。不引入分页，避免把简单读取变成协议。
- **[新增工具名进入所有专家白名单，可能稀释工具选择]** → 两个工具名语义明确（inventory / detail），且只在需要盘点时才有价值；既有细粒度工具保留，模型有明确的两条路可选。
- **[`read_shots` 截断仍在]** → 本变更明确不含镜头；用户在探索阶段确认"视频"只指素材卡。该问题留给独立变更，不在此处顺手改动，避免范围蔓延。

## Open Questions

- `q` 的匹配是否需要覆盖 `assets.note` 与 `tags`？当前按标题匹配，若实际使用中发现按备注找不到素材，再扩展。
