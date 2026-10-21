import * as THREE from 'three'
import type { ShotLayout } from './types'

/**
 * 把俯视调度数据渲染成 3D 调度动画，并录成 webm。
 *
 * 为什么用 3D：平面图看不出高度与遮挡关系。这里人物是胶囊体、机位是带视锥的相机，
 * 镜头沿「机位 → 看的方向」推近，能直观看走位与轴线。
 *
 * 为什么要录视频：Seedance 只吃图片（首帧 / 尾帧 / 参考图），
 * 所以视频会被抽成帧再当参考图用 —— 视频给人看，帧给模型用。
 */
export type ScheduleOptions = {
  /** 秒，默认 3 */
  seconds?: number
  /** 输出宽高，默认 960×540 */
  width?: number
  height?: number
  /** 正片纹理颜色（浅色底更接近故事板） */
  fps?: number
}

const FLOOR = 0xf7f6f1
const WALL = 0xdcdad2

/** layout 的 0~1 坐标 → 世界坐标（米），原点在场景中心 */
function toWorld(l: ShotLayout) {
  const w = l.w ?? 10
  const h = l.h ?? 8
  return {
    w,
    h,
    pos: (x: number, y: number) => new THREE.Vector3((x - 0.5) * w, 0, (y - 0.5) * h),
  }
}

function labelSprite(text: string, color = '#3c3489'): THREE.Sprite {
  const pad = 8
  const canvas = document.createElement('canvas')
  const ctx = canvas.getContext('2d')!
  const font = 'bold 28px system-ui, sans-serif'
  ctx.font = font
  const tw = Math.ceil(ctx.measureText(text).width)
  canvas.width = tw + pad * 2
  canvas.height = 44
  const c2 = canvas.getContext('2d')!
  c2.font = font
  c2.fillStyle = 'rgba(255,255,255,0.9)'
  c2.fillRect(0, 0, canvas.width, canvas.height)
  c2.fillStyle = color
  c2.textBaseline = 'middle'
  c2.fillText(text, pad, canvas.height / 2)
  const tex = new THREE.CanvasTexture(canvas)
  tex.colorSpace = THREE.SRGBColorSpace
  const sp = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, transparent: true, depthTest: false }))
  sp.scale.set(canvas.width / 90, canvas.height / 90, 1)
  return sp
}

export type ScheduleScene = {
  render: (t: number) => void
  dispose: () => void
  canvas: HTMLCanvasElement
}

/** 建场景：地板 + 人物 + 机位视锥 + 轴线；render(t) 用 0~1 的进度驱动一次绘制 */
export function buildScheduleScene(layout: ShotLayout, opts: ScheduleOptions = {}): ScheduleScene {
  const W = opts.width ?? 960
  const H = opts.height ?? 540
  const { w, h, pos } = toWorld(layout)

  const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: false, preserveDrawingBuffer: true })
  renderer.setPixelRatio(1)
  renderer.setSize(W, H)
  renderer.setClearColor(0xffffff, 1)

  const scene = new THREE.Scene()
  scene.fog = new THREE.Fog(0xffffff, w * 2.2, w * 4.5)

  const cam = new THREE.PerspectiveCamera(45, W / H, 0.1, 200)
  scene.add(new THREE.HemisphereLight(0xffffff, 0xbfc3c9, 1.15))
  const sun = new THREE.DirectionalLight(0xffffff, 1.1)
  sun.position.set(w * 0.6, h * 1.4, h * 0.8)
  scene.add(sun)

  // 地板 + 网格
  const floor = new THREE.Mesh(
    new THREE.PlaneGeometry(w, h),
    new THREE.MeshLambertMaterial({ color: FLOOR }),
  )
  floor.rotation.x = -Math.PI / 2
  scene.add(floor)
  const grid = new THREE.GridHelper(Math.max(w, h), Math.round(Math.max(w, h)), 0xb4b2a9, 0xd3d1c7)
  grid.position.y = 0.01
  scene.add(grid)

  // 轴线：前两名演员之间（黄色断线，高于地面）
  const [a0, a1] = layout.actors
  if (a0 && a1) {
    const p0 = pos(a0.x, a0.y)
    const p1 = pos(a1.x, a1.y)
    const geo = new THREE.BufferGeometry().setFromPoints([p0, p1])
    const axis = new THREE.Line(
      geo,
      new THREE.LineDashedMaterial({ color: 0x888780, dashSize: 0.35, gapSize: 0.25 }),
    )
    axis.computeLineDistances()
    axis.position.y = 0.03
    scene.add(axis)
  }

  // 人物：胶囊 + 朝向箭头 + 名字
  for (const ac of layout.actors) {
    const base = pos(ac.x, ac.y)
    const body = new THREE.Mesh(
      new THREE.CapsuleGeometry(0.22, 1.05, 6, 12),
      new THREE.MeshLambertMaterial({ color: 0x1d9e75 }),
    )
    body.position.set(base.x, 0.75, base.z)
    scene.add(body)

    const head = new THREE.Mesh(
      new THREE.SphereGeometry(0.16, 16, 12),
      new THREE.MeshLambertMaterial({ color: 0x9fe1cb }),
    )
    head.position.set(base.x, 1.52, base.z)
    scene.add(head)

    const rad = ((ac.face ?? 0) - 90) * (Math.PI / 180)
    const dir = new THREE.Vector3(Math.cos(rad), 0, Math.sin(rad))
    const arrow = new THREE.ArrowHelper(dir, new THREE.Vector3(base.x, 1.2, base.z), 0.75, 0x0f6e56, 0.24, 0.16)
    scene.add(arrow)

    const tag = labelSprite(ac.name)
    tag.position.set(base.x, 2.05, base.z)
    scene.add(tag)
  }

  // 机位：小相机盒子 + 视锥（用线框表示 fov）
  const camBase = pos(layout.camera.x, layout.camera.y)
  const lookAt = pos(layout.camera.lookX, layout.camera.lookY)
  const camBox = new THREE.Mesh(
    new THREE.BoxGeometry(0.42, 0.3, 0.5),
    new THREE.MeshLambertMaterial({ color: 0x185fa5 }),
  )
  const camY = 1.55
  camBox.position.set(camBase.x, camY, camBase.z)
  scene.add(camBox)

  const viewDir = new THREE.Vector3(lookAt.x - camBase.x, 0, lookAt.z - camBase.z)
  const dist = viewDir.length() || 1
  const focus = new THREE.Vector3(lookAt.x, 0.9, lookAt.z)

  const frustum = new THREE.LineSegments(
    new THREE.BufferGeometry(),
    new THREE.LineBasicMaterial({ color: 0x378add, transparent: true, opacity: 0.85 }),
  )
  {
    const halfW = Math.tan((28 * Math.PI) / 180) * dist
    const top = camY + 0.35
    const pts: number[] = []
    const near = new THREE.Vector3(camBase.x, camY, camBase.z)
    const corners = [
      [lookAt.x - halfW, top, lookAt.z - halfW * 0.55],
      [lookAt.x + halfW, top, lookAt.z - halfW * 0.55],
      [lookAt.x + halfW, 0.05, lookAt.z + halfW * 0.55],
      [lookAt.x - halfW, 0.05, lookAt.z + halfW * 0.55],
    ]
    for (const c of corners) {
      pts.push(near.x, near.y, near.z, c[0], c[1], c[2])
    }
    for (let i = 0; i < corners.length; i++) {
      const c1 = corners[i]
      const c2 = corners[(i + 1) % corners.length]
      pts.push(c1[0], c1[1], c1[2], c2[0], c2[1], c2[2])
    }
    frustum.geometry.setAttribute('position', new THREE.Float32BufferAttribute(pts, 3))
  }
  scene.add(frustum)

  const camTag = labelSprite('机位', '#185fa5')
  camTag.position.set(camBase.x, camY + 0.8, camBase.z)
  scene.add(camTag)

  // 运镜：从机位后上方俯视起步 → 推到机位视角，再轻轻飘移
  const startPos = new THREE.Vector3(camBase.x * 0.4, Math.max(w, h) * 0.95, camBase.z * 0.4 + h * 0.55)
  const endPos = new THREE.Vector3(
    camBase.x + (camBase.x - lookAt.x) * 0.12,
    camY + 0.9,
    camBase.z + (camBase.z - lookAt.z) * 0.12,
  )
  const midLook = new THREE.Vector3(0, 0.6, 0)

  const render = (t: number) => {
    const k = Math.min(1, Math.max(0, t))
    const ease = k < 0.5 ? 2 * k * k : 1 - Math.pow(-2 * k + 2, 2) / 2
    cam.position.lerpVectors(startPos, endPos, ease)
    // 落点：先看场地中心，再切到机位注视点
    const look = new THREE.Vector3().lerpVectors(midLook, focus, Math.min(1, ease * 1.6))
    look.x += Math.sin(k * Math.PI * 2) * 0.15
    cam.lookAt(look)
    renderer.render(scene, cam)
  }
  render(0)

  return {
    render,
    canvas: renderer.domElement,
    dispose: () => {
      renderer.dispose()
      scene.traverse((o) => {
        const any = o as unknown as { geometry?: THREE.BufferGeometry; material?: THREE.Material }
        any.geometry?.dispose?.()
      })
    },
  }
}

/** 渲染 + 录制 webm，返回 Blob */
export async function renderScheduleVideo(layout: ShotLayout, opts: ScheduleOptions = {}): Promise<Blob> {
  const seconds = opts.seconds ?? 3
  const fps = opts.fps ?? 30
  const scene = buildScheduleScene(layout, opts)
  const stream = scene.canvas.captureStream(fps)
  const mime = ['video/webm;codecs=vp9', 'video/webm;codecs=vp8', 'video/webm'].find((m) =>
    typeof MediaRecorder !== 'undefined' && MediaRecorder.isTypeSupported(m),
  )
  if (!mime) throw new Error('浏览器不支持 MediaRecorder 录制 webm')
  const rec = new MediaRecorder(stream, { mimeType: mime, videoBitsPerSecond: 4_000_000 })
  const chunks: BlobPart[] = []
  rec.ondataavailable = (e) => {
    if (e.data.size > 0) chunks.push(e.data)
  }
  const done = new Promise<Blob>((resolve) => {
    rec.onstop = () => resolve(new Blob(chunks, { type: 'video/webm' }))
  })
  rec.start()
  const t0 = performance.now()
  await new Promise<void>((resolve) => {
    const tick = () => {
      const t = (performance.now() - t0) / (seconds * 1000)
      scene.render(t)
      if (t >= 1) resolve()
      else requestAnimationFrame(tick)
    }
    requestAnimationFrame(tick)
  })
  await new Promise((r) => setTimeout(r, 120))
  rec.stop()
  const blob = await done
  stream.getTracks().forEach((t) => t.stop())
  scene.dispose()
  return blob
}
