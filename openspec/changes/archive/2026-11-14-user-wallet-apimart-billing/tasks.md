# Tasks

## 1. 计费库与配置

- [x] 1.1 新增 `server/billing/db.mjs`：`billing.db` 建表（users、sessions、wallets、ledger、payment_orders、usage_events、price_catalog、billing_settings），`CREATE TABLE IF NOT EXISTS` 与现有风格一致；编写 `verify-billing-db.mjs` 二次打开不报错
- [x] 1.2 实现 `billing_settings` 默认值（`billing_enabled=false`、`signup_bonus_credits=20`、五档充值、markup=0）；验证：读配置 JSON 与 design 表一致
- [x] 1.3 在 `.env.example` 增加 `BILLING_DB_PATH`、`XUNHUPAY_*`、`SMTP_*`、`BILLING_ADMIN_EMAIL` 说明；验证：缺 XUNHUPAY 时充值 API 返回可读错误

## 2. 用户账户 API

- [x] 2.1 实现 `server/billing/auth.mjs`（注册、登录、登出、邮箱验证 token、bcrypt、会话哈希）；`verify-billing-auth.mjs` 覆盖注册→验证→登录→401
- [x] 2.2 在 `vite.config.ts` 注册 `/api/auth/*`；HttpOnly Cookie；开发环境 console 邮件驱动输出验证链接
- [x] 2.3 注册赠送：首次 `email_verified_at` 写入时幂等 gift 流水；验证重复调用余额只加一次

## 3. 平台钱包与记录

- [x] 3.1 实现钱包读写、账本 append、`GET /api/billing/wallet` 与 `GET /api/billing/ledger`（分页）；`verify-billing-wallet.mjs` 断言 balance_after 一致
- [x] 3.2 充值档位 `GET /api/billing/packs` 返回启用档位与 Credits；管理员 `PATCH /api/billing/settings` 改赠送与 markup（校验 admin）

## 4. 虎皮椒支付

- [x] 4.1 实现 `server/billing/xunhupay.mjs`（签名、do.html、query）；`verify-billing-xunhupay-sign.mjs` 与技能示例向量一致
- [x] 4.2 `POST /api/billing/recharge` 建单返回二维码 URL；`POST /api/billing/xunhupay/notify` 验签入账；`verify-billing-xunhupay-notify.mjs` 含重复回调幂等

## 5. 价目表与扣费引擎

- [x] 5.1 新增 `server/billing/price-catalog.mjs`：内置与当前 APIMart 预设对齐的黄金价条目 + `estimate`/`settle`（文本 token、图张、视频秒）；`verify-billing-catalog.mjs` 抽检 seedream/gpt 样例行
- [x] 5.2 实现 `server/billing/guard.mjs`：`isPlatformApimartKey`、`hold`/`release`/`settle`；`verify-billing-guard.mjs` BYOK 路径返回 `skipBilling`

## 6. 网关集成

- [x] 6.1 在 APIMart 文本/图/视频/配音调用链挂 BillingGuard（仅平台 Key + `billing_enabled`）；用户不足 402 `user_insufficient_credits`；上游 402 文案区分
- [x] 6.2 异步 task 终态失败冲正；成功按 spec 结算；`verify-billing-apimart-hook.mjs` mock 上游
- [x] 6.3 更新 `src/api.ts` 与设置页测试：解析新 billing code；文档 `docs/billing.md` 简述混合 B 与 env

## 7. 前端计费设置

- [x] 7.1 `SettingsPage.tsx` 增加 `billing` section：余额、充值按钮、流水列表；`SettingsInitialSection` 扩展
- [x] 7.2 管理员区：开关、signup_bonus、档位编辑、markup、价目 synced_at；未登录引导登录
- [x] 7.3 轻量登录/注册弹窗或页（邮箱+密码）；验证后刷新余额；`verify-billing-settings-ui.mjs` 抽检 DOM 文案

## 8. 端到端与 OpenSpec

- [x] 8.1 聚合 `node verify-billing-*.mjs` 或 npm script；`billing_enabled=false` 时全跳过扣费回归通过
- [x] 8.2 运行 `openspec validate user-wallet-apimart-billing --strict` 并通过

## Workflow follow-up

- 归档前在 staging 配置公网 `notify_url` 做一笔真实小额虎皮椒入账验证。
- 上线后监控上游 `APIB_API_KEY` 余额与用户 Credits 负债比例。