import type { CharacterSheet } from './characters'
import type { ShotNodeType } from './data'
import { parseDialogue } from './prompts'
import type { ShotData, VideoPromptRenderMeta } from './types'
import { resolveShotLexiconRef } from './cameraLexicon'
import { shortHash } from './hash'
import {
  buildShotVideoRequest,
  type ShotVideoRequest,
  type VideoAttachment,
  type VideoModelInput,
} from './videoPrompt'
import type { ShotNodeType as TNode } from './data'
import { getPromptRenderTemplateVersion, resolveVideoPromptRenderPrompt } from './promptRenderSkill'

export { getPromptRenderTemplateVersion, refreshPromptRenderTemplateVersion } from './promptRenderSkill'
/** @deprecated 使用 getPromptRenderTemplateVersion()；模块加载时的快照 */
export const PROMPT_RENDER_TEMPLATE_VERSION = getPromptRenderTemplateVersion()

export const SEEDANCE_RULES_DIGEST =
  '遵循 Seedance 2.5：先写资产映射（@图像N/@视频N/@音频N），再写连续时间轴（0–Xs），最后写全局约束（无字幕、无水印、身份连续）。参考视频只继承运动/机位/节奏；参考图严格继承主体外观与场景；音频参考只继承音色与说话风格。'

export type PromptRenderAssetInherit = 'strict' | 'motion_only' | 'audio_only' | 'style_only'

export type PromptRenderBundle = {
  schemaVersion: 1
  kind: 'shot'
  templateVersion: string
  video: {
    type: string
    durationSec: number
    aspectRatio: string
    visualStyle: string
    shotCount: number
  }
  assets: {
    slot: 'image' | 'video' | 'audio'
    index: number
    label: string
    purpose: string
    inherit: PromptRenderAssetInherit
    mustNotInherit?: string[]
    submitted: boolean
    omitReason?: string
  }[]
  scene: {
    subjects: string[]
    castStates: string
    location: string
    environment: string
    weather?: string
    timeOfDay?: string
    lighting?: string
  }
  creative: {
    desc: string
    keyframePrompt?: string
    videoPromptBrief?: string
    size: string
    move: string
    cameraHint?: string
    performance?: unknown[]
    dialogue?: string
    dialogueDelivery?: unknown
    motionNote?: string
    nativeAudio?: { mode: 'off' | 'native'; character?: string }
    soundDesign?: string
  }
  continuity: {
    identityLocks: string[]
    spatialRules: string[]
    forbidden: string[]
    neighborSummary?: string
  }
  endFrame: {
    subjectPose: string
    composition: string
    focus: string
    nextShotLink?: string
  }
  seedanceRulesDigest: string
}

function inheritForAttachment(a: VideoAttachment): PromptRenderAssetInherit {
  if (a.slot === 'video') return 'motion_only'
  if (a.slot === 'audio') return 'audio_only'
  return 'strict'
}

function assetsFromRequest(request: ShotVideoRequest): PromptRenderBundle['assets'] {
  const out: PromptRenderBundle['assets'] = []
  for (const r of request.refs) {
    out.push({
      slot: 'image',
      index: r.index,
      label: r.label,
      purpose: r.purpose,
      inherit: inheritForAttachment(r),
      mustNotInherit: r.slot === 'video' ? ['外观', '场景材质'] : undefined,
      submitted: true,
    })
  }
  for (const o of request.omitted) {
    out.push({
      slot: 'image',
      index: 0,
      label: o.label,
      purpose: '未提交',
      inherit: 'strict',
      submitted: false,
      omitReason: o.reason,
    })
  }
  if (request.video) {
    out.push({
      slot: 'video',
      index: 1,
      label: request.video.label,
      purpose: request.video.purpose,
      inherit: 'motion_only',
      mustNotInherit: ['人物外观', '场景', '道具', '画风'],
      submitted: true,
    })
  }
  for (const o of request.omittedVideos) {
    out.push({
      slot: 'video',
      index: 0,
      label: o.label,
      purpose: '未提交',
      inherit: 'motion_only',
      submitted: false,
      omitReason: o.reason,
    })
  }
  if (request.audio) {
    out.push({
      slot: 'audio',
      index: 1,
      label: request.audio.label,
      purpose: request.audio.purpose,
      inherit: 'audio_only',
      submitted: true,
      ...(request.audio.character ? {} : {}),
    })
  }
  return out
}

export function promptRenderFingerprint(bundle: PromptRenderBundle): string {
  return shortHash(JSON.stringify(bundle))
}

export function isFreshVideoPromptRender(
  meta: VideoPromptRenderMeta | undefined,
  requestFingerprint: string,
  templateVersion: string,
): boolean {
  if (!meta?.fingerprint) return false
  if (meta.fingerprint !== requestFingerprint) return false
  return String(meta.templateVersion || '') === templateVersion
}

export function videoPromptRenderStale(
  rendered: string | undefined,
  meta: VideoPromptRenderMeta | undefined,
  requestFingerprint: string,
  templateVersion: string,
): boolean {
  if (!rendered?.trim()) return false
  return !isFreshVideoPromptRender(meta, requestFingerprint, templateVersion)
}

export function templateVersionStale(
  meta: VideoPromptRenderMeta | undefined,
  templateVersion: string,
): boolean {
  if (!meta?.templateVersion) return false
  return meta.templateVersion !== templateVersion
}

export function buildShotPromptRenderBundle(input: {
  data: ShotData
  nodeId: string
  nodes: ShotNodeType[]
  characters: CharacterSheet[]
  missingMedia?: Set<string>
  model?: VideoModelInput | null
  resolution?: string
  style: string
  aspect: string
  request: ShotVideoRequest
}): PromptRenderBundle {
  const d = input.data
  const dialogue = parseDialogue(d.dialogue)
  const cast = d.cast ?? []
  const vb = d.visualBrief
  const nativeChar = input.request.audio?.character
  const bundle: PromptRenderBundle = {
    schemaVersion: 1,
    kind: 'shot',
    templateVersion: getPromptRenderTemplateVersion(),
    video: {
      type: '图生视频',
      durationSec: input.request.seconds,
      aspectRatio: input.aspect,
      visualStyle: input.style,
      shotCount: 1,
    },
    assets: assetsFromRequest(input.request),
    scene: {
      subjects: cast,
      // 无表演数据时用画面正文兜底；正文整段透传，不做字符切片
      castStates: (d.performance ?? []).map((p) => `${p.character}:${p.emotion ?? ''}`).join('；') || d.prompt,
      location: d.sceneSlug || '',
      environment: d.prompt,
      lighting: '',
    },
    creative: {
      desc: d.prompt,
      keyframePrompt: d.prompt,
      videoPromptBrief: d.videoPrompt || '',
      size: d.size,
      move: (() => {
        const ref = resolveShotLexiconRef(d)
        return ref?.en ? `${d.move} (${ref.en})` : d.move
      })(),
      cameraHint: vb?.cameraHint ? JSON.stringify(vb.cameraHint) : '',
      performance: d.performance,
      dialogue: d.dialogue,
      dialogueDelivery: d.dialogueDelivery,
      motionNote: d.motionNote,
      nativeAudio: {
        mode: d.audioMode === 'native' ? 'native' : 'off',
        ...(nativeChar ? { character: nativeChar } : {}),
      },
    },
    continuity: {
      identityLocks: cast.map((c) => `保持角色「${c}」外貌与服装一致`),
      spatialRules: ['保持空间方向与物体位置合理'],
      forbidden: ['无字幕', '无水印', '无文字 UI', '禁止身份漂移'],
    },
    endFrame: {
      subjectPose: '与动作结束状态一致',
      composition: `${d.size}，主体清晰`,
      focus: '主体占画面视觉中心',
    },
    seedanceRulesDigest: SEEDANCE_RULES_DIGEST,
  }
  return bundle
}

function assetInheritLabel(inherit: PromptRenderAssetInherit): string {
  if (inherit === 'motion_only') return '仅参考运动/机位/节奏'
  if (inherit === 'audio_only') return '音色与说话风格'
  return '外观与场景一致'
}


/** 供测试：从镜头输入构建 bundle 并返回 bundle 指纹（应等于 request.fingerprint） */
export function shotRenderBundleFingerprint(input: Parameters<typeof buildShotVideoRequest>[0] & {
  style: string
  aspect: string
}): { bundle: PromptRenderBundle; requestFingerprint: string } {
  const request = buildShotVideoRequest(input)
  const bundle = buildShotPromptRenderBundle({ ...input, request })
  return {
    bundle,
    requestFingerprint: request.fingerprint,
  }
}

/** 从模型回复抽出 rendered_prompt */
export function parsePromptRenderResponse(text: string): { rendered_prompt: string; warnings: string[] } {
  const raw = String(text || '').trim()
  if (!raw) return { rendered_prompt: '', warnings: ['空响应'] }
  const fence = raw.match(/```json\s*([\s\S]*?)```/i)
  if (fence) {
    try {
      const j = JSON.parse(fence[1]) as { rendered_prompt?: string; warnings?: string[] }
      const rp = String(j.rendered_prompt || '').trim()
      if (rp) {
        return {
          rendered_prompt: rp,
          warnings: Array.isArray(j.warnings) ? j.warnings.map(String) : [],
        }
      }
    } catch {
      /* fall through */
    }
  }
  try {
    const j = JSON.parse(raw) as { rendered_prompt?: string; warnings?: string[] }
    if (j.rendered_prompt) {
      return {
        rendered_prompt: String(j.rendered_prompt).trim(),
        warnings: Array.isArray(j.warnings) ? j.warnings.map(String) : [],
      }
    }
  } catch {
    /* whole text */
  }
  const beforeJson = raw.split(/```json/i)[0].trim()
  return { rendered_prompt: beforeJson || raw, warnings: [] }
}

export async function renderSeedancePrompt(
  bundle: PromptRenderBundle,
  modelKey?: string,
  signal?: AbortSignal,
  opts?: { episode?: number; style?: string; aspect?: string },
): Promise<{ rendered_prompt: string; warnings: string[]; modelKey: string; templateVersion: string }> {
  const { callText } = await import('./api')
  const resolved = await resolveVideoPromptRenderPrompt({
    style: opts?.style ?? bundle.video.visualStyle,
    aspect: opts?.aspect ?? bundle.video.aspectRatio,
    episode: opts?.episode ?? 1,
  })
  const result = await callText({
    system: resolved.system,
    prompt: `${resolved.userPrompt}\n\n【PromptRenderBundle JSON】\n${JSON.stringify({ ...bundle, templateVersion: resolved.templateVersion }, null, 2)}`,
    modelKey,
    signal,
  })
  const parsed = parsePromptRenderResponse(result.text)
  if (!parsed.rendered_prompt.trim()) {
    throw new Error('模型未返回有效出片提示词')
  }
  return {
    ...parsed,
    modelKey: result.modelKey || modelKey || '',
    templateVersion: resolved.templateVersion,
  }
}
