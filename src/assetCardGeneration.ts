import type { ModelEntry } from './api'
import { isRunnableModel, modelHasCap } from './modelCaps'

export function audioModelReady(
  modelKey: string | undefined,
  models: ModelEntry[],
): { ok: true; entry: ModelEntry } | { ok: false; reason: string } {
  const key = String(modelKey || '').trim()
  if (!key) return { ok: false, reason: '请先选择音频模型' }
  const entry = models.find((m) => m.key === key)
  if (!entry || !modelHasCap(entry, 'audio')) return { ok: false, reason: '无效的音频模型' }
  if (!isRunnableModel(entry)) return { ok: false, reason: '该音频模型尚未接入' }
  return { ok: true, entry }
}