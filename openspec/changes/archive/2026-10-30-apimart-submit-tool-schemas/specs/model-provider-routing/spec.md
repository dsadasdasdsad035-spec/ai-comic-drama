## ADDED Requirements

### Requirement: APIMart 工具请求提交合规 function parameters

当 APIMart 渠道处理带 tools 的文本请求（含 `/chat/completions` 与需 tools 时的 `/responses`）时，系统 MUST 在发起上游请求前确保每个 function 的 `parameters` 为顶层 `type: "object"` 的 JSON Schema。若内部导出的 schema 不满足该约束，系统 MUST 使用声明用 schema 或归一化后的 schema，MUST NOT 依赖上游对 `anyOf` 的宽容解析。

#### Scenario: Responses 路由上的 tools

- **WHEN** 模型标识命中 APIMart Responses 工具路由且请求包含 tools
- **THEN** 发往 `/responses` 的 tools 数组中每一项 parameters 均为 object schema

#### Scenario: 不合规 schema 的可读失败

- **WHEN** 某工具无法归一化为 object parameters 且渠道为 APIMart
- **THEN** 在代理层返回可读错误，说明工具名与 schema 约束，而不是 opaque 的 upstream 400
