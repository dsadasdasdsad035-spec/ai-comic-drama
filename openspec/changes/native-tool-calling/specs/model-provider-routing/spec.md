# Spec Delta

## ADDED Requirements

### Requirement: 文本模型必须声明原生工具调用能力

文本渠道与模型 SHALL 显式声明是否支持原生工具调用，以及在工具调用模式下的 thinking 策略。选择 native 协议时 MUST 只使用已声明支持的模型；渠道支持 thinking 时，工具调用请求 MUST 关闭 thinking 以保护输出预算；不支持 tools 的模型 MUST NOT 被 native 协议选中，也 MUST NOT 因协议不支持而改用其他渠道。

#### Scenario: 支持的模型可被选择

- **WHEN** 环节模型声明支持原生工具调用
- **THEN** 该模型可被 native 协议选中，设置页显示支持状态

#### Scenario: 不支持的模型

- **WHEN** 环节模型未声明支持原生工具调用
- **THEN** native 协议不选择该模型，并给出可读提示或使用显式选择的 json

#### Scenario: 工具调用关闭 thinking

- **WHEN** 渠道支持 thinking 且请求携带 tools
- **THEN** 请求关闭 thinking，避免推理开销吃掉工具参数输出预算

#### Scenario: 不做渠道回退

- **WHEN** 当前模型不支持 tools
- **THEN** 系统停留在同一渠道内处理，不自动改用其他渠道重试
