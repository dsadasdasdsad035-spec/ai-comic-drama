# chat-agent-runtime Delta

## ADDED Requirements

### Requirement: 出片改稿线程键

Pi 改稿弹窗的聊天线程 MUST 使用稳定键，格式包含项目标识与实体类型（`shot` 或 `transition-join`）及实体 id（镜号或边标识）。MUST NOT 与剧本/镜头表等工作台线程键冲突。

#### Scenario: 线程键不与工作台冲突

- **WHEN** 同一项目同时使用镜头表工作台聊天与 S01 出片改稿
- **THEN** 两条线程消息互不影响
