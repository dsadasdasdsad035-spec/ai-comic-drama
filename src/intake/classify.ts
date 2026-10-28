/**
 * 压缩包内文件分类：判断每个文件能产出什么用途。
 *
 * 规则用真实资料包校准（github.com/dsadasdasdsad035-spec/cat）。两条被实测证伪的假设：
 * 1) 「一个文件一种用途」是错的——10 个分集文件全是「剧本 + 内嵌分镜表」双用途；
 * 2) 「正文出现『镜头』就是分镜表」是错的——图片索引 README 的表格单元格里
 *    写着「走路镜头」，按关键词会误判成分镜表。必须锚定表头行首列。
 */
export type BundleLabel = 'script' | 'shotlist' | 'prompts' | 'characters' | 'image'

export type ClassifiedFile = {
  id: string
  path: string
  name: string
  kind: 'text' | 'image'
  size: number
  labels: BundleLabel[]
  /** 集号范围：多集大纲不算单集 */
  episodeScope: 'single' | 'multi' | 'none'
  episodeNo?: number
  confidence: 'path' | 'name' | 'content' | 'none'
  reason: string
  /** 用户显式排除 */
  excluded?: boolean
  /** 用户改判后的用途；有值则覆盖 labels */
  override?: BundleLabel[] | null
}

const IMAGE_DIR = /参考照片|参考图|图片|照片|images?|photos?|refs?/i
const NAMED = {
  characters: /角色档案|项目设定|人物设定|角色设定|character/i,
  shotlist: /分镜|镜头表|storyboard|shotlist/i,
  prompts: /提示词|prompt/i,
  script: /剧本|分集|大纲|script|episode/i,
}

/** 分镜表判定：表头行首列必须是「镜头」或 shot，不是正文里出现「镜头」二字 */
export function hasShotTable(text: string): boolean {
  if (!text) return false
  return /^\|\s*(镜头|shot|镜号)\s*\|/im.test(text)
}

export function hasPromptBlocks(text: string): boolean {
  return /\*\*Prompt\*\*|Negative prompt|negative_prompt/i.test(text)
}

export function hasCharacterSection(text: string): boolean {
  return /###\s*外观锚点|^##\s*角色[A-Za-z一二三四五六七八九十]+\s*[：:]/m.test(text)
}

/**
 * 剧本正文特征：必须有真正的集标题或分集小节结构。
 * 「故事梗概」这类词在 README 的介绍文字里也会出现，不能单独当证据。
 */
export function hasScriptBody(text: string): boolean {
  if (/^#{1,6}\s*第\s*\d+\s*集/m.test(text)) return true
  if (/^#{1,6}\s*《[^》]+》\s*$/m.test(text) && /^##\s*(完整旁白稿|逐镜头分镜表)/m.test(text)) return true
  return false
}

/** 内容里出现几个「## 第 N 集」小节：0/1/多 决定单集还是多集大纲 */
export function episodeScopeOf(text: string): { scope: 'single' | 'multi' | 'none'; no?: number } {
  const nums = [...String(text || '').matchAll(/^#{1,6}\s*第\s*(\d+)\s*集/gm)].map((m) => Number(m[1]))
  const uniq = [...new Set(nums.filter((n) => Number.isFinite(n) && n > 0))]
  if (uniq.length === 0) return { scope: 'none' }
  if (uniq.length === 1) return { scope: 'single', no: uniq[0] }
  return { scope: 'multi' }
}

/** 文件名里的集号，仅作辅助校验 */
function fileNameEpisode(name: string): number | undefined {
  const m = String(name || '').match(/第\s*(\d+)\s*集/)
  return m ? Number(m[1]) : undefined
}

/**
 * 分类一个文件。
 * labels 为空 = 待判断，交给「让模型分析」或用户手动改判。
 */
export function classifyFile(input: {
  path: string
  name: string
  kind: 'text' | 'image'
  textPreview?: string
}): Omit<ClassifiedFile, 'id' | 'size'> {
  const { path, name, kind } = input
  const text = input.textPreview || ''

  if (kind === 'image') {
    const dirHit = IMAGE_DIR.test(path)
    return {
      path,
      name,
      kind,
      labels: ['image'],
      episodeScope: 'none',
      confidence: 'path',
      reason: dirHit ? '位于参考图目录' : '图片文件',
    }
  }

  // README / 说明 / 目录 这类文件是「关于包的文档」，不是产物本身。
  // 它们常常在标题里写着「完整剧本包」，凭文件名会整包误判成剧本。
  const isDocName = /^(README|readme|说明|目录|索引|INDEX|index)/.test(name.replace(/^[\d_\-\s]+/, ''))

  const labels = new Set<BundleLabel>()
  let via: ClassifiedFile['confidence'] = 'none'
  const reasons: string[] = []

  // 1) 文件名（说明类文件跳过：只认内容）
  if (!isDocName && NAMED.prompts.test(name) && !NAMED.script.test(name)) {
    labels.add('prompts')
    via = 'name'
    reasons.push('文件名含「提示词」')
  }
  if (!isDocName && NAMED.shotlist.test(name) && !NAMED.script.test(name)) {
    labels.add('shotlist')
    if (via === 'none') via = 'name'
    reasons.push('文件名含「分镜」')
  }
  if (!isDocName && NAMED.characters.test(name)) {
    labels.add('characters')
    if (via === 'none') via = 'name'
    reasons.push('文件名含「角色/项目设定」')
  }

  // 2) 内容（比文件名更可靠）
  if (hasShotTable(text)) {
    labels.add('shotlist')
    if (via === 'none' || via === 'name') via = 'content'
    reasons.push('含首列为「镜头」的表格')
  }
  if (hasPromptBlocks(text)) {
    labels.add('prompts')
    if (via === 'none') via = 'content'
    reasons.push('含 Prompt 段落')
  }
  if (hasCharacterSection(text)) {
    labels.add('characters')
    if (via === 'none') via = 'content'
    reasons.push('含外观锚点小节')
  }
  if (hasScriptBody(text)) {
    labels.add('script')
    if (via === 'none') via = 'content'
    reasons.push('含集标题或故事梗概')
  }

  const { scope, no } = episodeScopeOf(text)
  const fromName = fileNameEpisode(name)
  let episodeNo: number | undefined
  let episodeScope: ClassifiedFile['episodeScope'] = 'none'
  if (scope === 'multi') episodeScope = 'multi'
  else if (scope === 'single') {
    episodeScope = 'single'
    episodeNo = no
  } else if (fromName) {
    // 内容没有集标记时退回文件名，但标注为低置信
    episodeScope = 'single'
    episodeNo = fromName
    reasons.push('集号只能从文件名推断')
  }

  if (labels.size === 0) {
    return {
      path,
      name,
      kind,
      labels: [],
      // 用途认不出也要保留集号范围：多集大纲必须让人显式处理，不能当普通无关文件
      episodeScope,
      ...(episodeNo ? { episodeNo } : {}),
      confidence: 'none',
      reason:
        episodeScope === 'multi'
          ? `含多集大纲（${text.match(/^#{1,6}\s*第\s*\d+\s*集/gm)?.length ?? 0} 个小节），但没有可识别的单集结构；请排除或手动改判`
          : '没有可识别的结构，需要人工判断',
    }
  }

  return {
    path,
    name,
    kind,
    labels: [...labels],
    episodeScope,
    ...(episodeNo ? { episodeNo } : {}),
    confidence: via,
    reason: reasons.join('；') || '按内容识别',
  }
}

export const LABEL_TEXT: Record<BundleLabel, string> = {
  script: '剧本',
  shotlist: '分镜表',
  prompts: '提示词',
  characters: '角色档案',
  image: '参考图',
}

export type BundleConflict = {
  key: string
  label: BundleLabel
  episodeNo: number
  files: ClassifiedFile[]
}

/** 同用途 + 同集号出现多个候选 → 冲突，必须由人选一个 */
export function findConflicts(files: ClassifiedFile[]): BundleConflict[] {
  const groups = new Map<string, ClassifiedFile[]>()
  for (const f of files) {
    if (f.excluded) continue
    const labels = f.override ?? f.labels
    if (f.episodeScope !== 'single' || !f.episodeNo) continue
    for (const label of labels) {
      if (label === 'image' || label === 'characters') continue
      const key = `${label}:${f.episodeNo}`
      const list = groups.get(key) ?? []
      list.push(f)
      groups.set(key, list)
    }
  }
  const out: BundleConflict[] = []
  for (const [key, list] of groups) {
    if (list.length < 2) continue
    const [label, ep] = key.split(':')
    out.push({ key, label: label as BundleLabel, episodeNo: Number(ep), files: list })
  }
  return out.sort((a, b) => a.key.localeCompare(b.key))
}

/** 冲突里每个候选的镜数（供预览里并列显示，不让人凭记忆选） */
export function shotCountOf(text: string): number {
  if (!hasShotTable(text)) return 0
  const lines = String(text || '').split(/\r?\n/)
  const start = lines.findIndex((l) => /^\|\s*(镜头|shot|镜号)\s*\|/i.test(l.trim()))
  if (start < 0) return 0
  let n = 0
  for (let i = start + 2; i < lines.length; i++) {
    const t = lines[i].trim()
    if (!t.startsWith('|')) break
    if (/^\|?\s*:?-{2,}/.test(t)) continue
    n++
  }
  return n
}
