import * as THREE from 'three'

/**
 * 沙箱内运行的用户代码宿主。
 *
 * 这个文件会被 esbuild 打成单文件 IIFE，内联进 sandbox iframe 的 srcdoc。
 * 它只依赖 Three.js core 和浏览器 API；不能 import 项目里的任何模块。
 */

type AssetPayload = {
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

type SceneAsset = {
  key: string
  kind: 'image' | 'video-frame'
  label: string
  texture: THREE.Texture
  width: number
  height: number
  videoDuration?: number
  frameTime?: number
}

type CodeModule = {
  init?: (ctx: SceneContext) => void | Promise<void>
  renderAt?: (t: number, mode: 'clean' | 'review') => void
  dispose?: () => void
}

type SceneContext = {
  THREE: typeof THREE
  scene: THREE.Scene
  camera: THREE.PerspectiveCamera
  renderer: THREE.WebGLRenderer
  canvas: HTMLCanvasElement
  assets: Map<string, SceneAsset>
  assetList: SceneAsset[]
  width: number
  height: number
  aspect: number
  duration: number
  shot: Record<string, unknown>
  render: () => void
}

type InitMessage = {
  token: string
  type: 'init'
  code: string
  assets: AssetPayload[]
  width: number
  height: number
  aspect: string
  duration: number
  mode: 'clean' | 'review'
  shot?: Record<string, unknown>
}

type ParentMessage =
  | InitMessage
  | { token: string; type: 'play' }
  | { token: string; type: 'pause' }
  | { token: string; type: 'seek'; t: number }
  | { token: string; type: 'capture' }
  | { token: string; type: 'record' }
  | { token: string; type: 'cancel' }
  | { token: string; type: 'dispose' }

let token = ''
let initialized = false
let disposed = false
let renderer: THREE.WebGLRenderer | null = null
let scene: THREE.Scene | null = null
let camera: THREE.PerspectiveCamera | null = null
let canvas: HTMLCanvasElement | null = null
let codeModule: CodeModule | null = null
let duration = 3
let mode: 'clean' | 'review' = 'clean'
let currentTime = 0
let playing = false
let playTimer: number | null = null
let recording = false
let cancelRecord = false
let recordingRec: MediaRecorder | null = null
let assets = new Map<string, SceneAsset>()
let ctx: SceneContext | null = null

const FPS = 30
const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms))

function send(data: Record<string, unknown>, transfer: Transferable[] = []) {
  if (!token) return
  window.parent.postMessage({ ...data, token }, '*', transfer)
}

function fail(phase: string, error: unknown) {
  const e = error instanceof Error ? error : new Error(String(error))
  send({ type: 'error', phase, message: e.message || String(error), stack: e.stack || '' })
}

function disposeObject3D(root: THREE.Object3D) {
  root.traverse((o) => {
    const any = o as unknown as {
      geometry?: THREE.BufferGeometry
      material?: THREE.Material | THREE.Material[]
    }
    any.geometry?.dispose?.()
    const mats = Array.isArray(any.material) ? any.material : any.material ? [any.material] : []
    for (const m of mats) {
      const mm = m as THREE.Material & { map?: THREE.Texture }
      mm.map?.dispose?.()
      m.dispose?.()
    }
    if (o instanceof THREE.Sprite) {
      const mat = o.material as THREE.SpriteMaterial
      mat.map?.dispose?.()
      mat.dispose?.()
    }
  })
}

function hardDispose() {
  playing = false
  if (playTimer != null) window.clearTimeout(playTimer)
  playTimer = null
  try {
    codeModule?.dispose?.()
  } catch {
    /* user code cleanup is best effort */
  }
  codeModule = null
  for (const asset of assets.values()) {
    asset.texture.dispose()
  }
  assets.clear()
  if (scene) disposeObject3D(scene)
  try {
    renderer?.dispose()
  } catch {
    /* ignore */
  }
  if (canvas?.parentElement) canvas.parentElement.removeChild(canvas)
  renderer = null
  scene = null
  camera = null
  canvas = null
  ctx = null
  initialized = false
  disposed = true
}

function makeCanvas(width: number, height: number) {
  document.body.style.cssText = 'margin:0;width:100%;height:100%;overflow:hidden;background:#111318;display:flex;align-items:center;justify-content:center'
  const c = document.createElement('canvas')
  c.width = Math.max(2, Math.round(width))
  c.height = Math.max(2, Math.round(height))
  c.style.width = 'auto'
  c.style.height = 'auto'
  c.style.maxWidth = '100%'
  c.style.maxHeight = '100%'
  c.style.display = 'block'
  document.body.appendChild(c)
  return c
}

async function loadAssets(payloads: AssetPayload[]): Promise<string[]> {
  const missing: string[] = []
  await Promise.all(
    payloads.map(async (p) => {
      try {
        const blob = new Blob([p.bytes], { type: p.mime || 'image/png' })
        const bitmap = await createImageBitmap(blob)
        const texture = new THREE.Texture(bitmap)
        texture.colorSpace = THREE.SRGBColorSpace
        // ImageBitmap 的 texImage2D 会忽略 UNPACK_FLIP_Y_WEBGL；用 UV 翻转保证贴图正立。
        texture.flipY = false
        texture.repeat.y = -1
        texture.offset.y = 1
        texture.needsUpdate = true
        assets.set(p.key, {
          key: p.key,
          kind: p.kind === 'video-frame' ? 'video-frame' : 'image',
          label: p.label || p.key,
          texture,
          width: p.width || bitmap.width,
          height: p.height || bitmap.height,
          ...(p.videoDuration != null ? { videoDuration: Number(p.videoDuration) } : {}),
          ...(p.frameTime != null ? { frameTime: Number(p.frameTime) } : {}),
        })
      } catch {
        missing.push(p.key)
      }
    }),
  )
  return missing
}

function compile(code: string): CodeModule {
  const source = String(code || '')
  if (!source.trim()) throw new Error('代码为空')
  // THREE 作为沙箱全局，而不是函数参数：用户代码可以合法地写
  // `const THREE = ctx.THREE` 或在顶层声明同名变量，不会和参数冲突。
  ;(globalThis as unknown as { THREE: typeof THREE }).THREE = THREE
  const factory = new Function(
    `${source}\n;return {
      init: typeof init === 'function' ? init : undefined,
      renderAt: typeof renderAt === 'function' ? renderAt : undefined,
      dispose: typeof dispose === 'function' ? dispose : undefined
    }`,
  )
  const mod = factory() as CodeModule
  if (typeof mod.init !== 'function') throw new Error('代码必须定义 init(ctx)')
  if (typeof mod.renderAt !== 'function') throw new Error('代码必须定义 renderAt(t, mode)')
  return mod
}

function renderFrame(t: number) {
  if (!ctx || !codeModule?.renderAt || !renderer || !scene || !camera) throw new Error('运行时还没有初始化')
  const time = Math.min(duration, Math.max(0, Number(t) || 0))
  codeModule.renderAt(time, mode)
  renderer.render(scene, camera)
}

function captureFrame(): string {
  if (!canvas) return ''
  return canvas.toDataURL('image/jpeg', 0.86)
}

function startPlay() {
  if (playing || !initialized) return
  playing = true
  let last = performance.now()
  const tick = () => {
    if (!playing || !initialized) return
    const now = performance.now()
    const dt = Math.min(0.1, Math.max(0, (now - last) / 1000))
    last = now
    currentTime = (currentTime + dt) % Math.max(0.001, duration)
    try {
      renderFrame(currentTime)
      send({ type: 'time', t: currentTime })
    } catch (e) {
      playing = false
      fail('frame', e)
      return
    }
    playTimer = window.setTimeout(tick, 1000 / FPS)
  }
  playTimer = window.setTimeout(tick, 1000 / FPS)
}

function pausePlay() {
  playing = false
  if (playTimer != null) window.clearTimeout(playTimer)
  playTimer = null
}

function mimeForRecording(): string | null {
  return ['video/webm;codecs=vp9', 'video/webm;codecs=vp8', 'video/webm'].find(
    (m) => typeof MediaRecorder !== 'undefined' && MediaRecorder.isTypeSupported(m),
  ) || null
}

async function recordVideo() {
  if (!canvas || recording || !initialized) return
  const mime = mimeForRecording()
  if (!mime || typeof MediaRecorder === 'undefined') {
    fail('record', new Error('当前浏览器不支持 MediaRecorder 录制 webm'))
    return
  }
  pausePlay()
  recording = true
  cancelRecord = false
  const rec = new MediaRecorder(canvas.captureStream(FPS), { mimeType: mime, videoBitsPerSecond: 5_000_000 })
  recordingRec = rec
  const chunks: BlobPart[] = []
  rec.ondataavailable = (e) => {
    if (e.data.size > 0) chunks.push(e.data)
  }
  const done = new Promise<Blob>((resolve, reject) => {
    rec.onstop = () => resolve(new Blob(chunks, { type: 'video/webm' }))
    rec.onerror = () => reject(new Error('MediaRecorder 录制失败'))
  })
  const frames = Math.max(1, Math.round(duration * FPS))
  const t0 = performance.now()
  try {
    rec.start()
    for (let i = 0; i <= frames; i++) {
      if (cancelRecord) {
        try {
          if (rec.state !== 'inactive') rec.stop()
        } catch {
          /* ignore */
        }
        send({ type: 'cancelled', phase: 'record' })
        return
      }
      currentTime = (i / frames) * duration
      renderFrame(currentTime)
      send({ type: 'progress', phase: 'record', value: Math.min(1, i / frames) })
      const target = t0 + (i + 1) * (1000 / FPS)
      const wait = target - performance.now()
      if (wait > 0) await sleep(wait)
    }
    await sleep(120)
    if (cancelRecord) {
      send({ type: 'cancelled', phase: 'record' })
      return
    }
    rec.stop()
    const blob = await done
    const buffer = await blob.arrayBuffer()
    send({ type: 'video', buffer, mime: blob.type || 'video/webm' }, [buffer])
  } catch (e) {
    try {
      if (rec.state !== 'inactive') rec.stop()
    } catch {
      /* ignore */
    }
    fail('record', e)
  } finally {
    recording = false
    recordingRec = null
    cancelRecord = false
  }
}

async function init(msg: InitMessage) {
  if (initialized) throw new Error('沙箱已经初始化')
  token = String(msg.token || '')
  if (!token) throw new Error('缺少运行令牌')
  duration = Math.min(60, Math.max(0.1, Number(msg.duration) || 3))
  mode = msg.mode === 'review' ? 'review' : 'clean'
  const width = Math.max(2, Math.min(1920, Math.round(Number(msg.width) || 960)))
  const height = Math.max(2, Math.min(1920, Math.round(Number(msg.height) || 540)))
  const payloads = Array.isArray(msg.assets) ? msg.assets : []
  const missingAssets = await loadAssets(payloads)
  canvas = makeCanvas(width, height)
  renderer = new THREE.WebGLRenderer({
    canvas,
    antialias: true,
    alpha: false,
    preserveDrawingBuffer: true,
  })
  renderer.setPixelRatio(1)
  renderer.setSize(width, height, false)
  renderer.outputColorSpace = THREE.SRGBColorSpace
  renderer.setClearColor(0x111318, 1)
  scene = new THREE.Scene()
  camera = new THREE.PerspectiveCamera(45, width / height, 0.01, 1000)
  camera.position.set(0, 1.6, 5)
  camera.lookAt(0, 1, 0)
  assets = assets // keep map
  ctx = {
    THREE,
    scene,
    camera,
    renderer,
    canvas,
    assets,
    assetList: [...assets.values()],
    width,
    height,
    aspect: width / height,
    duration,
    shot: msg.shot || {},
    render: () => {
      if (renderer && scene && camera) renderer.render(scene, camera)
    },
  }
  codeModule = compile(msg.code)
  await Promise.resolve(codeModule.init?.(ctx))
  currentTime = 0
  renderFrame(0)
  const calls0 = renderer.info.render.calls
  if (!calls0) throw new Error('首帧没有绘制任何对象；请检查 camera 与 scene')
  renderFrame(duration)
  initialized = true
  send({
    type: 'ready',
    width,
    height,
    missingAssets,
    firstFrame: captureFrame(),
  })
}

window.addEventListener('message', (event: MessageEvent) => {
  const msg = event.data as ParentMessage
  if (!msg || typeof msg !== 'object' || typeof msg.type !== 'string') return
  if (event.source !== window.parent) return
  if (token && msg.token !== token) return
  if (msg.type === 'init') {
    if (disposed) return
    init(msg as InitMessage).catch((e) => {
      fail('init', e)
      hardDispose()
    })
    return
  }
  if (!token || msg.token !== token || !initialized) return
  if (msg.type === 'play') startPlay()
  else if (msg.type === 'pause') pausePlay()
  else if (msg.type === 'seek') {
    pausePlay()
    currentTime = Math.min(duration, Math.max(0, Number(msg.t) || 0))
    try {
      renderFrame(currentTime)
      send({ type: 'time', t: currentTime })
    } catch (e) {
      fail('frame', e)
    }
  } else if (msg.type === 'capture') {
    try {
      send({ type: 'frame', dataUrl: captureFrame() })
    } catch (e) {
      fail('frame', e)
    }
  } else if (msg.type === 'record') {
    void recordVideo()
  } else if (msg.type === 'cancel') {
    cancelRecord = true
    pausePlay()
    try {
      if (recordingRec && recordingRec.state !== 'inactive') recordingRec.stop()
    } catch {
      /* ignore */
    }
  } else if (msg.type === 'dispose') {
    hardDispose()
  }
})

// 让父页面知道脚本已经就位；真正的 ready 在 init 试运行成功后发送。
send({ type: 'boot' })
