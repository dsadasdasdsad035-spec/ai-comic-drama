import { saveScheduleVideo } from './api'
import { renderSize } from './scheduleGeometry'
import { SceneSandbox, SceneSandboxError, type SandboxAssetPayload } from './sceneSandbox'

export type RenderSceneCodeOptions = {
  code: string
  assets: SandboxAssetPayload[]
  duration: number
  aspect: string
  mode?: 'clean' | 'review'
  shot?: Record<string, unknown>
  signal?: AbortSignal
  onProgress?: (value: number) => void
}

const hiddenHosts = new Set<HTMLElement>()

function hiddenHost(width: number, height: number): HTMLElement {
  const host = document.createElement('div')
  host.setAttribute('data-scene-code-render', '1')
  host.style.cssText = `position:fixed;left:-10000px;top:0;width:${width}px;height:${height}px;pointer-events:none;opacity:0;z-index:-1`
  document.body.appendChild(host)
  hiddenHosts.add(host)
  return host
}

function cleanupHost(host: HTMLElement) {
  hiddenHosts.delete(host)
  host.remove()
}

/** 不开编辑器时的隐藏沙箱渲染，供右键生成和测试使用。 */
export async function renderSceneCodeVideo(opts: RenderSceneCodeOptions): Promise<Blob> {
  const { width, height } = renderSize(opts.aspect)
  const host = hiddenHost(width, height)
  const sandbox = new SceneSandbox(
    host,
    {
      code: opts.code,
      assets: opts.assets,
      width,
      height,
      aspect: opts.aspect,
      duration: opts.duration,
      mode: opts.mode || 'clean',
      ...(opts.shot ? { shot: opts.shot } : {}),
    },
    { onProgress: opts.onProgress },
  )
  const onAbort = () => sandbox.cancel()
  opts.signal?.addEventListener('abort', onAbort, { once: true })
  try {
    if (opts.signal?.aborted) throw new DOMException('已取消', 'AbortError')
    await sandbox.start()
    if (opts.signal?.aborted) throw new DOMException('已取消', 'AbortError')
    const blob = await sandbox.record()
    if (opts.signal?.aborted) throw new DOMException('已取消', 'AbortError')
    return blob
  } finally {
    opts.signal?.removeEventListener('abort', onAbort)
    sandbox.dispose()
    cleanupHost(host)
  }
}

export function blobToDataUrl(blob: Blob, signal?: AbortSignal): Promise<string> {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) {
      reject(new DOMException('已取消', 'AbortError'))
      return
    }
    const fr = new FileReader()
    fr.onload = () => {
      if (signal?.aborted) reject(new DOMException('已取消', 'AbortError'))
      else resolve(String(fr.result || ''))
    }
    fr.onerror = () => reject(new Error('读取录制结果失败'))
    fr.readAsDataURL(blob)
  })
}

export async function saveSceneCodeVideo(
  blob: Blob,
  signal?: AbortSignal,
  duration?: number,
): Promise<string> {
  const dataUrl = await blobToDataUrl(blob, signal)
  if (signal?.aborted) throw new DOMException('已取消', 'AbortError')
  return saveScheduleVideo(dataUrl, signal, duration)
}

export function sceneCodeRenderError(e: unknown): string {
  if (e instanceof SceneSandboxError) return `${e.phase}：${e.message}`
  return (e as Error)?.message || String(e)
}
