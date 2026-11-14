import { listSkillTexts } from './api'
import { buildSkillPrompt } from './render'
import type { Skill, SkillInputs, SkillPrompt, SkillRenderMode, SkillTextRecord } from './types'
import { parseSkillRecords, type SkillLoadIssue, type SkillLoadResult } from './validate'

/** 仓库不再内置技能正文；一律从 /api/skills（磁盘安装 + SkillHub + 覆盖）加载。 */
const BUILTIN_TEXTS: Record<string, string> = {}

let cache: SkillLoadResult | null = null
let loading: Promise<SkillLoadResult> | null = null
let textById: Map<string, SkillTextRecord> = new Map()

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
      textById = new Map(records.map((r) => [r.id, r]))
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

/** 任意已安装技能原文（含 Agent 包）；不要求 workbench 解析成功 */
export async function getSkillTextRecord(id: string): Promise<SkillTextRecord> {
  await loadSkills()
  const record = textById.get(id)
  if (!record) throw new Error(`技能「${id}」不存在`)
  return record
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
