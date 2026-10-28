/**
 * 导入输入的格式识别：决定走零模型路径还是请模型整理。
 *
 * 判定顺序按成本从低到高：JSON（可能就是契约本身）→ 表格（表头能映射）
 * → 兜底自由文本（只有这种才需要「让模型整理」）。
 */

export type IntakeFormat = 'json' | 'markdown-table' | 'csv' | 'tsv' | 'free-text' | 'empty'

export type FormatResult = {
  kind: IntakeFormat
  /** 人读的原因，直接显示在导入对话框里 */
  reason: string
  /** JSON 解析成功时的对象；其它格式为 undefined */
  json?: unknown
}

/** 一行里出现 2 个以上分隔符才可能算表格，避免把正文里的逗号当 CSV */
function delimiterScore(line: string, delim: string): number {
  let n = 0
  let quoted = false
  for (const ch of line) {
    if (ch === '"') quoted = !quoted
    else if (ch === delim && !quoted) n++
  }
  return n
}

/** 判断若干行是否是 Markdown 表格：至少表头 + 分隔行 */
export function looksLikeMarkdownTable(lines: string[]): boolean {
  const meaningful = lines.filter((l) => l.trim())
  if (meaningful.length < 2) return false
  const head = meaningful[0].trim()
  const sep = meaningful[1].trim()
  if (!head.startsWith('|') && !head.includes('|')) return false
  // 分隔行：| --- | :---: | 这种
  return /^\|?\s*:?-{2,}:?\s*(\|\s*:?-{2,}:?\s*)+\|?$/.test(sep)
}

/**
 * 识别格式。只看前若干行做判断——整篇文本扫一遍没必要，
 * 而且剧本很长时全量扫描只会拖慢导入对话框。
 */
export function detectFormat(text: string): FormatResult {
  const raw = String(text ?? '')
  if (!raw.trim()) return { kind: 'empty', reason: '没有内容' }

  const trimmed = raw.trim()

  // 1) JSON：允许被 ```json 围栏包着（模型和文档里都常见）
  const fenced = trimmed.match(/^```(?:json)?\s*\n([\s\S]*?)\n```$/)
  const jsonText = (fenced ? fenced[1] : trimmed).trim()
  if (jsonText.startsWith('{') || jsonText.startsWith('[')) {
    try {
      const parsed = JSON.parse(jsonText)
      return { kind: 'json', reason: '内容是 JSON', json: parsed }
    } catch {
      // 落到后面按文本处理，但要在原因里说清不是合法 JSON
    }
  }

  const lines = trimmed.split(/\r?\n/).slice(0, 40)

  // 2) Markdown 表格
  if (looksLikeMarkdownTable(lines)) {
    return { kind: 'markdown-table', reason: '内容是 Markdown 表格' }
  }

  // 3) CSV / TSV：看前几行的分隔符一致性
  const sample = lines.filter((l) => l.trim()).slice(0, 5)
  if (sample.length >= 2) {
    const tabs = sample.map((l) => delimiterScore(l, '\t'))
    const commas = sample.map((l) => delimiterScore(l, ','))
    const minTabs = Math.min(...tabs)
    const minCommas = Math.min(...commas)
    if (minTabs >= 1 && tabs.every((n) => n >= 1)) {
      return { kind: 'tsv', reason: '内容是制表符分隔的表格' }
    }
    if (minCommas >= 2 && commas.every((n) => n >= 2)) {
      return { kind: 'csv', reason: '内容是逗号分隔的表格' }
    }
  }

  if (jsonText.startsWith('{') || jsonText.startsWith('[')) {
    return { kind: 'free-text', reason: '内容看起来是 JSON 但不合法，需要整理' }
  }
  return { kind: 'free-text', reason: '内容是自由文本，需要整理成结构化草稿' }
}

/** 表格式的格式（可直接映射字段，不用模型） */
export function isTabular(kind: IntakeFormat): boolean {
  return kind === 'markdown-table' || kind === 'csv' || kind === 'tsv'
}

/**
 * 从整篇 Markdown 里抽出所有表格块。
 *
 * 为什么要抽块：真实分镜表是「文档 + 表格」——标题、简介、注意事项都在表格外。
 * 直接按 `|` 切全文会把标题行当成表头，导致「没有镜号列」的误判（实测踩到）。
 */
export function markdownTableBlocks(text: string): string[][][] {
  const lines = String(text ?? '').replace(/^\uFEFF/, '').split(/\r?\n/)
  const blocks: string[][][] = []
  let cur: string[][] = []
  for (const line of lines) {
    const t = line.trim()
    if (t.startsWith('|')) {
      const cells = t
        .replace(/^\|/, '')
        .replace(/\|$/, '')
        .split('|')
        .map((c) => c.trim().replace(/^`|`$/g, '').trim())
      cur.push(cells)
    } else if (cur.length) {
      blocks.push(cur)
      cur = []
    }
  }
  if (cur.length) blocks.push(cur)
  // 去掉纯分隔行开头的块（没有表头的碎片）
  return blocks.filter((b) => b.length >= 2)
}

/**
 * 把表格文本切成二维数组。三种表格共用一套分列，只有分隔符不同。
 * 支持 "..." 包裹（内部逗号/制表符不切分）与空单元格。
 * Markdown 会先抽块，只取第一块（含表头的那块）。
 */
export function parseTable(text: string, kind: IntakeFormat): string[][] {
  const raw = String(text ?? '').replace(/^\uFEFF/, '')
  const lines = raw.split(/\r?\n/).filter((l) => l.trim())

  if (kind === 'markdown-table') {
    const blocks = markdownTableBlocks(text)
    if (!blocks.length) return []
    const block = blocks[0]
    return block.filter((cells) => !cells.every((c) => /^:?-{2,}:?$/.test(c.trim())))
  }

  const delim = kind === 'tsv' ? '\t' : ','
  const rows: string[][] = []
  for (const line of lines) {
    if (line.trimStart().startsWith('#')) continue
    const cells: string[] = []
    let cur = ''
    let quoted = false
    for (let i = 0; i < line.length; i++) {
      const ch = line[i]
      if (ch === '"') {
        // "" 是转义的引号
        if (quoted && line[i + 1] === '"') {
          cur += '"'
          i++
        } else quoted = !quoted
      } else if (ch === delim && !quoted) {
        cells.push(cur.trim())
        cur = ''
      } else cur += ch
    }
    cells.push(cur.trim())
    rows.push(cells)
  }
  return rows
}
