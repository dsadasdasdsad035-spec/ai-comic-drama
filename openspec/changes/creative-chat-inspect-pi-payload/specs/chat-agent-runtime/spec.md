# Spec Delta

## ADDED Requirements

### Requirement: 创意会话使用统一 Pi 运行时且历史以 user 前缀拼接

创意会话 SHALL 使用与其它聊天相同的 `runStageAgent` Pi 循环。每轮 MUST 将 `threadTranscript` 生成的历史文本，在存在时以 `【之前的对话】` 块前缀拼入单条 user 消息；MUST NOT 为创意单独引入第二套模型循环或非原生工具协议。

#### Scenario: 创意发送走 Pi

- **WHEN** 创意会话发起一轮对话
- **THEN** 运行时产生与其它 Pi 聊天同形状的工具事件与步骤记录

#### Scenario: 历史拼接

- **WHEN** 会话存在 prior 消息且用户发送新一句
- **THEN** 渠道侧 user 载荷包含历史摘要块与本句原文，顺序与 stageRunner 约定一致
