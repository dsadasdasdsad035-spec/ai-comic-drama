import { SCENE_CODE_LIMITS } from './types'

export type SandboxAssetPayload = {
  key: string
  kind: 'image' | 'video-frame'
  label: string
  mime: string
  bytes: ArrayBuffer
  width?: number
  height?: number
  videoDuration?: number
  frameTime?: number
}

export type SceneSandboxOptions = {
  code: string
  assets: SandboxAssetPayload[]
  width: number
  height: number
  aspect: string
  duration: number
  mode: 'clean' | 'review'
  shot?: Record<string, unknown>
}

export type SceneSandboxReady = {
  width: number
  height: number
  missingAssets: string[]
  firstFrame: string
}

export type SceneSandboxHandlers = {
  onTime?: (t: number) => void
  onProgress?: (value: number) => void
  onError?: (error: SceneSandboxError) => void
}

export class SceneSandboxError extends Error {
  phase: string
  constructor(phase: string, message: string) {
    super(message)
    this.name = 'SceneSandboxError'
    this.phase = phase
  }
}

type Pending<T> = { resolve: (value: T) => void; reject: (error: Error) => void; timer: number }

let runtimeSourceCache: string | null = null

async function runtimeSource(): Promise<string> {
  if (runtimeSourceCache) return runtimeSourceCache
  const mod = await import('./sandbox/runtime.generated.js?raw')
  runtimeSourceCache = String(mod.default || '')
  if (!runtimeSourceCache) throw new Error('沙箱运行时为空，请先运行 npm run build:sandbox')
  return runtimeSourceCache
}

function srcdocFor(runtime: string): string {
  const safe = runtime.replace(/<\/script/gi, '<\\/script')
  const csp = [
    "default-src 'none'",
    "script-src 'unsafe-inline' 'unsafe-eval'",
    "style-src 'unsafe-inline'",
    'img-src blob: data:',
    'media-src blob: data:',
    "connect-src 'none'",
    "frame-src 'none'",
    "object-src 'none'",
    "base-uri 'none'",
  ].join('; ')
  return `<!doctype html><html><head><meta charset="utf-8"><meta http-equiv="Content-Security-Policy" content="${csp}"><style>html,body{margin:0;width:100%;height:100%;overflow:hidden;background:#111318}canvas{display:block;max-width:100%;max-height:100%;width:auto;height:auto}</style></head><body><script>${safe}</script></body></html>`
}

function tokenOf(): string {
  try {
    if (typeof crypto !== 'undefined' && 'randomUUID' in crypto) return crypto.randomUUID()
  } catch {
    /* ignore */
  }
  return `sandbox-${Date.now()}-${Math.random().toString(36).slice(2)}`
}

function copyBytes(bytes: unknown): ArrayBuffer {
  if (bytes instanceof ArrayBuffer) return bytes.slice(0)
  if (ArrayBuffer.isView(bytes)) {
    const view = bytes as ArrayBufferView
    return view.buffer.slice(view.byteOffset, view.byteOffset + view.byteLength) as ArrayBuffer
  }
  if (Array.isArray(bytes)) return new Uint8Array(bytes).buffer
  if (bytes && typeof bytes === 'object') {
    const values = Object.values(bytes as Record<string, number>).filter((v) => typeof v === 'number')
    if (values.length) return new Uint8Array(values).buffer
  }
  return new ArrayBuffer(0)
}

function abortError(message = '已取消'): Error {
  return typeof DOMException !== 'undefined'
    ? new DOMException(message, 'AbortError')
    : Object.assign(new Error(message), { name: 'AbortError' })
}

/**
 * 父页面侧沙箱客户端：负责 iframe 生命周期、消息校验、超时和录制结果。
 * 父页面不能读沙箱画布；抓帧和录制都由沙箱通过消息返回。
 */
export class SceneSandbox {
  readonly token = tokenOf()
  iframe: HTMLIFrameElement | null = null
  private container: HTMLElement
  private opts: SceneSandboxOptions
  private handlers: SceneSandboxHandlers
  private listener: ((event: MessageEvent) => void) | null = null
  private ready: SceneSandboxReady | null = null
  private startPending: Pending<SceneSandboxReady> | null = null
  private capturePending: Pending<string> | null = null
  private recordPending: Pending<Blob> | null = null
  private disposed = false

  constructor(container: HTMLElement, opts: SceneSandboxOptions, handlers: SceneSandboxHandlers = {}) {
    this.container = container
    this.opts = opts
    this.handlers = handlers
  }

  get isReady(): boolean {
    return Boolean(this.ready)
  }

  async start(): Promise<SceneSandboxReady> {
    if (this.ready) return this.ready
    if (this.disposed) throw new SceneSandboxError('init', '沙箱已关闭')
    if (this.startPending) throw new SceneSandboxError('init', '沙箱正在启动')
    const source = await runtimeSource()
    const iframe = document.createElement('iframe')
    iframe.setAttribute('sandbox', 'allow-scripts')
    iframe.setAttribute('referrerpolicy', 'no-referrer')
    iframe.setAttribute('title', '3D 代码预览沙箱')
    iframe.style.cssText = 'width:100%;height:100%;border:0;display:block;background:#111318'
    this.iframe = iframe

    const started = new Promise<SceneSandboxReady>((resolve, reject) => {
      const timer = window.setTimeout(() => {
        this.startPending = null
        reject(new SceneSandboxError('init', `沙箱启动超时（${SCENE_CODE_LIMITS.initMs}ms）`))
        this.destroy()
      }, SCENE_CODE_LIMITS.initMs)
      this.startPending = {
        resolve: (v) => {
          window.clearTimeout(timer)
          resolve(v)
        },
        reject: (e) => {
          window.clearTimeout(timer)
          reject(e)
        },
        timer,
      }
    })

    this.listener = (event: MessageEvent) => this.onMessage(event)
    window.addEventListener('message', this.listener)
    iframe.srcdoc = srcdocFor(source)
    this.container.replaceChildren(iframe)
    await new Promise<void>((resolve) => {
      let done = false
      const finish = () => {
        if (done) return
        done = true
        resolve()
      }
      iframe.addEventListener('load', finish, { once: true })
      window.setTimeout(finish, 1500)
    })
    if (this.disposed) throw abortError('沙箱已关闭')
    const assets = this.opts.assets.map((a) => ({ ...a, bytes: copyBytes(a.bytes) }))
    const transfer = assets.map((a) => a.bytes).filter((b): b is ArrayBuffer => b instanceof ArrayBuffer)
    this.post(
      {
        type: 'init',
        code: this.opts.code,
        assets,
        width: this.opts.width,
        height: this.opts.height,
        aspect: this.opts.aspect,
        duration: this.opts.duration,
        mode: this.opts.mode,
        shot: this.opts.shot || {},
      },
      transfer,
    )
    try {
      return await started
    } catch (e) {
      this.destroy()
      throw e
    }
  }

  play() {
    this.post({ type: 'play' })
  }

  pause() {
    this.post({ type: 'pause' })
  }

  seek(t: number) {
    this.post({ type: 'seek', t: Number(t) || 0 })
  }

  async capture(timeoutMs = 4000): Promise<string> {
    if (!this.ready) throw new SceneSandboxError('frame', '沙箱还没有准备好')
    if (this.capturePending) throw new SceneSandboxError('frame', '正在抓帧')
    return new Promise<string>((resolve, reject) => {
      const timer = window.setTimeout(() => {
        this.capturePending = null
        reject(new SceneSandboxError('frame', '抓帧超时'))
      }, timeoutMs)
      this.capturePending = { resolve, reject, timer }
      this.post({ type: 'capture' })
    })
  }

  async record(): Promise<Blob> {
    if (!this.ready) throw new SceneSandboxError('record', '沙箱还没有准备好')
    if (this.recordPending) throw new SceneSandboxError('record', '正在录制')
    return new Promise<Blob>((resolve, reject) => {
      const timer = window.setTimeout(() => {
        this.recordPending = null
        reject(new SceneSandboxError('record', '录制超时'))
        this.destroy()
      }, Math.max(15000, this.opts.duration * 1000 + 15000))
      this.recordPending = { resolve, reject, timer }
      this.post({ type: 'record' })
    })
  }

  cancel() {
    this.post({ type: 'cancel' })
  }

  dispose() {
    if (this.disposed) return
    this.disposed = true
    this.post({ type: 'dispose' })
    this.rejectPending(new SceneSandboxError('dispose', '沙箱已关闭'))
    if (this.listener) window.removeEventListener('message', this.listener)
    this.listener = null
    if (this.iframe?.parentElement) this.iframe.parentElement.removeChild(this.iframe)
    this.iframe = null
    this.ready = null
  }

  private destroy() {
    this.dispose()
  }

  private post(data: Record<string, unknown>, transfer: Transferable[] = []) {
    if (!this.iframe?.contentWindow || this.disposed) return
    this.iframe.contentWindow.postMessage({ ...data, token: this.token }, '*', transfer)
  }

  private rejectPending(error: Error) {
    for (const key of ['startPending', 'capturePending', 'recordPending'] as const) {
      const pending = this[key] as Pending<unknown> | null
      if (!pending) continue
      window.clearTimeout(pending.timer)
      pending.reject(error)
      ;(this as unknown as Record<string, unknown>)[key] = null
    }
  }

  private onMessage(event: MessageEvent) {
    if (!this.iframe || event.source !== this.iframe.contentWindow) return
    const data = event.data as {
      token?: unknown
      type?: unknown
      width?: number
      height?: number
      missingAssets?: string[]
      firstFrame?: string
      t?: number
      dataUrl?: string
      value?: number
      buffer?: ArrayBuffer
      mime?: string
      phase?: string
      message?: string
      stack?: string
    }
    if (!data || typeof data !== 'object' || data.token !== this.token || typeof data.type !== 'string') return

    if (data.type === 'ready') {
      this.ready = {
        width: Number(data.width) || this.opts.width,
        height: Number(data.height) || this.opts.height,
        missingAssets: Array.isArray(data.missingAssets) ? data.missingAssets : [],
        firstFrame: String(data.firstFrame || ''),
      }
      const pending = this.startPending
      this.startPending = null
      pending?.resolve(this.ready)
      return
    }
    if (data.type === 'error') {
      const error = new SceneSandboxError(String(data.phase || 'run'), String(data.message || '沙箱运行失败'))
      const pending = this.startPending
      this.startPending = null
      pending?.reject(error)
      if (this.capturePending) {
        window.clearTimeout(this.capturePending.timer)
        this.capturePending.reject(error)
        this.capturePending = null
      }
      if (this.recordPending) {
        window.clearTimeout(this.recordPending.timer)
        this.recordPending.reject(error)
        this.recordPending = null
      }
      this.handlers.onError?.(error)
      return
    }
    if (data.type === 'time') {
      this.handlers.onTime?.(Number(data.t) || 0)
      return
    }
    if (data.type === 'progress') {
      this.handlers.onProgress?.(Number(data.value) || 0)
      return
    }
    if (data.type === 'frame' && this.capturePending) {
      window.clearTimeout(this.capturePending.timer)
      this.capturePending.resolve(String(data.dataUrl || ''))
      this.capturePending = null
      return
    }
    if (data.type === 'video' && this.recordPending) {
      window.clearTimeout(this.recordPending.timer)
      const buffer = data.buffer instanceof ArrayBuffer ? data.buffer : new ArrayBuffer(0)
      this.recordPending.resolve(new Blob([buffer], { type: data.mime || 'video/webm' }))
      this.recordPending = null
      return
    }
    if (data.type === 'cancelled' && this.recordPending) {
      window.clearTimeout(this.recordPending.timer)
      this.recordPending.reject(abortError('渲染已取消'))
      this.recordPending = null
    }
  }
}
