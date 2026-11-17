import { z } from 'zod'
import { defineTool, type ToolDef } from './tool'
import type { ProjectAsset, ProjectData, ProjectShot } from '../api'
import type { CharacterSheet } from '../characters'
import { readCharacters } from '../charMap'
import { assetNodesFromAssets, composeShotCanvasNodes } from '../canvasShots'
import type { ShotNodeType } from '../data'
import { assetMediaType } from '../mediaPick'
import { normalizeGenerated, normalizeTransitionOut } from '../transition'
import type { TransitionGenerated } from '../types'
import {
  effectiveTransitionRefs,
  transitionDialogueText,
  transitionRefCandidateView,
  transitionRequestSeconds,
  type TransitionRefCandidateView,
} from '../transitionGen'
import { nativeAudioFingerprint, nativeAudioRef, audioRefCapabilitiesFor } from '../nativeAudio'
import { parseDialogue } from '../prompts'
import { applyRefTokens, resolveRefTargets } from './refResolve'
import type { VideoModelInput } from '../videoPrompt'

/**
 * 转场参考 / 原生音频的写入工具。
 *
 * 为什么独立成文件而不是塞进 `submit_joins`：`generated` 是 passthrough，
 * 多传的键既不报错也不落地，参考到底写没写进去无法从返回判断。
 * 参考是集合语义（add 幂等 / remove 只减目标项），用独立工具才说得清。
 *
 * 为什么名字寻址：`asset-<canvasId>` 这类 token 模型看不到也拼不对，
 * 让它传 id 只会写出指不到任何卡片的参考。
 */

export type TransitionRefToolDeps = {
  /** 当前项目名；空串表示未选项目 */
  projectName: () => string
  epNo: () => number
  load: () => Promise<ProjectData>
  setSnapshot: (p: ProjectData) => void
  onChanged?: () => void
  /** 单镜写回：服务端按 id 字段级合并 */
  writeShot: (project: ProjectData, next: ProjectShot) => Promise<{ ok: true } | { ok: false; error: string }>
  /** 画布节点/角色/坏链；缺省时按项目快照重建（素材卡 token 也能解析） */
  getCanvasContext?: () => {
    nodes: ShotNodeType[]
    characters: CharacterSheet[]
    missingMedia: Set<string>
  }
  /** 画布当前视频模型：原生音频能力门禁要它 */
  getSelectedVideoModel?: () => VideoModelInput | null
  /** Agent 写入标记：宿主记到内存，刷新即失效 */
  onRefsWritten?: (info: { afterShotId: string; toShotId: string; tokens: string[] }) => void
}

/** 单次最多写入的参考项；再多就分两次，避免一次把整张角色表塞进请求 */
const MAX_NAMES = 8

const NO_PROJECT = '请先在顶栏选择项目'

type CanvasCtx = {
  nodes: ShotNodeType[]
  characters: CharacterSheet[]
  missingMedia: Set<string>
}

function canvasContext(deps: TransitionRefToolDeps, project: ProjectData): CanvasCtx {
  const host = deps.getCanvasContext?.()
  if (host) return host
  const shots = Array.isArray(project.shots) ? (project.shots as ProjectShot[]) : []
  const assets = Array.isArray(project.assets) ? (project.assets as ProjectAsset[]) : []
  return {
    nodes: composeShotCanvasNodes(assetNodesFromAssets(assets), shots),
    characters: readCharacters(project.characters),
    missingMedia: new Set<string>(),
  }
}

function findShot(project: ProjectData, ep: number, no: string): ProjectShot | undefined {
  const want = String(no ?? '').trim()
  return (project.shots || []).find(
    (s) => (Number(s.episode) || 1) === ep && String(s.no ?? '').trim() === want,
  )
}

type Seam = {
  project: ProjectData
  source: ProjectShot
  sourceNode: ShotNodeType
  target: ProjectShot
  targetNode: ShotNodeType
  generated: TransitionGenerated
  ctx: CanvasCtx
}

type SeamResult = { ok: true; seam: Seam } | { ok: false; error: string }

/** 定位接缝：源镜号 + 可选目标镜号（缺省取 transition_out.to） */
async function locateSeam(
  deps: TransitionRefToolDeps,
  args: { after_no: string; to_no?: string; episode?: number },
): Promise<SeamResult> {
  if (!deps.projectName().trim()) return { ok: false, error: NO_PROJECT }
  let project: ProjectData
  try {
    project = await deps.load()
  } catch (e) {
    return { ok: false, error: (e as Error)?.message || String(e) }
  }
  const ep = Number(args.episode) > 0 ? Math.floor(Number(args.episode)) : deps.epNo()
  const source = findShot(project, ep, args.after_no)
  if (!source) {
    return { ok: false, error: `第 ${ep} 集找不到镜号 ${String(args.after_no).trim()}` }
  }
  const out = normalizeTransitionOut(
    (source as unknown as { transition_out?: unknown }).transition_out as never,
    '',
  )
  const rawOut = (source as unknown as { transition_out?: Record<string, unknown> }).transition_out
  if (!rawOut) {
    return {
      ok: false,
      error: `镜 ${source.no} 未配置转场。下一步：先用 submit_joins 建立接缝，或在画布上连线后重试`,
    }
  }
  const ctx = canvasContext(deps, project)
  const sourceNode = ctx.nodes.find((n) => String(n.data?.shotId ?? '') === String(source.id ?? ''))
  if (!sourceNode) {
    return { ok: false, error: `镜 ${source.no} 不在画布上，无法解析转场参考。下一步：刷新画布或重新导入分镜后重试` }
  }
  let target: ProjectShot | undefined
  if (args.to_no) target = findShot(project, ep, args.to_no)
  else {
    const wanted = String(rawOut.to ?? '')
    target =
      (project.shots || []).find((s) => String(s.id ?? '') === wanted) ??
      (project.shots || []).find((s) => String(s.no ?? '') === wanted)
  }
  if (!target) {
    return {
      ok: false,
      error: `转场目标镜「${String(args.to_no ?? rawOut.to ?? '') || '(空)'}」找不到。下一步：用 read_shots 确认镜号，或用 submit_joins 重设接缝`,
    }
  }
  const targetNode = ctx.nodes.find((n) => String(n.data?.shotId ?? '') === String(target.id ?? ''))
  if (!targetNode) {
    return { ok: false, error: `镜 ${target.no} 不在画布上，无法解析转场参考。下一步：刷新画布或重新导入分镜后重试` }
  }
  return {
    ok: true,
    seam: {
      project,
      source,
      sourceNode,
      target,
      targetNode,
      generated: normalizeGenerated(out.generated),
      ctx,
    },
  }
}

/** 写回转场配置：只改来源镜的 transition_out，不追加 handEdited */
async function writeGenerated(
  deps: TransitionRefToolDeps,
  project: ProjectData,
  seam: Seam,
  generated: TransitionGenerated,
): Promise<{ ok: true } | { ok: false; error: string }> {
  const rawOut = (seam.source as unknown as { transition_out?: Record<string, unknown> }).transition_out ?? {}
  const next: ProjectShot = {
    ...seam.source,
    transition_out: { ...rawOut, generated } as never,
  }
  const written = await deps.writeShot(project, next)
  if (!written.ok) return written
  deps.setSnapshot({
    ...project,
    shots: (project.shots || []).map((s) => (s.id === next.id ? next : s)),
  })
  deps.onChanged?.()
  return { ok: true }
}

/** 写入后的有序参考：与出片同一处计算，index 直接对应正文里的 [图N] */
function orderedRefs(seam: Seam, generated: TransitionGenerated) {
  return effectiveTransitionRefs(
    seam.sourceNode,
    seam.targetNode,
    seam.ctx.nodes,
    seam.ctx.characters,
    seam.ctx.missingMedia,
    generated,
  ).map((r, i) => ({ index: i + 1, token: r.token, label: r.label, source: r.source, url: r.url }))
}

function candidatePool(seam: Seam, generated: TransitionGenerated): TransitionRefCandidateView[] {
  return transitionRefCandidateView({
    source: seam.sourceNode,
    target: seam.targetNode,
    nodes: seam.ctx.nodes,
    characters: seam.ctx.characters,
    missingMedia: seam.ctx.missingMedia,
    generated,
  }).candidates
}

function labelList(rows: TransitionRefCandidateView[]): string {
  const shown = rows.slice(0, 12).map((r) => r.label)
  return shown.join('、') + (rows.length > shown.length ? ` 等 ${rows.length} 个` : '')
}

/**
 * 画布素材卡（含视频/音频）：按标题寻址先全部解析，再由候选池判定能不能当风格参考。
 * 只把图片卡放进候选名单会让「推镜」这种视频卡直接变成「没有素材卡」，说不清为什么不能选。
 */
function canvasAssetCards(ctx: CanvasCtx): { id: string; name: string }[] {
  const out: { id: string; name: string }[] = []
  for (const n of ctx.nodes) {
    const type = (n as unknown as { type?: string }).type
    if (type !== 'asset') continue
    const d = n.data as unknown as { title?: string; url?: string }
    out.push({ id: n.id, name: String(d.title || '未命名') })
  }
  return out
}

export function createTransitionRefTools(deps: TransitionRefToolDeps): ToolDef[] {
  const attachTransitionRefs = defineTool({
    name: 'attach_transition_refs',
    description:
      '【平台内置】给某个镜间转场的风格参考加/减参考图。寻址一律用名字：角色传角色名，素材传图片素材卡标题，' +
      'URL 传候选池里已存在的地址；不要传画布节点 id 或 asset- 前缀 token。' +
      'add 是并集（重复调用不会重复加），remove 只移除目标项、其他参考保持不变。' +
      '名字找不到、同名歧义、角色没有外观图、素材不是图片、URL 不在候选池时报错并列出候选，不写入任何猜测的值。' +
      '本工具不写提示词、不改首尾帧，也不把字段标成手改。' +
      '写完后请用 read_transition_video_inputs 核对 [图N] 顺序再写正文。',
    schema: z.object({
      after_no: z.string().min(1).describe('接缝前镜（源镜）的镜号，例如 S03'),
      to_no: z.string().optional().describe('接缝后镜的镜号；省略时取源镜 transition_out.to 指向的镜头'),
      kind: z.enum(['character', 'asset', 'url']).describe('参考类型：角色卡 / 图片素材卡 / 候选池里的 URL'),
      names: z
        .array(z.string().min(1))
        .min(1)
        .describe('角色名、图片素材卡标题或候选池 URL；单次最多 8 项，不要传节点 id'),
      action: z.enum(['add', 'remove']).optional().describe('默认 add；remove 只移除目标项'),
      episode: z.number().int().min(1).optional().describe('集号；省略用当前集'),
    }),
    run: async ({ after_no, to_no, kind, names, action, episode }) => {
      const located = await locateSeam(deps, { after_no, to_no, episode })
      if (!located.ok) return located
      const seam = located.seam
      const pool = candidatePool(seam, seam.generated)
      const byToken = new Map(pool.map((c) => [c.token, c]))
      const byUrl = new Map(pool.map((c) => [c.url, c]))

      const wanted = Array.from(new Set((names ?? []).map((n) => String(n ?? '').trim()).filter(Boolean)))
      if (!wanted.length) return { ok: false, error: 'names 不能为空：至少给出一个名字或 URL' }
      const accepted = wanted.slice(0, MAX_NAMES)
      const over = wanted.slice(MAX_NAMES)

      let tokens: string[] = []
      if (kind === 'url') {
        const unknown = accepted.filter((u) => !byUrl.has(u))
        if (unknown.length) {
          return {
            ok: false,
            error:
              `URL 不在转场候选池：${unknown.join('、')}。` +
              `候选里的图片地址：${byUrl.size ? [...byUrl.keys()].slice(0, 12).join('、') : '(空)'}。` +
              '下一步：先把这张图加为镜头的手工参考，或改用角色名 / 素材卡标题',
          }
        }
        tokens = accepted.map((u) => byUrl.get(u)!.token)
      } else {
        let project: ProjectData
        try {
          project = await deps.load()
        } catch (e) {
          return { ok: false, error: (e as Error)?.message || String(e) }
        }
        const resolved =
          kind === 'character'
            ? resolveRefTargets({
                kind: 'character',
                names: accepted,
                characters: readCharacters(project.characters).map((c) => ({ id: c.id, name: c.name })),
              })
            : resolveRefTargets({ kind: 'asset', names: accepted, assets: canvasAssetCards(seam.ctx) })
        if (!resolved.ok) return resolved
        const outside = resolved.tokens.filter((t) => !byToken.has(t))
        if (outside.length) {
          const kinds = kind === 'asset' ? '图片素材' : '角色外观'
          return {
            ok: false,
            error:
              `这些${kinds}不能作为转场参考：${outside.join('、')}` +
              (kind === 'character' ? '（没有外观图）' : '（不是画布上的图片素材卡）') +
              `。当前可选：${pool.length ? labelList(pool) : '(无候选)'}`,
          }
        }
        tokens = resolved.tokens
      }

      const mode = action ?? 'add'
      const current = [
        ...(seam.generated.refIds ?? []),
        // 兜底：没有任何显式选择时，已提交项可能就是候选池里的空集，不必补
      ]
      const refIds = applyRefTokens(current, tokens, mode)
      if (mode === 'remove' && refIds.length === current.length) {
        return {
          ok: false,
          error: `这些项本来就不在转场参考里：${tokens.join('、')}。当前已提交：${
            orderedRefs(seam, seam.generated).map((r) => `[图${r.index}] ${r.label}`).join(' / ') || '(无)'
          }`,
        }
      }
      const nextGenerated = normalizeGenerated({ ...seam.generated, refIds })
      const written = await writeGenerated(deps, seam.project, seam, nextGenerated)
      if (!written.ok) return written

      if (mode === 'add') deps.onRefsWritten?.({ afterShotId: String(seam.source.id), toShotId: String(seam.target.id), tokens })
      const refs = orderedRefs(seam, nextGenerated)
      return {
        ok: true,
        summary:
          mode === 'add'
            ? `已加入 ${tokens.length} 项参考，当前共 ${refs.length} 项`
            : `已移除 ${tokens.length} 项参考，当前共 ${refs.length} 项`,
        seam: { after_no: String(seam.source.no ?? ''), to_no: String(seam.target.no ?? '') },
        added: mode === 'add' ? tokens : [],
        removed: mode === 'remove' ? tokens : [],
        refs,
        refTotal: refs.length,
        ...(over.length
          ? { omitted: over.map((n) => ({ name: n, reason: `单次最多 ${MAX_NAMES} 项，请再调一次` })) }
          : {}),
        next: '正文里的 [图N] 必须与这里的 index 一致；写正文用 submit_joins',
      }
    },
  })

  const setTransitionAudio = defineTool({
    name: 'set_transition_audio',
    description:
      '【平台内置】开关某个镜间转场的原生音频。只接受 mode（native / off）与可选的角色名；' +
      '不接受音频地址——音色由系统按该角色的音色样本解析，不信任调用方给的 URL。' +
      '角色没有可用样本、样本已失效、台词缺失或两镜出现多个说话人时返回可读原因且不写入。' +
      '开启后请求秒数会被抬到原生音频门槛（可能超过转场目标时长），成片仍裁回目标时长。',
    schema: z.object({
      after_no: z.string().min(1).describe('接缝前镜（源镜）的镜号'),
      to_no: z.string().optional().describe('接缝后镜的镜号；省略时取源镜 transition_out.to 指向的镜头'),
      mode: z.enum(['native', 'off']).describe('native = 使用 Seedance 原生声音 + 角色音色；off = 关闭'),
      character: z.string().optional().describe('说话角色名；省略则用接缝台词里唯一的说话人'),
      episode: z.number().int().min(1).optional().describe('集号；省略用当前集'),
    }),
    run: async ({ after_no, to_no, mode, character, episode }) => {
      const located = await locateSeam(deps, { after_no, to_no, episode })
      if (!located.ok) return located
      const seam = located.seam
      const targetSeconds = seam.generated.targetSeconds
      const submitsLastFrame = Boolean(seam.generated.boundary?.out && seam.generated.boundary?.in)

      if (mode === 'off') {
        const rest: Record<string, unknown> = { ...seam.generated }
        delete rest.audioMode
        delete rest.audioRef
        delete rest.audioMeta
        // 与面板「关闭」同一形状：audioMode: 'off'，音色引用与元数据一并清空
        const nextGenerated: TransitionGenerated = {
          ...normalizeGenerated(rest as Partial<TransitionGenerated>),
          audioMode: 'off',
        }
        const written = await writeGenerated(deps, seam.project, seam, nextGenerated)
        if (!written.ok) return written
        return {
          ok: true,
          summary: '已关闭原生音频',
          audio: { mode: 'off', label: '无参考音频', detail: '环境声可写在「声音描述」里' },
        }
      }

      const model = deps.getSelectedVideoModel?.() ?? null
      const caps = audioRefCapabilitiesFor({
        providerKind: model?.providerKind,
        model: model?.model,
        audioOut: model?.features?.audioOut ?? model?.audioOut,
      })
      const req = transitionRequestSeconds(targetSeconds, model?.model, submitsLastFrame, {
        nativeAudio: true,
        nativeAudioMinVideoSeconds: caps?.minVideoSeconds,
      })
      const dialogue = parseDialogue(transitionDialogueText(seam.sourceNode, seam.targetNode))
      const performance = [...(seam.sourceNode.data.performance ?? []), ...(seam.targetNode.data.performance ?? [])]
      const speakers = [...new Set(dialogue.filter((l) => l.speaker && String(l.text || '').trim()).map((l) => l.speaker))]
      if (character && speakers.length && !speakers.includes(character)) {
        return {
          ok: false,
          error: `接缝台词不属于角色「${character}」；当前说话人：${speakers.join('、')}`,
        }
      }
      const resolved = nativeAudioRef({
        dialogue,
        performance,
        characters: seam.ctx.characters,
        caps,
        seconds: req.seconds,
      })
      if (!resolved.ok) return { ok: false, error: resolved.reason }
      if (character && resolved.character !== character) {
        return {
          ok: false,
          error: `原生音频只接受唯一说话角色：当前是「${resolved.character}」，与指定的「${character}」不一致`,
        }
      }
      const modelKey = model?.model
      const nextGenerated = normalizeGenerated({
        ...seam.generated,
        audioMode: 'native',
        audioRef: resolved.ref,
        audioMeta: {
          fingerprint: nativeAudioFingerprint({ modelKey, audioRef: resolved.ref, dialogue }),
          ...(modelKey ? { modelKey } : {}),
          createdAt: new Date().toISOString(),
        },
      })
      const written = await writeGenerated(deps, seam.project, seam, nextGenerated)
      if (!written.ok) return written
      return {
        ok: true,
        summary: `已开启原生音频：${resolved.character} 音色（样本 ${resolved.sampleSeconds.toFixed(1)}s）`,
        audio: {
          mode: 'native',
          label: `${resolved.character} 音色`,
          detail: '出片请求将附带 audio_url 与 generate_audio',
          character: resolved.character,
        },
        seconds: targetSeconds,
        requestSeconds: req.seconds,
        ...(req.trimTo ? { trimTo: req.trimTo } : {}),
      }
    },
  })

  return [attachTransitionRefs, setTransitionAudio]
}
