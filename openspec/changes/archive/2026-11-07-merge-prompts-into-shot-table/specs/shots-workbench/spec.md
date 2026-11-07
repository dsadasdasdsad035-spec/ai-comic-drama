## Purpose

定义镜头表工作台：在同一视图编辑分镜结构与首帧/视频提示词，经 Agent 一次拆镜产出可出图提示词，并推送到画布或下游出片。

## ADDED Requirements

### Requirement: 镜头表展示并编辑提示词列

系统 SHALL 在镜头表为每镜提供 `keyframe_prompt` 与 `video_prompt` 的可见编辑区。编辑 MUST 与分镜字段同属一条镜头草稿，经同一保存动作写入项目。用户手改两列时 MUST 记入 `handEdited`，重新拆镜合并时 MUST 保留手改列直到用户清除手改保护。

#### Scenario: 保存含提示词

- **WHEN** 用户在镜头表修改某镜首帧提示词并点保存
- **THEN** 项目数据中该镜 `keyframe_prompt` 更新，且该字段出现在 `handEdited` 中

#### Scenario: 重拆镜保留手改提示词

- **WHEN** 某镜 `keyframe_prompt` 已手改且用户经 Agent 重新提交全集拆镜
- **THEN** 该镜手改的首帧提示词不被模型输出覆盖

### Requirement: 拆镜同次产出两列提示词

镜头表 Agent MUST 使用 `shotlist` 技能并通过 `submit_shots` 写回。模型输出 MUST 为 `shots-v1` 形状且每镜含非空的 `keyframe_prompt` 与 `video_prompt`（聊天路径）。宿主 MUST 在写回前将首帧中的 `{{角色名}}` 占位展开为角色 bible 的 `look_en`；存在无法展开的占位时 MUST 在回执中报告未解析数量。

#### Scenario: 成功拆镜带提示词

- **WHEN** Agent 提交一集 4 镜且每镜含结构字段与两列提示词
- **THEN** 镜头表显示 4 镜，且每镜两列提示词已展开锚点并处于未保存草稿态

#### Scenario: 缺提示词列

- **WHEN** Agent 提交的某一镜缺少 `video_prompt`
- **THEN** 系统仍写入其余字段，回执 MUST 标明缺列镜号，并提示用户补写或重试

### Requirement: 锚点与推画布校验

镜头表 MUST 显示首帧提示词的锚点解析状态（或等价摘要）。用户从镜头表推送到画布时，对将要推送的镜头 MUST 沿用「首帧提示词非空」等业务规则，不得因取消提示词视图而放宽。

#### Scenario: 空首帧阻止推画布

- **WHEN** 当前集存在将要推送且 `keyframe_prompt` 为空的镜头
- **THEN** 推送被阻止并说明须先填写首帧提示词

#### Scenario: 未解析锚点可见

- **WHEN** 某镜首帧仍含无法匹配的 `{{角色名}}`
- **THEN** 镜头表对该镜显示未解析锚点状态

### Requirement: 只重写提示词的次路径

系统 SHALL 允许在镜头表 Agent 中通过 `prompt` 技能与 `submit_prompts` 仅更新 `keyframe_prompt` / `video_prompt`，MUST NOT 要求单独的顶栏提示词视图。该路径 MUST 使用 `mergePromptDraft` 语义，只改提示词列。

#### Scenario: 角色 bible 变更后只刷提示词

- **WHEN** 用户在镜头表聊天要求只重写本集提示词且 Agent 提交 `prompts-v1`
- **THEN** 分镜结构字段不变，提示词列按镜号更新

### Requirement: 镜头表不提供独立批量「生成提示词」顶栏

镜头表 MUST NOT 提供与原提示词工作台顶栏等价的「生成提示词」主按钮；拆镜与写提示词的主路径 MUST 为 Agent `shotlist` 提交。次路径不得占用全局导航。

#### Scenario: 无顶栏生成提示词

- **WHEN** 用户打开镜头表视图
- **THEN** 上下文带不出现「生成提示词」强调按钮
