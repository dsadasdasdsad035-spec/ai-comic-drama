import { SceneSandbox, type SandboxAssetPayload } from '../sceneSandbox'
import type { AgentFrame, AgentTrial } from './sceneAgentTypes'

export class AgentSandboxSession {
  private host: HTMLElement
  private sandbox: SceneSandbox
  private started = false

  constructor(opts: {
    code: string
    assets: SandboxAssetPayload[]
    width: number
    height: number
    aspect: string
    duration: number
  }) {
    this.host = document.createElement('div')
    this.host.style.cssText = `position:fixed;left:-10000px;top:0;width:${opts.width}px;height:${opts.height}px;pointer-events:none;opacity:0;z-index:-1`
    document.body.appendChild(this.host)
    this.sandbox = new SceneSandbox(this.host, {
      code: opts.code,
      assets: opts.assets,
      width: opts.width,
      height: opts.height,
      aspect: opts.aspect,
      duration: opts.duration,
      mode: 'clean',
    })
  }

  async start(): Promise<AgentTrial> {
    try {
      const ready = await this.sandbox.start()
      this.started = true
      return {
        ok: true,
        ...(ready.firstFrame ? { firstFrame: ready.firstFrame } : {}),
      }
    } catch (e) {
      return { ok: false, error: (e as Error).message || String(e) }
    }
  }

  async capture(times: number[]): Promise<AgentFrame[]> {
    if (!this.started) throw new Error('沙箱还没有准备好')
    const frames: AgentFrame[] = []
    for (const t of times) {
      this.sandbox.pause()
      this.sandbox.seek(Number(t) || 0)
      await new Promise((r) => setTimeout(r, 80))
      const url = await this.sandbox.capture()
      if (url) frames.push({ t: Number(t) || 0, url })
    }
    return frames
  }

  dispose() {
    this.sandbox.dispose()
    this.host.remove()
  }
}
