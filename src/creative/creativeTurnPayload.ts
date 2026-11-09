import type { AgentMessage } from '../agent/sceneAgentTypes'
import type { WorkbenchProfile, WorkbenchTaskView } from '../agent/workbenchChat'
import { buildPiAgentSystem } from '../agent/workbenchChat'
import { threadTranscript } from '../agent/threads'
import type { Skill } from '../skills/types'

const HISTORY_HEAD = '【之前的对话】'

/** 创意会话检查器用的静态 profile（无草稿保存语义） */
export const CREATIVE_INSPECT_PROFILE: WorkbenchProfile = {
  title: '创意助手',
  emptyTitle: '',
  emptyBody: '',
  suggestions: [],
  placeholder: '',
  saveMode: 'immediate',
  inputLabels: {},
}

/** 创意 Pi system：不含模式、会话 id、只读技能名单 */
export function buildCreativePiSystem(host: Skill): string {
  return buildPiAgentSystem(host, [], [])
}

/** 与 runStageAgent 入参一致：历史存在时加前缀块 */
export function assembleCreativeUser(draftText: string, messages: AgentMessage[]): string {
  const text = String(draftText || '').trim()
  const history = threadTranscript(messages).trim()
  if (history) {
    return `${HISTORY_HEAD}\n${history}${text ? `\n\n${text}` : ''}`
  }
  return text
}

/** 与 bindCreativeTools 过滤规则一致，仅用于展示 */
export function listCreativeToolNames(skills: Array<{ skill: Skill; mode: 'host' | 'readonly' }>): string[] {
  const names = new Set<string>()
  for (const { skill, mode } of skills) {
    for (const name of skill.manifest.tools) {
      if (
        mode === 'readonly' &&
        (name.startsWith('submit_') || name.startsWith('generate_') || name.startsWith('ingest_'))
      ) {
        continue
      }
      names.add(name)
    }
  }
  names.add('read_skill')
  return [...names].sort()
}

export type CreativeTurnPayload = {
  system: string
  userForModel: string
  toolNames: string[]
}

export function buildCreativeTurnPayload(input: {
  host: Skill
  messages: AgentMessage[]
  draftText: string
}): CreativeTurnPayload {
  const bindings = [{ skill: input.host, mode: 'host' as const }]
  return {
    system: buildCreativePiSystem(input.host),
    userForModel: assembleCreativeUser(input.draftText, input.messages),
    toolNames: listCreativeToolNames(bindings),
  }
}

export function creativeTaskView(
  host: Skill,
  payload: CreativeTurnPayload,
  modelLabel: string,
): WorkbenchTaskView {
  return {
    system: payload.system,
    task: payload.userForModel,
    inputs: {},
    references: [],
    missing: [],
    modelLabel,
    skillId: host.id,
    skillTitle: host.manifest.name || host.id,
    skillSource: host.source,
    skillVersion: host.manifest.version,
    readonly: [],
    readTools: payload.toolNames,
    saveMode: 'immediate',
  }
}
