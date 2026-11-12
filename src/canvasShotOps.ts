/**
 * 画布镜头操作纯函数：新增、插入、删除、改号的「计划」。
 *
 * 为什么要计划而不是直接改状态：写入 project.json 可能失败，
 * 失败时必须保持项目与画布都不变，所以先把结果算出来，再交给落库层。
 */
import type { ProjectShot } from './api'
import type { CharacterSheet } from './characters'
import { auditKeyframePrompt } from './promptAudit'
import { blankShot, findDuplicateNos, insertAfter, nextShotNo } from './shotRows'

export const episodeOf = (s: Pick<ProjectShot, 'id' | 'no' | 'episode'>) => Number(s.episode) || 1

const pad = (n: number) => String(n).padStart(2, '0')

function noNumber(no: string | undefined): number | null {
  const m = String(no ?? '').match(/(\d+)/)
  if (!m) return null
  const n = Number(m[1])
  return Number.isFinite(n) ? n : null
}

/** 集内已占用的镜号 */
function usedNos(shots: ProjectShot[], ep: number): Set<string> {
  return new Set(
    shots
      .filter((s) => episodeOf(s) === ep)
      .map((s) => String(s.no ?? '').trim())
      .filter(Boolean),
  )
}

/**
 * 某镜之后的镜号：
 * - 紧邻的整数号空着就用它；
 * - 已被占用时挂小数后缀（`S02.1`），按数字排序仍落在 S02 与 S03 之间。
 */
export function nextNoAfter(shots: ProjectShot[], ep: number, targetNo: string): string {
  const used = usedNos(shots, ep)
  const n = (noNumber(targetNo) ?? 0) + 1
  const candidate = `S${pad(n)}`
  if (!used.has(candidate)) return candidate
  let i = 1
  while (used.has(`${targetNo}.${i}`)) i++
  return `${targetNo}.${i}`
}

/** 集内镜号唯一性校验；返回错误文案，null 表示通过 */
export function validateShotNos(shots: ProjectShot[], eps?: number[]): string | null {
  const list = eps ?? [...new Set(shots.map(episodeOf))]
  for (const ep of list) {
    const dups = findDuplicateNos(shots, ep)
    if (dups.length) return `第 ${ep} 集镜号「${dups[0].no}」重复，未写入`
  }
  return null
}

/** 旧有新无 = 本次导入真正删掉的镜头（只算受影响集，避免误删别的集） */
export function deletedShotIds(prev: ProjectShot[], next: ProjectShot[], eps?: number[]): string[] {
  const scope = eps ?? [...new Set(next.map(episodeOf))]
  const keep = new Set(next.map((s) => s.id))
  const inScope = new Set(scope)
  return prev
    .filter((s) => inScope.has(episodeOf(s)) && !keep.has(s.id))
    .map((s) => s.id)
}

/** 新增镜头：集内最大号 + 1 */
export function planAddShot(shots: ProjectShot[], ep: number): { shot: ProjectShot; next: ProjectShot[] } {
  const shot = blankShot(ep, nextShotNo(shots, ep))
  return { shot, next: [...shots, shot] }
}

/** 在某镜之后插入：新镜头紧跟目标，镜号在集内唯一 */
export function planInsertAfter(
  shots: ProjectShot[],
  afterShotId: string,
): { shot: ProjectShot; next: ProjectShot[] } | null {
  const target = shots.find((s) => s.id === afterShotId)
  if (!target) return null
  const ep = episodeOf(target)
  const shot = blankShot(ep, nextNoAfter(shots, ep, target.no ?? ''))
  return { shot, next: insertAfter(shots, afterShotId, shot) }
}

/** 删除镜头：同时清掉上一镜指向它的 transition_out，避免水合时把边修回来 */
export function planDeleteShot(
  shots: ProjectShot[],
  shotId: string,
): { next: ProjectShot[]; deletes: string[] } {
  const next = shots
    .filter((s) => s.id !== shotId)
    .map((s) => (s.transition_out?.to === shotId ? { ...s, transition_out: undefined } : s))
  return { next, deletes: [shotId] }
}

/** 批量删除：一次清掉所有目标与指向它们的转场 */
export function planDeleteShots(
  shots: ProjectShot[],
  shotIds: string[],
): { next: ProjectShot[]; deletes: string[] } {
  const gone = new Set(shotIds)
  const next = shots
    .filter((s) => !gone.has(s.id))
    .map((s) => (s.transition_out?.to && gone.has(s.transition_out.to) ? { ...s, transition_out: undefined } : s))
  return { next, deletes: [...gone] }
}

/**
 * 导入落库计划：先校验镜号唯一，再算「旧有新无」的删除集合。
 * 调用方只在这份计划算成功后落库，失败时项目与画布都不动。
 */
export function planShotImport(
  prev: ProjectShot[],
  resultShots: ProjectShot[],
): { shots: ProjectShot[]; deletes: string[]; error?: string } {
  const eps = [...new Set(resultShots.map(episodeOf))]
  const invalid = validateShotNos(resultShots, eps)
  if (invalid) return { shots: prev, deletes: [], error: invalid }
  return { shots: resultShots, deletes: deletedShotIds(prev, resultShots, eps) }
}

/**
 * 补齐当前集锚点：无法展开的角色占位替换为外观锚点，并标记人改。
 * 只改当前集；缺失角色没有外观锚点时保持原样。
 */
export function planFixAnchors(
  shots: ProjectShot[],
  ep: number,
  chars: CharacterSheet[],
): { shots: ProjectShot[]; fixed: number; skipped: number } {
  let fixed = 0
  let skipped = 0
  const next = shots.map((s) => {
    if (episodeOf(s) !== ep) return s
    const a = auditKeyframePrompt(s, chars)
    if (a.empty || a.missing.length === 0) return s
    const add = a.missing.map((name) => chars.find((c) => c.name === name)?.lookEn || '').filter(Boolean)
    if (add.length === 0) {
      skipped++
      return s
    }
    fixed++
    return {
      ...s,
      keyframe_prompt: `${(s.keyframe_prompt || '').trim()}, ${add.join(', ')}`,
      handEdited: [...new Set([...(s.handEdited ?? []), 'keyframe_prompt'])],
    }
  })
  return { shots: next, fixed, skipped }
}

/**
 * 改镜号 = 新镜 + 删旧镜：id 由 `E{集}-{镜号}` 生成，原地改号会留下指向旧 id 的边。
 * 冲突时返回错误并保持原数组不变。
 */
export function planRenameShotNo(
  shots: ProjectShot[],
  shotId: string,
  rawNo: string,
): { ok: true; next: ProjectShot[]; deletes: string[]; newId: string } | { ok: false; error: string } {
  const src = shots.find((s) => s.id === shotId)
  if (!src) return { ok: false, error: '镜头不存在' }
  const no = String(rawNo ?? '').trim()
  if (!no || no === src.no) return { ok: false, error: '' }
  const ep = episodeOf(src)
  const dup = shots.some((s) => episodeOf(s) === ep && String(s.no ?? '').trim() === no && s.id !== shotId)
  if (dup) return { ok: false, error: `E${pad(ep)} 已有镜号「${no}」，未修改` }
  const newId = blankShot(ep, no).id
  const next = shots.map((s) => {
    if (s.id === shotId) return { ...s, id: newId, no }
    // 指向旧 id 的转场跟着改号走，避免接缝丢失
    if (s.transition_out?.to === shotId) {
      return { ...s, transition_out: { ...s.transition_out, to: newId } }
    }
    return s
  })
  return { ok: true, next, deletes: [shotId], newId }
}
