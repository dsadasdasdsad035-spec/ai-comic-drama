# Spec Delta

## Purpose

为混合部署提供可登录的终端用户身份，使平台钱包与 APIMart 代调用计费能绑定到具体用户。

## ADDED Requirements

### Requirement: 邮箱注册与验证

系统 SHALL 允许用户使用邮箱与密码注册账户；注册后 MUST 向该邮箱发送验证链接或验证码；在邮箱验证完成前 MUST NOT 允许发起需要平台钱包的 APIMart 代调用。

#### Scenario: 注册成功待发验证

- **WHEN** 用户提交未占用的邮箱与符合强度要求的密码
- **THEN** 系统创建 `email_verified_at` 为空的用户记录，并发送验证邮件

#### Scenario: 重复邮箱

- **WHEN** 用户注册已存在的邮箱
- **THEN** 系统返回明确错误，不泄露该邮箱是否已注册以外的账户细节

#### Scenario: 验证后可用

- **WHEN** 用户完成邮箱验证
- **THEN** `email_verified_at` 被写入，用户可登录并调用需计费的平台 APIMart 能力

### Requirement: 登录与会话

系统 SHALL 支持邮箱密码登录，并签发有时效的会话凭证；客户端 MUST 在调用计费相关 API 时携带该凭证。

#### Scenario: 登录成功

- **WHEN** 用户提供正确邮箱与密码且账户未被禁用
- **THEN** 系统返回会话凭证与过期时间

#### Scenario: 凭证无效

- **WHEN** 请求携带过期或篡改的会话凭证
- **THEN** 系统返回 401，不执行钱包扣费

#### Scenario: 登出

- **WHEN** 用户主动登出
- **THEN** 当前会话在服务端失效，后续请求需重新登录