/**
 * 镜头行操作纯函数：新镜号、插入、删除、集内重复检测。
 *
 * 为什么必须有镜号唯一性：镜头 id 由 `E{集}-{镜号}` 生成，
 * 同集重复镜号会让两条镜头拿到同一个 id，之后任何一次拆镜/导入都互相覆盖。
 */
import type { ProjectShot } from './api'

const pad = (n: number) => String(n).padStart(2, '0')

/** 正式镜头 id：`E{两位集号}-{镜号}` */
export function canonicalShotId(episode: number, no: string): string {
  const ep = Math.max(1, Math.floor(Number(episode) || 1))
  return `E${pad(ep)}-${String(no ?? '').trim()}`
}

/** 从 `shotId` 前缀解析集号；无法解析时返回 null */
export function episodeFromShotId(id: string | undefined): number | null {
  const m = String(id ?? '').trim().match(/^E(\d{1,4})-/i)
  if (!m) return null
  const n = Number(m[1])
  return Number.isFinite(n) && n > 0 ? n : null
}

/** 画布卡头 / 顶栏展示的集标签 */
export function formatEpisodeLabel(ep: number): string {
  return `E${pad(Math.max(1, Math.floor(Number(ep) || 1)))}`
}

/** 按 `episode` + `no` 修正单条镜头的 `id` */
export function reconcileShotRow(s: ProjectShot): ProjectShot {
  const no = String(s.no ?? '').trim()
  if (!no) return s
  const ep = Number(s.episode) || 1
  const id = canonicalShotId(ep, no)
  if (s.id === id) return s
  return { ...s, id }
}

/**
 * 批量修正 `id` 与 `episode` 漂移，并重映射 `transition_out.to`。
 */
export function reconcileProjectShots(shots: ProjectShot[]): {
  shots: ProjectShot[]
  idMap: Map<string, string>
  changed: number
} {
  const idMap = new Map<string, string>()
  let changed = 0
  const next = shots.map((s) => {
    const fixed = reconcileShotRow(s)
    if (fixed.id !== s.id) {
      idMap.set(s.id, fixed.id)
      changed++
    }
    return fixed
  })
  if (idMap.size === 0) return { shots: next, idMap, changed }
  const withTransitions = next.map((s) => {
    const to = s.transition_out?.to
    if (!to) return s
    const mapped = idMap.get(to) ?? to
    if (mapped === to) return s
    return { ...s, transition_out: { ...s.transition_out!, to: mapped } }
  })
  return { shots: withTransitions, idMap, changed }
}

type Row = Pick<ProjectShot, 'id' | 'no' | 'episode'>

/** 从镜号里取数字；`S07` / `07` / `第7镜` 都能取到 7 */
function noNumber(no: string | undefined): number | null {
  const m = String(no ?? '').match(/(\d+)/)
  if (!m) return null
  const n = Number(m[1])
  return Number.isFinite(n) ? n : null
}

/**
 * 下一个镜号：集内最大值 + 1。
 *
 * 不复用空洞：删掉 S02 后再加一镜得到 S07 而不是 S02。
 * 复用空洞会让人误以为这是原来那一镜，而 id 若被复用还可能命中残留引用。
 */
export function nextShotNo(shots: Row[], epNo: number): string {
  const max = shots
    .filter((s) => (Number(s.episode) || 1) === epNo)
    .reduce((m, s) => Math.max(m, noNumber(s.no) ?? 0), 0)
  return `S${pad(max + 1)}`
}

/** 在指定镜头之后插入一行；找不到目标时追加到末尾 */
export function insertAfter<T extends Row>(shots: T[], afterId: string, row: T): T[] {
  const idx = shots.findIndex((s) => s.id === afterId)
  if (idx < 0) return [...shots, row]
  return [...shots.slice(0, idx + 1), row, ...shots.slice(idx + 1)]
}

export function removeRow<T extends Row>(shots: T[], id: string): T[] {
  return shots.filter((s) => s.id !== id)
}

/** 本集内重复的镜号；跨集同号是正常的 */
export function findDuplicateNos(shots: Row[], epNo: number): { no: string; ids: string[] }[] {
  const seen = new Map<string, string[]>()
  const out: { no: string; ids: string[] }[] = []
  for (const s of shots) {
    if ((Number(s.episode) || 1) !== epNo) continue
    const no = String(s.no ?? '').trim()
    if (!no) continue
    const list = seen.get(no)
    if (list) {
      list.push(s.id)
      if (!out.some((d) => d.no === no)) out.push({ no, ids: list })
    } else seen.set(no, [s.id])
  }
  return out
}

/** 新建一行的默认值：时长 3、中景、固定，不继承任何产物 */
export function blankShot(
  epNo: number,
  no: string,
  prodKind: 'image' | 'video' = 'video',
): ProjectShot {
  return {
    id: canonicalShotId(epNo, no),
    prod_kind: prodKind,
    episode: epNo,
    no,
    seconds: 3,
    size: '中景',
    move: '固定',
    desc: '',
    dialogue: [],
    cast: [],
  }
}
