# Spec Delta

## Purpose

管理用户平台积分余额、流水与充值档位，计量单位与 apimart.ai 定价页 Credits 一致。

## ADDED Requirements

### Requirement: 钱包余额以 Credits 计量

系统 SHALL 以 apimart.ai Credits 为用户可见余额单位；内部存储 MUST 使用整数微 Credit（1 Credit = 10^6 微单位）避免浮点误差。

#### Scenario: 查询余额

- **WHEN** 已登录用户请求钱包概览
- **THEN** 返回当前可用 Credits 与可选冻结额（预扣）

#### Scenario: 账本一致性

- **WHEN** 任意一笔流水写入
- **THEN** 流水记录包含变动后余额，且与钱包表余额一致

### Requirement: 注册赠送积分

系统 SHALL 在管理员配置的 `signup_bonus_credits` 大于零时，于用户首次完成邮箱验证后赠送一次；同一用户 MUST NOT 重复领取。

#### Scenario: 首次验证赠送

- **WHEN** 用户首次完成邮箱验证且赠送配置为 20 Credits
- **THEN** 钱包增加 20 Credits 并写入类型为 gift 的账本流水

#### Scenario: 重复触发防护

- **WHEN** 验证回调或接口被重复调用
- **THEN** 赠送只发生一次

### Requirement: 充值档位到账 Credits

系统 SHALL 提供固定充值档位；每档 MUST 定义人民币标价与到账总 Credits（含赠送），默认结构与 APIMart 点数套餐换算一致：$10→100、$25→260、$50→550、$100→1200、$500→6500 Credits。

#### Scenario: 展示档位

- **WHEN** 用户打开充值页
- **THEN** 列出启用中的档位、人民币价格、到账 Credits 与赠送说明

#### Scenario: 禁用档位

- **WHEN** 管理员禁用某档位
- **THEN** 用户不可再选择该档，已有订单不受影响

### Requirement: 用户可查询充值与消费记录

系统 SHALL 向已登录用户提供分页的账本流水，含充值、赠送、消费、冲正；消费流水 MUST 可关联用量摘要（能力、模型、时间）。

#### Scenario: 充值记录

- **WHEN** 用户查看充值记录
- **THEN** 展示虎皮椒订单号、实付人民币、到账 Credits、状态与时间

#### Scenario: 消费记录

- **WHEN** 用户查看消费记录
- **THEN** 展示扣减 Credits、能力类型与模型标识