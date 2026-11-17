# Spec Delta

## MODIFIED Requirements

### Requirement: 拆镜同次产出两列提示词

画布分镜 Agent MUST 使用 `shotlist` 技能并通过 `submit_shots` 写回。模型输出 MUST 为 `shots-v1` 形状且每镜含非空的 `keyframe_prompt` 与 `video_prompt`（聊天路径）。系统 SHALL 允许分多批提交同一集的分镜，每批 MUST 是合法的 `shots-v1` 子集并按镜号合并；分批写回与一次写回 MUST 在画布镜数、顺序与字段取值上等价。宿主 MUST 在写回前将首帧中的 `{{角色名}}` 占位展开为角色 bible 的 `look_en`；存在无法展开的占位时 MUST 在回执中报告未解析数量。

#### Scenario: 成功拆镜带提示词

- **WHEN** Agent 提交一集 4 镜且每镜含结构字段与两列提示词
- **THEN** 画布出现 4 镜，且每镜两列提示词已展开锚点并写入项目

#### Scenario: 缺提示词列

- **WHEN** Agent 提交的某一镜缺少 `video_prompt`
- **THEN** 系统仍写入其余字段，回执 MUST 标明缺列镜号，并提示用户补写或重试

#### Scenario: 分批写回与一次写回等价

- **WHEN** Agent 把同一集 12 镜分成三批提交，每批带上一批回执给出的后续批次入口
- **THEN** 画布最终为 12 镜且顺序与一次写回一致，每镜两列提示词均已展开锚点

#### Scenario: 分批时镜号冲突

- **WHEN** 后一批提交的镜号与前一批已写入的镜号重复
- **THEN** 该镜按后一批内容覆盖字段，不产生重复镜头，回执标明新增与更新条数
