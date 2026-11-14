/** 1 Credit = 1e6 微单位，避免浮点误差 */
export const CREDIT_MICRO = 1_000_000

export const DEFAULT_RECHARGE_PACKS = [
  { id: 'starter', title: '体验包', price_cny: 72.5, credits_total: 100, credits_bonus: 0, enabled: true },
  { id: 'standard', title: '标准包', price_cny: 181.25, credits_total: 260, credits_bonus: 10, enabled: true },
  { id: 'pro', title: '专业包', price_cny: 362.5, credits_total: 550, credits_bonus: 50, enabled: true },
  { id: 'business', title: '商业包', price_cny: 725, credits_total: 1200, credits_bonus: 200, enabled: true },
  { id: 'enterprise', title: '企业包', price_cny: 3625, credits_total: 6500, credits_bonus: 1500, enabled: true },
]

/** 联调用的 1 分钱档位：仅 BILLING_TEST_PACK=1 时注入默认值，避免新库丢失测试档 */
export const TEST_RECHARGE_PACK = {
  id: 'test-001',
  title: '测试 1 分钱',
  price_cny: 0.01,
  credits_total: 1,
  credits_bonus: 0,
  enabled: true,
}

export function testPackEnabled() {
  return String(process.env.BILLING_TEST_PACK || '') === '1'
}

/** 默认档位（含测试档，取决于 BILLING_TEST_PACK） */
export function defaultRechargePacks() {
  return testPackEnabled() ? [TEST_RECHARGE_PACK, ...DEFAULT_RECHARGE_PACKS] : [...DEFAULT_RECHARGE_PACKS]
}

export const DEFAULT_BILLING_SETTINGS = {
  billing_enabled: false,
  signup_bonus_credits: 20,
  usage_markup_percent: 0,
  fx_usd_cny: 7.25,
  recharge_packs: defaultRechargePacks(),
  price_catalog_synced_at: null,
  // 验证邮件：库内配置优先于环境变量，桌面端因此也能在 UI 里配置
  // port / secure 用空值表示「未配置」，这样部署时设置的环境变量仍然生效
  email_driver: '',
  smtp_host: '',
  smtp_port: '',
  smtp_secure: '',
  smtp_user: '',
  smtp_pass: '',
  email_from: '',
}

/** Credits 小数展示 */
export function creditsFromMicro(micro) {
  const n = Number(micro) || 0
  return Math.round((n / CREDIT_MICRO) * 1000) / 1000
}

export function microFromCredits(credits) {
  const n = Number(credits) || 0
  return Math.round(n * CREDIT_MICRO)
}