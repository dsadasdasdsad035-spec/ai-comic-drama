/**
 * 镜头行操作纯函数：新镜号、插入、删除、集内重复检测。
 *
 * 为什么必须有镜号唯一性：镜头 id 由 `E{集}-{镜号}` 生成，
 * 同集重复镜号会让两条镜头拿到同一个 id，之后任何一次拆镜/导入都互相覆盖。
 */
import type { ProjectShot } from './api'

const pad = (n: number) => String(n).padStart(2, '0')

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
export function blankShot(epNo: number, no: string): ProjectShot {
  return {
    id: `E${pad(epNo)}-${no}`,
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
