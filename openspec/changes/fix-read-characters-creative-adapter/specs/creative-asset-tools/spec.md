# Spec Delta

## ADDED Requirements

### Requirement: 创意会话的细粒度读工具读项目快照

创意会话中，`read_characters` 与 `read_designs` SHALL 返回当前项目快照里的角色表与设定卡；系统 MUST NOT 因会话没有「活草稿」而跳过项目读取并返回空集合。空集合 MUST 只表示项目确实没有该数据。

#### Scenario: 界面有角色时读角色非空

- **WHEN** 当前项目角色板已有 3 个角色，agent 在创意会话调用 `read_characters`
- **THEN** 返回 `ok: true` 且 `characters` 含这 3 条记录，字段与项目快照一致

#### Scenario: 项目确实没有角色

- **WHEN** 当前项目未写入任何角色，agent 调用 `read_characters`
- **THEN** 返回 `ok: true`、`characters: []` 与 `total: 0`，不返回错误

#### Scenario: 设定卡同源读取

- **WHEN** 当前项目已有场景与道具设定卡，agent 调用 `read_designs`
- **THEN** 返回当前项目的设定卡，且 `kind` / `names` 过滤语义不变

### Requirement: 未选项目时读工具返回可读错误

创意会话未绑定项目时，`read_characters` 与 `read_designs` MUST 返回可读的「需要先选择项目」类失败，MUST NOT 以成功响应返回空数组。

#### Scenario: 未选项目调用读角色

- **WHEN** 顶栏未选项目，agent 调用 `read_characters`
- **THEN** 返回 `ok: false` 并提示先选择项目或使用项目清单工具

### Requirement: 角色读取的过滤与返回形状不变

修正数据来源后，`read_characters` SHALL 保留既有参数与返回形状：`names` 过滤、`characters` / `total` / `truncated` / `note` 字段，以及超限时的整条装填与截断标记。MUST NOT 改变这些语义。

#### Scenario: 按名过滤仍生效

- **WHEN** agent 调用 `read_characters` 并传入 `names: ["角色3"]`
- **THEN** 只返回名为「角色3」的角色

#### Scenario: 超限仍可解析

- **WHEN** 项目角色数超过读取上限
- **THEN** 响应标记 `truncated` 并给出总数，`characters` 中每条仍是完整对象而非半截 JSON
