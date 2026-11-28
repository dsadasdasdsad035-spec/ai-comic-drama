import type { AppSettings, ModelEntry } from './api'
import { isRunnableModel, modelHasCap } from './modelCaps'

/** 手选 modelKey 优先，否则设置页该能力默认；均空则返回空串 */
export function resolveCapModelKey(
  pickKey: string | undefined,
  settings: AppSettings | null,
  cap: 'image' | 'audio' | 'text',
): string {
  const pick = String(pickKey || '').trim()
  if (pick) return pick
  return String(settings?.defaults?.[cap] || '').trim()
}

export function resolveImageModelKey(pickKey: string | undefined, settings: AppSettings | null): string {
  return resolveCapModelKey(pickKey, settings, 'image')
}

export function resolveAudioModelKey(pickKey: string | undefined, settings: AppSettings | null): string {
  return resolveCapModelKey(pickKey, settings, 'audio')
}

export function resolveTextModelKey(pickKey: string | undefined, settings: AppSettings | null): string {
  const pick = String(pickKey || '').trim()
  if (pick) return pick
  return String(settings?.defaults?.text || settings?.defaults?.textPro || '').trim()
}

export function imageModelReady(
  modelKey: string | undefined,
  models: ModelEntry[],
): { ok: true; entry: ModelEntry } | { ok: false; reason: string } {
  const runnable = models.filter((m) => modelHasCap(m, 'image') && isRunnableModel(m))
  if (runnable.length === 0) {
    return { ok: false, reason: '设置页还没有可用的生图模型' }
  }
  const key = String(modelKey || '').trim()
  if (!key) {
    return { ok: false, reason: '请在此选择生图模型，或在设置页配置图像默认' }
  }
  const entry = models.find((m) => m.key === key)
  if (!entry || !modelHasCap(entry, 'image')) {
    return { ok: false, reason: '无效的生图模型' }
  }
  if (!isRunnableModel(entry)) {
    return { ok: false, reason: '该生图模型尚未接入' }
  }
  return { ok: true, entry }
}

export function audioModelReady(
  modelKey: string | undefined,
  models: ModelEntry[],
): { ok: true; entry: ModelEntry } | { ok: false; reason: string } {
  const runnable = models.filter((m) => modelHasCap(m, 'audio') && isRunnableModel(m))
  if (runnable.length === 0) {
    return { ok: false, reason: '设置页还没有可用的音频模型' }
  }
  const key = String(modelKey || '').trim()
  if (!key) {
    return { ok: false, reason: '请在此选择音频模型，或在设置页配置配音默认' }
  }
  const entry = models.find((m) => m.key === key)
  if (!entry || !modelHasCap(entry, 'audio')) {
    return { ok: false, reason: '无效的音频模型' }
  }
  if (!isRunnableModel(entry)) {
    return { ok: false, reason: '该音频模型尚未接入' }
  }
  return { ok: true, entry }
}

export function textModelReady(
  modelKey: string | undefined,
  models: ModelEntry[],
): { ok: true; entry: ModelEntry } | { ok: false; reason: string } {
  const runnable = models.filter(
    (m) => (modelHasCap(m, 'text') || modelHasCap(m, 'textPro')) && isRunnableModel(m),
  )
  if (runnable.length === 0) {
    return { ok: false, reason: '设置页还没有可用的文本模型' }
  }
  const key = String(modelKey || '').trim()
  if (!key) {
    return { ok: false, reason: '请选择文本模型，或在设置页配置文本默认' }
  }
  const entry = models.find((m) => m.key === key)
  if (!entry || (!modelHasCap(entry, 'text') && !modelHasCap(entry, 'textPro'))) {
    return { ok: false, reason: '无效的文本模型' }
  }
  if (!isRunnableModel(entry)) {
    return { ok: false, reason: '该文本模型尚未接入' }
  }
  return { ok: true, entry }
}