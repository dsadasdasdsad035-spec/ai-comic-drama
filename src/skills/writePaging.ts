/**
 * 分批写入的宿主侧规则：单批条数、游标签发与校验、快照指纹。
 *
 * 为什么需要游标：模型单次输出有上限，分镜/提示词这类数组型写回很容易撞顶。
 * 只让模型「自己拆小」不够——没有宿主签发的游标，模型无法知道自己写到哪、
 * 也分不清「同一批重试」与「下一批续写」。
 *
 * 三条硬约束：
 * 1. 游标必须由宿主签发：自造 token 解不出来，也不会出现在 ISSUED 表里。
 * 2. 游标绑定编辑状态指纹：批次之间项目被改动过就失效，必须重新读取。
 * 3. 未写完的部分留在宿主（PENDING），模型下一批只带游标即可，不必重发整段。
 */

export type WritePagingPlan = {
  /** 契约里承载批次的数组字段 */
  key: string
  /** 单条业务键：合并与游标定位用 */
  identity: string
  /** 游标失效时的重读入口 */
  reread: string
  /** 默认单批条数 */
  defaultLimit: number
}

/** 只有「单数组 + 业务键稳定」的契约适合分批；其余保持一次性写入。 */
export const WRITE_PAGING: Record<string, WritePagingPlan> = {
  'shots-v1': { key: 'shots', identity: 'no', reread: 'read_shots', defaultLimit: 8 },
  'prompts-v1': { key: 'shots', identity: 'no', reread: 'read_shot_detail', defaultLimit: 8 },
  'prompt-renders-v1': { key: 'shots', identity: 'no', reread: 'read_shot_detail', defaultLimit: 8 },
  'characters-v1': { key: 'characters', identity: 'name', reread: 'read_characters', defaultLimit: 6 },
  'assets-v1': { key: 'assets', identity: 'title', reread: 'read_asset_inventory', defaultLimit: 8 },
  'joins-v1': { key: 'joins', identity: 'after_no', reread: 'read_shots', defaultLimit: 8 },
  'script-v1': { key: 'episodes', identity: 'no', reread: 'read_episode', defaultLimit: 4 },
}

export function pagingPlan(contractId: string): WritePagingPlan | undefined {
  return WRITE_PAGING[contractId]
}

/** 单次提交的字符上限：超过就分批，避免半截 JSON 或 400 体积超限。 */
export const SUBMIT_CHAR_LIMIT = 24_000

function fnv1a(text: string): string {
  let h = 0x811c9dc5
  for (let i = 0; i < text.length; i++) {
    h ^= text.charCodeAt(i)
    h = Math.imul(h, 0x01000193) >>> 0
  }
  return h.toString(16).padStart(8, '0')
}

/** 编辑状态指纹：只看宿主自己的草稿，批次之间被改动就会变。 */
export function fingerprintOf(value: unknown): string {
  let text = ''
  try {
    text = JSON.stringify(value ?? null)
  } catch {
    text = String(value)
  }
  return `${fnv1a(text)}${fnv1a(`${text.length}:${text.slice(0, 64)}`)}`
}

function b64encode(text: string): string {
  const bytes = new TextEncoder().encode(text)
  let binary = ''
  bytes.forEach((byte) => {
    binary += String.fromCharCode(byte)
  })
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
}

function b64decode(token: string): string | null {
  try {
    const padded = token.replace(/-/g, '+').replace(/_/g, '/')
    const pad = padded.length % 4 ? '='.repeat(4 - (padded.length % 4)) : ''
    const binary = atob(padded + pad)
    const bytes = Uint8Array.from(binary, (ch) => ch.charCodeAt(0))
    return new TextDecoder().decode(bytes)
  } catch {
    return null
  }
}

export type CursorData = {
  contractId: string
  /** 签发时的草稿指纹 */
  fingerprint: string
  /** 已接受批次序号（0 起） */
  seq: number
  /** 上一批最后一条的业务键，便于回执与排查 */
  lastKey: string
}

type PendingBatch = {
  contractId: string
  /** 尚未写入的条目（保持原顺序） */
  items: unknown[]
  fingerprint: string
}

/** 宿主签发过的游标：自造 token 不在表里，一律拒绝 */
const ISSUED = new Map<string, CursorData>()
/** 游标对应的待写批次；消费后删除，重复使用会被识别为已写入 */
const PENDING = new Map<string, PendingBatch>()
const CONSUMED = new Set<string>()

/** 签发游标（同内容复用一个 token，便于回执稳定） */
export function issueCursor(data: CursorData): string {
  const token = b64encode(JSON.stringify(data))
  ISSUED.set(token, data)
  return token
}

export type CursorRead =
  | { ok: true; data: CursorData; pending: PendingBatch | undefined }
  | { ok: false; error: string; hint: string }

/**
 * 校验游标：解码 → 是否宿主签发 → 契约一致 → 编辑状态未变。
 * 任一不满足都拒绝本批，并给出重读入口（不让模型猜）。
 */
export function readCursor(token: string, contractId: string, fingerprint: string): CursorRead {
  const plan = pagingPlan(contractId)
  const reread = plan?.reread || '对应的 read_* 读取工具'
  const decoded = b64decode(token)
  if (!decoded) {
    return {
      ok: false,
      error: '游标不是宿主签发的（无法解析）',
      hint: `不要自造 cursor。先用 ${reread} 读取现状，或省略 cursor 从第一批重新提交。`,
    }
  }
  const known = ISSUED.get(token)
  if (!known) {
    return {
      ok: false,
      error: '游标不是宿主签发的',
      hint: `不要自造 cursor。先用 ${reread} 读取现状，或省略 cursor 从第一批重新提交。`,
    }
  }
  if (known.contractId !== contractId) {
    return {
      ok: false,
      error: `游标属于 ${known.contractId}，与本次写入契约 ${contractId} 不一致`,
      hint: '换回该契约自己的游标，或省略 cursor 重新开始分批。',
    }
  }
  if (CONSUMED.has(token)) {
    return {
      ok: false,
      error: '该批次已写入过（游标已被消费）',
      hint: '无需重复提交；若还有后续条目，用回执里最新的 nextCursor，或重新提交剩余数据。',
    }
  }
  if (known.fingerprint !== fingerprint) {
    return {
      ok: false,
      error: '编辑状态已变化，游标失效',
      hint: `批次之间项目被改动过。请先用 ${reread} 重新读取，再按最新内容继续提交。`,
    }
  }
  return { ok: true, data: known, pending: PENDING.get(token) }
}

/** 登记待写批次并签发续写游标 */
export function stashPending(
  contractId: string,
  items: unknown[],
  fingerprint: string,
  seq: number,
  lastKey: string,
): string {
  const cursor = issueCursor({ contractId, fingerprint, seq, lastKey })
  PENDING.set(cursor, { contractId, items, fingerprint })
  return cursor
}

/** 消费游标：写入成功后才调用，保证失败批次可重试 */
export function consumeCursor(token: string): void {
  PENDING.delete(token)
  CONSUMED.add(token)
}

/** 清空宿主状态（测试用；也用于项目切换时避免串数据） */
export function resetWritePaging(): void {
  ISSUED.clear()
  PENDING.clear()
  CONSUMED.clear()
}

/** 按字符预算切出本批条目；单条自身就超限时返回 null（交给调用方给拆条建议） */
export function takeBatchByChars(
  items: readonly unknown[],
  maxChars: number,
  maxItems: number,
): { batch: unknown[]; rest: unknown[] } | null {
  const batch: unknown[] = []
  let used = 0
  for (let i = 0; i < items.length; i++) {
    if (batch.length >= maxItems) break
    let size = 0
    try {
      size = JSON.stringify(items[i]).length
    } catch {
      size = 0
    }
    // 首条无论多大都要接受一次，否则永远无法推进；超限由字符预检单独拦。
    if (batch.length > 0 && used + size > maxChars) break
    batch.push(items[i])
    used += size
  }
  if (!batch.length) return null
  return { batch, rest: items.slice(batch.length) }
}
