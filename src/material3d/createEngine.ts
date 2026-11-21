import type { ArcRotateCamera, Engine, Scene } from '@babylonjs/core'
import type { SceneEnvironmentHandles } from './sceneEnvironment'

export type BabylonHost = {
  engine: Engine
  scene: Scene
  camera: ArcRotateCamera
  envHandles: SceneEnvironmentHandles
  dispose: () => void
}

/** 轨道相机的完整位姿：UI 面板与同步逻辑共用这一份形状 */
export type OrbitPose = {
  /** 方位角（弧度） */
  alpha: number
  /** 极角（弧度）；0 = 目标正上方，π/2 = 水平 */
  beta: number
  /** 与目标的距离（米） */
  radius: number
  target: { x: number; y: number; z: number }
}

/** 相机半径下限的硬边界；实际值由 setRadiusLimits 按内容浮动 */
export const MIN_RADIUS_FLOOR = 1.2
/** 相机半径上限的硬边界 */
export const MAX_RADIUS_CEILING = 200

/** 鼠标滚轮一格的精度（值越大越慢） */
const WHEEL_PRECISION_MOUSE = 40
/** 触控板双指滑动的精度：delta 小得多，要更灵敏 */
const WHEEL_PRECISION_TRACKPAD = 12
/** 触控板判定阈值：|deltaY| 小于它且非行模式视为触控板 */
const TRACKPAD_DELTA_MAX = 40

export function readCameraPose(host: BabylonHost): OrbitPose {
  const c = host.camera
  return {
    alpha: c.alpha,
    beta: c.beta,
    radius: c.radius,
    target: { x: c.target.x, y: c.target.y, z: c.target.z },
  }
}

export function applyCameraPose(host: BabylonHost, pose: OrbitPose): void {
  const c = host.camera
  c.alpha = pose.alpha
  // beta 夹在 (0, π/2 + 少量] —— 不碰 0（万向锁），也不翻到目标下方
  c.beta = Math.min(Math.PI / 2 + 0.35, Math.max(Math.PI / 180, pose.beta))
  c.radius = pose.radius
  c.target.x = pose.target.x
  c.target.y = pose.target.y
  c.target.z = pose.target.z
}

/**
 * 按内容尺寸设置相机的距离上下限。
 * 上下限仍带硬边界：避免用户把 radius 滚到 0 或天文数字造成 NaN。
 */
export function setRadiusLimits(host: BabylonHost, contentDiagonal: number): void {
  const diag = Number.isFinite(contentDiagonal) ? Math.max(0.5, contentDiagonal) : 0.5
  const min = Math.max(MIN_RADIUS_FLOOR, Math.min(1.2, diag * 0.06))
  const max = Math.min(MAX_RADIUS_CEILING, Math.max(30, diag * 2.2))
  host.camera.lowerRadiusLimit = Math.min(min, max)
  host.camera.upperRadiusLimit = max
}

/**
 * 滚轮精度分级：触控板的双指滑动 delta 很小，用同一精度会「滚很久没反应」。
 * 只改 wheelPrecision，不拦截 Babylon 的输入处理。
 */
function wireWheelPrecision(canvas: HTMLCanvasElement, camera: ArcRotateCamera): () => void {
  const onWheel = (e: WheelEvent) => {
    const isTrackpad = e.deltaMode === 0 && Math.abs(e.deltaY) < TRACKPAD_DELTA_MAX
    camera.wheelPrecision = isTrackpad ? WHEEL_PRECISION_TRACKPAD : WHEEL_PRECISION_MOUSE
  }
  canvas.addEventListener('wheel', onWheel, { passive: true })
  return () => canvas.removeEventListener('wheel', onWheel)
}

const HOST_ROOTS = new Set(['__m3d_ground', '__m3d_light'])

export function isHostMeshName(name: string): boolean {
  return HOST_ROOTS.has(name) || name.startsWith('__m3d_')
}

/** Electron/ flex 布局下 canvas 可能先以 0×0 挂载，立刻建 WebGL 上下文易触发渲染进程崩溃 */
export function waitCanvasLayout(canvas: HTMLCanvasElement, maxMs = 3000): Promise<void> {
  if (canvas.clientWidth > 0 && canvas.clientHeight > 0) return Promise.resolve()
  return new Promise((resolve) => {
    const done = () => {
      ro.disconnect()
      clearTimeout(timer)
      resolve()
    }
    const ro = new ResizeObserver(() => {
      if (canvas.clientWidth > 0 && canvas.clientHeight > 0) done()
    })
    ro.observe(canvas)
    const timer = window.setTimeout(done, maxMs)
  })
}

/** 创建 Babylon 视口：Arc 相机、地面与基础灯光 */
export async function createBabylonHost(canvas: HTMLCanvasElement): Promise<BabylonHost> {
  await waitCanvasLayout(canvas)
  const BABYLON = await import('@babylonjs/core')
  const engine = new BABYLON.Engine(canvas, true, {
    preserveDrawingBuffer: true,
    stencil: false,
    adaptToDeviceRatio: true,
    doNotHandleContextLost: true,
  })
  const scene = new BABYLON.Scene(engine)
  scene.clearColor = new BABYLON.Color4(0.07, 0.09, 0.11, 1)

  const camera = new BABYLON.ArcRotateCamera(
    '__m3d_cam',
    -Math.PI / 2,
    Math.PI / 2.5,
    10,
    new BABYLON.Vector3(0, 1, 0),
    scene,
  )
  camera.attachControl(canvas, true)
  camera.wheelPrecision = WHEEL_PRECISION_MOUSE
  camera.lowerRadiusLimit = 2
  camera.upperRadiusLimit = 40
  const unwireWheel = wireWheelPrecision(canvas, camera)

  new BABYLON.HemisphericLight('__m3d_light_hemi', new BABYLON.Vector3(0.2, 1, 0.2), scene)
  const dir = new BABYLON.DirectionalLight('__m3d_light_sun', new BABYLON.Vector3(-0.5, -1, -0.3), scene)
  dir.intensity = 0.6

  const ground = BABYLON.MeshBuilder.CreateGround(
    '__m3d_ground',
    { width: 24, height: 24, subdivisions: 2 },
    scene,
  )
  const gmat = new BABYLON.StandardMaterial('__m3d_ground_mat', scene)
  gmat.diffuseColor = new BABYLON.Color3(0.14, 0.16, 0.19)
  gmat.specularColor = new BABYLON.Color3(0.05, 0.05, 0.05)
  ground.material = gmat
  ground.isPickable = false

  let disposed = false
  engine.runRenderLoop(() => {
    if (disposed || engine.isDisposed || scene.isDisposed) return
    scene.render()
  })

  const onResize = () => {
    if (disposed || engine.isDisposed) return
    engine.resize()
  }
  window.addEventListener('resize', onResize)

  const envHandles: SceneEnvironmentHandles = {
    ground,
    hemiName: '__m3d_light_hemi',
    dirName: '__m3d_light_sun',
    baseHemiIntensity: 1,
    baseDirIntensity: 0.6,
  }

  return {
    engine,
    scene,
    camera,
    envHandles,
    dispose: () => {
      if (disposed) return
      disposed = true
      unwireWheel()
      window.removeEventListener('resize', onResize)
      try {
        camera.detachControl()
      } catch {
        /* 已分离 */
      }
      engine.stopRenderLoop()
      if (!scene.isDisposed) scene.dispose()
      if (!engine.isDisposed) {
        engine.wipeCaches(true)
        engine.dispose()
      }
    },
  }
}