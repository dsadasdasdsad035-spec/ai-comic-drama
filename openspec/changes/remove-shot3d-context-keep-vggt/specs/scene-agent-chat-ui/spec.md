# Spec Delta

## MODIFIED Requirements

### Requirement: 现有参考内容与输入框保持可用

3D 调度聊天 SHALL 保留输入框与发送能力。附件（若有）MUST 为会话级清单，与输入区 unified 附件条一致；MUST NOT 再显示或编辑按镜头持久化的 `shot_3d_context` chips。发送前 MUST 仅使用本轮显式附件与用户文字，MUST NOT 静默注入镜头表 prompt、cast 或未选素材。

#### Scenario: 已选 chips

- **WHEN** 用户打开聊天
- **THEN** 不显示来自 `shot_3d_context` 的 chips；若有会话附件则以 chips 显示并可移除

#### Scenario: 发送前移除

- **WHEN** 用户移除一个会话附件 chip 后发送
- **THEN** 本次 agent 上下文不包含该素材

#### Scenario: 输入框

- **WHEN** agent 未运行
- **THEN** 用户可输入并发送，支持键盘快捷键
