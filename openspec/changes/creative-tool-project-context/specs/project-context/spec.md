# Spec Delta

## ADDED Requirements

### Requirement: 创意会话的工具读写落到当前项目

创意视图打开时，系统 SHALL 把顶栏当前项目推送给会话宿主作为工具上下文，并在顶栏切换项目后立即更新。宿主未收到项目名时，工具 MUST 依赖服务端的当前项目记录，MUST NOT 在缺少项目上下文时写入任何项目。

#### Scenario: 进入创意视图即带上项目

- **WHEN** 顶栏已选项目 `rain-night`，操作员打开创意视图
- **THEN** 会话宿主获得该项目的工具上下文，`read_episodes` 能读出分集

#### Scenario: 顶栏切项目

- **WHEN** 操作员在创意视图内把顶栏项目从 `rain-night` 切到 `sunrise`
- **THEN** 后续工具调用读取 `sunrise`，`rain-night` 不被写入

#### Scenario: 未选项目

- **WHEN** 顶栏为「未选项目」时在创意会话调用读取工具
- **THEN** 工具返回可读失败并提示可用项目清单工具查看已有项目，不写入任何项目
