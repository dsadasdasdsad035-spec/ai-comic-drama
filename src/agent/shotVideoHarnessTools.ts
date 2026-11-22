import { z } from 'zod'
import { defineTool, type ToolDef } from './tool'
import { listMedia, patchProject, type ProjectData, type ProjectShot } from '../api'
import { extractSingleClipFrame, type ClipFrameRole } from '../clipBoundaryFrames'
import {
  buildClipFrameAssetFields,
  clipFrameAssetToken,
  findClipFrameAsset,
  mergeClipFrameIntoAssets,
} from '../clipFrameAssets'
import { appendRefToken } from '../clipFrameRef'
import { uid } from '../types'
import type { MaterialToolDeps } from './materialTools'
import { isProjectMediaUrl } from '../assetCards'
import { readCharacters } from '../charMap'
import { assetNodesFromAssets, buildShotNodes } from '../canvasShots'
import type { ShotNodeType } from '../data'
import { audioRefCapabilitiesFor, nativeAudioFingerprint, nativeAudioRef } from '../nativeAudio'
import { parseDialogue } from '../prompts'
import { applyRefTokens } from './refResolve'
import { SHOT_NEXT, SHOT_PREV } from '../shotReferences'
import { buildShotVideoRequest } from '../videoPrompt'
import { shotRequestSeconds } from '../videoSeconds'

const NO_PROJECT = '请先在顶栏选择项目；可用 list_projects 查看已有项目'

function findShot(project: ProjectData, ep: number, no: string): ProjectShot | undefined {
  const want = String(no ?? '').trim()
  return (project.shots || []).find((s) => (Number(s.episode) || 1) === ep && String(s.no ?? '').trim() === want)
}

function nodesFor(deps: MaterialToolDeps, project: ProjectData): ShotNodeType[] {
  const host = deps.getCanvasNodes?.()
  if (host?.length) return host
  const assets = Array.isArray(project.assets) ? project.assets : []
  const base = assetNodesFromAssets(assets)
  return buildShotNodes(base, project.shots ?? [])
}

function shotNode(nodes: ShotNodeType[], shot: ProjectShot): ShotNodeType | undefined {
  return nodes.find((n) => String(n.data?.shotId ?? '') === shot.id)
}

function buildRequest(deps: MaterialToolDeps, project: ProjectData, shot: ProjectShot, dataOverride?: Partial<ShotNodeType['data']>) {
  const nodes = nodesFor(deps, project)
  const node = shotNode(nodes, shot)
  if (!node) return { ok: false as const, error: `镜 ${shot.no} 不在画布上，无法解析出片请求` }
  const data = dataOverride ? { ...node.data, ...dataOverride } : node.data
  const model = deps.getSelectedVideoModel?.() ?? null
  const request = buildShotVideoRequest({
    data,
    nodeId: node.id,
    nodes,
    characters: readCharacters(project.characters),
    missingMedia: deps.getMissingMedia?.() ?? new Set(),
    model,
    resolution: deps.getVideoResolution?.() ?? '',
  })
  return { ok: true as const, node, request }
}

/** 镜级出片开关：表情参考、原生音频、工位 */
export function createSetShotVideoOptionsTool(deps: MaterialToolDeps): ToolDef {
  return defineTool({
    name: 'set_shot_video_options',
    description:
      '【平台内置】写入某镜出片相关开关：表情参考、原生音频、工位（生图/出片）。' +
      '至少提供一个字段；只有当前模型不支持原生音频才会拒绝，' +
      '缺音色样本或说话人无法判定时仍会开启，出片阶段降级为静音视频并给出说明。',
    schema: z
      .object({
        no: z.string().min(1).describe('镜号，例如 S03'),
        episode: z.number().int().min(1).optional().describe('集号；省略用当前集'),
        useExpressionRef: z.boolean().optional().describe('是否带说话角色表情参考'),
        audioMode: z.enum(['native', 'off']).optional().describe('原生音频开/关'),
        prod_kind: z.enum(['image', 'video']).optional().describe('工位：生图镜或出片镜'),
      })
      .refine((v) => v.useExpressionRef !== undefined || v.audioMode !== undefined || v.prod_kind !== undefined, {
        message: '至少提供一个字段：useExpressionRef / audioMode / prod_kind',
      }),
    run: async ({ no, episode, useExpressionRef, audioMode, prod_kind }) => {
      if (!deps.projectName().trim()) return { ok: false, error: NO_PROJECT }
      let project: ProjectData
      try {
        project = await deps.load()
      } catch (e) {
        return { ok: false, error: (e as Error)?.message || String(e) }
      }
      const ep = Number(episode) > 0 ? Math.floor(Number(episode)) : deps.epNo()
      const shot = findShot(project, ep, no)
      if (!shot) return { ok: false, error: `第 ${ep} 集找不到镜号 ${String(no).trim()}` }

      const patch: ProjectShot = { ...shot }
      const notes: string[] = []

      if (useExpressionRef !== undefined) {
        patch.use_expression_ref = useExpressionRef
        notes.push(`表情参考：${useExpressionRef ? '开' : '关'}`)
      }

      if (prod_kind !== undefined) {
        patch.prod_kind = prod_kind
        notes.push(`工位：${prod_kind === 'image' ? '生图' : '出片'}`)
      }

      if (audioMode !== undefined) {
        if (audioMode === 'off') {
          patch.audio_mode = 'off'
          patch.audio_ref = undefined
          patch.audio_meta = undefined
          notes.push('原生音频：关')
        } else {
          const built = buildRequest(deps, project, shot)
          if (!built.ok) return built
          const model = deps.getSelectedVideoModel?.() ?? null
          const caps = audioRefCapabilitiesFor({
            providerKind: model?.providerKind,
            model: model?.model,
            audioOut: model?.audioOut,
          })
          const dialogue = parseDialogue(built.node.data.dialogue)
          const seconds = shotRequestSeconds({
            seconds: Number(shot.seconds) || 0,
            modelId: model?.model,
            nativeAudio: true,
            nativeAudioMinVideoSeconds: caps?.minVideoSeconds,
          }).seconds
          const ref = nativeAudioRef({
            dialogue,
            performance: built.node.data.performance,
            characters: readCharacters(project.characters),
            caps,
            seconds,
            // 无声镜没有说话人可推断，沿用镜上已保存的音色角色
            preferredCharacter: shot.audio_ref?.character,
          })
          // 模型不支持原生音频才是硬错误；音色样本缺失只降级，不拒绝设置
          if (!caps?.supported) {
            return { ok: false, error: '当前模型不支持原生音频' }
          }
          patch.audio_mode = 'native'
          if (ref.ok) {
            patch.audio_ref = { character: ref.ref.character, url: ref.ref.url }
            patch.audio_meta = {
              fingerprint: nativeAudioFingerprint({
                modelKey: model?.key,
                audioRef: ref.ref,
                dialogue,
              }),
              modelKey: model?.key ?? '',
              createdAt: new Date().toISOString(),
            }
            notes.push('原生音频：开')
          } else {
            // 与面板一致：偏好记为 native，出片时由拼装器降级并给 warn
            patch.audio_ref = undefined
            patch.audio_meta = undefined
            notes.push(`原生音频：开（无音色参考，出片会降级为静音：${ref.reason}）`)
          }
        }
      }

      const written = await deps.writeShot(project, patch)
      if (!written.ok) return written
      return { ok: true, summary: `镜 ${shot.no}：${notes.join('；')}`, no: shot.no }
    },
  })
}

/** 手改正文保存/清除 */
export function createSetShotVideoOverrideTool(deps: MaterialToolDeps): ToolDef {
  return defineTool({
    name: 'set_shot_video_override',
    description:
      '【平台内置】保存或清除某镜出手改正文（video_prompt_override）。' +
      '保存时须提供 fingerprint，且须与当前出片请求一致（可先 read_shot_video_inputs）。' +
      '存在 override 时 generate_clip 逐字使用 override，忽略参数 prompt。',
    schema: z.object({
      no: z.string().min(1).describe('镜号'),
      episode: z.number().int().min(1).optional(),
      text: z.string().optional().describe('手改正文；与 clear 二选一'),
      fingerprint: z.string().min(1).optional().describe('当前出片请求指纹；保存时必填'),
      clear: z.boolean().optional().describe('true 清除手改'),
    }),
    run: async ({ no, episode, text, fingerprint, clear }) => {
      if (!deps.projectName().trim()) return { ok: false, error: NO_PROJECT }
      if (clear) {
        let project: ProjectData
        try {
          project = await deps.load()
        } catch (e) {
          return { ok: false, error: (e as Error)?.message || String(e) }
        }
        const ep = Number(episode) > 0 ? Math.floor(Number(episode)) : deps.epNo()
        const shot = findShot(project, ep, no)
        if (!shot) return { ok: false, error: `第 ${ep} 集找不到镜号 ${String(no).trim()}` }
        const written = await deps.writeShot(project, {
          ...shot,
          video_prompt_override: null,
          handEdited: (shot.handEdited || []).filter((f) => f !== 'video_prompt_override'),
        })
        if (!written.ok) return written
        return { ok: true, summary: `镜 ${shot.no} 已清除手改正文`, no: shot.no }
      }
      const body = String(text ?? '').trim()
      const fp = String(fingerprint ?? '').trim()
      if (!body) return { ok: false, error: '保存手改正文需要非空 text' }
      if (!fp) return { ok: false, error: '保存手改正文需要 fingerprint（先调用 read_shot_video_inputs）' }

      let project: ProjectData
      try {
        project = await deps.load()
      } catch (e) {
        return { ok: false, error: (e as Error)?.message || String(e) }
      }
      const ep = Number(episode) > 0 ? Math.floor(Number(episode)) : deps.epNo()
      const shot = findShot(project, ep, no)
      if (!shot) return { ok: false, error: `第 ${ep} 集找不到镜号 ${String(no).trim()}` }
      const built = buildRequest(deps, project, shot)
      if (!built.ok) return built
      if (built.request.fingerprint !== fp) {
        return {
          ok: false,
          error: `fingerprint 与当前出片请求不一致（期望 ${built.request.fingerprint.slice(0, 12)}…）。先 read_shot_video_inputs 再保存`,
        }
      }
      const written = await deps.writeShot(project, {
        ...shot,
        video_prompt_override: {
          text: body,
          fingerprint: fp,
          createdAt: new Date().toISOString(),
        },
        handEdited: [...new Set([...(shot.handEdited || []), 'video_prompt_override'])],
      })
      if (!written.ok) return written
      return { ok: true, summary: `镜 ${shot.no} 已保存手改正文（${body.length} 字）`, no: shot.no }
    },
  })
}

/** 手工参考 URL */
export function createSetShotRefExtrasTool(deps: MaterialToolDeps): ToolDef {
  return defineTool({
    name: 'set_shot_ref_extras',
    description:
      '【平台内置】为某镜添加或移除手工参考图 URL（refExtras）。仅接受当前项目媒体地址；外链拒绝。',
    schema: z.object({
      no: z.string().min(1),
      episode: z.number().int().min(1).optional(),
      urls: z.array(z.string().min(1)).min(1).describe('项目内图片地址列表'),
      action: z.enum(['add', 'remove']).optional().describe('默认 add'),
    }),
    run: async ({ no, episode, urls, action }) => {
      if (!deps.projectName().trim()) return { ok: false, error: NO_PROJECT }
      let project: ProjectData
      try {
        project = await deps.load()
      } catch (e) {
        return { ok: false, error: (e as Error)?.message || String(e) }
      }
      const ep = Number(episode) > 0 ? Math.floor(Number(episode)) : deps.epNo()
      const shot = findShot(project, ep, no)
      if (!shot) return { ok: false, error: `第 ${ep} 集找不到镜号 ${String(no).trim()}` }

      const allowed = await projectMediaUrls(deps)
      const wanted = [...new Set(urls.map((u) => String(u).trim()).filter(Boolean))]
      const bad = wanted.filter((u) => !isProjectMediaUrl(u, allowed))
      if (bad.length) {
        return {
          ok: false,
          error: `以下地址不在当前项目媒体里：${bad.slice(0, 3).join('、')}${bad.length > 3 ? ' …' : ''}`,
        }
      }
      const mode = action ?? 'add'
      const current = [...(shot.refExtras ?? [])]
      let next: string[]
      if (mode === 'add') {
        const set = new Set(current)
        for (const u of wanted) set.add(u)
        next = [...set]
      } else {
        const drop = new Set(wanted)
        next = current.filter((u) => !drop.has(u))
      }
      const written = await deps.writeShot(project, { ...shot, refExtras: next })
      if (!written.ok) return written
      return {
        ok: true,
        summary: mode === 'add' ? `镜 ${shot.no} 已添加 ${wanted.length} 条手工参考` : `镜 ${shot.no} 已移除 ${wanted.length} 条手工参考`,
        no: shot.no,
        refExtras: next,
      }
    },
  })
}

async function projectMediaUrls(deps: MaterialToolDeps): Promise<string[]> {
  const name = deps.projectName().trim()
  if (!name) return []
  try {
    if (deps.io?.mediaUrls) return await deps.io.mediaUrls(name)
    const bundle = await listMedia(name)
    return [...bundle.images, ...bundle.videos].map((m) => m.url)
  } catch {
    return []
  }
}

/** 邻镜参考 token */
export function createSetShotNeighborRefsTool(deps: MaterialToolDeps): ToolDef {
  return defineTool({
    name: 'set_shot_neighbor_refs',
    description:
      '【平台内置】为某镜添加或移除相邻镜参考（shot-prev / shot-next），与画布邻镜连线等价。',
    schema: z.object({
      no: z.string().min(1),
      episode: z.number().int().min(1).optional(),
      neighbor: z.enum(['prev', 'next']).describe('上一镜或下一镜'),
      action: z.enum(['add', 'remove']).optional().describe('默认 add'),
    }),
    run: async ({ no, episode, neighbor, action }) => {
      if (!deps.projectName().trim()) return { ok: false, error: NO_PROJECT }
      let project: ProjectData
      try {
        project = await deps.load()
      } catch (e) {
        return { ok: false, error: (e as Error)?.message || String(e) }
      }
      const ep = Number(episode) > 0 ? Math.floor(Number(episode)) : deps.epNo()
      const shot = findShot(project, ep, no)
      if (!shot) return { ok: false, error: `第 ${ep} 集找不到镜号 ${String(no).trim()}` }
      const token = neighbor === 'prev' ? SHOT_PREV : SHOT_NEXT
      const mode = action ?? 'add'
      const refIds = applyRefTokens(shot.refIds, [token], mode)
      const written = await deps.writeShot(project, { ...shot, refIds })
      if (!written.ok) return written
      return {
        ok: true,
        summary: `镜 ${shot.no} 已${mode === 'add' ? '添加' : '移除'}${neighbor === 'prev' ? '上' : '下'}一镜参考`,
        no: shot.no,
        refIds,
      }
    },
  })
}

function prevShotInEpisode(project: ProjectData, ep: number, shot: ProjectShot): ProjectShot | undefined {
  const list = (project.shots ?? [])
    .filter((s) => (Number(s.episode) || 1) === ep)
    .slice()
    .sort((a, b) => String(a.no ?? '').localeCompare(String(b.no ?? ''), 'zh'))
  const idx = list.findIndex((s) => s.id === shot.id)
  if (idx <= 0) return undefined
  return list[idx - 1]
}

async function upsertClipFrameAssetInProject(
  projectName: string,
  project: ProjectData,
  shot: ProjectShot,
  role: ClipFrameRole,
): Promise<{ ok: true; token: string; title: string; notice?: string } | { ok: false; error: string }> {
  const clip = String(shot.clip ?? '').trim()
  if (!clip) return { ok: false, error: `镜 ${shot.no} 还没有成片` }
  const extracted = await extractSingleClipFrame(clip, role)
  if ('error' in extracted) return { ok: false, error: extracted.error }
  const assets = [...(project.assets ?? [])]
  const existing = findClipFrameAsset(assets, shot.id, role)
  const canvasId = String(existing?.canvasId ?? '').trim() || uid()
  const fields = buildClipFrameAssetFields({
    shotId: shot.id,
    shotNo: String(shot.no ?? ''),
    videoUrl: clip,
    frameUrl: extracted.url,
    role,
    canvasId,
  })
  const merged = mergeClipFrameIntoAssets(assets, fields)
  await patchProject(projectName, { assets: merged })
  return {
    ok: true,
    token: clipFrameAssetToken(canvasId),
    title: fields.title,
    notice: extracted.notice,
  }
}

/** 从成片抽首/尾帧并写入项目素材库（画布下次水合可见） */
export function createPublishShotClipFrameTool(deps: MaterialToolDeps): ToolDef {
  return defineTool({
    name: 'publish_shot_clip_frame',
    description:
      '【平台内置】从某镜成片抽取首帧或尾帧，发布/覆盖为溯源素材卡（sourceShotId+frameRole）。',
    schema: z.object({
      no: z.string().min(1),
      episode: z.number().int().min(1).optional(),
      role: z.enum(['head', 'tail']),
    }),
    run: async ({ no, episode, role }) => {
      if (!deps.projectName().trim()) return { ok: false, error: NO_PROJECT }
      const name = deps.projectName().trim()
      let project: ProjectData
      try {
        project = await deps.load()
      } catch (e) {
        return { ok: false, error: (e as Error)?.message || String(e) }
      }
      const ep = Number(episode) > 0 ? Math.floor(Number(episode)) : deps.epNo()
      const shot = findShot(project, ep, no)
      if (!shot) return { ok: false, error: `第 ${ep} 集找不到镜号 ${String(no).trim()}` }
      const out = await upsertClipFrameAssetInProject(name, project, shot, role)
      if (!out.ok) return out
      deps.onChanged?.()
      return {
        ok: true,
        summary: `镜 ${shot.no} 已发布${role === 'head' ? '首' : '尾'}帧素材：${out.title}`,
        token: out.token,
        ...(out.notice ? { notice: out.notice } : {}),
      }
    },
  })
}

/** 上一镜尾帧素材写入本镜 refIds（不写入 shot-prev） */
export function createLinkPrevShotTailFrameTool(deps: MaterialToolDeps): ToolDef {
  return defineTool({
    name: 'link_prev_shot_tail_frame',
    description: '【平台内置】将上一镜成片尾帧发布为素材卡，并把对应 asset token 写入本镜 refIds。',
    schema: z.object({
      no: z.string().min(1),
      episode: z.number().int().min(1).optional(),
    }),
    run: async ({ no, episode }) => {
      if (!deps.projectName().trim()) return { ok: false, error: NO_PROJECT }
      const name = deps.projectName().trim()
      let project: ProjectData
      try {
        project = await deps.load()
      } catch (e) {
        return { ok: false, error: (e as Error)?.message || String(e) }
      }
      const ep = Number(episode) > 0 ? Math.floor(Number(episode)) : deps.epNo()
      const shot = findShot(project, ep, no)
      if (!shot) return { ok: false, error: `第 ${ep} 集找不到镜号 ${String(no).trim()}` }
      const prev = prevShotInEpisode(project, ep, shot)
      if (!prev) return { ok: false, error: '没有上一镜' }
      const pub = await upsertClipFrameAssetInProject(name, project, prev, 'tail')
      if (!pub.ok) return pub
      project = await deps.load()
      const refIds = appendRefToken(shot.refIds, pub.token)
      const written = await deps.writeShot(project, { ...shot, refIds })
      if (!written.ok) return written
      deps.onChanged?.()
      return {
        ok: true,
        summary: `镜 ${shot.no} 已引用上一镜尾帧：${pub.title}`,
        refIds,
        token: pub.token,
      }
    },
  })
}