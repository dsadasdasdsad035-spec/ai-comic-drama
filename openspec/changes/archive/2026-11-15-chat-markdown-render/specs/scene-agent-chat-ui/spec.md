# Spec Delta

## MODIFIED Requirements

### Requirement: 聊天使用结构化消息而不是纯文本拼接

聊天 UI SHALL 把助手消息渲染为结构化 parts，至少支持文本、工具调用、工具结果、代码摘要、关键帧和验收清单；MUST NOT 只把工具日志拼进一段 Markdown 文本。

#### Scenario: 文本消息

- **WHEN** 助手返回解释
- **THEN** 该文本按 `chat-message-markdown` 能力的渲染契约展示，标题、强调、列表、行内代码与表格均为富文本，围栏代码以折叠块呈现

#### Scenario: 工具消息

- **WHEN** agent 调用工具
- **THEN** 该工具以独立卡片或 part 出现在消息流中

#### Scenario: 混合内容

- **WHEN** 一次回答包含文本、工具、帧和清单
- **THEN** 按执行顺序分别渲染，不混成一段纯文本
