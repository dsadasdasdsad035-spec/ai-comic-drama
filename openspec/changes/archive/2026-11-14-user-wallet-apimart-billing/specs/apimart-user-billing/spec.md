# Spec Delta

## Purpose

在用户侧按 apimart.ai 黄金价对 APIMart 平台代调用扣减 Credits，非 APIMart 或用户自带 Key 时不扣费。

## ADDED Requirements

### Requirement: 仅 APIMart 平台 Key 触发用户扣费

系统 SHALL 仅当生成请求路由到 `provider.kind === 'apimart'` 且实际使用的 Key 为平台托管（设置库与环境变量中的代发 Key，而非用户在该渠道填写的自有 Key）时，执行用户钱包校验与扣费。

#### Scenario: 平台代调用扣费

- **WHEN** 已验证用户发起 APIMart 文本生成且使用平台 Key
- **THEN** 系统在调用上游前校验余额，成功后按价目扣减 Credits

#### Scenario: BYOK 不扣用户钱包

- **WHEN** 用户在 APIMart 渠道填写了自己的 API Key 并被选中使用
- **THEN** 系统不扣减用户平台钱包，沿用现有上游 402 语义

#### Scenario: 方舟与 MiniMax

- **WHEN** 请求路由到非 apimart 渠道
- **THEN** 系统不读取用户平台钱包

### Requirement: 价目表来源为 apimart.ai 黄金价

系统 SHALL 以 [apimart.ai/zh/pricing](https://apimart.ai/zh/pricing) 的黄金价档位作为默认单价；管理员可配置 `usage_markup_percent` 在黄金价上加成；扣费 MUST NOT 使用用户充值套餐的赠送比例改变单次调用单价。

#### Scenario: 图像按张

- **WHEN** 用户通过 APIMart 生成一张图且模型与分辨率匹配价目表一行
- **THEN** 扣费等于该行黄金价 Credits 乘以（1 + markup）

#### Scenario: 文本按 token

- **WHEN** 文本调用返回 usage 含 prompt 与 completion tokens
- **THEN** 按价目表中对应模型的输入/输出每百万 token 单价结算

#### Scenario: 价目缺失

- **WHEN** 模型在价目表中无条目且管理员未配置回退价
- **THEN** 系统拒绝发起平台代调用并返回可读配置错误

### Requirement: Fail-closed 余额不足

在平台代调用路径上，若用户可用余额不足以覆盖预估费用（含预扣策略），系统 MUST 拒绝上游请求并返回对用户可读的平台积分不足错误，HTTP 状态 SHOULD 为 402，`kind` 为 `billing`。

#### Scenario: 预检失败

- **WHEN** 预估费用高于用户可用 Credits
- **THEN** 不调用 APIMart，提示用户充值

#### Scenario: 与上游 402 区分

- **WHEN** 用户余额充足但上游 APIMart 平台账户返回 insufficient balance
- **THEN** 错误文案 MUST 表明为运营侧上游欠费，而非用户积分不足

### Requirement: 调用失败可冲正

若平台代调用在上游失败且未产生可计费用量，系统 SHOULD 不扣费或冲正预扣；异步图像/视频任务失败 MUST 冲正对应预扣。

#### Scenario: 文本上游错误

- **WHEN** 上游返回非 2xx 且无有效 usage
- **THEN** 用户钱包不发生净扣减

#### Scenario: 视频任务失败

- **WHEN** 异步视频任务终态为失败
- **THEN** 释放或冲正该任务的预扣 Credits