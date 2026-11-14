/** 1 Credit = 1e6 微单位，避免浮点误差 */
export const CREDIT_MICRO = 1_000_000

export const DEFAULT_RECHARGE_PACKS = [
  { id: 'starter', title: '体验包', price_cny: 72.5, credits_total: 100, credits_bonus: 0, enabled: true },
  { id: 'standard', title: '标准包', price_cny: 181.25, credits_total: 260, credits_bonus: 10, enabled: true },
  { id: 'pro', title: '专业包', price_cny: 362.5, credits_total: 550, credits_bonus: 50, enabled: true },
  { id: 'business', title: '商业包', price_cny: 725, credits_total: 1200, credits_bonus: 200, enabled: true },
  { id: 'enterprise', title: '企业包', price_cny: 3625, credits_total: 6500, credits_bonus: 1500, enabled: true },
]

export const DEFAULT_BILLING_SETTINGS = {
  billing_enabled: false,
  signup_bonus_credits: 20,
  usage_markup_percent: 0,
  fx_usd_cny: 7.25,
  recharge_packs: DEFAULT_RECHARGE_PACKS,
  price_catalog_synced_at: null,
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