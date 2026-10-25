import type { PreparedSceneAsset } from '../sceneCodeAssets'
import { renderAndWait } from '../sceneBlender'
import { renderDims, trialSceneCode } from '../sceneCodeRender'
import type { AgentFrame, AgentTrial } from './sceneAgentTypes'

/**
 * Agent 的渲染会话：试运行 = 低清首尾两帧；抓帧 = 一次小尺寸多帧渲染。
 * 没有常驻进程：每个动作都是一次服务端作业，取消靠 AbortSignal。
 */
export class AgentBlenderSession {
  private code: string
  private assets: PreparedSceneAsset[]
  private duration: number
  private aspect: string
  private passed = false

  constructor(opts: {
    code: string
    assets: PreparedSceneAsset[]
    duration: number
    aspect: string
  }) {
    this.code = opts.code
    this.assets = opts.assets
    this.duration = opts.duration
    this.aspect = opts.aspect
  }

  async start(): Promise<AgentTrial> {
    try {
      const job = await trialSceneCode({
        code: this.code,
        assets: this.assets,
        duration: this.duration,
        aspect: this.aspect,
      })
      this.passed = true
      return {
        ok: true,
        ...(job.frameUrls[0] ? { firstFrame: job.frameUrls[0] } : {}),
      }
    } catch (e) {
      return { ok: false, error: (e as Error).message || String(e) }
    }
  }

  async capture(times: number[], signal?: AbortSignal): Promise<AgentFrame[]> {
    if (!this.passed) throw new Error('渲染试运行还没有通过，请先运行 run_render')
    const { width, height } = renderDims(this.aspect, 'trial')
    const wanted = times.slice(0, 9).map((t) => Math.max(0, Math.min(this.duration, Number(t) || 0)))
    const job = await renderAndWait(
      {
        code: this.code,
        assets: this.assets,
        width,
        height,
        fps: 30,
        duration: this.duration,
        tier: 'trial',
        mode: 'clean',
        times: wanted,
        keyTimes: wanted,
      },
      { ...(signal ? { signal } : {}), timeoutMs: 120_000 },
    )
    return wanted
      .map((t, i) => ({ t, url: job.frameUrls[i] }))
      .filter((frame): frame is AgentFrame => Boolean(frame.url))
  }

  dispose() {
    // 作业由服务端在完成/取消后自行清理，这里没有常驻资源。
    this.passed = false
  }
}
