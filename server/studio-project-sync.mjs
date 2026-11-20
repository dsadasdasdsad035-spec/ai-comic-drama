/**
 * 创意工具写库后的项目 revision 登记，供浏览器壳轮询对齐落库。
 */
import { readProject, resolveRoot } from './db.mjs'

/** @type {Map<string, { revision: number, updatedAt: number }>} */
const ledger = new Map()

export function bumpStudioProjectRevision(root, projectName) {
  const name = String(projectName || '').trim()
  if (!name) return
  try {
    const p = readProject(resolveRoot(root), name)
    const revision = Math.max(0, Math.floor(Number(p.revision) || 0))
    ledger.set(name, { revision, updatedAt: Date.now() })
  } catch {
    ledger.delete(name)
  }
}

export function peekStudioProjectLedger(projectName) {
  const name = String(projectName || '').trim()
  return ledger.get(name) ?? null
}

/** 从库读当前 revision（轮询真源） */
export function readProjectRevision(root, projectName) {
  const name = String(projectName || '').trim()
  if (!name) return 0
  const p = readProject(resolveRoot(root), name)
  return Math.max(0, Math.floor(Number(p.revision) || 0))
}