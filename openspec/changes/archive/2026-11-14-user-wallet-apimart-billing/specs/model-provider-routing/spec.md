# Spec Delta

## ADDED Requirements

### Requirement: APIMart 平台代调用与用户钱包联动

当 APIMart 请求使用平台托管 Key 时，系统 SHALL 在发起上游请求前执行用户钱包 fail-closed 校验；余额不足时 MUST 返回 `kind: 'billing'` 且消息指明用户平台积分不足。当使用用户自带 Key 时，MUST NOT 执行用户钱包校验。

#### Scenario: 用户积分不足

- **WHEN** 已登录用户的平台钱包不足以支付预估 APIMart 调用
- **THEN** 网关不转发至 APIMart，客户端收到与用户充值相关的 billing 错误

#### Scenario: 用户自带 Key

- **WHEN** APIMart 渠道使用用户填写的自有 Key
- **THEN** 行为与变更前一致，仅反映上游 APIMart 账户状态

#### Scenario: 未登录平台模式

- **WHEN** 部署启用平台计费且请求未携带有效用户会话
- **THEN** 系统拒绝平台代调用或要求登录，不得静默使用平台 Key 免扣费