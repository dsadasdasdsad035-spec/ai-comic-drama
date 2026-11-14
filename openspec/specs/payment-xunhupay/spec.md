# payment-xunhupay Specification

## Purpose
通过虎皮椒（xunhupay）收取人民币并为平台钱包增加 Credits。

## Requirements

### Requirement: 创建待支付充值订单

系统 SHALL 在用户选择充值档位后创建 `pending` 状态的支付订单，生成全局唯一的 `trade_order_id`，并调用虎皮椒发起支付接口获取支付链接或二维码 URL。

#### Scenario: 创建订单

- **WHEN** 已登录用户确认购买某启用档位
- **THEN** 系统创建订单、返回支付 URL，订单状态为 pending

#### Scenario: 未登录

- **WHEN** 未携带有效会话时发起充值
- **THEN** 系统返回 401，不创建订单

### Requirement: 回调验签与幂等入账

系统 MUST 在虎皮椒异步通知到达时先验证签名；验签通过后 MUST 校验订单号与金额；对已为 `paid` 的订单 MUST 幂等返回成功，不得重复加 Credits。

#### Scenario: 验签失败

- **WHEN** 回调参数签名不匹配
- **THEN** 系统拒绝入账并记录安全日志

#### Scenario: 支付成功入账

- **WHEN** 验签通过且金额与 pending 订单一致
- **THEN** 订单标记 paid、钱包增加对应 Credits、写入 recharge 流水

#### Scenario: 重复回调

- **WHEN** 同一笔成功支付的通知被虎皮椒重复发送
- **THEN** 余额只增加一次

### Requirement: 支付配置来自环境

虎皮椒 APPID、SECRET 与网关域名 MUST 从环境变量或安全配置读取，MUST NOT 写入前端或仓库；`notify_url` MUST 为公网 HTTPS 地址。

#### Scenario: 缺配置

- **WHEN** 服务端未配置虎皮椒密钥却用户发起充值
- **THEN** 返回明确配置错误，不调用虎皮椒
