# Design

## Context

- 生成网关集中在 `vite.config.ts`，APIMart 逻辑在 `server/apimart.mjs`；项目数据在 `server/db.mjs` SQLite。
- 用户 Key 解析见 `providerKey()`：设置库 Key 优先于 `.env`。
- 现有 `src/pricing.ts` 仅用于 UI 成本估算，与用户钱包无关。
- 探索结论：钱包单位 = **apimart.ai Credits**（页内 $ ≈ Credits × 0.1）；充值档位镜像 [APIMart 点数套餐](https://apimart.app/docs/zh/billing/credit-packs/) 到账总数 ÷10；混合 **B** = 本地项目库 + 云端计费库。

## Goals / Non-Goals

**Goals:**

- 云端认证 + 钱包 + 虎皮椒充值 + APIMart 平台 Key 路径扣费。
- 计费设置（管理员）与用户充值/记录 UI。
- 可测试的价目计算与回调幂等。

**Non-Goals:**

- 本地 SQLite 项目表加 `user_id` 全量多租户。
- 非 APIMart 渠道扣费。
- 自动同步 apimart.app `GET /frontend/api/billing/credit-packs`（可选手动配置档位）。

## Decisions

### 1. 双库（混合 B）

| 库 | 内容 |
|----|------|
| 现有 `projects.db` | 项目、设置、创意会话等 |
| 新 `billing.db`（路径可 env 配置） | users、sessions、wallets、ledger、orders、usage、price_catalog、billing_settings |

**理由：** 不把用户数据绑进本机项目备份；计费服务可独立部署。**替代：** 同库新表 —— 简单但备份/迁移耦合计费。

### 2. 金额存储

- `balance_micro`：`1 Credit = 1_000_000` 微单位。
- 展示：`credits = balance_micro / 1e6`，三位小数按需。

### 3. 平台 Key 判定

```text
isPlatformApimartKey(provider) :=
  trim(provider.apiKey) === ''  AND  env(APIB_API_KEY|APIMART_API_KEY) 非空
```

用户在设置里填写了 APIMart Key → **BYOK**，不扣用户钱包（与 spec 一致）。

### 4. BillingGuard 挂载点

在 `vite.config.ts` 内，解析出 `provider` + `kind === 'apimart'` + `isPlatformApimartKey` 后、调用 `server/apimart.mjs` 之前：

1. `requireUserSession(req)`（Cookie `session` 或 `Authorization: Bearer`）
2. `estimateCost(cap, model, body)` 从 `price_catalog`
3. 不足 → 402 JSON `{ kind: 'billing', code: 'user_insufficient_credits', ... }`
4. 可选 `hold_micro` 行锁（SQLite `BEGIN IMMEDIATE`）
5. 上游成功 → `settleFromUsage(response)`；失败 → `releaseHold`

文本用 usage；图/视频用张数、秒数 + spec；异步任务在 poll 终态时结算。

### 5. 价目表

- **v1**：`server/billing/price-catalog.mjs` 内置 JSON 片段 + 脚本从定价页 HTML/手工 curated 更新（与 `apimart-text-*` / `apimart-image-*` 预设 model key 对齐）。
- 匹配键：`provider_model_id` + `spec_key`（如 `default`, `1K`, `文本输入` token 类型）。
- 扣费：`golden_credits * (1 + usage_markup_percent/100)`。

### 6. 充值档位默认值

| id | CNY（示例 fx=7.25, markup=0） | credits_total |
|----|-------------------------------|---------------|
| starter | 72.50 | 100 |
| standard | 181.25 | 260 |
| pro | 362.50 | 550 |
| business | 725.00 | 1200 |
| enterprise | 3625.00 | 6500 |

`signup_bonus_credits` 默认 **20**。存于 `billing_settings` JSON。

### 7. 虎皮椒

实现放 `server/billing/xunhupay.mjs`，签名算法与 `.cursor/skills/xunhupay` 一致。

- `POST /api/billing/recharge` → 建单 + `do.html`
- `POST /api/billing/xunhupay/notify` → 验签入账（无 session）

### 8. 认证

- `server/billing/auth.mjs`：注册、登录、验证 token、密码 bcrypt。
- 邮件：SMTP env（`SMTP_URL` 或 host/port/user/pass）；开发可用 `console` 驱动写验证链接到日志。
- Session：随机 token，哈希存库，HttpOnly Cookie；本地 Vite 代理同源。

### 9. 设置 UI

`SettingsPage.tsx` 新增 section `billing`：

- **管理员**（env `BILLING_ADMIN_EMAIL` 或首用户）：开关、赠送、档位、markup、价目同步按钮。
- **所有登录用户**：余额、充值、记录链接/内嵌列表。

保留现有「计价」section 作创作估算；计费区链到真实 Credits。

### 10. 错误语义

| 条件 | kind | 用户文案方向 |
|------|------|--------------|
| 用户 Credits 不足 | billing | 平台积分不足，请充值 |
| 上游 APIMart 402 | billing | 服务暂不可用（上游余额），联系支持 |
| 未登录 + 平台模式 | auth | 请先登录 |

## Risks / Trade-offs

- **[Risk] 价目表滞后** → 管理员可见 `synced_at`；扣费前可留 `max_estimate` 缓冲系数。
- **[Risk] 上游与用户账本透支** → 运营监控 APIB 余额；极端情况禁用 `billing_enabled`。
- **[Risk] 虎皮椒回调不可用** → 订单查询接口 + 手动补单工具（tasks 后期）。
- **[Risk] 混合部署会话跨域** → 默认同源；远程 billing API 需 CORS + Bearer。

## Migration Plan

1. 部署带 `billing.db` 的服务；`billing_enabled=false` 默认关。
2. 配置 SMTP、XUNHUPAY、上游 Key。
3. 导入价目表；冒烟 `verify-billing-*.mjs`。
4. 打开 `billing_enabled`；前端显示登录/充值。
5. 回滚：关开关即恢复纯 BYOK/无用户扣费行为。

## Open Questions

- 计费 API 是否与 Vite 同进程长期共存，还是独立 Node 服务（首期同进程）。
- 邮件验证是否允许管理员手动 `verify` 用户（运维救急）。