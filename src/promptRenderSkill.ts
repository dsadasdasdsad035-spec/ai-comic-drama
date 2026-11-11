import { buildSkillPrompt } from './skills/render'
import { getSkill } from './skills/registry'
import type { Skill, SkillInputs, SkillSource } from './skills/types'
import { shortHash } from './scheduleGeometry'

export const PROMPT_RENDER_SKILL_ID = 'seedance-prompt-render'
export const PROMPT_RENDER_REFINE_SKILL_ID = 'seedance-prompt-refine'

/** 与旧常量兼容；运行时应优先用 getPromptRenderTemplateVersion() */
export const PROMPT_RENDER_TEMPLATE_VERSION_LEGACY = 'seedance-2.5-cn-9'

let cachedTemplateVersion = `${PROMPT_RENDER_SKILL_ID}@0#pending`

export function getPromptRenderTemplateVersion(): string {
  return cachedTemplateVersion
}

export function computePromptTemplateDigest(skill: Skill): string {
  return shortHash(`${skill.manifest.version}|${skill.source}|${skill.role}|${skill.task}`)
}

export function formatPromptRenderTemplateVersion(skill: Skill): string {
  return `${PROMPT_RENDER_SKILL_ID}@${skill.manifest.version}#${computePromptTemplateDigest(skill).slice(0, 12)}`
}

export type ResolvedVideoPromptRenderPrompt = {
  system: string
  userPrompt: string
  templateVersion: string
  templateDigest: string
  source: SkillSource
  skillId: string
  role: string
  taskRendered: string
}

const RENDER_OUTPUT_FOOTER =
  '输出：先写完整中文正文，再在 ```json 围栏内给出 {"rendered_prompt":"与正文相同","warnings":[]}。'

/**
 * 从设置页技能解析单镜/转场共用的九段渲染 system + task。
 * bundle 以 JSON 附在 user 侧，避免改技能 task 占位符。
 */
export async function resolveVideoPromptRenderPrompt(
  inputs: SkillInputs = {},
  skillId = PROMPT_RENDER_SKILL_ID,
): Promise<ResolvedVideoPromptRenderPrompt> {
  const skill = await getSkill(skillId)
  const built = buildSkillPrompt(skill, inputs, 'inline', Infinity)
  const templateVersion = formatPromptRenderTemplateVersion(skill)
  if (skillId === PROMPT_RENDER_SKILL_ID) {
    cachedTemplateVersion = templateVersion
  }
  return {
    system: built.system,
    userPrompt: `${built.task}\n\n${RENDER_OUTPUT_FOOTER}`,
    templateVersion,
    templateDigest: computePromptTemplateDigest(skill),
    source: skill.source,
    skillId: skill.id,
    role: skill.role,
    taskRendered: built.task,
  }
}

/** 应用启动或设置保存技能后调用，刷新同步 stale 判定用的版本号 */
export async function refreshPromptRenderTemplateVersion(): Promise<string> {
  const r = await resolveVideoPromptRenderPrompt({})
  return r.templateVersion
}
