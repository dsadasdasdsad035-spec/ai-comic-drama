# shots-workbench Specification

## Purpose
定义分镜的产生与写回：经 Agent 一次拆镜产出分镜结构与首帧/视频提示词，写回项目后由画布呈现与编辑，供下游出图出片。

## Requirements

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
