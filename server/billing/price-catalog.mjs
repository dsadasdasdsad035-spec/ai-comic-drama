import { getBillingDb } from './db.mjs'
import { getBillingSettings } from './settings.mjs'
import { microFromCredits } from './constants.mjs'

/** 黄金价样例（Credits）；与 apimart.ai 定价页 order-of-magnitude 对齐 */
const SEED_ROWS = [
  { model_key: 'seedream-5-0-pro', metric: 'image', spec_key: 'default', credits_per_unit: 0.36 },
  { model_key: 'seedream-5-0-pro', metric: 'image', spec_key: '1K', credits_per_unit: 0.2925 },
  { model_key: 'nano-banana-2-lite', metric: 'text_in', spec_key: 'default', credits_per_unit: 0.000002 },
  { model_key: 'nano-banana-2-lite', metric: 'text_out', spec_key: 'default', credits_per_unit: 0.000012 },
  { model_key: 'gpt-5.1', metric: 'text_in', spec_key: 'default', credits_per_unit: 0.000004 },
  { model_key: 'gpt-5.1', metric: 'text_out', spec_key: 'default', credits_per_unit: 0.000024 },
  { model_key: 'seedance', metric: 'video_second', spec_key: '480p', credits_per_unit: 0.08 },
  { model_key: 'seedance', metric: 'video_second', spec_key: '720p', credits_per_unit: 0.15 },
]

export function seedPriceCatalogIfEmpty() {
  const d = getBillingDb()
  const n = d.prepare('SELECT COUNT(*) AS c FROM price_catalog').get().c
  if (n > 0) return
  const ins = d.prepare(
    `INSERT INTO price_catalog (model_key, metric, spec_key, credits_per_unit, synced_at)
     VALUES (?, ?, ?, ?, datetime('now'))`,
  )
  for (const r of SEED_ROWS) ins.run(r.model_key, r.metric, r.spec_key, r.credits_per_unit)
}

function markupMult() {
  const p = Number(getBillingSettings().usage_markup_percent) || 0
  return 1 + p / 100
}

function lookupRow(modelKey, metric, specKey = 'default') {
  const d = getBillingDb()
  let row = d
    .prepare('SELECT credits_per_unit FROM price_catalog WHERE model_key = ? AND metric = ? AND spec_key = ?')
    .get(modelKey, metric, specKey)
  if (!row) {
    row = d
      .prepare('SELECT credits_per_unit FROM price_catalog WHERE model_key = ? AND metric = ? AND spec_key = ?')
      .get(modelKey, metric, 'default')
  }
  return row ? Number(row.credits_per_unit) * markupMult() : null
}

/** 从 ModelEntry.model 字符串归一化价目键 */
export function modelKeyFromId(model) {
  const m = String(model || '').toLowerCase()
  if (/seedream.*5.*0.*pro/i.test(m)) return 'seedream-5-0-pro'
  if (/nano-banana.*lite/i.test(m)) return 'nano-banana-2-lite'
  if (/gpt-5/i.test(m)) return 'gpt-5.1'
  if (/seedance|doubao-seedance/i.test(m)) return 'seedance'
  return m.split('/').pop().split(':')[0] || 'default'
}

export function estimateTextCredits(model, promptTokensEst, maxOutputTokens) {
  const key = modelKeyFromId(model)
  const inRate = lookupRow(key, 'text_in') ?? lookupRow('gpt-5.1', 'text_in') ?? 0.000004
  const outRate = lookupRow(key, 'text_out') ?? lookupRow('gpt-5.1', 'text_out') ?? 0.000024
  const inTok = Math.max(1, Number(promptTokensEst) || 500)
  const outTok = Math.max(1, Number(maxOutputTokens) || 1024)
  return inRate * inTok + outRate * outTok
}

export function settleTextCredits(model, usage) {
  const key = modelKeyFromId(model)
  const inRate = lookupRow(key, 'text_in') ?? 0.000004
  const outRate = lookupRow(key, 'text_out') ?? 0.000024
  const inTok = Number(usage?.prompt_tokens) || 0
  const outTok = Number(usage?.completion_tokens) || 0
  return inRate * inTok + outRate * outTok
}

export function estimateImageCredits(model, n = 1, specKey = 'default') {
  const key = modelKeyFromId(model)
  const rate = lookupRow(key, 'image', specKey) ?? lookupRow('seedream-5-0-pro', 'image') ?? 0.36
  return rate * Math.max(1, n)
}

export function estimateVideoCredits(model, seconds, res = '480p') {
  const key = modelKeyFromId(model)
  const spec = res === '720p' ? '720p' : '480p'
  const rate = lookupRow(key, 'video_second', spec) ?? 0.08
  return rate * Math.max(1, Number(seconds) || 5)
}

export function creditsToMicro(credits) {
  return microFromCredits(credits)
}