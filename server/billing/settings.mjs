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
  getBillingDb().prepare('UPDATE billing_settings SET json = ? WHERE id = 1').run(JSON.stringify(next))
  return next
}

export function isBillingEnabled() {
  return Boolean(getBillingSettings().billing_enabled)
}