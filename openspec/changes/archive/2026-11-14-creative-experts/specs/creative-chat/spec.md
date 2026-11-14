# Spec Delta

## ADDED Requirements

### Requirement: 创意会话专家与自动技能目录双模式

创意工作室 SHALL 支持两种互斥的 Pi 约束模式：（1）**无专家**：默认自主发现技能，可选用顶栏「偏好」Agent 包，并可使用 `list_installed_skills`；（2）**有专家**：按 `creative-experts` 能力约束 system、技能与工具。用户 MUST 可通过顶栏专家下拉切回「无（技能目录）」恢复（1）。

#### Scenario: 无专家等同原自动模式

- **WHEN** 专家下拉为「无」
- **THEN** 使用 `buildCreativePiSystem` 与偏好技能逻辑，与未引入专家前行为一致

#### Scenario: 有专家覆盖自主壳

- **WHEN** 用户选择内置或自定义专家
- **THEN** 创意对话 MUST NOT 使用 `buildCreativePiSystemAutonomous` 拼接段落作为 system