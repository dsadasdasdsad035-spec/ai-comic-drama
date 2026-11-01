# Spec Delta

## ADDED Requirements

### Requirement: 技能输入不注入隐藏制作默认值

工作台 Agent 在组装技能模板输入时，画风 MUST 来自当前项目已保存的 `style`；当前集目标时长 MUST 来自该集 `targetSeconds`（经统一解析）。系统 MUST NOT 用未在项目/分集数据中出现的固定画风或时长字符串填充输入。画风缺失时 MUST 阻止发送并提示补全项目制作参数，而非替换成默认画风。

#### Scenario: 分镜任务卡画风

- **WHEN** 项目画风为「近未来科幻写实」且用户在第 1 集镜头表发送 Agent 消息
- **THEN** 任务卡画风行为「近未来科幻写实」，且与项目 JSON 一致

#### Scenario: 无画风不发送

- **WHEN** 项目 `style` 为空且用户在提示词工作台尝试发送
- **THEN** 发送被阻止，用户看到补全项目画风的提示

#### Scenario: 时长来自当前集

- **WHEN** 第 3 集 `targetSeconds` 为 52 且用户在镜头表 Agent 发送
- **THEN** 任务输入中目标时长为 52，而非其他工作台本地默认值
