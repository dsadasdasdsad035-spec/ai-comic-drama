import assetSkillText from '../../skills/asset/SKILL.md?raw'
import characterSkillText from '../../skills/character/SKILL.md?raw'
import promptSkillText from '../../skills/prompt/SKILL.md?raw'
import promptIntakeSkillText from '../../skills/prompt-intake/SKILL.md?raw'
import scene3dSkillText from '../../skills/scene3d/SKILL.md?raw'
import scriptSkillText from '../../skills/script/SKILL.md?raw'
import scriptIntakeSkillText from '../../skills/script-intake/SKILL.md?raw'
import shotlistSkillText from '../../skills/shotlist/SKILL.md?raw'
import shotlistIntakeSkillText from '../../skills/shotlist-intake/SKILL.md?raw'
import { listSkillTexts } from './api'
import { buildSkillPrompt } from './render'
import type { Skill, SkillInputs, SkillPrompt, SkillRenderMode, SkillTextRecord } from './types'
import { parseSkillRecords, type SkillLoadIssue, type SkillLoadResult } from './validate'

const BUILTIN_TEXTS: Record<string, string> = {
  asset: assetSkillText,
  character: characterSkillText,
  prompt: promptSkillText,
  'prompt-intake': promptIntakeSkillText,
  scene3d: scene3dSkillText,
  script: scriptSkillText,
  'script-intake': scriptIntakeSkillText,
  shotlist: shotlistSkillText,
  'shotlist-intake': shotlistIntakeSkillText,
}

let cache: SkillLoadResult | null = null
let loading: Promise<SkillLoadResult> | null = null

function builtinRecords(): SkillTextRecord[] {
  return Object.entries(BUILTIN_TEXTS).map(([id, text]) => ({
    id,
    text,
    builtinText: text,
    source: 'builtin',
  }))
}

/** 加载有效技能：服务端合并内置/覆盖；服务端不可用时用打包默认值。 */
export async function loadSkills(force = false): Promise<SkillLoadResult> {
  if (!force && cache) return cache
  if (!force && loading) return loading
  const p = (async () => {
    try {
      const records = await listSkillTexts()
      if (!records.length) throw new Error('服务端没有返回技能')
      const result = parseSkillRecords(records)
      cache = result
      return result
    } catch (e) {
      const issues: SkillLoadIssue[] = [
        { id: '*', message: `技能服务不可用，使用内置技能：${(e as Error).message || e}` },
      ]
      const result = { ...parseSkillRecords(builtinRecords()), issues, fallback: true }
      cache = result
      return result
    } finally {
      loading = null
    }
  })()
  loading = p
  return p
}

export async function reloadSkills(): Promise<SkillLoadResult> {
  cache = null
  return loadSkills(true)
}

export async function getSkill(id: string): Promise<Skill> {
  const { skills, issues } = await loadSkills()
  const skill = skills.get(id)
  if (!skill) {
    const issue = issues.find((x) => x.id === id)
    throw new Error(issue?.message || `技能「${id}」不存在或不可用`)
  }
  return skill
}

export async function buildPromptForSkill(
  id: string,
  inputs: SkillInputs,
  mode: SkillRenderMode = 'inline',
  threshold = 2000,
): Promise<SkillPrompt> {
  return buildSkillPrompt(await getSkill(id), inputs, mode, threshold)
}

export function builtinSkillText(id: string): string | undefined {
  return BUILTIN_TEXTS[id]
}

export function builtinSkillIds(): string[] {
  return Object.keys(BUILTIN_TEXTS)
}
