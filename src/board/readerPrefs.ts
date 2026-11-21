/**
 * 剧本阅读排版偏好。
 *
 * 跟人不跟项目：写 localStorage 而不是 project.json——这是阅读习惯，
 * 不是作品属性。隐私模式下 localStorage 会抛错，全部读写都兜底，
 * 失败时按默认值渲染，不阻断阅读。
 */
export type ReaderFamily = 'serif' | 'sans'
export type ReaderAlign = 'justify' | 'left'

export type ReaderPrefs = {
  /** 正文字号 px */
  size: number
  /** 行距倍数 */
  leading: number
  family: ReaderFamily
  align: ReaderAlign
  /** 首行缩进 */
  indent: boolean
}

export const READER_PREFS_KEY = 'storyboard-script-reader'

export const READER_DEFAULTS: ReaderPrefs = {
  size: 17,
  leading: 2,
  family: 'serif',
  align: 'justify',
  indent: true,
}

export const READER_SIZES = [15, 16, 17, 18] as const
export const READER_LEADINGS = [1.8, 2, 2.2] as const

function clampPick<T extends number>(value: unknown, allowed: readonly T[], fallback: T): T {
  const n = Number(value)
  return (allowed as readonly number[]).includes(n) ? (n as T) : fallback
}

/** 读取偏好：任何异常或脏数据都回落到默认值 */
export function readReaderPrefs(): ReaderPrefs {
  try {
    const raw = localStorage.getItem(READER_PREFS_KEY)
    if (!raw) return READER_DEFAULTS
    const parsed = JSON.parse(raw) as Partial<ReaderPrefs>
    return {
      size: clampPick(parsed.size, READER_SIZES, READER_DEFAULTS.size),
      leading: clampPick(parsed.leading, READER_LEADINGS, READER_DEFAULTS.leading),
      family: parsed.family === 'sans' ? 'sans' : 'serif',
      align: parsed.align === 'left' ? 'left' : 'justify',
      indent: parsed.indent !== false,
    }
  } catch {
    return READER_DEFAULTS
  }
}

/** 写入偏好：失败静默（隐私模式） */
export function writeReaderPrefs(prefs: ReaderPrefs): void {
  try {
    localStorage.setItem(READER_PREFS_KEY, JSON.stringify(prefs))
  } catch {
    /* 无存储权限时忽略：本次会话内仍按内存状态渲染 */
  }
}

/** 偏好 → CSS 变量，挂在阅读根节点上 */
export function readerCssVars(prefs: ReaderPrefs): Record<string, string> {
  return {
    '--reader-fs': `${prefs.size}px`,
    '--reader-lh': String(prefs.leading),
    '--reader-indent': prefs.indent ? '2em' : '0',
  }
}
