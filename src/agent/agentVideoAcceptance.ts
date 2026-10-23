import type { AppSettings } from '../api'
import { extractFrames } from '../api'
import type { StagePick } from '../ModelSelect'
import type { SandboxAssetPayload } from '../sceneSandbox'
import { renderSceneCodeVideo, saveSceneCodeVideo } from '../sceneCodeRender'
import { reviewFramesWithVision } from './agentReview'
import type {
  AgentFrame,
  AgentReview,
  AgentVideoErrorCode,
  AgentVideoPhase,
  AgentVideoStatus,
} from './sceneAgentTypes'

export type AgentVideoProgress = {
  phase: AgentVideoPhase
  value?: number
}

export type AgentVideoAcceptanceInput = {
  videoId?: string
  code: string
  codeHash: string
  assets: SandboxAssetPayload[]
  duration: number
  aspect: string
  requirements: string[]
  settings: AppSettings | null
  stagePick?: StagePick
  signal?: AbortSignal
  onProgress?: (progress: AgentVideoProgress) => void
  limits?: Partial<AgentVideoAcceptanceLimits>
}

export type AgentVideoPersistInput = {
  code: string
  codeHash: string
  videoUrl: string
  frames: AgentFrame[]
  review: AgentReview
}

export type AgentVideoAcceptanceLimits = {
  renderMs: number
  saveMs: number
  extractMs: number
  reviewMs: number
  totalMs: number
}

export type AgentVideoAcceptanceDeps = {
  render: (opts: {
    code: string
    assets: SandboxAssetPayload[]
    duration: number
    aspect: string
    signal: AbortSignal
    onProgress?: (value: number) => void
  }) => Promise<Blob>
  save: (blob: Blob, signal: AbortSignal) => Promise<string>
  extract: (
    url: string,
    count: number,
    signal: AbortSignal,
    times?: number[],
  ) => Promise<{ urls: string[]; duration: number; times?: number[] }>
  review: (frames: AgentFrame[], requirements: string[], signal: AbortSignal) => Promise<AgentReview>
  persist: (input: AgentVideoPersistInput) => Promise<void>
}

export type AgentVideoAcceptanceResult = {
  videoId: string
  codeHash: string
  status: Exclude<AgentVideoStatus, 'running'>
  videoUrl?: string
  duration: number
  aspect: string
  frames: AgentFrame[]
  review?: AgentReview
  saved: boolean
  error?: string
  errorCode?: AgentVideoErrorCode
}

const DEFAULT_SAVE_MS = 30_000
const DEFAULT_EXTRACT_MS = 30_000
const DEFAULT_REVIEW_MS = 60_000
const DEFAULT_TOTAL_MS = 180_000

class VideoStepTimeout extends Error {}

function makeId() {
  return typeof crypto !== 'undefined' && 'randomUUID' in crypto
    ? crypto.randomUUID()
    : `video-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
}

function isAbort(e: unknown): boolean {
  return (e as Error)?.name === 'AbortError'
}

function throwIfAborted(signal?: AbortSignal) {
  if (signal?.aborted) throw new DOMException('已取消', 'AbortError')
}

function renderLimitFor(duration: number): number {
  return Math.min(120_000, Math.max(45_000, duration * 8_000 + 20_000))
}

export function defaultVideoAcceptanceLimits(duration: number): AgentVideoAcceptanceLimits {
  return {
    renderMs: renderLimitFor(duration),
    saveMs: DEFAULT_SAVE_MS,
    extractMs: DEFAULT_EXTRACT_MS,
    reviewMs: DEFAULT_REVIEW_MS,
    totalMs: DEFAULT_TOTAL_MS,
  }
}

/** 短镜头 5 帧、长镜头 9 帧；帧数上限避免视觉联系表过大。 */
export function videoFrameCount(duration: number): number {
  return Number(duration) > 6 ? 9 : 5
}

/** 从 0 到有效时长均匀取帧，包含首尾，避免长镜头只看前 4 秒。 */
export function videoFrameTimes(duration: number, count = videoFrameCount(duration)): number[] {
  const total = Math.max(0.1, Number(duration) || 0)
  const n = Math.max(2, Math.round(count))
  return Array.from({ length: n }, (_, i) => Number(((total * i) / (n - 1)).toFixed(3)))
}

function runStep<T>(
  fn: (signal: AbortSignal) => Promise<T>,
  ms: number,
  external: AbortSignal | undefined,
  deadline: number,
): Promise<T> {
  const remaining = Math.min(ms, deadline - Date.now())
  if (remaining <= 0) return Promise.reject(new VideoStepTimeout('视频验收超时'))
  const controller = new AbortController()
  return new Promise<T>((resolve, reject) => {
    let settled = false
    const cleanup = () => {
      clearTimeout(timer)
      external?.removeEventListener('abort', onAbort)
    }
    const settle = (ok: boolean, value: T | Error) => {
      if (settled) return
      settled = true
      cleanup()
      if (ok) resolve(value as T)
      else reject(value)
    }
    const timer = setTimeout(() => {
      controller.abort()
      settle(false, new VideoStepTimeout('视频验收超时'))
    }, Math.max(1, remaining))
    const onAbort = () => {
      controller.abort()
      settle(false, new DOMException('已取消', 'AbortError'))
    }
    external?.addEventListener('abort', onAbort, { once: true })
    if (external?.aborted) {
      onAbort()
      return
    }
    Promise.resolve()
      .then(() => fn(controller.signal))
      .then(
        (value) => settle(true, value),
        (e) => {
          if (external?.aborted || isAbort(e)) settle(false, new DOMException('已取消', 'AbortError'))
          else settle(false, e as Error)
        },
      )
  })
}

function failMessage(errorCode: AgentVideoErrorCode): string {
  switch (errorCode) {
    case 'render_failed':
      return '视频渲染失败'
    case 'save_failed':
      return '视频保存失败'
    case 'extract_failed':
      return '从 MP4 抽帧失败'
    case 'vision_unavailable':
      return '未配置视觉模型或视觉验收不可用'
    case 'review_failed':
      return 'MP4 帧验收未通过'
    case 'cancelled':
      return '视频验收已取消'
    case 'timeout':
      return '视频验收超时'
  }
}

/**
 * finish 后的视频验收：渲染 MP4 → 从 MP4 抽帧 → 视觉清单 → 通过后持久化。
 * 只有 passed 且 saved 才表示镜头数据已更新；其他状态都不会覆盖旧视频。
 */
export async function runVideoAcceptance(
  input: AgentVideoAcceptanceInput,
  overrides: Partial<AgentVideoAcceptanceDeps> = {},
): Promise<AgentVideoAcceptanceResult> {
  const videoId = input.videoId || makeId()
  const limits = { ...defaultVideoAcceptanceLimits(input.duration), ...input.limits }
  const deadline = Date.now() + limits.totalMs
  let phase: AgentVideoPhase = 'rendering'
  let videoUrl = ''
  let frames: AgentFrame[] = []
  let review: AgentReview | undefined

  const deps: AgentVideoAcceptanceDeps = {
    render: (opts) =>
      renderSceneCodeVideo({
        code: opts.code,
        assets: opts.assets,
        duration: opts.duration,
        aspect: opts.aspect,
        mode: 'clean',
        signal: opts.signal,
        onProgress: opts.onProgress,
      }),
    save: (blob, signal) => saveSceneCodeVideo(blob, signal, input.duration),
    extract: (url, count, signal, times) => extractFrames(url, count, signal, times),
    review: (nextFrames, requirements, signal) =>
      reviewFramesWithVision({
        frames: nextFrames,
        requirements,
        settings: input.settings,
        stagePick: input.stagePick,
        signal,
      }),
    persist: async () => {
      throw new Error('视频验收没有配置持久化')
    },
    ...overrides,
  }

  const fail = (
    status: Exclude<AgentVideoStatus, 'running'>,
    errorCode: AgentVideoErrorCode,
    error: string,
    saved = false,
  ): AgentVideoAcceptanceResult => ({
    videoId,
    codeHash: input.codeHash,
    status,
    duration: input.duration,
    aspect: input.aspect,
    frames,
    saved,
    ...(videoUrl ? { videoUrl } : {}),
    ...(review ? { review } : {}),
    error,
    errorCode,
  })

  try {
    throwIfAborted(input.signal)
    input.onProgress?.({ phase: 'rendering', value: 0 })
    const blob = await runStep(
      (signal) =>
        deps.render({
          code: input.code,
          assets: input.assets,
          duration: input.duration,
          aspect: input.aspect,
          signal,
          onProgress: (value) => input.onProgress?.({ phase: 'rendering', value }),
        }),
      limits.renderMs,
      input.signal,
      deadline,
    )
    throwIfAborted(input.signal)
    phase = 'saving'
    input.onProgress?.({ phase: 'saving' })
    videoUrl = await runStep((signal) => deps.save(blob, signal), limits.saveMs, input.signal, deadline)
    throwIfAborted(input.signal)

    phase = 'extracting'
    input.onProgress?.({ phase: 'extracting' })
    const count = videoFrameCount(input.duration)
    const desiredTimes = videoFrameTimes(input.duration, count)
    const extracted = await runStep(
      (signal) => deps.extract(videoUrl, count, signal, desiredTimes),
      limits.extractMs,
      input.signal,
      deadline,
    )
    const urls = extracted.urls.slice(0, count)
    if (!urls.length) {
      return fail('needs_human', 'extract_failed', 'MP4 已生成，但没有抽到可验收的帧')
    }
    if (urls.length < Math.min(5, count)) {
      return fail(
        'needs_human',
        'extract_failed',
        `MP4 只抽到 ${urls.length} 帧，低于最低 5 帧；可能录制帧率不足，请重试或人工检查`,
      )
    }
    const reportedTimes =
      extracted.times && extracted.times.length === urls.length ? extracted.times : desiredTimes.slice(0, urls.length)
    frames = urls.map((url, i) => ({ t: reportedTimes[i] ?? desiredTimes[i] ?? 0, url }))
    throwIfAborted(input.signal)

    phase = 'reviewing'
    input.onProgress?.({ phase: 'reviewing' })
    review = await runStep(
      (signal) => deps.review(frames, input.requirements, signal),
      limits.reviewMs,
      input.signal,
      deadline,
    )
    if (!review.usedVision || review.needsHumanReview) {
      return fail('needs_human', 'vision_unavailable', review.summary || '未配置视觉模型，需人工检查 MP4')
    }
    if (!review.passed) {
      return fail('rejected', 'review_failed', review.summary || 'MP4 帧验收未通过')
    }

    try {
      await runStep(
        (signal) =>
          deps.persist({
            code: input.code,
            codeHash: input.codeHash,
            videoUrl,
            frames,
            review: review as AgentReview,
          }),
        limits.saveMs,
        input.signal,
        deadline,
      )
    } catch (e) {
      if (isAbort(e) || input.signal?.aborted) throw e
      const msg = (e as Error)?.message || String(e)
      return fail('failed', 'save_failed', `视频已生成且验收通过，但保存失败：${msg}`)
    }
    return {
      videoId,
      codeHash: input.codeHash,
      status: 'passed',
      videoUrl,
      duration: input.duration,
      aspect: input.aspect,
      frames,
      review,
      saved: true,
    }
  } catch (e) {
    if (e instanceof VideoStepTimeout) {
      return fail('timeout', 'timeout', failMessage('timeout'))
    }
    if (isAbort(e) || input.signal?.aborted) {
      return fail('cancelled', 'cancelled', failMessage('cancelled'))
    }
    const msg = (e as Error)?.message || String(e)
    if (phase === 'extracting' && videoUrl) {
      return fail('needs_human', 'extract_failed', `${failMessage('extract_failed')}：${msg}`)
    }
    if (phase === 'reviewing' && videoUrl) {
      return fail('needs_human', 'vision_unavailable', `${failMessage('vision_unavailable')}：${msg}`)
    }
    if (phase === 'saving') {
      return fail('failed', 'save_failed', `${failMessage('save_failed')}：${msg}`)
    }
    return fail('failed', 'render_failed', `${failMessage('render_failed')}：${msg}`)
  }
}

function reviewCounts(review?: AgentReview) {
  const items = review?.items || []
  const ok = items.filter((x) => x.ok).length
  const failed = items.filter((x) => !x.ok).map((x) => x.label)
  return { total: items.length, ok, failed }
}

/** 最终聊天文字只引用结构化结果，不让文本模型补写画面细节。 */
export function agentVideoSummary(result: AgentVideoAcceptanceResult): string {
  const hash = String(result.codeHash || '').slice(0, 10) || '—'
  const frameText = result.frames.length
    ? `MP4 帧 ${result.frames.map((f) => `${f.t.toFixed(1)}s`).join(' / ')}`
    : '未抽到 MP4 帧'
  const url = result.videoUrl ? `；视频 ${result.videoUrl}` : ''
  const counts = reviewCounts(result.review)
  const failedText = counts.failed.length ? `；未通过：${counts.failed.slice(0, 3).join('、')}` : ''
  if (result.status === 'passed') {
    if (!result.saved) return `代码 ${hash}；${frameText}；MP4 帧验收 ${counts.ok}/${counts.total} 通过；视频尚未保存${url}。`
    return `代码 ${hash} 已通过沙箱；MP4 ${result.duration.toFixed(1)}s 已保存；${frameText}；MP4 帧验收 ${counts.ok}/${counts.total} 通过${url}。`
  }
  if (result.status === 'rejected') {
    return `代码 ${hash}；MP4 ${result.duration.toFixed(1)}s 已生成但未保存；MP4 帧验收 ${counts.ok}/${counts.total}${failedText}；旧视频保持不变${url}。`
  }
  if (result.status === 'needs_human') {
    if (result.saved) {
      return `代码 ${hash}；MP4 ${result.duration.toFixed(1)}s 已人工采用并保存；${frameText}；自动验收：${result.error || failMessage('vision_unavailable')}${url}。`
    }
    return `代码 ${hash}；MP4 ${result.duration.toFixed(1)}s 已生成，但无法自动验收：${result.error || failMessage('vision_unavailable')}${url}。视频未保存，请人工检查后采用。`
  }
  if (result.status === 'cancelled' || result.status === 'timeout') {
    return `代码 ${hash}；${failMessage(result.errorCode || (result.status === 'timeout' ? 'timeout' : 'cancelled'))}；视频未保存，旧视频保持不变。`
  }
  return `代码 ${hash}；${failMessage(result.errorCode || 'render_failed')}：${result.error || '未知错误'}。视频未保存，旧视频保持不变。`
}
