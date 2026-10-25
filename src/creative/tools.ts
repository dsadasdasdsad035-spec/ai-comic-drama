import { DynamicStructuredTool } from '@langchain/core/tools'
import type { StructuredToolInterface } from '@langchain/core/tools'
import { z } from 'zod'
import { askVision, type AppSettings, type Cap } from '../api'
import { isRunnableModel, modelHasCap } from '../modelCaps'
import { getContractSchema, validateContract } from '../skills/contracts'
import type { Skill } from '../skills/types'
import { boundJson } from '../agent/workbenchChat'
import type { CreativeArtifact, CreativeSessionSummary, CreativeShot, CreativeSource } from './sessionStore'
import {
  analyzeCreative,
  downloadCreativeExport,
  extractFrames,
  ingestCreative,
  listCreativeArtifacts,
  promoteCreativeArtifact,
  splitCreativeSource,
  probeCreativeSource,
} from './mediaApi'

/** 会话快照：工具只读这一份，避免每轮都重新拉一遍 */
export type CreativeSnapshot = {
  session: CreativeSessionSummary
  sources: CreativeSource[]
  shots: Record<string, CreativeShot[]>
  artifacts: CreativeArtifact[]
}

export type CostRequest = {
  capability: Cap
  modelKey: string
  modelLabel: string
  calls: number
  note?: string
  /** Seedance 2.0+ 之类必须每次确认的调用 */
  alwaysConfirm?: boolean
}

export type CreativeToolDeps = {
  sessionId: string
  getSnapshot: () => Promise<CreativeSnapshot>
  /** 付费调用前确认；返回 false 表示用户拒绝 */
  confirmCost?: (req: CostRequest) => Promise<boolean>
  /** 生成能力实现；由 UI 注入，测试可用桩 */
  generateImage?: (input: { prompt: string; modelKey: string; signal?: AbortSignal }) => Promise<unknown>
  generateVideo?: (input: { prompt: string; image?: string; modelKey: string; signal?: AbortSignal }) => Promise<unknown>
  generateVoice?: (input: { text: string; modelKey: string; signal?: AbortSignal }) => Promise<unknown>
  settings: AppSettings | null
  /** 创意配置（能力绑定模型等）；不传时退回全局默认 */
  creative?: unknown
  /** 文本模型的可读标签；写进产物供审计 */
  modelLabel?: string
  signal?: AbortSignal
  /** 本轮已分析过的证据帧 → 视觉结果，避免重复付费 */
  frameCache?: Map<string, Record<string, unknown>>
  /** 本轮已发生的付费调用数，用于 maxPaidCallsPerTurn */
  paidCalls?: { count: number; max: number }
  onSourceChanged?: () => void
  onArtifactChanged?: () => void
}

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' ? (value as Record<string, unknown>) : {}
}

function pickCapabilityLabel(cap: Cap): string {
  if (cap === 'image') return '生图'
  if (cap === 'video') return '生视频'
  if (cap === 'audio') return '配音'
  if (cap === 'vision') return '视觉理解'
  if (cap === 'videoVision') return '视频理解'
  return cap
}

/**
 * 按能力解析模型键：创意配置覆盖 > 全局默认 > 该能力第一条。
 *
 * 非文本能力绝不能回落到文本模型：拿文本模型去出图/出片会直接失败，
 * 而且用户会以为自己在用某个视觉/视频模型。没有就返回空键，由调用方禁用并说明原因。
 */
export function creativeModelFor(settings: AppSettings | null, creative: unknown, cap: Cap): {
  key: string
  label: string
} {
  const supports = (m: { key: string; caps?: Cap[]; cap: Cap; supportsVideoRef?: boolean }) =>
    modelHasCap(m as never, cap) || (cap === 'videoRef' && Boolean(m.supportsVideoRef))
  const usable = (key: string) => {
    const hit = (settings?.models ?? []).find((m) => m.key === key && supports(m))
    return hit
  }
  const describe = (hit: { key: string; label: string; model: string }) => `${hit.label} · ${hit.model}`

  const configured = String(asRecord(asRecord(creative).models)[cap] || '').trim()
  if (configured) {
    const hit = usable(configured)
    if (hit) return { key: hit.key, label: describe(hit) }
    return { key: configured, label: `配置的模型不可用（${configured}）` }
  }

  const defKey = String(settings?.defaults?.[cap] || '').trim()
  const def = defKey ? usable(defKey) : undefined
  if (def) return { key: def.key, label: describe(def) }

  const first = (settings?.models ?? []).find((m) => supports(m) && isRunnableModel(m))
  if (first) return { key: first.key, label: describe(first) }

  return { key: '', label: `未配置${pickCapabilityLabel(cap)}模型` }
}

async function askCost(deps: CreativeToolDeps, req: CostRequest): Promise<{ ok: boolean; error?: string }> {
  if (!req.modelKey) return { ok: false, error: `没有可用的${pickCapabilityLabel(req.capability)}模型，请到设置页绑定` }
  if (deps.paidCalls) {
    if (deps.paidCalls.count + req.calls > deps.paidCalls.max) {
      return {
        ok: false,
        error: `本轮付费调用将超过上限（已用 ${deps.paidCalls.count}，本次 ${req.calls}，上限 ${deps.paidCalls.max}）`,
      }
    }
  }
  if (!deps.confirmCost) return { ok: true }
  const approved = await deps.confirmCost(req)
  return approved ? { ok: true } : { ok: false, error: '用户取消了本次调用' }
}

/** 站内路径 → dataURL；视觉接口只吃 dataURL */
async function frameToDataUrl(path: string): Promise<string> {
  const res = await fetch(path)
  if (!res.ok) throw new Error(`读取证据帧失败 HTTP ${res.status}`)
  const blob = await res.blob()
  if (blob.size > 4 * 1024 * 1024) throw new Error('证据帧超过 4MB，无法送视觉接口')
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => resolve(String(reader.result || ''))
    reader.onerror = () => reject(new Error('证据帧读取失败'))
    reader.readAsDataURL(blob)
  })
}

const FRAME_PROMPT = [
  '分析这一张视频证据帧，只描述画面里确实可见的内容。',
  '输出 JSON：',
  '{',
  '  "size": "景别（establishing wide / full / medium / medium close-up / close-up / extreme close-up）",',
  '  "camera": "机位与角度（low angle / eye level / high angle / dutch angle 等）",',
  '  "subject": "主体是谁/是什么",',
  '  "action": "正在发生的可见动作",',
  '  "environment": "环境与背景",',
  '  "lighting": "光源方向与性质",',
  '  "color": "色彩与调色",',
  '  "text": "画面里可读的文字；没有就留空",',
  '  "uncertain": "看不清或不确定的地方"',
  '}',
  '看不清就写「未识别」，不要编造品牌、文字或人脸细节。',
].join('\n')

/**
 * 创意会话的工具集。
 * 分四簇：读会话 / 媒体（无模型费用）/ 产物（只写 artifact）/ 生成（付费，必须过闸门）。
 * 与工作台的 stageTools 分开，是因为这里没有宿主草稿与 submit_* 合并语义。
 */
export function createCreativeToolSet(deps: CreativeToolDeps) {
  const snapshot = () => deps.getSnapshot()

  const readSession = new DynamicStructuredTool({
    name: 'read_creative_session',
    description: '读取当前创意会话的标题、模式、源视频列表与产物列表。只读。',
    schema: z.object({}),
    func: async () => {
      const snap = await snapshot()
      return {
        ok: true,
        session: {
          id: snap.session.id,
          title: snap.session.title,
          mode: snap.session.mode,
        },
        sources: snap.sources.map((s) => ({
          id: s.id,
          platform: s.platform,
          title: s.title,
          duration: s.duration,
          width: s.width,
          height: s.height,
          hasAudio: s.hasAudio,
          cover: s.cover,
        })),
        artifacts: snap.artifacts.map((a) => ({
          id: a.id,
          kind: a.kind,
          title: a.title,
          sourceId: a.sourceId,
          createdAt: a.createdAt,
        })),
      }
    },
  })

  const readSource = new DynamicStructuredTool({
    name: 'read_creative_source',
    description: '读取某个源视频的技术信息与镜头切分状态。只读；sourceId 省略时读最近一个。',
    schema: z.object({
      sourceId: z.string().optional().describe('源视频 id；省略则读最近一个'),
    }),
    func: async ({ sourceId }) => {
      const snap = await snapshot()
      const src = sourceId ? snap.sources.find((s) => s.id === sourceId) : snap.sources[0]
      if (!src) return { ok: false, error: '会话里还没有源视频' }
      const shots = snap.shots[src.id] || []
      return {
        ok: true,
        source: {
          id: src.id,
          platform: src.platform,
          title: src.title,
          url: src.url,
          duration: src.duration,
          width: src.width,
          height: src.height,
          fps: src.fps,
          hasAudio: src.hasAudio,
          cover: src.cover,
        },
        shotCount: shots.length,
        framedCount: shots.filter((s) => s.frames.length).length,
      }
    },
  })

  const readShots = new DynamicStructuredTool({
    name: 'read_video_shots',
    description: '读取镜头切分结果：每镜的时间范围、状态与证据帧路径。只读。',
    schema: z.object({
      sourceId: z.string().optional().describe('源视频 id；省略读最近一个'),
      only: z.enum(['all', 'unframed', 'unanalyzed']).optional().describe('过滤：全部 / 缺帧 / 未分析'),
    }),
    func: async ({ sourceId, only }) => {
      const snap = await snapshot()
      const src = sourceId ? snap.sources.find((s) => s.id === sourceId) : snap.sources[0]
      if (!src) return { ok: false, error: '会话里还没有源视频' }
      let shots = snap.shots[src.id] || []
      if (only === 'unframed') shots = shots.filter((s) => !s.frames.length)
      if (only === 'unanalyzed') shots = shots.filter((s) => s.status !== 'analyzed')
      return {
        ok: true,
        sourceId: src.id,
        shots: boundJson(
          shots.map((s) => ({
            index: s.index,
            start: s.start,
            end: s.end,
            status: s.status,
            frames: s.frames,
          })),
        ),
        total: (snap.shots[src.id] || []).length,
      }
    },
  })

  const readFrameDetail = new DynamicStructuredTool({
    name: 'read_frame_detail',
    description:
      '读取某一镜的证据帧，并用视觉模型描述画面（景别、机位、主体、动作、环境、光影、色彩）。' +
      '会产生视觉模型费用，开始前确认；同一帧在本轮内只分析一次。',
    schema: z.object({
      sourceId: z.string().optional(),
      index: z.number().int().min(1).describe('镜头序号（从 1 开始）'),
      analyze: z.boolean().optional().describe('false 只返回帧路径，不调用视觉模型'),
    }),
    func: async ({ sourceId, index, analyze }) => {
      const snap = await snapshot()
      const src = sourceId ? snap.sources.find((s) => s.id === sourceId) : snap.sources[0]
      if (!src) return { ok: false, error: '会话里还没有源视频' }
      const shot = (snap.shots[src.id] || []).find((s) => s.index === Number(index))
      if (!shot) return { ok: false, error: `没有第 ${index} 镜` }
      if (!shot.frames.length) return { ok: false, error: `第 ${index} 镜还没有证据帧，先调用 extract_frames` }
      if (analyze === false) {
        return {
          ok: true,
          shot: { index: shot.index, start: shot.start, end: shot.end, frames: shot.frames },
        }
      }

      const resolved = creativeModelFor(deps.settings, deps.creative, 'vision')
      if (!resolved.key) {
        return { ok: false, error: '没有可用的视觉模型，请在设置页绑定「视觉」能力' }
      }
      // 同一轮里同一帧只付一次
      const pending = shot.frames.filter((f) => !deps.frameCache?.has(f))
      const gate = await askCost(deps, {
        capability: 'vision',
        modelKey: resolved.key,
        modelLabel: resolved.label,
        calls: Math.max(1, pending.length),
        note: `第 ${index} 镜证据帧`,
      })
      if (!gate.ok) return { ok: false, error: gate.error }
      if (deps.paidCalls) deps.paidCalls.count += Math.max(1, pending.length)

      const analyses: Array<Record<string, unknown>> = []
      const errors: string[] = []
      for (const frame of shot.frames) {
        const cached = deps.frameCache?.get(frame)
        if (cached) {
          analyses.push({ frame, ...cached })
          continue
        }
        try {
          const image = await frameToDataUrl(frame)
          const r = await askVision({
            prompt: FRAME_PROMPT,
            image,
            modelKey: resolved.key,
            json: true,
            maxTokens: 900,
            signal: deps.signal,
          })
          const parsed = (r.json as Record<string, unknown>) || { text: r.text }
          deps.frameCache?.set(frame, parsed)
          analyses.push({ frame, ...parsed })
        } catch (e) {
          errors.push(`${frame}: ${(e as Error).message || String(e)}`)
        }
      }
      if (!analyses.length) {
        return { ok: false, error: `视觉分析失败：${errors.join('；')}` }
      }
      return {
        ok: true,
        shot: { index: shot.index, start: shot.start, end: shot.end },
        frames: analyses,
        modelLabel: resolved.label,
        ...(errors.length ? { warnings: errors } : {}),
      }
    },
  })

  const ingest = new DynamicStructuredTool({
    name: 'ingest_source',
    description:
      '摄取一个源视频：本地上传已由用户完成时省略；传 url 时按已启用的适配器下载。返回源视频 id 与技术信息。',
    schema: z.object({
      url: z.string().optional().describe('公网视频链接或平台链接'),
      adapter: z.enum(['upload', 'direct', 'ytdlp', 'dtk']).optional().describe('强制指定适配器'),
    }),
    func: async ({ url, adapter }) => {
      if (!url) return { ok: false, error: '请提供视频链接；本地文件请让用户从界面上传' }
      try {
        const r = await ingestCreative({ sessionId: deps.sessionId, url, adapter })
        deps.onSourceChanged?.()
        return {
          ok: true,
          summary: `已摄取 ${r.source.platform || '视频'} · ${r.source.duration ?? '?'}s`,
          source: r.source,
          warnings: r.warnings,
        }
      } catch (e) {
        return { ok: false, error: (e as Error).message || String(e) }
      }
    },
  })

  const probe = new DynamicStructuredTool({
    name: 'probe_source',
    description: '重新读取源视频的技术信息（时长、分辨率、帧率、音轨）。不产生模型费用。',
    schema: z.object({ sourceId: z.string() }),
    func: async ({ sourceId }) => {
      try {
        const r = await probeCreativeSource(sourceId)
        deps.onSourceChanged?.()
        return { ok: true, summary: `probe 完成：${r.probe.duration ?? '?'}s`, probe: r.probe, source: r.source }
      } catch (e) {
        return { ok: false, error: (e as Error).message || String(e) }
      }
    },
  })

  const split = new DynamicStructuredTool({
    name: 'split_scenes',
    description: '按画面变化把源视频切成镜头段。覆盖整段时长，过短的段会并入相邻段。',
    schema: z.object({
      sourceId: z.string(),
      threshold: z.number().min(0.05).max(0.95).optional().describe('灵敏度；越大越不敏感'),
    }),
    func: async ({ sourceId, threshold }) => {
      try {
        const r = await splitCreativeSource(sourceId, threshold)
        deps.onSourceChanged?.()
        return {
          ok: true,
          summary: `切出 ${r.shots.length} 镜（${r.duration}s）`,
          duration: r.duration,
          threshold: r.threshold,
          shots: r.shots.map((s) => ({ index: s.index, start: s.start, end: s.end })),
          staleCount: r.staleCount,
        }
      } catch (e) {
        return { ok: false, error: (e as Error).message || String(e) }
      }
    },
  })

  const frames = new DynamicStructuredTool({
    name: 'extract_frames',
    description: '给镜头抽证据帧。默认每镜一帧；重跑会追加而不是覆盖已有帧。',
    schema: z.object({
      sourceId: z.string(),
      shotIndexes: z.array(z.number().int().min(1)).optional().describe('只抽这些镜头；省略抽全部'),
      framesPerShot: z.number().int().min(1).max(3).optional(),
      overwrite: z.boolean().optional().describe('true 时替换已有帧'),
    }),
    func: async ({ sourceId, shotIndexes, framesPerShot, overwrite }) => {
      try {
        const r = await extractFrames(sourceId, { shotIndexes, framesPerShot, overwrite })
        deps.onSourceChanged?.()
        const withFrames = r.shots.filter((s) => s.frames.length).length
        return {
          ok: true,
          summary: `抽帧完成：${withFrames}/${r.shots.length} 镜有帧`,
          shots: r.shots.map((s) => ({ index: s.index, frames: s.frames, errors: s.errors })),
        }
      } catch (e) {
        return { ok: false, error: (e as Error).message || String(e) }
      }
    },
  })

  const submitSchema = getContractSchema('reverse-v1')
  if (!submitSchema) throw new Error('缺少 reverse-v1 契约')
  const submit = new DynamicStructuredTool({
    name: 'submit_reverse_pack',
    description:
      '提交反推结果（reverse-v1）。只写入创意产物，不修改项目；不合格会被拒绝并返回校验错误。',
    schema: submitSchema,
    func: async (payload) => {
      const checked = validateContract('reverse-v1', payload)
      if (!checked.ok) return { ok: false, error: `提交不符合契约：${checked.errors.join('；')}` }
      try {
        const artifact = await saveCreativeReversePack(deps.sessionId, checked.value as Record<string, unknown>, {
          sourceId: (checked.value as { sourceId?: string }).sourceId,
          modelLabel: deps.modelLabel || '',
        })
        deps.onArtifactChanged?.()
        const shots = (checked.value as { shots?: unknown[] }).shots?.length ?? 0
        return { ok: true, summary: `已保存提示词包：${shots} 镜`, artifactId: artifact.id, shots }
      } catch (e) {
        return { ok: false, error: (e as Error).message || String(e) }
      }
    },
  })

  const genImage = new DynamicStructuredTool({
    name: 'generate_image',
    description:
      '用绑定的图像模型生成一张图。会先确认费用；未绑定模型或用户拒绝时返回失败，不发起请求。',
    schema: z.object({
      prompt: z.string().min(1).describe('画面描述'),
      modelKey: z.string().optional().describe('覆盖本次使用的模型键'),
    }),
    func: async ({ prompt, modelKey }) => {
      const resolved = modelKey
        ? { key: modelKey, label: modelKey }
        : creativeModelFor(deps.settings, deps.creative, 'image')
      if (!deps.generateImage) return { ok: false, error: '当前环境没有可用的生图实现' }
      const gate = await askCost(deps, {
        capability: 'image',
        modelKey: resolved.key,
        modelLabel: resolved.label,
        calls: 1,
      })
      if (!gate.ok) return { ok: false, error: gate.error }
      if (deps.paidCalls) deps.paidCalls.count += 1
      try {
        const result = await deps.generateImage({ prompt, modelKey: resolved.key, signal: deps.signal })
        return { ok: true, summary: '已生成图片', modelLabel: resolved.label, result }
      } catch (e) {
        return { ok: false, error: (e as Error).message || String(e) }
      }
    },
  })

  const genVideo = new DynamicStructuredTool({
    name: 'generate_video',
    description:
      '用绑定的视频模型生成一段视频。真实 Seedance 2.0+ 每次都要确认；未确认不发起请求。',
    schema: z.object({
      prompt: z.string().min(1),
      image: z.string().optional().describe('首帧图路径'),
      modelKey: z.string().optional(),
    }),
    func: async ({ prompt, image, modelKey }) => {
      const resolved = modelKey ? { key: modelKey, label: modelKey } : creativeModelFor(deps.settings, deps.creative, 'video')
      if (!deps.generateVideo) return { ok: false, error: '当前环境没有可用的生视频实现' }
      const gate = await askCost(deps, {
        capability: 'video',
        modelKey: resolved.key,
        modelLabel: resolved.label,
        calls: 1,
        alwaysConfirm: true,
      })
      if (!gate.ok) return { ok: false, error: gate.error }
      if (deps.paidCalls) deps.paidCalls.count += 1
      try {
        const result = await deps.generateVideo({ prompt, image, modelKey: resolved.key, signal: deps.signal })
        return { ok: true, summary: '已生成视频', modelLabel: resolved.label, result }
      } catch (e) {
        return { ok: false, error: (e as Error).message || String(e) }
      }
    },
  })

  const genVoice = new DynamicStructuredTool({
    name: 'generate_voice',
    description: '用绑定的配音模型把文本转成语音。会先确认费用。',
    schema: z.object({
      text: z.string().min(1),
      modelKey: z.string().optional(),
    }),
    func: async ({ text, modelKey }) => {
      const resolved = modelKey ? { key: modelKey, label: modelKey } : creativeModelFor(deps.settings, deps.creative, 'audio')
      if (!deps.generateVoice) return { ok: false, error: '当前环境没有可用的配音实现' }
      const gate = await askCost(deps, {
        capability: 'audio',
        modelKey: resolved.key,
        modelLabel: resolved.label,
        calls: 1,
      })
      if (!gate.ok) return { ok: false, error: gate.error }
      if (deps.paidCalls) deps.paidCalls.count += 1
      try {
        const result = await deps.generateVoice({ text, modelKey: resolved.key, signal: deps.signal })
        return { ok: true, summary: '已生成配音', modelLabel: resolved.label, result }
      } catch (e) {
        return { ok: false, error: (e as Error).message || String(e) }
      }
    },
  })

  const byName = new Map<string, StructuredToolInterface>([
    [readSession.name, readSession],
    [readSource.name, readSource],
    [readShots.name, readShots],
    [readFrameDetail.name, readFrameDetail],
    [ingest.name, ingest],
    [probe.name, probe],
    [split.name, split],
    [frames.name, frames],
    [submit.name, submit],
    [genImage.name, genImage],
    [genVideo.name, genVideo],
    [genVoice.name, genVoice],
  ])

  return { byName, submit }
}

/** 按技能声明过滤可用工具；只读技能拿不到写与生成工具 */
export function bindCreativeTools(
  set: ReturnType<typeof createCreativeToolSet>,
  skills: Array<{ skill: Skill; mode: 'host' | 'readonly' }>,
): StructuredToolInterface[] {
  const out = new Map<string, StructuredToolInterface>()
  for (const { skill, mode } of skills) {
    for (const name of skill.manifest.tools) {
      if (mode === 'readonly' && (name.startsWith('submit_') || name.startsWith('generate_') || name.startsWith('ingest_'))) {
        continue
      }
      const tool = set.byName.get(name)
      if (tool) out.set(name, tool)
    }
  }
  return [...out.values()]
}

/** 通过产物路由保存反推结果（服务端负责落库与契约二次校验） */
async function saveCreativeReversePack(
  sessionId: string,
  payload: Record<string, unknown>,
  opts: { sourceId?: string; modelLabel?: string } = {},
): Promise<CreativeArtifact> {
  const { saveReverseArtifact } = await import('./mediaApi')
  return saveReverseArtifact(sessionId, payload, opts)
}

/** 供 UI 与测试复用的产物列表刷新 */
export async function refreshArtifacts(sessionId: string) {
  return listCreativeArtifacts(sessionId)
}

export {
  analyzeCreative,
  downloadCreativeExport,
  ingestCreative,
  promoteCreativeArtifact,
  splitCreativeSource,
  extractFrames,
}
