/**
 * 角色档案解析：从「角色档案 / 项目设定」文档里抽出角色草稿。
 *
 * 只抽原文写了的东西：名称、定位、外观锚点。原文没有英文锚点时留空——
 * 生成三视图前仍需补 lookEn，这是既有规则，不要在导入时编一段英文。
 */
import type { DesignSheet } from '../api'
import { mergeCharacters, type ExtractedChar } from '../charExtract'
import type { CharacterSheet } from '../characters'
import { toSheet } from '../charMap'

export type CharacterDraft = {
  name: string
  role: string
  lookCn: string
  lookEn: string
  palette: string
  keywords: string[]
}

const ROLE_HEADING = /^#{2,4}\s*(?:角色\s*[A-Za-z一二三四五六七八九十0-9]+\s*[：:]\s*)?(.+?)\s*$/gm
const APPEARANCE = /外观锚点|外形特征|外观特征/

/** 去掉「角色A：」这类前缀，只留名字 */
function cleanName(raw: string): string {
  return String(raw || '')
    .replace(/^角色\s*[A-Za-z一二三四五六七八九十0-9]+\s*[：:]\s*/, '')
    .replace(/^[——\-\s]+/, '')
    .replace(/[《》]/g, '')
    .trim()
}

/** 从小节里取列表项 */
function bulletsOf(section: string): string[] {
  return section
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter((l) => /^[-*·]\s+/.test(l))
    .map((l) => l.replace(/^[-*·]\s+/, '').replace(/[。；;]$/, '').trim())
    .filter(Boolean)
}

/** 英文锚点：小节里已经写成英文的那一行（有就别再编） */
function englishLine(lines: string[]): string {
  for (const l of lines) {
    if (!/[a-zA-Z]{3,}/.test(l)) continue
    // 中文占比高的行不算英文锚点
    const cjk = (l.match(/[\u4e00-\u9fa5]/g) || []).length
    if (cjk <= 2) return l.trim()
  }
  return ''
}

/**
 * 解析角色档案文档。
 * 识别的结构：`## 角色A：主角猫——狸花白手套猫` 或 `## 主角猫`，其下有
 * `### 外观锚点` 小节（列表项）或直接是列表项。
 */
export function parseCharacterDrafts(text: string): CharacterDraft[] {
  const raw = String(text || '')
  if (!raw.trim()) return []

  // 角色是二级标题；三级标题（外观锚点 / 剧情性格）是它的子节。
  // 先按二级切段，段内再单独找外观子节——否则「### 剧情性格」会被当成角色名。
  const parts: { title: string; body: string }[] = []
  const re = /^##\s+(.+?)\s*$/gm
  const marks = [...raw.matchAll(re)].map((m) => ({
    title: m[1],
    start: m.index ?? 0,
    bodyStart: (m.index ?? 0) + m[0].length,
  }))
  for (let i = 0; i < marks.length; i++) {
    const cur = marks[i]
    const end = i + 1 < marks.length ? marks[i + 1].start : raw.length
    parts.push({ title: cur.title, body: raw.slice(cur.bodyStart, end) })
  }
  // 整篇只有一级标题 + 三级子节时（没有二级角色段），退回按三级切
  if (parts.length === 0) {
    const re3 = /^###\s+(.+?)\s*$/gm
    const m3 = [...raw.matchAll(re3)].map((m) => ({
      title: m[1],
      start: m.index ?? 0,
      bodyStart: (m.index ?? 0) + m[0].length,
    }))
    for (let i = 0; i < m3.length; i++) {
      const end = i + 1 < m3.length ? m3[i + 1].start : raw.length
      parts.push({ title: m3[i].title, body: raw.slice(m3[i].bodyStart, end) })
    }
  }

  const out: CharacterDraft[] = []
  for (const p of parts) {
    const name = cleanName(p.title)
    if (!name) continue
    // 排除明显不是角色的标题
    if (/^(基本信息|项目定位|核心故事|视觉规则|超能力规则|制作原则|使用说明|图片清单|角色对应)$/.test(name)) continue
    if (/^(前\s*\d+\s*集|分集大纲|完整剧本|拍摄|剪辑|注意|外观锚点|剧情性格|性格|处境)/.test(name)) continue

    const hasAppearance = APPEARANCE.test(p.body)
    const bullets = bulletsOf(p.body)
    if (!hasAppearance && bullets.length < 2) continue
    const looksLikeCharacter =
      hasAppearance || /剧情性格|^\s*[-*·]\s*(处境|性格|表演方式)/m.test(p.body)
    if (!looksLikeCharacter) continue

    // 外观子节：从「外观锚点」到下一个三级标题；没有该子节时用段内列表
    let appearanceLines = bullets
    const apIdx = p.body.search(APPEARANCE)
    if (apIdx >= 0) {
      const after = p.body.slice(apIdx)
      const nextH3 = after.slice(1).search(/^###\s/m)
      const scoped = nextH3 > 0 ? after.slice(0, nextH3 + 1) : after
      const apBullets = bulletsOf(scoped)
      if (apBullets.length) appearanceLines = apBullets
    }

    const lookCn = appearanceLines.join('，')
    const lookEn = englishLine(appearanceLines)
    const roleLine = bullets.find((l) => /^(角色|定位|身份|类型)[：:]/.test(l))
    out.push({
      name,
      role: roleLine ? roleLine.replace(/^(角色|定位|身份|类型)[：:]\s*/, '') : '',
      lookCn,
      lookEn,
      palette: '',
      keywords: appearanceLines.slice(0, 4).map((l) => l.replace(/^[\u4e00-\u9fa5]{2,6}[：:]\s*/, '')).slice(0, 4),
    })
  }

  // 同名去重（先出现的为准）
  const seen = new Set<string>()
  return out.filter((d) => (seen.has(d.name) ? false : (seen.add(d.name), true)))
}

/** 把档案里的设计要点也抽成场景/道具草稿（只在文档明确写了场景/道具时才产出） */
export function parseDesignDrafts(text: string): DesignSheet[] {
  const raw = String(text || '')
  const out: DesignSheet[] = []
  for (const m of raw.matchAll(/^#{2,4}\s*(场景|道具)\s*[：:]\s*(.+?)\s*$/gm)) {
    out.push({
      id: `design-bundle-${Date.now()}-${out.length}`,
      kind: m[1] === '场景' ? 'scene' : 'prop',
      name: m[2].trim(),
      refs: [],
      summaryCn: '',
      promptEn: '',
      keywords: [],
    })
  }
  return out
}

/** 与既有角色合并：已有角色只在锚点为空时补一句，不覆盖手改 */
export function mergeImportedCharacters(
  current: CharacterSheet[],
  drafts: CharacterDraft[],
): { next: CharacterSheet[]; added: string[]; filled: string[]; skipped: string[] } {
  const incoming: ExtractedChar[] = drafts.map((d) => ({
    name: d.name,
    role: d.role,
    look_cn: d.lookCn,
    look_en: d.lookEn,
    palette: d.palette,
    keywords: d.keywords,
  }))
  const merged = mergeCharacters(current, incoming)
  return { next: merged.next, added: merged.added, filled: merged.filled, skipped: merged.skipped }
}

/** 便于测试：草稿 → 角色卡 */
export function draftToSheet(d: CharacterDraft): CharacterSheet {
  return toSheet({
    name: d.name,
    role: d.role,
    look_cn: d.lookCn,
    look_en: d.lookEn,
    palette: d.palette,
    keywords: d.keywords,
  })
}
