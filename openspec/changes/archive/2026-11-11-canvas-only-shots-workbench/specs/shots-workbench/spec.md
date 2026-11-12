# shots-workbench Specification (delta)

## REMOVED Requirements

### Requirement: 镜头表展示并编辑提示词列

**Reason**: 镜头表视图下线，分镜字段与两列提示词的可见编辑面改为画布单镜 Inspector 与画布内 Agent，不再保留全集表格列编辑。

**Migration**: 首帧与视频提示词的查看与手改改在画布 Inspector 的对应字段；批量写回改经画布 Agent 的 `submit_shots` / `submit_prompts`。手改保护（`handEdited`）语义不变，迁移后仍按字段生效。

### Requirement: 镜头表不提供独立批量「生成提示词」顶栏

**Reason**: 该要求只约束已下线的镜头表顶栏；「不设独立提示词视图」这一意图已由 `workbench-shell` 的导航要求与 `canvas-shots-workbench` 承担。

**Migration**: 无独立提示词视图；提示词生成只经画布 Agent。用户侧无额外操作，原有顶栏入口本来就不存在。

### Requirement: 锚点与推画布校验

**Reason**: 「从镜头表推送到画布」的动作随视图一起下线，画布改由导入与 Agent 写回后自动水合；同时空首帧不再阻止镜头进入画布。

**Migration**: 出图与出片仍要求首帧提示词非空，由画布单镜与批量入口各自拦截；锚点解析状态的展示改在画布 Inspector 与集级摘要中呈现。

## MODIFIED Requirements

### Requirement: 拆镜同次产出两列提示词

画布分镜 Agent MUST 使用 `shotlist` 技能并通过 `submit_shots` 写回。模型输出 MUST 为 `shots-v1` 形状且每镜含非空的 `keyframe_prompt` 与 `video_prompt`（聊天路径）。宿主 MUST 在写回前将首帧中的 `{{角色名}}` 占位展开为角色 bible 的 `look_en`；存在无法展开的占位时 MUST 在回执中报告未解析数量。

#### Scenario: 成功拆镜带提示词

- **WHEN** Agent 提交一集 4 镜且每镜含结构字段与两列提示词
- **THEN** 画布出现 4 镜，且每镜两列提示词已展开锚点并写入项目

#### Scenario: 缺提示词列

- **WHEN** Agent 提交的某一镜缺少 `video_prompt`
- **THEN** 系统仍写入其余字段，回执 MUST 标明缺列镜号，并提示用户补写或重试

### Requirement: 只重写提示词的次路径

系统 SHALL 允许在画布分镜 Agent 中通过 `prompt` 技能与 `submit_prompts` 仅更新 `keyframe_prompt` / `video_prompt`，MUST NOT 要求单独的顶栏提示词视图。该路径 MUST 使用 `mergePromptDraft` 语义，只改提示词列。

#### Scenario: 角色 bible 变更后只刷提示词

- **WHEN** 用户在画布聊天要求只重写本集提示词且 Agent 提交 `prompts-v1`
- **THEN** 分镜结构字段与画布节点不变，提示词列按镜号更新
