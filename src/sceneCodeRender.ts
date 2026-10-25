import { renderSize } from './scheduleGeometry'
import type { PreparedSceneAsset } from './sceneCodeAssets'
import {
  blenderErrorText,
  pollRender,
  renderAndWait,
  sizeForEdge,
  submitRender,
  type BlenderJob,
  type BlenderTier,
} from './sceneBlender'

export type RenderSceneCodeOptions = {
  code: string
  assets: PreparedSceneAsset[]
  duration: number
  aspect: string
  tier?: BlenderTier
  mode?: 'clean' | 'review'
  shot?: Record<string, unknown>
  signal?: AbortSignal
  onProgress?: (value: number) => void
  keyTimes?: number[]
}

export type RenderSceneCodeResult = {
  videoUrl: string
  frameUrls: string[]
  job: BlenderJob
}

export { sizeForEdge }

/**
 * 字幕/预览用不到显式渲染尺寸：final 跟随项目长边 960 的既有约定，
 * proxy / trial 用短边约束，保证竖屏也按短边缩。
 */
export function renderDims(aspect: string, tier: BlenderTier): { width: number; height: number } {
  if (tier === 'trial') return sizeForEdge(aspect, 320)
  if (tier === 'proxy') return sizeForEdge(aspect, 540)
  return renderSize(aspect)
}

const FPS_FOR_TIER: Record<BlenderTier, number> = { trial: 30, proxy: 15, final: 30 }

/** 不开工作台时的整段渲染（右键生成、Agent 定稿）。 */
export async function renderSceneCode(opts: RenderSceneCodeOptions): Promise<RenderSceneCodeResult> {
  const tier = opts.tier || 'final'
  const { width, height } = renderDims(opts.aspect, tier)
  const duration = Math.max(0.1, Number(opts.duration) || 2)
  const keyTimes =
    opts.keyTimes ||
    [0, duration / 3, (duration * 2) / 3, Math.max(0, duration - 1 / FPS_FOR_TIER[tier])]
  const job = await renderAndWait(
    {
      code: opts.code,
      assets: opts.assets,
      width,
      height,
      fps: FPS_FOR_TIER[tier],
      duration,
      tier,
      mode: opts.mode || 'clean',
      ...(opts.shot ? { shot: opts.shot } : {}),
      keyTimes,
    },
    {
      ...(opts.signal ? { signal: opts.signal } : {}),
      onProgress: (j) => opts.onProgress?.(j.progress),
    },
  )
  return { videoUrl: job.videoUrl, frameUrls: job.frameUrls, job }
}

/** 试运行：低分辨率首尾两帧，只判断「能不能渲染」。 */
export async function trialSceneCode(opts: {
  code: string
  assets: PreparedSceneAsset[]
  duration: number
  aspect: string
  signal?: AbortSignal
  shot?: Record<string, unknown>
}): Promise<BlenderJob> {
  const { width, height } = renderDims(opts.aspect, 'trial')
  const duration = Math.max(0.1, Number(opts.duration) || 2)
  const job = await submitRender({
    code: opts.code,
    assets: opts.assets,
    width,
    height,
    fps: 30,
    duration,
    tier: 'trial',
    mode: 'clean',
    times: [0, duration],
    keyTimes: [0, duration],
    ...(opts.shot ? { shot: opts.shot } : {}),
  })
  return pollRender(job.id, {
    ...(opts.signal ? { signal: opts.signal } : {}),
    timeoutMs: 90_000,
  })
}

export function sceneCodeRenderError(e: unknown): string {
  return blenderErrorText(e)
}
