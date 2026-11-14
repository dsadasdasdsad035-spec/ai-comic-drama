/** 账号页的纯展示辅助函数：数字、时间、流水类型的中文化都在这里 */

const creditFmt = new Intl.NumberFormat('zh-CN', { maximumFractionDigits: 2 })
const priceFmt = new Intl.NumberFormat('zh-CN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })

/** 积分：整数不显示小数，带千分位 */
export function formatCredits(n: number | null | undefined): string {
  if (typeof n !== 'number' || !Number.isFinite(n)) return '0'
  return creditFmt.format(n)
}

/** 人民币：固定两位小数 */
export function formatCny(n: number | null | undefined): string {
  const v = typeof n === 'number' && Number.isFinite(n) ? n : 0
  return priceFmt.format(v)
}

/** 单位成本：档位越小单价越高，保留 4 位便于横向比较 */
export function unitPrice(priceCny: number, credits: number): string {
  if (!credits || !Number.isFinite(priceCny)) return '—'
  return (priceCny / credits).toFixed(4)
}

/** 赠送比例：以基础积分为基准，取整显示 */
export function bonusPercent(bonus: number | undefined, total: number): number {
  if (!bonus || bonus <= 0) return 0
  const base = total - bonus
  if (base <= 0) return 0
  return Math.round((bonus / base) * 100)
}

/** 流水类型 → 中文标签与色调 */
export function ledgerTypeMeta(type?: string): { label: string; tone: 'in' | 'out' | 'neutral' } {
  switch (String(type || '')) {
    case 'recharge':
      return { label: '充值', tone: 'in' }
    case 'gift':
      return { label: '赠送', tone: 'in' }
    case 'usage':
      return { label: '消耗', tone: 'out' }
    case 'refund':
      return { label: '退款', tone: 'in' }
    default:
      return { label: type ? String(type) : '其他', tone: 'neutral' }
  }
}

/**
 * SQLite 的 datetime('now') 返回 UTC 的 `YYYY-MM-DD HH:MM:SS`。
 * 这里按本地时区展示到分钟，解析失败就原样返回，不吞掉信息。
 */
export function formatTime(raw?: string): string {
  const s = String(raw || '')
  if (!s) return '—'
  const normalized = s.includes('T') ? s : s.replace(' ', 'T') + 'Z'
  const d = new Date(normalized)
  if (Number.isNaN(d.getTime())) return s
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${d.getMonth() + 1}/${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`
}

/** 邮箱首字母头像：取 @ 前的首字符 */
export function initialOf(email?: string): string {
  const c = String(email || '').trim().charAt(0)
  return c ? c.toUpperCase() : '?'
}
