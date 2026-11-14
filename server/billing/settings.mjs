import { DEFAULT_BILLING_SETTINGS } from './constants.mjs'
import { getBillingDb } from './db.mjs'

export function getBillingSettings() {
  const row = getBillingDb().prepare('SELECT json FROM billing_settings WHERE id = 1').get()
  try {
    return { ...DEFAULT_BILLING_SETTINGS, ...JSON.parse(String(row?.json || '{}')) }
  } catch {
    return { ...DEFAULT_BILLING_SETTINGS }
  }
}

export function patchBillingSettings(patch) {
  const cur = getBillingSettings()
  const next = { ...cur, ...patch }
  if (patch.recharge_packs) next.recharge_packs = patch.recharge_packs
  // SMTP 密码是敏感值：payload 里没带这个键就视为「不改」，
  // 显式传空串才代表「清空」，否则每次改其他字段都会把密码冲掉。
  if (!Object.prototype.hasOwnProperty.call(patch, 'smtp_pass')) next.smtp_pass = cur.smtp_pass ?? ''
  getBillingDb().prepare('UPDATE billing_settings SET json = ? WHERE id = 1').run(JSON.stringify(next))
  return next
}

/**
 * 返回给前端的设置副本：SMTP 密码不回传明文，只告知「是否已设置」。
 * 前端保存时因此必须用「留空=不改」的语义。
 */
export function publicBillingSettings(settings = getBillingSettings()) {
  const { smtp_pass, ...rest } = settings
  return { ...rest, smtp_pass: '', smtp_pass_set: Boolean(smtp_pass) }
}

export function isBillingEnabled() {
  return Boolean(getBillingSettings().billing_enabled)
}
