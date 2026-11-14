# 平台计费（混合 B）

本地项目数据仍在 `storyboard.sqlite`；用户账户、钱包与虎皮椒订单在 `data/billing.sqlite`（可用 `BILLING_DB_PATH` 覆盖）。

## 行为摘要

- 仅当 **APIMart 渠道使用平台 Key**（设置里未填 APIMart Key，且环境变量有 `APIMART_API_KEY` / `APIB_API_KEY`）时扣减用户 **Credits**。
- 单价默认来自 [apimart.ai 定价页](https://apimart.ai/zh/pricing) 黄金价（内置样例，可在库表 `price_catalog` 扩展）。
- `billing_enabled=false`（默认）时不拦截、不扣费。

## 环境变量

见 `deploy/.env.example` 中「平台计费」一节。变量写在**仓库根目录** `.env`（与 Vite 代理同处），不要只放在 `deploy/.env` 而不合并。

- `XUNHUPAY_NOTIFY_URL` 必须指向**本服务**的 `/api/billing/xunhupay/notify`，且虎皮椒服务器能公网访问。
- 前端生成请求已通过 `credentials: 'include'` 携带 `sb_session`，与设置页登录态一致。

## 验证邮件

`BILLING_EMAIL_DRIVER` 决定验证邮件的投递方式：

| 驱动 | 行为 | 适用场景 |
|---|---|---|
| `console`（默认） | 验证链接打印到服务端日志 | 本地调试、测试 |
| `smtp` | 通过 nodemailer 真实发信 | 生产环境、桌面端 |

**注意**：`console` 驱动下用户拿不到链接。桌面端看不到服务端日志，因此桌面端**必须**选 `smtp`。

### 配置来源：设置页优先，环境变量兜底

邮件配置有两处来源，**设置页写入的值优先**：

1. 「设置 → 计费 → 验证邮件」（写入 `billing_settings`，管理员可见）。桌面端只能走这条，因为 Electron 子进程没有 `.env` 加载机制，用户也无处设置环境变量。
2. 环境变量 `BILLING_SMTP_*` / `BILLING_EMAIL_*`。适合容器/服务器部署，无需进 UI 配置。

设置页提供「发送测试邮件到我」，与注册时走同一条发信代码路径，可直接验证配置是否可用。

`smtp_port` 与 `smtp_secure` 在库里留空时表示「未配置」，此时回落到环境变量，再回落到按端口推断（465 隐式 TLS，其余 STARTTLS）。

**密码处理**：`GET/PATCH /api/billing/settings` 不回传 `smtp_pass` 明文，只返回 `smtp_pass_set` 布尔值。保存其他字段时若 payload 未带 `smtp_pass`，原密码保持不变；显式传空串才清空。

注册时若邮件发送失败，接口仍返回 `ok: true`（账户已创建），但会带 `email_sent: false` 与具体原因，不谎报成功；用户可通过「重发验证邮件」重试。

## 验证

```bash
npm run verify:billing
npm run verify:billing:e2e
```

端到端冒烟覆盖：注册 → 验证 → 登录 → 模拟充值（`BILLING_ALLOW_SIMULATE=1`）→ APIMart 文本扣费 → 渠道对账。

## 对账

管理员 `GET /api/billing/reconcile` 返回：

- 用户总余额 / 冻结额
- 流水按类型汇总（gift / recharge / usage）
- 用量按能力汇总
- `channel.platform_apimart_credits_owed`：应对接上游 APIMart 的消费 Credits（与用户扣费 1:1 记账时一致）

测试环境模拟入账：`POST /api/billing/simulate-paid` + `BILLING_ALLOW_SIMULATE=1`（仅管理员）。

## 联调测试档位

`BILLING_TEST_PACK=1` 时默认档位里会带一个 **0.01 元 / 1 Credit** 的「测试 1 分钱」档（`test-001`），用于跑通真实虎皮椒支付。
关掉该开关后：新库不再生成该档；已存在库里的档位仍在设置中保留，但**低于 1 元的档位会被下单接口拒绝**（403），防止测试价被公开薅积分。生产请保持 `BILLING_TEST_PACK=0`。

## API

- `POST /api/auth/register|login|logout`
- `POST /api/auth/resend-verify`（重发验证邮件；对已注册/未注册返回同一话术）
- `GET /api/auth/me`
- `GET /api/billing/email-status`（邮件配置生效值，需管理员；不含密码）
- `POST /api/billing/email-test`（发送测试邮件，需管理员）
- `GET /api/billing/wallet|ledger|packs`
- `POST /api/billing/recharge`
- `GET /api/billing/order?trade_order_id=…`（充值后轮询订单状态）
- `POST /api/billing/xunhupay/notify`（虎皮椒回调，需公网 `XUNHUPAY_NOTIFY_URL`）