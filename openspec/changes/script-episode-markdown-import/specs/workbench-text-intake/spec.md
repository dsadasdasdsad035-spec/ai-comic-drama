# Spec Delta

## MODIFIED Requirements

### Requirement: 解析按成本从低到高选择路径

系统 SHALL 先尝试零模型的解析路径：内容本身符合目标契约时直接通过契约校验，结构化表格按表头映射为契约形状，分集剧本导入时符合 short-drama 场次标题约定的 Markdown 按场切分并映射为 `script-v1`。只有上述路径都不成立时，才 SHALL 在**画布分镜或提示词**等仍支持整理的入口为用户提供请模型结构整理的选项。系统 MUST NOT 在零模型路径可用时自动调用模型。分集剧本导入入口 MUST NOT 提供「让模型整理」选项。

#### Scenario: 文件就是契约

- **WHEN** 用户在画布导入的 JSON 内容符合目标环节的输出契约
- **THEN** 系统直接进入预览，不发起任何模型请求

#### Scenario: 表格可以直接映射

- **WHEN** 用户在画布导入含可识别表头的表格
- **THEN** 系统按表头映射生成契约形状并进入预览，不发起模型请求

#### Scenario: 分集剧本 Markdown 可按场切分

- **WHEN** 用户在分集目录导入含至少一个合法 short-drama 场次标题的 Markdown
- **THEN** 系统按场生成 `script-v1` 形状并进入预览，不发起任何模型请求

#### Scenario: 无法结构化

- **WHEN** 用户在画布导入的内容既不是契约 JSON、也不是可识别表格、也不适用提示词专用路径
- **THEN** 系统显示「让模型整理」选项与将使用的环节模型，等待用户主动点击后才发起请求

### Requirement: 文本工作台提供导入入口

剧本与画布两个视图 SHALL 各自提供「导入」入口。分集目录的剧本导入 MUST 仅支持 Markdown 文件（`.md` / `.markdown`）或粘贴的 Markdown 文本；MUST NOT 在该入口接受 JSON 或纯 `.txt`。画布导入 MUST 继续支持表格、JSON 与粘贴文本。画布导入 MUST 同时支持仅含分镜列、仅含提示词列、或结构与提示词兼有的文件。提示词-only 内容 MUST 在画布导入流程中处理。分集剧本与画布导入入口 MUST NOT 要求先经过模型；MUST 在未选择项目时不可用并说明原因。

#### Scenario: 上传文件

- **WHEN** 用户在有项目的画布点击「导入」并选择一个表格文件
- **THEN** 系统读取该文件并进入解析与预览流程，不要求用户先点生成

#### Scenario: 粘贴文本

- **WHEN** 用户把一段分镜文本粘贴进画布导入框并确认
- **THEN** 系统以同样的解析与预览流程处理该文本

#### Scenario: 分集剧本上传 Markdown

- **WHEN** 用户在有项目的分集目录点击「导入剧本大纲」并选择 `.md` 文件
- **THEN** 系统读取该文件并进入 short-drama Markdown 解析与预览，不要求配置文本模型

#### Scenario: 分集剧本拒绝非 Markdown 文件

- **WHEN** 用户在分集剧本导入入口选择 `.json` 或 `.txt`
- **THEN** 系统拒绝该文件并说明仅支持 Markdown，不进入预览

#### Scenario: 画布导入纯提示词表

- **WHEN** 用户在画布上传只含镜号与首帧提示词两列的表格
- **THEN** 预览标明只更新提示词列，应用后分镜结构字段保持原值

#### Scenario: 没有项目

- **WHEN** 用户尚未选择项目时查看导入入口
- **THEN** 导入入口不可用，并显示先选择项目的提示

## ADDED Requirements

### Requirement: 分集剧本场次标题必须符合 short-drama 语法

分集剧本 Markdown 导入 SHALL 以二级标题 `## <场景 ID> <内|外|内外> · <地点> · <时间>` 划分场次。场景 ID MUST 匹配 `EP` 集号与 `SC` 场号（允许可选季前缀，如 `S01-EP001-SC001`）。地点与时间 MUST 非空；否则整次导入 MUST 拒绝并指出首个不合规标题行。

#### Scenario: 合法场次标题

- **WHEN** 文件含 `## EP002-SC001 内 · 咖啡厅 · 日`
- **THEN** 解析出场次 slug 为场景 ID、place 为「咖啡厅」、time 为「日」

#### Scenario: 缺地点或时间

- **WHEN** 某场次标题为 `## EP001-SC002 外 · 街道` 且没有第三个分段
- **THEN** 整次导入被拒绝，错误信息引用该标题行

#### Scenario: 没有任何场次标题

- **WHEN** Markdown 不含任何可识别的 short-drama 场次标题
- **THEN** 整次导入被拒绝，说明需要 `## EP001-SC001 内 · 地点 · 时间` 格式

### Requirement: 场次正文原样进入 beats

每个场次从标题下一行起至下一场次标题（或文件结束）的正文 MUST 原样拼接为 `beats` 字符串。系统 MUST NOT 改写对白、MUST NOT 删改制作标签（如 `[VO]`、`[OS]`），MUST NOT 为通过校验而编造情节。

#### Scenario: 对白与标签保留

- **WHEN** 某场正文含 `陈默：你来了。` 与 `[VO] 系统：任务更新`
- **THEN** 导入后该场 `beats` 仍包含上述原文，顺序不变

### Requirement: 集号与场号从场景 ID 映射

系统 SHALL 从场景 ID 解析集号 `no` 与场 `no`（`EP003` → 3，`SC002` → 2）。集标题 `# EP003 集名` 存在时 SHALL 写入该集 `title`。单文件仅一集且场景 ID 与「建议集号」冲突时 MUST 在预览中显式提示并以场景 ID 为准。

#### Scenario: 单集文件

- **WHEN** 文件仅含 `EP001` 前缀的场次且有一级标题 `# EP001 开篇`
- **THEN** 预览显示导入 1 集、title 为「开篇」或等价解析结果

#### Scenario: 仅含部分集

- **WHEN** 文件只含 `EP002` 的场次
- **THEN** 应用后仅更新或新增第 2 集，其他集保留

### Requirement: 合体 Markdown 中分镜表不进入剧本导入

当同一份 Markdown 既含 short-drama 场次标题又含镜号表头分镜表时，分集剧本导入 MUST 只处理剧本场次，MUST 忽略分镜表块。预览 MUST 说明已忽略分镜表，并提示分镜须通过画布导入。

#### Scenario: 剧本与分镜同框

- **WHEN** 文件在场次正文后含首列为「镜头」的 Markdown 表格
- **THEN** 剧本预览仍成功，并列出「已忽略 N 处分镜表，请用画布导入」类说明