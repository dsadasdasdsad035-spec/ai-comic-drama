import type { ProjectData, ProjectShot } from '../api'
import { mergeProjectShots } from '../api'
import { mergePromptRenderDraft, type PromptRenderJoinPatch, type PromptRenderShotPatch } from './promptRenderDraft'
import type { ChatThreadKey } from './threads'
import type { DraftApplyResult, WorkbenchChatAdapter } from './workbenchChat'
import type { PromptRenderBundle } from '../promptRender'
import { getPromptRenderTemplateVersion } from '../promptRender'
import { PROMPT_RENDER_REFINE_SKILL_ID, resolveVideoPromptRenderPrompt } from '../promptRenderSkill'
import type { VideoPromptRenderMeta } from '../types'
export type ShotPromptRefineDeps = {
  projectName: string
  episode: number
  shotNo: string
  shotNodeId: string
  style: string
  aspect: string
  bundle: () => PromptRenderBundle
  getSnapshot: () => ProjectData | null
  setSnapshot: (p: ProjectData) => void
  onShotPatched: (nodeId: string, patch: { videoPromptRendered: string; videoPromptRenderMeta: VideoPromptRenderMeta }) => void
}

export function createShotPromptRefineAdapter(deps: ShotPromptRefineDeps): WorkbenchChatAdapter {
  const threadKey: ChatThreadKey = {
    project: deps.projectName,
    surface: `prompt-refine-shot`,
    episode: deps.episode,
    shotId: deps.shotNodeId,
  }
  return {
    surface: 'prompt-refine',
    skillId: PROMPT_RENDER_REFINE_SKILL_ID,
    stage: 'prompt',
    artifact: 'prompts',
    writeTool: 'submit_prompt_renders',
    writeContract: 'prompt-renders-v1',
    threadKey,
    scope: () => `${deps.shotNo} · 九段出片改稿`,
    inputs: () => ({
      style: deps.style,
      aspect: deps.aspect,
      episode: deps.episode,
    }),
    ownDraft: () => undefined,
    projectSnapshot: async () => {
      const p = deps.getSnapshot()
      if (!p) throw new Error('项目未加载')
      return p
    },
    promptRenderBundle: deps.bundle,
    promptRenderGate: { kind: 'shot', shotNo: deps.shotNo },
    promptRenderSkillPreview: async () => {
      const r = await resolveVideoPromptRenderPrompt({
        style: deps.style,
        aspect: deps.aspect,
        episode: deps.episode,
      })
      return { role: r.role, task: r.taskRendered, source: r.source }
    },
    applyDraft: (payload): DraftApplyResult => {
      const p = deps.getSnapshot()
      if (!p) return { ok: false, summary: '', error: '项目未加载' }
      const shots = Array.isArray((payload as { shots?: PromptRenderShotPatch[] }).shots)
        ? (payload as { shots: PromptRenderShotPatch[] }).shots
        : []
      const merged = mergePromptRenderDraft(p.shots || [], shots, deps.episode)
      if (!merged.patched) {
        return { ok: false, summary: '', error: merged.missing.length ? `未找到镜头：${merged.missing.join('、')}` : '没有可写回的镜头' }
      }
      const hit = shots[0]
      const tpl = hit.video_prompt_render_meta.templateVersion || getPromptRenderTemplateVersion()
      deps.setSnapshot({ ...p, shots: merged.shots })
      void mergeProjectShots(deps.projectName, merged.shots)
      const row = merged.shots.find((s) => s.id === deps.shotNodeId || String(s.no) === deps.shotNo)
      if (row?.video_prompt_rendered) {
        deps.onShotPatched(deps.shotNodeId, {
          videoPromptRendered: row.video_prompt_rendered,
          videoPromptRenderMeta: {
            ...(row.video_prompt_render_meta as VideoPromptRenderMeta),
            templateVersion: tpl,
          },
        })
      }
      return { ok: true, summary: `已写回镜 ${deps.shotNo} 的模板渲染正文`, counts: { patched: merged.patched } }
    },
    chatTitle: () => `${deps.shotNo} 出片改稿`,
  }
}

export type TransitionPromptRefineDeps = {
  projectName: string
  episode: number
  sourceId: string
  sourceNo: string
  targetNo: string
  to: string
  style: string
  aspect: string
  bundle: () => PromptRenderBundle
  fingerprint: string
  getSnapshot: () => ProjectData | null
  onTransitionPatched: (
    sourceId: string,
    to: string,
    patch: { renderedPrompt: string; renderMeta: VideoPromptRenderMeta },
  ) => void
}

export function createTransitionPromptRefineAdapter(deps: TransitionPromptRefineDeps): WorkbenchChatAdapter {
  const threadKey: ChatThreadKey = {
    project: deps.projectName,
    surface: 'prompt-refine-transition',
    episode: deps.episode,
    shotId: `${deps.sourceId}->${deps.to}`,
  }
  return {
    surface: 'prompt-refine',
    skillId: PROMPT_RENDER_REFINE_SKILL_ID,
    stage: 'prompt',
    artifact: 'prompts',
    writeTool: 'submit_prompt_renders',
    writeContract: 'prompt-renders-v1',
    threadKey,
    scope: () => `${deps.sourceNo}→${deps.targetNo} · 转场改稿`,
    inputs: () => ({
      style: deps.style,
      aspect: deps.aspect,
      episode: deps.episode,
    }),
    ownDraft: () => undefined,
    projectSnapshot: async () => {
      const p = deps.getSnapshot()
      if (!p) throw new Error('项目未加载')
      return p
    },
    promptRenderBundle: deps.bundle,
    promptRenderGate: { kind: 'join', afterNo: deps.sourceNo, toNo: deps.targetNo },
    promptRenderSkillPreview: async () => {
      const r = await resolveVideoPromptRenderPrompt({
        style: deps.style,
        aspect: deps.aspect,
        episode: deps.episode,
      })
      return { role: r.role, task: r.taskRendered, source: r.source }
    },
    applyDraft: (payload): DraftApplyResult => {
      const joins = Array.isArray((payload as { joins?: PromptRenderJoinPatch[] }).joins)
        ? (payload as { joins: PromptRenderJoinPatch[] }).joins
        : []
      const j = joins[0]
      if (!j?.rendered_prompt?.trim()) {
        return { ok: false, summary: '', error: '缺少 rendered_prompt' }
      }
      const meta: VideoPromptRenderMeta = {
        ...j.render_meta,
        fingerprint: j.render_meta.fingerprint || deps.fingerprint,
        templateVersion: j.render_meta.templateVersion || getPromptRenderTemplateVersion(),
      }
      deps.onTransitionPatched(deps.sourceId, deps.to, { renderedPrompt: j.rendered_prompt.trim(), renderMeta: meta })
      return { ok: true, summary: `已写回转场 ${deps.sourceNo}→${deps.targetNo}`, counts: { patched: 1 } }
    },
    chatTitle: () => `转场 ${deps.sourceNo}→${deps.targetNo}`,
  }
}
