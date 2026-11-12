import { mergeProjectShots, patchProject, type ProjectData, type ProjectShot } from '../api'
import { mergePromptDraft } from '../agent/promptDraft'
import type { DraftApplyResult, WorkbenchChatAdapter, WriteArtifact, WriteTool } from '../agent/workbenchChat'
import type { ChatThreadKey } from '../agent/threads'
import type { Skill } from '../skills/types'
import type { Stage } from '../api'
import { mergeCharacters, type ExtractedChar } from '../charExtract'
import { mergeShotsDraft } from '../shotSync'
import { blankShot } from '../shotRows'
import { applyJoinsToShots, type JoinDraft } from '../shotJoins'
import type { CharacterSheet } from '../characters'

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
      const p = ctx.getSnapshot()
      if (!p) return { ok: false, summary: '', error: '未加载项目，请确认顶栏已选项目' }
      const out = host.manifest.output
      if (out === 'shots-v1') {
        const shots = Array.isArray((payload as { shots?: ProjectShot[] }).shots)
          ? (payload as { shots: ProjectShot[] }).shots
          : []
        const { shots: merged, added, updated } = mergeShotsDraft(p.shots || [], shots, ctx.epNo, 'merge')
        // 技能只产出镜号，不产出 id；新镜在这里补上 `E{集}-{镜号}` 才能落库（服务端按 id 写入）
        const withIds = merged.map((s) => {
          const no = String(s.no ?? '').trim()
          if (s.id || !no) return s
          const ep = Number(s.episode) || ctx.epNo
          const base = blankShot(ep, no)
          return { ...base, ...s, id: base.id, episode: ep }
        })
        ctx.setSnapshot({ ...p, shots: withIds })
        void mergeProjectShots(ctx.projectName, withIds).then(() => ctx.onProjectDataChanged?.())
        return {
          ok: true,
          summary: `分镜已写回：新增 ${added}，更新 ${updated}`,
          counts: { added, updated, total: shots.length },
        }
      }
      if (out === 'characters-v1') {
        const incoming = Array.isArray((payload as { characters?: ExtractedChar[] }).characters)
          ? (payload as { characters: ExtractedChar[] }).characters
          : []
        const merged = mergeCharacters((p.characters || []) as CharacterSheet[], incoming)
        ctx.setSnapshot({ ...p, characters: merged.next })
        void patchProject(ctx.projectName, { characters: merged.next }).then(() => ctx.onProjectDataChanged?.())
        return {
          ok: true,
          summary: `角色表：新增 ${merged.added.length}，更新 ${merged.updated.length}`,
          counts: { total: incoming.length, added: merged.added.length, updated: merged.updated.length },
        }
      }
      if (out === 'prompts-v1') {
        const items = Array.isArray((payload as { shots?: unknown[] }).shots)
          ? (payload as { shots: Parameters<typeof mergePromptDraft>[1] }).shots
          : []
        const { shots, patched, missing, unresolved } = mergePromptDraft(
          p.shots || [],
          items,
          ctx.epNo,
          (p.characters || []) as CharacterSheet[],
        )
        ctx.setSnapshot({ ...p, shots })
        void mergeProjectShots(ctx.projectName, shots).then(() => ctx.onProjectDataChanged?.())
        return {
          ok: true,
          summary: `提示词已写回 ${patched} 镜${missing ? `，${missing} 镜未找到` : ''}${unresolved ? `，${unresolved} 处锚点未解析` : ''}`,
          counts: { patched, missing, unresolved },
        }
      }
      if (out === 'joins-v1') {
        const joins = Array.isArray((payload as { joins?: JoinDraft[] }).joins)
          ? (payload as { joins: JoinDraft[] }).joins
          : []
        const r = applyJoinsToShots(p.shots || [], joins)
        ctx.setSnapshot({ ...p, shots: r.shots })
        void mergeProjectShots(ctx.projectName, r.shots).then(() => ctx.onProjectDataChanged?.())
        return {
          ok: true,
          summary: `镜间接缝：应用 ${r.applied}，硬切 ${r.cuts}，特效 ${r.effects}，生成 ${r.generated}`,
          counts: { applied: r.applied, cuts: r.cuts, effects: r.effects, generated: r.generated },
        }
      }
      if (out === 'designs-v1') {
        const rec = payload as { designs?: unknown[]; scene3d?: unknown[]; props?: unknown[] }
        const next = { ...p }
        if (rec.designs) next.designs = rec.designs as ProjectData['designs']
        ctx.setSnapshot(next)
        void patchProject(ctx.projectName, {
          ...(rec.designs ? { designs: rec.designs as ProjectData['designs'] } : {}),
        }).then(() => ctx.onProjectDataChanged?.())
        return { ok: true, summary: '素材设定已写回项目' }
      }
      return { ok: false, summary: '', error: '该产物契约在创意会话中不支持写回' }
    },
  }
}
