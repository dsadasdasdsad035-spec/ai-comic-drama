import type { ProjectData } from '../api'
import type { DraftApplyResult, WorkbenchChatAdapter, WriteArtifact, WriteTool } from '../agent/workbenchChat'
import type { ChatThreadKey } from '../agent/threads'
import type { Skill } from '../skills/types'
import type { Stage } from '../api'
import { applyProjectDraft, type ProjectDraftCtx } from '../platform/projectDraft'

const PROJECT_OUTPUT: Record<
  string,
  { artifact: WriteArtifact; writeTool: WriteTool; surface: 'characters' | 'assets' | 'shots' }
> = {
  'characters-v1': { artifact: 'characters', writeTool: 'submit_characters', surface: 'characters' },
  'designs-v1': { artifact: 'designs', writeTool: 'submit_designs', surface: 'assets' },
  'shots-v1': { artifact: 'shots', writeTool: 'submit_shots', surface: 'shots' },
  'prompts-v1': { artifact: 'prompts', writeTool: 'submit_prompts', surface: 'shots' },
  'joins-v1': { artifact: 'shots', writeTool: 'submit_joins', surface: 'shots' },
}

export type CreativeProjectStageCtx = {
  projectName: string
  epNo: number
  getSnapshot: () => ProjectData | null
  setSnapshot: (p: ProjectData) => void
  onProjectDataChanged?: () => void
}

/** 宿主技能是否能在已选项目下挂载工作台读/写工具 */
export function canUseProjectStage(host: Skill): boolean {
  const submit = host.manifest.tools.find((t) => t.startsWith('submit_'))
  if (!submit || submit === 'submit_reverse_pack') return false
  return Boolean(PROJECT_OUTPUT[host.manifest.output])
}

export function createCreativeProjectAdapter(
  host: Skill,
  ctx: CreativeProjectStageCtx,
): WorkbenchChatAdapter | null {
  const meta = PROJECT_OUTPUT[host.manifest.output]
  if (!meta) return null
  const submit = host.manifest.tools.find((t) => t.startsWith('submit_'))
  if (!submit || submit !== meta.writeTool) return null

  const threadKey: ChatThreadKey = {
    project: ctx.projectName,
    surface: meta.surface,
    episode: ctx.epNo,
  }

  return {
    surface: meta.surface,
    skillId: host.id,
    stage: host.manifest.stage as Stage,
    artifact: meta.artifact,
    writeTool: meta.writeTool,
    writeContract: host.manifest.output,
    threadKey,
    scope: () => `第 ${ctx.epNo} 集`,
    inputs: () => ({}),
    ownDraft: () => {
      const p = ctx.getSnapshot()
      if (!p) return undefined
      if (meta.artifact === 'shots' || meta.artifact === 'prompts') {
        return (p.shots || []).filter((s) => (Number(s.episode) || 1) === ctx.epNo)
      }
      if (meta.artifact === 'characters') return p.characters || []
      if (meta.artifact === 'designs') return p.designs || []
      return undefined
    },
    projectSnapshot: async () => {
      const p = ctx.getSnapshot()
      if (p) return p
      throw new Error('项目数据未加载')
    },
    applyDraft: (payload): DraftApplyResult => {
      const draftCtx: ProjectDraftCtx = {
        projectName: ctx.projectName,
        epNo: ctx.epNo,
        getSnapshot: ctx.getSnapshot,
        setSnapshot: ctx.setSnapshot,
        onProjectDataChanged: ctx.onProjectDataChanged,
      }
      return applyProjectDraft(host.manifest.output, payload, draftCtx)
    },
  }
}
