# Spec Delta

## ADDED Requirements

### Requirement: Agent 只读查询运镜 catalog

镜头表与提示词工作台 Agent SHALL 提供只读工具查询 catalog（按关键词、move、size、category），返回 `key`、`cn`、`en`、`url`、`sectionTitle`，MUST NOT 修改项目数据。

#### Scenario: 按运镜查库

- **WHEN** Agent 调用查询且 `move=推`
- **THEN** 响应包含 `01_dolly_in` 及至少一条相关进阶条目

#### Scenario: 按景别查语法

- **WHEN** Agent 查询 `size=特写`
- **THEN** 响应包含 `104_close_up_push` 或标记为 `primaryForSize` 的条目
