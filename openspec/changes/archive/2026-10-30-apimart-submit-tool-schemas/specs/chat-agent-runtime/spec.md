## ADDED Requirements

### Requirement: 发往渠道的工具参数必须是 object JSON Schema

聊天运行时向文本渠道提交原生 function tools 时，每个工具的 `parameters` MUST 在 JSON Schema 顶层声明 `type: "object"`。系统 MUST NOT 将顶层为 `anyOf`、`oneOf` 或缺少 `type` 的 schema 原样发给声明校验严格的渠道。若某工具契约在运行时仍接受多种 payload 形状，模型可见的声明 MUST 使用单一 object 形状；其它形状 MUST 在工具执行或契约校验前归一化。

#### Scenario: APIMart Responses 接受角色 submit 工具

- **WHEN** 角色聊天使用 APIMart 推理模型且走 Responses 工具路由
- **THEN** `submit_characters` 的 parameters 为顶层 object，请求不因 invalid_function_parameters 在发工具声明阶段失败

#### Scenario: 模型返回裸数组仍可通过契约

- **WHEN** 模型调用 `submit_characters` 且 arguments 为角色数组而非 `{ characters: [...] }`
- **THEN** 系统在契约校验前归一化为 object 形状，校验与合并草稿行为与归一化前合法数组一致

#### Scenario: 静态验收覆盖全部 submit 工具

- **WHEN** 运行工具 schema 验收脚本
- **THEN** 各工作台 `submit_*` 工具导出的 parameters 均满足顶层 `type: "object"`
