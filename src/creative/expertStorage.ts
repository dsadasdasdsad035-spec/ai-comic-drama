import { EXPERT_NONE } from './expertTypes'

const KEY_PREFIX = 'creative.expertId'

function storageKey(projectName: string) {
  const p = String(projectName || '').trim()
  return p ? `${KEY_PREFIX}.${encodeURIComponent(p)}` : KEY_PREFIX
}

export function readStoredExpertId(projectName: string): string {
  try {
    return String(localStorage.getItem(storageKey(projectName)) || '').trim() || EXPERT_NONE
  } catch {
    return EXPERT_NONE
  }
}

export function storeExpertId(projectName: string, expertId: string) {
  try {
    const key = storageKey(projectName)
    const id = String(expertId || '').trim()
    if (id) localStorage.setItem(key, id)
    else localStorage.removeItem(key)
  } catch {
    /* 隐私模式 */
  }
}