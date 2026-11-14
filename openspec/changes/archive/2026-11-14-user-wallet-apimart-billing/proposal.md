# Proposal

## Why

应用在本地使用 SQLite 管理项目与设置，APIMart 渠道由运营侧统一 Key 代调用；当前「余额不足」仅反映上游 APIMart 账户欠费，终端用户无法自助充值，也没有按调用扣减的账户体系。需要以混合部署（本地项目 + 云端账户/钱包）支持邮箱注册、虎皮椒充值、以及**仅 APIMart 平台 Key 路径**的按价扣费，单价以 [apimart.ai 定价页黄金价](https://apimart.ai/zh/pricing) 为准。

## What Changes

- 新增云端用户账户：邮箱注册、验证、登录会话（JWT 或等价机制）；首次验证后可配置赠送 Credits。
- 新增平台钱包与账本：余额以 **apimart.ai Credits** 为计量单位（整数微 Credit 存储）；充值记录、消费流水、用量明细。
- 新增虎皮椒（xunhupay）充值：固定档位套餐，到账 Credits 结构与 [APIMart 点数套餐](https://apimart.app/docs/zh/billing/credit-packs/) 的赠送比例对齐；异步回调验签、幂等入账。
- 新增 APIMart 平台计费闸门：仅当 `provider.kind === 'apimart'` 且解析为**平台 Key**（非用户 BYOK）时，调用前 fail-closed 校验余额，成功后按价目表与 `usage` 实扣。
- 新增价目表同步/配置：默认定价来源为 apimart.ai 黄金价；支持 `usage_markup` 与充值标价中的 `fx_usd_cny`、零售加成。
- 设置页新增「计费」分区（管理员：开关、赠送、档位、加成、价目版本；登录用户：余额、充值入口、记录只读）；区分「上游 APIMart 欠费」与「用户积分不足」文案。
- 本地创作 SQLite **不强制** `user_id` 分区（混合 B）；生成类 API 携带会话，计费数据存云端库（可与现有 `server/db.mjs` 分库或独立 `billing.db`）。

**Out of scope**

- 非 APIMart 渠道（方舟、MiniMax、用户自填 Key 等）的用户扣费。
- 项目数据多租户迁云、全量 SaaS 单库。
- Stripe/PayPal（用户支付仅虎皮椒）。
- APIMart 运营侧进货自动化（人工充值上游即可）。

## Capabilities

### New Capabilities

- `user-accounts`：邮箱注册、验证、登录、会话与鉴权中间件。
- `platform-wallet`：钱包余额、账本流水、注册赠送、充值档位配置、用户侧余额与记录查询。
- `payment-xunhupay`：创建充值订单、虎皮椒下单、回调验签与入账幂等。
- `apimart-user-billing`：价目表（黄金价）、预扣/实扣、用量事件；仅 APIMart 平台 Key。

### Modified Capabilities

- `model-provider-routing`：APIMart 平台代调用路径 MUST 在余额不足时返回对用户可读的平台积分不足错误，且不得与上游 402 文案混淆；BYOK 路径 MUST NOT 触发用户钱包扣费。

## Impact

- 代码：`vite.config.ts` 生成路由中间件、`server/` 新增 `billing/` 或 `auth/` 模块、可选独立 SQLite；`src/settings/SettingsPage.tsx` 计费区；`src/api.ts` 会话与 402 处理；`.env` 增加 `XUNHUPAY_*`、邮件 SMTP、计费库路径。
- 数据：云端增量表 `users`、`user_sessions`、`wallets`、`ledger_entries`、`payment_orders`、`usage_events`、`price_catalog`、`billing_settings`；本地 `settings` 可存 `billingApiBase` 等指针。
- 依赖：邮件发送（选 SMTP 库或 HTTP 服务）；虎皮椒按 `.cursor/skills/xunhupay` 签名规范，不新增重型支付 SDK。
- 运维：公网 `notify_url`；监控上游 `APIB_API_KEY` 余额与用户负债 Credits 比例。
- 验证：新增 `verify-billing-*.mjs`（价目计算、幂等回调、仅 apimart 扣费、BYOK 旁路）。