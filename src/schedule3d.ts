import * as THREE from 'three'
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js'
import type { SceneLayout, ShotBlocking } from './types'
import {
  actorMeters,
  cameraMeters,
  interpolateBlocking,
  renderSize,
  segmentEndpoints,
  wallSegments,
} from './scheduleGeometry'

/**
 * 3D 调度渲染。
 *
 * clean：从镜头机位输出，无网格/文字/辅助线，作为 Seedance 参考视频与人工预演；
 * review：环绕视角，显示墙体/人物/机位/视锥/路径，仅用于审片，不作为出片参考。
 *
 * 所有运动都由 blocking 关键帧插值；move 只影响“手持”的确定性微抖。
 */
export type ScheduleViewMode = 'clean' | 'review'

export type ScheduleOptions = {
  layout: SceneLayout
  blocking: ShotBlocking
  /** 有效出片时长，2~12 秒由调用方夹取 */
  duration: number
  aspect: string
  mode: ScheduleViewMode
  width?: number
  height?: number
  /** 审阅模式是否画名字/机位标签；clean 永远不画 */
  showLabels?: boolean
  /** 编辑器交互环绕；录制时为 false */
  interactive?: boolean
  /** 运镜类型：只有手持叠加确定性抖动 */
  move?: string
  signal?: AbortSignal
  onProgress?: (value: number) => void
}

export type ScheduleScene = {
  render: (seconds: number) => void
  dispose: () => void
  canvas: HTMLCanvasElement
  /** 实际渲染尺寸（偶数，长边最多 960） */
  width: number
  height: number
}

const BG_CLEAN = 0xe7ebef
const BG_REVIEW = 0xf7f6f1
const FLOOR = 0xf2efe8
const WALL = 0xd9dde3
const WALL_EDGE = 0x9aa3ad
const PROP = 0xaab4c0
const ZONE_COLORS = [0x9bc7c0, 0xc7b9e6, 0xe8c7a6]
const ACTOR_COLORS = [0x2c9c86, 0x4a86c7, 0xc27c57, 0x8f72c9, 0x789b52, 0xc45c7a, 0x5b8d9c, 0x9b8b45]

function labelSprite(text: string, color = '#24313d'): THREE.Sprite {
  const pad = 10
  const canvas = document.createElement('canvas')
  const ctx = canvas.getContext('2d')!
  const font = 'bold 28px system-ui, sans-serif'
  ctx.font = font
  const tw = Math.ceil(ctx.measureText(text).width)
  canvas.width = tw + pad * 2
  canvas.height = 44
  const c2 = canvas.getContext('2d')!
  c2.font = font
  c2.fillStyle = 'rgba(255,255,255,0.88)'
  c2.fillRect(0, 0, canvas.width, canvas.height)
  c2.fillStyle = color
  c2.textBaseline = 'middle'
  c2.fillText(text, pad, canvas.height / 2)
  const tex = new THREE.CanvasTexture(canvas)
  tex.colorSpace = THREE.SRGBColorSpace
  const sp = new THREE.Sprite(
    new THREE.SpriteMaterial({ map: tex, transparent: true, depthTest: false, depthWrite: false }),
  )
  sp.scale.set(canvas.width / 90, canvas.height / 90, 1)
  return sp
}

function actorColor(name: string) {
  let h = 0
  for (let i = 0; i < name.length; i++) h = (Math.imul(h, 31) + name.charCodeAt(i)) >>> 0
  return ACTOR_COLORS[h % ACTOR_COLORS.length]
}

function addEdges(mesh: THREE.Mesh, color = WALL_EDGE, opacity = 0.35) {
  const edges = new THREE.LineSegments(
    new THREE.EdgesGeometry(mesh.geometry),
    new THREE.LineBasicMaterial({ color, transparent: true, opacity }),
  )
  mesh.add(edges)
  return edges
}

function addWalls(scene: THREE.Scene, layout: SceneLayout) {
  for (const wall of layout.walls) {
    for (const seg of wallSegments(wall)) {
      const e = segmentEndpoints(wall, seg)
      const len = Math.hypot(e.x2 - e.x1, e.z2 - e.z1)
      if (len < 0.02) continue
      const h = Math.max(0.02, seg.y1 - seg.y0)
      const mesh = new THREE.Mesh(
        new THREE.BoxGeometry(len, h, Math.max(0.02, wall.thickness)),
        new THREE.MeshStandardMaterial({ color: WALL, roughness: 0.9, metalness: 0 }),
      )
      const angle = Math.atan2(e.z2 - e.z1, e.x2 - e.x1)
      mesh.position.set((e.x1 + e.x2) / 2, seg.y0 + h / 2, (e.z1 + e.z2) / 2)
      mesh.rotation.y = -angle
      mesh.castShadow = true
      mesh.receiveShadow = true
      addEdges(mesh)
      scene.add(mesh)
    }
  }
}

function addProps(scene: THREE.Scene, layout: SceneLayout) {
  for (const p of layout.props) {
    let geo: THREE.BufferGeometry
    if (p.shape === 'cylinder') {
      const radius = Math.max(0.05, Math.max(p.w, p.d) / 2)
      geo = new THREE.CylinderGeometry(radius, radius, p.h, 16)
    } else {
      geo = new THREE.BoxGeometry(p.w, p.h, p.d)
    }
    const mesh = new THREE.Mesh(
      geo,
      new THREE.MeshStandardMaterial({ color: PROP, roughness: 0.85, metalness: 0 }),
    )
    mesh.position.set(p.x, p.h / 2, p.z)
    mesh.rotation.y = -(p.rotation * Math.PI) / 180
    mesh.castShadow = true
    mesh.receiveShadow = true
    addEdges(mesh)
    scene.add(mesh)
  }
}

function addZones(scene: THREE.Scene, layout: SceneLayout, review: boolean) {
  layout.zones.forEach((z, i) => {
    const geo = new THREE.PlaneGeometry(z.w, z.d)
    const color = z.color ? new THREE.Color(z.color).getHex() : ZONE_COLORS[i % ZONE_COLORS.length]
    const mat = new THREE.MeshBasicMaterial({
      color,
      transparent: true,
      opacity: review ? 0.18 : 0.08,
      depthWrite: false,
      side: THREE.DoubleSide,
    })
    const mesh = new THREE.Mesh(geo, mat)
    mesh.rotation.x = -Math.PI / 2
    mesh.position.set(z.x + z.w / 2, 0.012 + i * 0.0005, z.z + z.d / 2)
    scene.add(mesh)
    if (review) {
      const pts = [
        new THREE.Vector3(-z.w / 2, 0, -z.d / 2),
        new THREE.Vector3(z.w / 2, 0, -z.d / 2),
        new THREE.Vector3(z.w / 2, 0, z.d / 2),
        new THREE.Vector3(-z.w / 2, 0, z.d / 2),
        new THREE.Vector3(-z.w / 2, 0, -z.d / 2),
      ]
      const edge = new THREE.Line(
        new THREE.BufferGeometry().setFromPoints(pts),
        new THREE.LineBasicMaterial({ color, transparent: true, opacity: 0.55 }),
      )
      edge.position.copy(mesh.position)
      scene.add(edge)
    }
  })
}

function addAxis(scene: THREE.Scene, layout: SceneLayout) {
  const a = layout.axis
  if (!a) return
  const geo = new THREE.BufferGeometry().setFromPoints([
    new THREE.Vector3(a.a.x, 0.03, a.a.z),
    new THREE.Vector3(a.b.x, 0.03, a.b.z),
  ])
  const line = new THREE.Line(
    geo,
    new THREE.LineDashedMaterial({ color: 0x6f7a86, dashSize: 0.28, gapSize: 0.2 }),
  )
  line.computeLineDistances()
  scene.add(line)
}

type ActorView = {
  name: string
  group: THREE.Group
  label?: THREE.Sprite
}

function addActor(name: string, review: boolean): ActorView {
  const group = new THREE.Group()
  const color = actorColor(name)
  const body = new THREE.Mesh(
    new THREE.CapsuleGeometry(0.22, 1.02, 6, 12),
    new THREE.MeshStandardMaterial({ color, roughness: 0.8, metalness: 0 }),
  )
  body.position.y = 0.76
  body.castShadow = true
  group.add(body)
  const head = new THREE.Mesh(
    new THREE.SphereGeometry(0.16, 16, 12),
    new THREE.MeshStandardMaterial({ color: 0xf0d7c2, roughness: 0.75, metalness: 0 }),
  )
  head.position.y = 1.52
  head.castShadow = true
  group.add(head)
  // 朝向锥：脸朝 +x；胶囊本身看不出朝向
  const nose = new THREE.Mesh(
    new THREE.ConeGeometry(0.1, 0.32, 12),
    new THREE.MeshStandardMaterial({ color, roughness: 0.7, metalness: 0 }),
  )
  nose.rotation.z = -Math.PI / 2
  nose.position.set(0.3, 1.26, 0)
  group.add(nose)
  let label: THREE.Sprite | undefined
  if (review) {
    label = labelSprite(name, '#1d3d38')
    label.position.set(0, 2.03, 0)
    group.add(label)
  }
  return { name, group, label }
}

function addCameraProxy() {
  const group = new THREE.Group()
  const box = new THREE.Mesh(
    new THREE.BoxGeometry(0.42, 0.3, 0.5),
    new THREE.MeshStandardMaterial({ color: 0x2f6f9f, roughness: 0.7, metalness: 0.1 }),
  )
  box.castShadow = true
  group.add(box)
  const label = labelSprite('机位', '#2f6f9f')
  label.position.set(0, 0.7, 0)
  group.add(label)
  const line = new THREE.LineSegments(
    new THREE.BufferGeometry(),
    new THREE.LineBasicMaterial({ color: 0x378add, transparent: true, opacity: 0.85 }),
  )
  group.add(line)
  return { group, line, label }
}

function updateCameraProxy(
  proxy: ReturnType<typeof addCameraProxy>,
  camera: ReturnType<typeof cameraMeters>,
  aspect: number,
) {
  proxy.group.position.set(camera.x, camera.height, camera.z)
  proxy.group.lookAt(new THREE.Vector3(camera.lookX, 1.2, camera.lookZ))
  const dist = Math.max(0.5, Math.hypot(camera.lookX - camera.x, camera.lookZ - camera.z))
  const halfH = Math.tan((camera.fov * Math.PI) / 360)
  const halfW = halfH * aspect
  const near = 0.12
  // Group.lookAt 对非 Camera/Light 对象让本地 +z 朝向目标，所以视锥也朝 +z 建。
  const z = dist
  const pts: number[] = []
  const corners = [
    [-halfW * dist, -halfH * dist, z],
    [halfW * dist, -halfH * dist, z],
    [halfW * dist, halfH * dist, z],
    [-halfW * dist, halfH * dist, z],
  ]
  for (const c of corners) pts.push(0, 0, near, c[0], c[1], c[2])
  for (let i = 0; i < corners.length; i++) {
    const c1 = corners[i]
    const c2 = corners[(i + 1) % corners.length]
    pts.push(c1[0], c1[1], c1[2], c2[0], c2[1], c2[2])
  }
  proxy.line.geometry.dispose()
  proxy.line.geometry = new THREE.BufferGeometry()
  proxy.line.geometry.setAttribute('position', new THREE.Float32BufferAttribute(pts, 3))
}

function addPathLines(scene: THREE.Scene, layout: SceneLayout, blocking: ShotBlocking) {
  const actorNames = [...new Set(blocking.keys.flatMap((k) => k.actors.map((a) => a.name)))]
  for (const name of actorNames) {
    const pts: THREE.Vector3[] = []
    for (let i = 0; i <= 40; i++) {
      const key = interpolateBlocking(blocking, i / 40)
      const a = key?.actors.find((x) => x.name === name)
      if (a) {
        const m = actorMeters(layout, a)
        pts.push(new THREE.Vector3(m.x, 0.05, m.z))
      }
    }
    if (pts.length < 2) continue
    const line = new THREE.Line(
      new THREE.BufferGeometry().setFromPoints(pts),
      new THREE.LineDashedMaterial({ color: actorColor(name), dashSize: 0.25, gapSize: 0.18 }),
    )
    line.computeLineDistances()
    scene.add(line)
  }
  const camPts: THREE.Vector3[] = []
  for (let i = 0; i <= 40; i++) {
    const key = interpolateBlocking(blocking, i / 40)
    if (!key) continue
    const c = cameraMeters(layout, key)
    camPts.push(new THREE.Vector3(c.x, 0.08, c.z))
  }
  if (camPts.length > 1) {
    const line = new THREE.Line(
      new THREE.BufferGeometry().setFromPoints(camPts),
      new THREE.LineDashedMaterial({ color: 0x2f6f9f, dashSize: 0.3, gapSize: 0.2 }),
    )
    line.computeLineDistances()
    scene.add(line)
  }
}

function setupReviewCamera(layout: SceneLayout, aspect: number, interactive: boolean, dom: HTMLCanvasElement) {
  const cam = new THREE.PerspectiveCamera(42, aspect, 0.1, 500)
  const center = new THREE.Vector3(layout.w / 2, 0.8, layout.h / 2)
  const dist = Math.max(layout.w, layout.h) * 1.35
  cam.position.set(layout.w / 2 + dist * 0.55, dist * 0.8, layout.h / 2 + dist * 0.95)
  cam.lookAt(center)
  let controls: OrbitControls | undefined
  if (interactive) {
    controls = new OrbitControls(cam, dom)
    controls.target.copy(center)
    controls.enableDamping = true
    controls.dampingFactor = 0.08
    controls.minDistance = Math.max(1.5, Math.max(layout.w, layout.h) * 0.35)
    controls.maxDistance = Math.max(layout.w, layout.h) * 3.5
    controls.maxPolarAngle = Math.PI * 0.49
    controls.update()
  }
  return { cam, controls }
}

export function buildScheduleScene(opts: ScheduleOptions): ScheduleScene {
  const width = opts.width ?? renderSize(opts.aspect).width
  const height = opts.height ?? renderSize(opts.aspect).height
  const aspect = width / height
  const clean = opts.mode === 'clean'
  const review = !clean
  const showLabels = review && (opts.showLabels ?? true)

  const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: false, preserveDrawingBuffer: true })
  renderer.setPixelRatio(1)
  renderer.setSize(width, height)
  renderer.setClearColor(clean ? BG_CLEAN : BG_REVIEW, 1)
  renderer.outputColorSpace = THREE.SRGBColorSpace
  renderer.shadowMap.enabled = true
  renderer.shadowMap.type = THREE.PCFSoftShadowMap

  const scene = new THREE.Scene()
  const floor = new THREE.Mesh(
    new THREE.PlaneGeometry(opts.layout.w, opts.layout.h),
    new THREE.MeshStandardMaterial({ color: FLOOR, roughness: 0.95, metalness: 0 }),
  )
  floor.rotation.x = -Math.PI / 2
  floor.position.set(opts.layout.w / 2, 0, opts.layout.h / 2)
  floor.receiveShadow = true
  scene.add(floor)
  if (review) {
    const grid = new THREE.GridHelper(
      Math.max(opts.layout.w, opts.layout.h),
      Math.max(4, Math.round(Math.max(opts.layout.w, opts.layout.h))),
      0xb8bec5,
      0xd6d9dd,
    )
    grid.position.set(opts.layout.w / 2, 0.016, opts.layout.h / 2)
    scene.add(grid)
  }
  addZones(scene, opts.layout, review)
  addWalls(scene, opts.layout)
  addProps(scene, opts.layout)
  if (review) addAxis(scene, opts.layout)

  scene.add(new THREE.HemisphereLight(0xffffff, 0xb9c0c8, 1.25))
  const sun = new THREE.DirectionalLight(0xffffff, 2.1)
  sun.position.set(opts.layout.w * 0.65, Math.max(opts.layout.w, opts.layout.h) * 1.4, opts.layout.h * 0.9)
  sun.castShadow = true
  sun.shadow.mapSize.set(1024, 1024)
  sun.shadow.camera.near = 0.5
  sun.shadow.camera.far = Math.max(opts.layout.w, opts.layout.h) * 4
  scene.add(sun)

  const actorNames = [...new Set(opts.blocking.keys.flatMap((k) => k.actors.map((a) => a.name)))]
  const actors = new Map<string, ActorView>()
  for (const name of actorNames) {
    const view = addActor(name, showLabels)
    actors.set(name, view)
    scene.add(view.group)
  }

  const camProxy = review ? addCameraProxy() : undefined
  if (camProxy) scene.add(camProxy.group)
  if (review) addPathLines(scene, opts.layout, opts.blocking)

  const povCam = new THREE.PerspectiveCamera(45, aspect, 0.04, 300)
  const reviewCamera = review ? setupReviewCamera(opts.layout, aspect, Boolean(opts.interactive), renderer.domElement) : undefined

  const render = (seconds: number) => {
    const p = Math.min(1, Math.max(0, Number(seconds) / Math.max(0.001, opts.duration)))
    const key = interpolateBlocking(opts.blocking, p)
    if (!key) return
    const seen = new Set<string>()
    for (const a of key.actors) {
      const view = actors.get(a.name)
      if (!view) continue
      seen.add(a.name)
      const m = actorMeters(opts.layout, a)
      view.group.position.set(m.x, 0, m.z)
      view.group.rotation.y = -(m.face * Math.PI) / 180
      view.group.visible = true
    }
    for (const [name, view] of actors) view.group.visible = seen.has(name)

    const cam = cameraMeters(opts.layout, key)
    if (camProxy) updateCameraProxy(camProxy, cam, aspect)
    if (review) {
      const rc = reviewCamera!.cam
      if (reviewCamera!.controls) reviewCamera!.controls.update()
      for (const view of actors.values()) {
        const label = view.label
        if (!label) continue
        const dist = label.getWorldPosition(new THREE.Vector3()).distanceTo(rc.position)
        const mat = label.material as THREE.SpriteMaterial
        mat.opacity = Math.min(1, Math.max(0, (dist - 1.6) / 1.4))
      }
      if (camProxy) {
        const d = camProxy.label.getWorldPosition(new THREE.Vector3()).distanceTo(rc.position)
        ;(camProxy.label.material as THREE.SpriteMaterial).opacity = Math.min(1, Math.max(0, (d - 1.8) / 1.2))
      }
      renderer.render(scene, rc)
    } else {
      // 干净 POV：直接站到镜头机位；手持只叠加确定性微抖
      let jx = 0
      let jy = 0
      let jz = 0
      if (opts.move === '手持') {
        jx = Math.sin(p * 51.7) * 0.018
        jy = Math.sin(p * 37.3 + 1.4) * 0.012
        jz = Math.cos(p * 43.1) * 0.018
      }
      povCam.position.set(cam.x + jx, Math.max(0.35, cam.height + jy), cam.z + jz)
      povCam.fov = cam.fov
      povCam.aspect = aspect
      povCam.updateProjectionMatrix()
      povCam.lookAt(cam.lookX + jx * 0.6, 1.2 + jy * 0.3, cam.lookZ + jz * 0.6)
      renderer.render(scene, povCam)
    }
  }

  render(0)
  return {
    render,
    canvas: renderer.domElement,
    width,
    height,
    dispose: () => {
      reviewCamera?.controls?.dispose()
      renderer.dispose()
      scene.traverse((o) => {
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
      })
    },
  }
}

function sleep(ms: number) {
  return new Promise<void>((r) => setTimeout(r, ms))
}

/**
 * 确定性录制：先渲染首帧，再按 30fps 的墙钟节拍推帧；用 setTimeout 而不是只靠
 * requestAnimationFrame（无头/后台标签页会节流）。取消时不产出 Blob。
 */
export async function renderScheduleVideo(opts: ScheduleOptions): Promise<Blob> {
  const fps = 30
  const width = opts.width ?? renderSize(opts.aspect).width
  const height = opts.height ?? renderSize(opts.aspect).height
  const duration = Math.max(0.1, Number(opts.duration) || 2)
  const frames = Math.max(1, Math.round(duration * fps))
  const frameMs = 1000 / fps
  const scene = buildScheduleScene({ ...opts, width, height })
  const stream = scene.canvas.captureStream(fps)
  const mime = ['video/webm;codecs=vp9', 'video/webm;codecs=vp8', 'video/webm'].find(
    (m) => typeof MediaRecorder !== 'undefined' && MediaRecorder.isTypeSupported(m),
  )
  if (!mime) {
    scene.dispose()
    stream.getTracks().forEach((t) => t.stop())
    throw new Error('浏览器不支持 MediaRecorder 录制 webm')
  }
  const rec = new MediaRecorder(stream, { mimeType: mime, videoBitsPerSecond: 4_000_000 })
  const chunks: BlobPart[] = []
  rec.ondataavailable = (e) => {
    if (e.data.size > 0) chunks.push(e.data)
  }
  const done = new Promise<Blob>((resolve, reject) => {
    rec.onstop = () => resolve(new Blob(chunks, { type: 'video/webm' }))
    rec.onerror = () => reject(new Error('MediaRecorder 录制失败'))
  })

  const cleanup = () => {
    try {
      stream.getTracks().forEach((t) => t.stop())
    } catch {
      /* ignore */
    }
    scene.dispose()
  }

  try {
    scene.render(0)
    rec.start()
    const t0 = performance.now()
    for (let i = 0; i <= frames; i++) {
      if (opts.signal?.aborted) throw new DOMException('已取消', 'AbortError')
      scene.render((i / frames) * duration)
      opts.onProgress?.(Math.min(1, i / frames))
      const target = t0 + (i + 1) * frameMs
      const wait = target - performance.now()
      if (wait > 0) await sleep(wait)
    }
    await sleep(120)
    if (opts.signal?.aborted) throw new DOMException('已取消', 'AbortError')
    rec.stop()
    const blob = await done
    opts.onProgress?.(1)
    cleanup()
    return blob
  } catch (e) {
    try {
      if (rec.state !== 'inactive') rec.stop()
    } catch {
      /* ignore */
    }
    cleanup()
    throw e
  }
}
