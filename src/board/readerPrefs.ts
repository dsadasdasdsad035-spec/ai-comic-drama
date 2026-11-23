/**
 * 剧本阅读排版偏好。
 *
 * 跟人不跟项目：写 localStorage 而不是 project.json——这是阅读习惯，
 * 不是作品属性。隐私模式下 localStorage 会抛错，全部读写都兜底，
 * 失败时按默认值渲染，不阻断阅读。
 */
export type ReaderFamily = 'serif' | 'sans'
export type ReaderAlign = 'justify' | 'left'

/**
 * 纸张主题。
 *
 * 与应用全局主题（`html[data-theme='day'|'night']`）正交：用户可能白天读
 * 「夜间墨」，也可能开着暗色应用读「羊皮纸」。所以它是阅读器局部的一份数据属性，
 * 不参与全局主题切换。
 *
 * - paper     书页白：中性纸色，最接近打印稿
 * - parchment 羊皮纸：暖黄、偏旧、默认衬线
 * - ink       夜间墨：深底浅字，长时间夜间阅读
 * - terminal  终端：等宽、低饱和、偏冷
 */
export type ReaderTheme = 'paper' | 'parchment' | 'ink' | 'terminal'

export type ReaderPrefs = {
  /** 正文字号 px */
  size: number
  /** 行距倍数 */
  leading: number
  family: ReaderFamily
  align: ReaderAlign
  /** 首行缩进 */
  indent: boolean
  /** 纸张主题 */
  theme: ReaderTheme
}

export const READER_PREFS_KEY = 'storyboard-script-reader'

export const READER_DEFAULTS: ReaderPrefs = {
  size: 17,
  leading: 2,
  family: 'serif',
  align: 'justify',
  indent: true,
  theme: 'paper',
}

export const READER_SIZES = [15, 16, 17, 18] as const
export const READER_LEADINGS = [1.8, 2, 2.2] as const

/** 主题的显示名与顺序：菜单按这个顺序渲染 */
export const READER_THEMES: Array<{ id: ReaderTheme; label: string; hint: string }> = [
  { id: 'paper', label: '书页', hint: '中性纸色，接近打印稿' },
  { id: 'parchment', label: '羊皮', hint: '暖黄旧纸，默认衬线' },
  { id: 'ink', label: '夜墨', hint: '深底浅字，夜间久读' },
  { id: 'terminal', label: '终端', hint: '等宽低饱和，偏冷' },
]

/**
 * 主题 → 版心配色 + 纹理强度 + 推荐的排版。
 *
 * 为什么集中在一处：书页 CSS 变量与 mermaid 的 `themeVariables` 必须同源，
 * 两处各写一份迟早漂移——最典型的表现是「羊皮纸上画着深色流程图」。
 *
 * `grain` 是纹理透明度（0–0.14）：纸越旧纹理越明显，终端不要纹理。
 */
export type ReaderThemeSpec = {
  paper: string
  ink: string
  inkSoft: string
  rule: string
  grain: number
  /** 主题默认字族建议；只在用户没显式选过时生效 */
  familyHint: ReaderFamily
  /** mermaid 的主题变量 */
  diagram: {
    primaryColor: string
    primaryTextColor: string
    primaryBorderColor: string
    lineColor: string
    secondaryColor: string
    tertiaryColor: string
    background: string
    mainBkg: string
    textColor: string
    nodeBorder: string
    clusterBkg: string
    clusterBorder: string
    titleColor: string
    edgeLabelBackground: string
  }
}

/**
 * 四套主题的取值。
 *
 * 对比度：正文 `ink` 与纸张 `paper` 均 ≥ 4.5:1（night/day 应用主题下同值，
 * 因为书页自带纸色，不跟随全局主题）。
 */
export const READER_THEME_SPECS: Record<ReaderTheme, ReaderThemeSpec> = {
  paper: {
    paper: '#fbf8f1',
    ink: '#23201b',
    inkSoft: '#5b5548',
    rule: '#ded5c7',
    grain: 0.04,
    familyHint: 'serif',
    diagram: {
      primaryColor: '#efe7d7',
      primaryTextColor: '#23201b',
      primaryBorderColor: '#b9a98d',
      lineColor: '#6d6455',
      secondaryColor: '#f5efe2',
      tertiaryColor: '#e8dfcd',
      background: '#fbf8f1',
      mainBkg: '#efe7d7',
      textColor: '#23201b',
      nodeBorder: '#b9a98d',
      clusterBkg: '#f5efe2',
      clusterBorder: '#cfc3ab',
      titleColor: '#23201b',
      edgeLabelBackground: '#fbf8f1',
    },
  },
  parchment: {
    paper: '#f3e6c8',
    ink: '#3a2d18',
    inkSoft: '#6b5940',
    rule: '#cdb98d',
    grain: 0.1,
    familyHint: 'serif',
    diagram: {
      primaryColor: '#e8d5aa',
      primaryTextColor: '#3a2d18',
      primaryBorderColor: '#a98a54',
      lineColor: '#7a6642',
      secondaryColor: '#eedfbe',
      tertiaryColor: '#dfcaa0',
      background: '#f3e6c8',
      mainBkg: '#e8d5aa',
      textColor: '#3a2d18',
      nodeBorder: '#a98a54',
      clusterBkg: '#eedfbe',
      clusterBorder: '#c2a878',
      titleColor: '#3a2d18',
      edgeLabelBackground: '#f3e6c8',
    },
  },
  ink: {
    paper: '#121820',
    ink: '#e2e8f0',
    inkSoft: '#9fb0c3',
    rule: '#2a3646',
    grain: 0.06,
    familyHint: 'serif',
    diagram: {
      primaryColor: '#1e2a38',
      primaryTextColor: '#e2e8f0',
      primaryBorderColor: '#3f5570',
      lineColor: '#7d93ab',
      secondaryColor: '#1a2430',
      tertiaryColor: '#16202a',
      background: '#121820',
      mainBkg: '#1e2a38',
      textColor: '#e2e8f0',
      nodeBorder: '#3f5570',
      clusterBkg: '#1a2430',
      clusterBorder: '#2f4155',
      titleColor: '#e2e8f0',
      edgeLabelBackground: '#121820',
    },
  },
  terminal: {
    paper: '#0d1210',
    ink: '#c8d6c8',
    inkSoft: '#8ba38b',
    rule: '#22302a',
    grain: 0,
    familyHint: 'sans',
    diagram: {
      primaryColor: '#16211b',
      primaryTextColor: '#c8d6c8',
      primaryBorderColor: '#3c5a48',
      lineColor: '#6f9078',
      secondaryColor: '#131c17',
      tertiaryColor: '#101814',
      background: '#0d1210',
      mainBkg: '#16211b',
      textColor: '#c8d6c8',
      nodeBorder: '#3c5a48',
      clusterBkg: '#131c17',
      clusterBorder: '#2a4034',
      titleColor: '#c8d6c8',
      edgeLabelBackground: '#0d1210',
    },
  },
}

export const READER_THEME_VALUES: ReaderTheme[] = ['paper', 'parchment', 'ink', 'terminal']

export function themeSpec(theme: ReaderTheme): ReaderThemeSpec {
  return READER_THEME_SPECS[theme] || READER_THEME_SPECS.paper
}

function clampPick<T extends number>(value: unknown, allowed: readonly T[], fallback: T): T {
  const n = Number(value)
  return (allowed as readonly number[]).includes(n) ? (n as T) : fallback
}

function normalizeTheme(value: unknown): ReaderTheme {
  const v = String(value ?? '')
  return (READER_THEME_VALUES as string[]).includes(v) ? (v as ReaderTheme) : READER_DEFAULTS.theme
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
      theme: normalizeTheme(parsed.theme),
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

/**
 * 偏好 → CSS 变量，挂在阅读根节点上。
 *
 * `--page-*` 前缀而不是复用书架的 `--reader-*`：书架那套 token 属于叶片与书脊，
 * 日夜各一份由全局主题切换；书页纸色由纸张主题决定。同名会互相覆盖。
 */
export function readerCssVars(prefs: ReaderPrefs): Record<string, string> {
  const spec = themeSpec(prefs.theme)
  return {
    '--reader-fs': `${prefs.size}px`,
    '--reader-lh': String(prefs.leading),
    '--reader-indent': prefs.indent ? '2em' : '0',
    '--page-paper': spec.paper,
    '--page-ink': spec.ink,
    '--page-ink-soft': spec.inkSoft,
    '--page-rule': spec.rule,
    '--page-grain': String(spec.grain),
  }
}
