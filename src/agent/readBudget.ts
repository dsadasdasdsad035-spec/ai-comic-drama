/**
 * 读工具的装填预算：按整条记录装填，绝不切 JSON 文本。
 *
 * 为什么不用字符切片：`JSON.stringify` 之后取前 N 个字符，得到的是半截 JSON，
 * 模型解析不了，也无法知道后面还有多少条。镜头记录里 `video_prompt`、
 * `transition_out`、`refIds` 都排在末尾，一切就全丢——实测一集 31 镜里
 * 只有第 1 镜能被读到。
 *
 * 这里的取舍固定为三条：
 * 1. 只装整条：装不下的整条不装，已装的字段一个不少。
 * 2. 至少装一条：空列表等于没回答；单条自身超预算时仍整条返回并标 `oversized`。
 * 3. 截断必须可见：`total` 与 `returned` 永远给出，`truncated` 明确标记。
 */

export type PackedRecords<T> = {
  /** 本次实际装填的记录，均为完整条目 */
  items: T[]
  /** 候选总数（未受预算影响的原始条数） */
  total: number
  /** 本次返回条数，等于 items.length */
  returned: number
  /** 还有记录没装进来 */
  truncated: boolean
  /** 本次返回的记录里有单条自身就超过预算（此时预算已让位，不是错误） */
  oversized: boolean
}

/** 单条记录的序列化长度；序列化失败时退回字符串长度，不让预算计算抛错 */
export function recordSize(value: unknown): number {
  try {
    const text = JSON.stringify(value)
    return text ? text.length : 0
  } catch {
    return String(value ?? '').length
  }
}

/**
 * 按整条装填 `items`，累计序列化长度不超过 `budget`。
 *
 * @param items  已按展示顺序排列的记录
 * @param budget 字符预算；非正数按 0 处理（此时只保证「至少装一条」）
 */
export function packRecords<T>(items: readonly T[], budget: number): PackedRecords<T> {
  const total = items.length
  const limit = Number.isFinite(budget) ? Math.max(0, Math.floor(budget)) : 0
  const out: T[] = []
  let used = 0
  let oversized = false
  for (const item of items) {
    const size = recordSize(item)
    // 第一条无条件装入：返回空列表等于告诉调用方「没有数据」，那是错误结论
    if (out.length === 0) {
      out.push(item)
      used = size
      if (size > limit) oversized = true
      continue
    }
    if (used + size > limit) break
    out.push(item)
    used += size
    if (size > limit) oversized = true
  }
  return { items: out, total, returned: out.length, truncated: out.length < total, oversized }
}

/** 装填结果的通用响应字段，保证各读工具的截断标记形状一致 */
export function packFields<T>(packed: PackedRecords<T>): Record<string, unknown> {
  return {
    total: packed.total,
    returned: packed.returned,
    ...(packed.truncated ? { truncated: true } : {}),
    ...(packed.oversized ? { oversized: true } : {}),
  }
}

/** 截断说明：统一文案，避免每个工具各写一句 */
export function truncationNote(packed: PackedRecords<unknown>, next?: string): string | undefined {
  if (!packed.truncated) return undefined
  const tail = next
    ? `用 cursor: "${next}" 续读剩余 ${packed.total - packed.returned} 条`
    : `还有 ${packed.total - packed.returned} 条未返回，可缩小查询范围或改用钻取工具`
  return `本次返回 ${packed.returned}/${packed.total} 条：${tail}`
}
