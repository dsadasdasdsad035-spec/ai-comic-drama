# Spec Delta

## ADDED Requirements

### Requirement: 3D 调度聊天附件不落库镜头参考

3D 调度工作台的聊天附件 MUST 仅作用于当前聊天会话或线程，MUST NOT 写入镜头的 `shot_3d_context` 或等价持久化字段。关闭工作台或刷新页面后，除非线程级存储另有定义，附件 MAY 不自动恢复。

#### Scenario: 关闭工作台

- **WHEN** 用户关闭 3D 工作台未保存镜头
- **THEN** 项目 JSON 不因聊天附件新增 `shot_3d_context`

#### Scenario: 保存镜头

- **WHEN** 用户保存 3D 代码
- **THEN** 保存 payload 不包含聊天附件或 `shot_3d_context`
