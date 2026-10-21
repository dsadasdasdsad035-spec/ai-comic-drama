import type { CharacterSheet } from './characters'
import { toSheet, type ProjectChar } from './charMap'
import type { ProjectEpisode } from './api'

/** 模型输出的角色（蛇形字段，与 CHARACTER_SYS 的输出契约一致） */
export type ExtractedChar = ProjectChar

/** 场次 → 给模型看的剧本摘要 */
export function digestEpisodes(eps: ProjectEpisode[]): string {
  return eps
    .map((e) => {
      const scenes = (e.scenes ?? [])
        .map((s) =>
          [
            `- ${s.slug || '场景'}｜${s.place || ''}｜${s.time || ''}`,
            s.beats ? `  ${s.beats}` : '',
            s.characters?.length ? `  出场：${s.characters.join('、')}` : '',
          ]
            .filter(Boolean)
            .join('\n'),
        )
        .join('\n')
      return `【第 ${e.no} 集 ${e.title || ''}】${e.hook ? `（钩子：${e.hook}）` : ''}\n${scenes}`
    })
    .join('\n\n')
}

/** 当前集镜头 → 出场与台词摘要（说话人也是角色线索） */
export function digestShots(
  shots: { no?: string; cast?: string[]; dialogue?: string; prompt?: string }[],
): string {
  return shots
    .filter((s) => (s.cast?.length ?? 0) > 0 || s.dialogue)
    .map((s) =>
      [
        `${s.no ?? ''}`,
        s.cast?.length ? `出场：${s.cast.join('、')}` : '',
        s.dialogue ? `台词：${s.dialogue.replace(/\s+/g, ' ').slice(0, 90)}` : '',
        s.prompt ? `画面：${s.prompt.slice(0, 70)}` : '',
      ]
        .filter(Boolean)
        .join(' ｜ '),
    )
    .join('\n')
}

/** 模型返回可能套一层 json 字段或直接给数组，统一抽成角色列表 */
export function pickExtracted(json: unknown): ExtractedChar[] {
  const j = json as { characters?: ExtractedChar[] } | ExtractedChar[] | null
  const list = Array.isArray(j) ? j : j?.characters
  if (!Array.isArray(list)) return []
  return list
    .filter((c) => c && String(c.name || '').trim())
    .map((c) => ({ ...c, name: String(c.name).trim() }))
}

/**
 * 合并拆出来的角色：
 * - 已有同名角色且已写外观锚点 → 跳过（不覆盖用户手改过的设定）
 * - 已有同名但锚点空白 → 只补空字段
 * - 没有 → 新增到末尾
 */
export function mergeCharacters(
  cur: CharacterSheet[],
  incoming: ExtractedChar[],
): { next: CharacterSheet[]; added: string[]; filled: string[]; skipped: string[] } {
  const next = [...cur]
  const added: string[] = []
  const filled: string[] = []
  const skipped: string[] = []

  for (const raw of incoming) {
    const sheet = toSheet(raw)
    const idx = next.findIndex((c) => c.name === sheet.name || c.id === sheet.name)
    if (idx < 0) {
      next.push(sheet)
      added.push(sheet.name)
      continue
    }
    const old = next[idx]
    if (old.lookEn.trim()) {
      skipped.push(sheet.name)
      continue
    }
    next[idx] = {
      ...old,
      role: old.role || sheet.role,
      age: old.age || sheet.age,
      lookCn: old.lookCn || sheet.lookCn,
      lookEn: sheet.lookEn,
      palette: old.palette || sheet.palette,
      keywords: old.keywords.length ? old.keywords : sheet.keywords,
    }
    filled.push(sheet.name)
  }
  return { next, added, filled, skipped }
}
