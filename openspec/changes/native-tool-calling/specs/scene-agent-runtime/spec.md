# Spec Delta

## MODIFIED Requirements

### Requirement: 模型调用必须经过服务端代理

agent 的模型调用 MUST 通过应用服务端代理完成，浏览器 MUST NOT 持有模型渠道 API Key；模型适配层 MUST 只消费服务端返回的文本、JSON 或结构化 tool_calls，不得把 Key 写入聊天、项目或日志。

#### Scenario: 正常模型调用

- **WHEN** agent 需要生成或修复代码
- **THEN** 浏览器请求本地代理，服务端再调用配置的模型渠道

#### Scenario: 原生工具调用

- **WHEN** agent 使用 provider 原生工具调用
- **THEN** 工具定义与工具调用仍经本地代理转发，浏览器直接收到结构化 tool_calls

#### Scenario: 缺少模型 Key

- **WHEN** 当前代码模型渠道没有可用 Key
- **THEN** agent 以可读错误结束，不把请求伪装成成功

#### Scenario: 不泄露 Key

- **WHEN** 聊天轨迹或项目被保存
- **THEN** 不包含模型 Key 或渠道鉴权头

## ADDED Requirements

### Requirement: 两种工具协议必须保持等价的运行时约束

无论使用 JSON action 还是 provider 原生工具调用，运行时 MUST 保持相同的工具集合、参数完整后才执行的规则、修复/验收上限、事件审计与取消语义；协议差异 MUST NOT 改变工具的权限、执行顺序约束或副作用。

#### Scenario: 工具集合一致

- **WHEN** 同一镜头分别在 native 和 json 协议下运行
- **THEN** 两种协议暴露的工具集合、参数约束和拒绝规则相同

#### Scenario: 执行门槛一致

- **WHEN** 工具参数尚未完整
- **THEN** 两种协议都只展示进度，不执行工具、不写草稿

#### Scenario: 审计字段一致

- **WHEN** 对比两种协议的运行轨迹
- **THEN** 都包含模型轮次、工具顺序、失败原因和修复次数

#### Scenario: 上限与取消一致

- **WHEN** 达到修复/验收上限或用户取消
- **THEN** 两种协议都以相同方式停止、保留旧代码并停止后续事件
