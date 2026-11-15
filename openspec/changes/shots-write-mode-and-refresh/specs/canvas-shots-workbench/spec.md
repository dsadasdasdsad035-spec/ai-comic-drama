# Spec Delta

## ADDED Requirements

### Requirement: Agent 写回后宿主立即水合画布

任何 Agent 写工具落库成功后，宿主 MUST 收到「项目数据已变」的通知，并立即按最新项目数据水合画布节点与顺序连线。系统 MUST NOT 要求用户重启应用或切换项目才能看到写回结果；落库失败时 MUST NOT 水合，MUST NOT 展示未落库的镜头。

#### Scenario: 对话写回后画布立即可见

- **WHEN** 用户在创意工作室对话中让 Agent 写回 3 镜
- **THEN** 切到画布即可看到这 3 镜与顺序连线，无需重启或重新选择项目

#### Scenario: 落库失败不产生幻影镜头

- **WHEN** 写回请求失败
- **THEN** 画布保持写回前状态，不出现未落库的镜头，并提示失败

#### Scenario: 只改提示词不改变结构

- **WHEN** Agent 只写回提示词字段
- **THEN** 画布节点数与顺序连线不变，Inspector 显示新的提示词
