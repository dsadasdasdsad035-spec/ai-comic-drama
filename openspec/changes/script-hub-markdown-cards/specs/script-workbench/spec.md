# Spec Delta: script-workbench

## MODIFIED Requirements

### Requirement: 剧本主区域只展示分集结构

剧本视图（`script`）主内容区 SHALL 以**分集卡片墙**展示项目的全部集次（`episodes` 与镜头归属集的并集），支持搜索与状态摘要。主区域 MUST NOT 提供原著全文、logline 表单或场次级结构化编辑表单。用户选择某一集后 SHALL 进入该集的详情层，以 Markdown 预览阅读剧本与分镜文档。

#### Scenario: 打开剧本页

- **WHEN** 用户进入剧本视图且项目已加载
- **THEN** 主区域显示分集卡片墙（或空态），不出现左栏原著/logline 编辑区

#### Scenario: 手改分集仍可用

- **WHEN** 用户需要修改场次 beats 或标题
- **THEN** 系统通过导入 short-drama Markdown 或创意 Agent `submit_episodes` 写回项目，MUST NOT 在主区域提供场次级表单编辑

### Requirement: 拆集生成入口仅在 Agent

系统 MUST NOT 在剧本视图上下文带或工具条提供「生成分集 / 重新生成分集」按钮。从零拆集与改稿 MUST 经创意工作室 Agent 调用 `submit_episodes`（或等价契约）写回 `project.episodes`；写回后剧本视图 MUST 在不刷新的情况下反映最新数据（经项目重载或宿主刷新）。

#### Scenario: 顶栏无拆集按钮

- **WHEN** 用户查看剧本视图上下文带的动作区
- **THEN** 不出现「生成分集」或「重新生成分集」强调或非强调按钮

#### Scenario: 聊天内置拆集

- **WHEN** 用户在创意 Agent 中运行分集生成且项目已绑定、具备可用文本模型与输入
- **THEN** 分集写入 `project.episodes`，剧本视图卡片墙反映更新

#### Scenario: 对话改稿

- **WHEN** 用户在创意 Agent 输入改稿要求且模型调用提交工具返回合法剧本 JSON
- **THEN** 分集按既有 merge 规则合并进项目，剧本视图预览随项目数据更新

### Requirement: 空态与提示指向 Agent

剧本卡片墙在无分集时 SHALL 提示用户前往创意工作室生成分集，或使用「导入剧本大纲」粘贴 short-drama Markdown；MUST NOT 指引已移除的顶栏拆集或左栏原著表单。

#### Scenario: 无分集空态

- **WHEN** 项目尚无 `episodes` 登记且未导入
- **THEN** 空态说明可通过创意 Agent 生成分集或导入 Markdown 大纲

## REMOVED Requirements

### Requirement: 顶栏仍提供拆集参数

**Reason**：拆集参数已集中在设置页与创意任务卡，剧本视图不再承载模型/集数表单。  
**Migration**：依赖创意工作室与项目设置中的环节模型与目标集数；验收改查创意入口而非剧本顶栏。

## ADDED Requirements

### Requirement: 剧本中心提供导入大纲主入口

系统 SHALL 在剧本视图工具条提供「导入剧本大纲」，复用分集剧本 Markdown 零模型解析（`parseScriptMarkdown`）与 `planScriptImport` 合并逻辑。该入口 MUST 为项目内导入分集剧本的**主入口**；画布集目录 MUST NOT 再提供同等的导入剧本大纲主按钮（MAY 保留深链至剧本视图）。

#### Scenario: 剧本视图导入

- **WHEN** 用户在剧本视图导入合法 short-drama Markdown 并确认
- **THEN** 对应 `episodes` 写入当前项目，卡片墙立即反映新场次

#### Scenario: 非 Markdown 拒绝

- **WHEN** 用户上传非 `.md` 文件到剧本导入
- **THEN** 系统拒绝并提示仅支持 Markdown

### Requirement: 集详情提供剧本 Markdown 预览

集详情 SHALL 提供「剧本」tab，将当前集 `episodes` 结构渲染为 short-drama 剧本 Markdown（场次标题 `## EPxxx-SCxxx 内 · 地点 · 时间` 与 beats 正文）并以只读 Markdown 预览展示。预览 MUST 使用与聊天一致的 Markdown 渲染栈。系统 MUST 提供「复制 Markdown」或等价动作。

#### Scenario: 有场次时预览

- **WHEN** 该集存在至少一场且 beats 非空
- **THEN** 预览中可见对应场次标题与正文，层级与导入格式一致

#### Scenario: 缺剧本空预览

- **WHEN** 该集无场次或仅有空壳分集记录
- **THEN** 预览区说明缺剧本，并指向导入或创意 Agent

### Requirement: 集详情提供分镜 Markdown 预览

集详情 SHALL 提供「分镜」tab，用现有分镜导出逻辑生成当前集 Markdown（含场次摘要与分镜表）并只读预览。该 tab MUST NOT 提供表格编辑；改镜 MUST 经画布或分镜 Agent。

#### Scenario: 分镜 tab 只读

- **WHEN** 用户切换到分镜 tab
- **THEN** 显示当前集 `episodeMarkdown` 输出，不出现可编辑单元格

#### Scenario: 进画布深链

- **WHEN** 用户点击「进画布」
- **THEN** 导航至画布该集单集阶段（或概览约定的进集规则），`epNo` 设为该集

### Requirement: 剧本 Markdown 渲染与导入互逆

系统 SHALL 提供从 `ProjectEpisode` 生成 short-drama 剧本 Markdown 的纯函数，与 `parseScriptMarkdown` 在场次标题、集号与 beats 正文上互逆（往返后契约校验通过）。该输出供预览与复制，不单独持久化文件。

#### Scenario: 往返校验

- **WHEN** 对样例集执行 render → parse → validate `script-v1`
- **THEN** 校验通过且场数与 beats 一致