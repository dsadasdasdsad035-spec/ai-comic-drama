import type {
  BlockingActor,
  BlockingCamera,
  BlockingKey,
  Mark,
  SceneAxis,
  SceneLayout,
  SceneProp,
  SceneWall,
  SceneWallOpening,
  SceneZone,
  ScheduleMeta,
  ShotBlocking,
  ShotLayout,
} from './types'
import { SCENE_LIMITS } from './types'

/**
 * 3D 调度的纯几何层：不碰 DOM / Three.js / fetch，方便用 Node 直接测。
 *
 * 坐标约定：
 * - 场景布局用米，原点在场地左上角，x 向右、z 向下；
 * - 角色/机位位置归一化 0~1，y 对应场景 z；
 * - face 为角度，0=+x、90=+z。
 */

export type Issue = { code: string; message: string; key?: string }
export type SanitizeResult = { layout: SceneLayout; warnings: string[] }
export type ValidationResult = { errors: Issue[]; warnings: Issue[] }
export type WallSegment = {
  wallId: string
  /** 沿墙起点到段起点的距离（米） */
  a: number
  b: number
  y0: number
  y1: number
  thickness: number
  height: number
}

export type BlockingValidationOpts = {
  layout: SceneLayout
  roster: string[]
  aspect?: string
  duration?: number
}

export type FingerprintInput = {
  layout: SceneLayout
  blocking: ShotBlocking
  duration: number
  aspect: string
  mode: 'clean' | 'review'
}

const EPS = 1e-6
const ACTOR_RADIUS = 0.27
const ACTOR_BODY_LOW = 0.2
const ACTOR_BODY_HIGH = 1.75

const num = (v: unknown): number | null => {
  const n = typeof v === 'number' ? v : Number(v)
  return Number.isFinite(n) ? n : null
}

const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v))
const round = (v: number, digits = 4) => {
  const m = 10 ** digits
  return Math.round(v * m) / m
}

export const sceneLayoutId = (episode: number, sceneNo: number) =>
  `E${String(Math.max(1, Math.round(episode))).padStart(2, '0')}-SC${String(Math.max(1, Math.round(sceneNo))).padStart(2, '0')}`

export function normalizeFace(face: number): number {
  const f = Number(face)
  if (!Number.isFinite(f)) return 0
  return ((f % 360) + 360) % 360
}

export function angleDelta(from: number, to: number): number {
  let d = normalizeFace(to) - normalizeFace(from)
  while (d > 180) d -= 360
  while (d < -180) d += 360
  return d
}

export function faceTowards(from: { x: number; y: number }, to: { x: number; y: number }): number {
  // 画面坐标里 y 向下，atan2(dy, dx) 与 face 的 0=+x、90=+y 一致
  return normalizeFace((Math.atan2(to.y - from.y, to.x - from.x) * 180) / Math.PI)
}

export function bearingOf(dx: number, dz: number): string {
  const deg = (Math.atan2(dx, -dz) * 180) / Math.PI
  const names = ['正北', '东北', '正东', '东南', '正南', '西南', '正西', '西北']
  return names[Math.round(((deg + 360) % 360) / 45) % 8]
}

export function aspectValue(aspect: string | undefined): number {
  const m = String(aspect || '16:9').match(/^(\d+(?:\.\d+)?):(\d+(?:\.\d+)?)$/)
  if (!m) return 16 / 9
  const a = Number(m[1])
  const b = Number(m[2])
  return a > 0 && b > 0 ? a / b : 16 / 9
}

export const DEFAULT_SCENE_W = 10
export const DEFAULT_SCENE_H = 8

export function fallbackSceneLayout(
  episode: number,
  sceneNo: number,
  sceneSlug?: string,
  designId?: string,
): SceneLayout {
  const ep = Math.max(1, Math.round(episode || 1))
  const no = Math.max(1, Math.round(sceneNo || 1))
  const w = DEFAULT_SCENE_W
  const h = DEFAULT_SCENE_H
  return {
    id: sceneLayoutId(ep, no),
    episode: ep,
    sceneNo: no,
    ...(sceneSlug ? { sceneSlug } : {}),
    ...(designId ? { designId } : {}),
    w,
    h,
    walls: [
      { id: 'w1', x1: 0, z1: 0, x2: w, z2: 0, height: 2.8, thickness: 0.18 },
      {
        id: 'w2',
        x1: 0,
        z1: h,
        x2: w,
        z2: h,
        height: 2.8,
        thickness: 0.18,
        openings: [{ at: w * 0.62, width: 1.0, height: 2.1, kind: 'door' }],
      },
      { id: 'w3', x1: 0, z1: 0, x2: 0, z2: h, height: 2.8, thickness: 0.18 },
      { id: 'w4', x1: w, z1: 0, x2: w, z2: h, height: 2.8, thickness: 0.18 },
    ],
    props: [],
    zones: [{ id: 'z1', name: '表演区', kind: 'action', x: w * 0.25, z: h * 0.25, w: w * 0.5, d: h * 0.5 }],
    axis: { a: { x: w * 0.35, z: h * 0.5 }, b: { x: w * 0.65, z: h * 0.5 }, label: '默认轴线' },
    source: 'fallback',
  }
}

function sanitizeOpening(raw: unknown, wallLength: number, wallHeight: number): SceneWallOpening | null {
  const o = (raw || {}) as Record<string, unknown>
  const at = num(o.at)
  const width = num(o.width)
  const height = num(o.height)
  if (at == null || width == null || height == null) return null
  const kind = o.kind === 'window' ? 'window' : 'door'
  const w = clamp(width, 0.15, Math.max(0.2, wallLength))
  const h = clamp(height, 0.3, wallHeight)
  const start = clamp(at, 0, Math.max(0, wallLength - w))
  const sillRaw = kind === 'window' ? num(o.sill ?? 0.9) : 0
  const sill = clamp(sillRaw == null ? 0.9 : sillRaw, 0, Math.max(0, wallHeight - h))
  return {
    at: round(start),
    width: round(w),
    height: round(h),
    kind,
    ...(kind === 'window' ? { sill: round(sill) } : {}),
  }
}

function sanitizeWall(raw: unknown, w: number, h: number, index: number): { wall: SceneWall | null; warning?: string } {
  const o = (raw || {}) as Record<string, unknown>
  const x1 = num(o.x1)
  const z1 = num(o.z1)
  const x2 = num(o.x2)
  const z2 = num(o.z2)
  const height = num(o.height)
  const thickness = num(o.thickness)
  if (x1 == null || z1 == null || x2 == null || z2 == null || height == null || thickness == null) {
    return { wall: null, warning: `墙 ${index + 1} 缺少有效坐标/尺寸，已忽略` }
  }
  const length = Math.hypot(x2 - x1, z2 - z1)
  if (length < 0.1) return { wall: null, warning: `墙 ${index + 1} 长度过短，已忽略` }
  const wallHeight = clamp(height, 0.5, 20)
  const wall: SceneWall = {
    id: String(o.id || `w${index + 1}`),
    x1: round(clamp(x1, -2, w + 2)),
    z1: round(clamp(z1, -2, h + 2)),
    x2: round(clamp(x2, -2, w + 2)),
    z2: round(clamp(z2, -2, h + 2)),
    height: round(wallHeight),
    thickness: round(clamp(thickness, 0.02, 2)),
  }
  const rawOpenings = Array.isArray(o.openings) ? o.openings.slice(0, 8) : []
  const openings: SceneWallOpening[] = []
  for (const item of rawOpenings) {
    const parsed = sanitizeOpening(item, length, wallHeight)
    if (!parsed) continue
    const prev = openings[openings.length - 1]
    if (prev && parsed.at < prev.at + prev.width - 0.01) continue
    openings.push(parsed)
  }
  if (openings.length) wall.openings = openings.sort((a, b) => a.at - b.at)
  return { wall }
}

function sanitizeProp(raw: unknown, w: number, h: number, index: number): SceneProp | null {
  const o = (raw || {}) as Record<string, unknown>
  const x = num(o.x)
  const z = num(o.z)
  const pw = num(o.w)
  const pd = num(o.d)
  const ph = num(o.h)
  if (x == null || z == null || pw == null || pd == null || ph == null) return null
  if (pw <= 0 || pd <= 0 || ph <= 0) return null
  const shape = o.shape === 'cylinder' ? 'cylinder' : 'box'
  const rotation = num(o.rotation) ?? 0
  return {
    id: String(o.id || `p${index + 1}`),
    name: String(o.name || `固定物 ${index + 1}`).slice(0, 30),
    ...(o.designId ? { designId: String(o.designId) } : {}),
    shape,
    x: round(clamp(x, 0, w)),
    z: round(clamp(z, 0, h)),
    w: round(clamp(pw, 0.1, Math.max(0.1, w))),
    d: round(clamp(pd, 0.1, Math.max(0.1, h))),
    h: round(clamp(ph, 0.1, 20)),
    rotation: round(normalizeFace(rotation)),
  }
}

function sanitizeZone(raw: unknown, w: number, h: number, index: number): SceneZone | null {
  const o = (raw || {}) as Record<string, unknown>
  const x = num(o.x)
  const z = num(o.z)
  const zw = num(o.w)
  const zd = num(o.d)
  if (x == null || z == null || zw == null || zd == null || zw <= 0 || zd <= 0) return null
  const left = clamp(x, 0, w)
  const top = clamp(z, 0, h)
  const right = clamp(x + zw, 0, w)
  const bottom = clamp(z + zd, 0, h)
  if (right - left < 0.1 || bottom - top < 0.1) return null
  const kind = o.kind === 'floor' || o.kind === 'blocked' ? o.kind : 'action'
  return {
    id: String(o.id || `z${index + 1}`),
    name: String(o.name || `分区 ${index + 1}`).slice(0, 30),
    kind,
    x: round(left),
    z: round(top),
    w: round(right - left),
    d: round(bottom - top),
    ...(typeof o.color === 'string' ? { color: o.color.slice(0, 24) } : {}),
  }
}

/** 读到损坏数据时尽量保留可用部分，不让一个坏字段拖垮项目 */
export function sanitizeSceneLayout(
  raw: unknown,
  fallback?: { episode?: number; sceneNo?: number; sceneSlug?: string; designId?: string },
): SanitizeResult {
  const o = (raw || {}) as Record<string, unknown>
  const warnings: string[] = []
  const episode = Math.max(1, Math.round(num(o.episode) ?? fallback?.episode ?? 1))
  const sceneNo = Math.max(1, Math.round(num(o.sceneNo ?? o.scene_no) ?? fallback?.sceneNo ?? 1))
  let w = num(o.w)
  let h = num(o.h)
  if (w == null || w < 2 || w > 80) {
    if (w != null) warnings.push('场地宽度无效，已回退 10 米')
    w = DEFAULT_SCENE_W
  }
  if (h == null || h < 2 || h > 80) {
    if (h != null) warnings.push('场地深度无效，已回退 8 米')
    h = DEFAULT_SCENE_H
  }
  const walls: SceneWall[] = []
  for (const [i, item] of (Array.isArray(o.walls) ? o.walls : []).slice(0, SCENE_LIMITS.walls).entries()) {
    const r = sanitizeWall(item, w, h, i)
    if (r.wall) walls.push(r.wall)
    if (r.warning) warnings.push(r.warning)
  }
  const props: SceneProp[] = []
  for (const [i, item] of (Array.isArray(o.props) ? o.props : []).slice(0, SCENE_LIMITS.props).entries()) {
    const p = sanitizeProp(item, w, h, i)
    if (p) props.push(p)
    else warnings.push(`固定物 ${i + 1} 尺寸无效，已忽略`)
  }
  const zones: SceneZone[] = []
  for (const [i, item] of (Array.isArray(o.zones) ? o.zones : []).slice(0, SCENE_LIMITS.zones).entries()) {
    const z = sanitizeZone(item, w, h, i)
    if (z) zones.push(z)
    else warnings.push(`分区 ${i + 1} 尺寸无效，已忽略`)
  }
  let axis: SceneAxis | undefined
  const ao = (o.axis || {}) as Record<string, unknown>
  const aa = (ao.a || {}) as Record<string, unknown>
  const bb = (ao.b || {}) as Record<string, unknown>
  const ax = num(aa.x)
  const az = num(aa.z)
  const bx = num(bb.x)
  const bz = num(bb.z)
  if (ax != null && az != null && bx != null && bz != null) {
    axis = {
      a: { x: round(clamp(ax, 0, w)), z: round(clamp(az, 0, h)) },
      b: { x: round(clamp(bx, 0, w)), z: round(clamp(bz, 0, h)) },
      ...(ao.label ? { label: String(ao.label).slice(0, 30) } : {}),
    }
  }
  const source: SceneLayout['source'] =
    o.source === 'ai' || o.source === 'manual' || o.source === 'legacy' || o.source === 'fallback' ? o.source : 'manual'
  const sceneSlug = String(o.sceneSlug ?? o.scene_slug ?? fallback?.sceneSlug ?? '').trim() || undefined
  const designId = String(o.designId ?? o.design_id ?? fallback?.designId ?? '').trim() || undefined
  return {
    layout: {
      id: String(o.id || sceneLayoutId(episode, sceneNo)),
      episode,
      sceneNo,
      ...(sceneSlug ? { sceneSlug } : {}),
      ...(designId ? { designId } : {}),
      w: round(w),
      h: round(h),
      walls,
      props,
      zones,
      ...(axis ? { axis } : {}),
      source,
      ...(typeof o.updatedAt === 'string' ? { updatedAt: o.updatedAt } : {}),
    },
    warnings,
  }
}

/** 墙按洞口切成可见实体段；门洞只留门楣，窗洞留窗台+门楣 */
export function wallSegments(wall: SceneWall): WallSegment[] {
  const length = Math.hypot(wall.x2 - wall.x1, wall.z2 - wall.z1)
  if (!(length > 0.05)) return []
  const openings = (wall.openings ?? []).slice().sort((a, b) => a.at - b.at)
  const out: WallSegment[] = []
  let cursor = 0
  for (const op of openings) {
    const at = clamp(op.at, 0, length)
    const end = clamp(at + op.width, 0, length)
    if (end <= at + 0.01) continue
    if (at > cursor + 0.01) {
      out.push({ wallId: wall.id, a: cursor, b: at, y0: 0, y1: wall.height, thickness: wall.thickness, height: wall.height })
    }
    const sill = clamp(op.kind === 'window' ? op.sill ?? 0.9 : 0, 0, wall.height)
    const top = clamp(sill + op.height, 0, wall.height)
    if (sill > 0.01) {
      out.push({ wallId: wall.id, a: at, b: end, y0: 0, y1: sill, thickness: wall.thickness, height: wall.height })
    }
    if (top < wall.height - 0.01) {
      out.push({ wallId: wall.id, a: at, b: end, y0: top, y1: wall.height, thickness: wall.thickness, height: wall.height })
    }
    cursor = Math.max(cursor, end)
  }
  if (cursor < length - 0.01) {
    out.push({ wallId: wall.id, a: cursor, b: length, y0: 0, y1: wall.height, thickness: wall.thickness, height: wall.height })
  }
  return out
}

/** 线段在墙上的局部偏移 → 世界坐标 */
export function segmentEndpoints(wall: SceneWall, seg: { a: number; b: number }): {
  x1: number
  z1: number
  x2: number
  z2: number
} {
  const len = Math.hypot(wall.x2 - wall.x1, wall.z2 - wall.z1) || 1
  const ux = (wall.x2 - wall.x1) / len
  const uz = (wall.z2 - wall.z1) / len
  return {
    x1: wall.x1 + ux * seg.a,
    z1: wall.z1 + uz * seg.a,
    x2: wall.x1 + ux * seg.b,
    z2: wall.z1 + uz * seg.b,
  }
}

function pointSegmentDistance(px: number, pz: number, x1: number, z1: number, x2: number, z2: number) {
  const dx = x2 - x1
  const dz = z2 - z1
  const len2 = dx * dx + dz * dz
  if (len2 < EPS) return Math.hypot(px - x1, pz - z1)
  const t = clamp(((px - x1) * dx + (pz - z1) * dz) / len2, 0, 1)
  return Math.hypot(px - (x1 + dx * t), pz - (z1 + dz * t))
}

function segmentsIntersect(
  ax: number, az: number, bx: number, bz: number,
  cx: number, cz: number, dx: number, dz: number,
) {
  const cross = (x1: number, z1: number, x2: number, z2: number, x3: number, z3: number) =>
    (x2 - x1) * (z3 - z1) - (z2 - z1) * (x3 - x1)
  const d1 = cross(ax, az, bx, bz, cx, cz)
  const d2 = cross(ax, az, bx, bz, dx, dz)
  const d3 = cross(cx, cz, dx, dz, ax, az)
  const d4 = cross(cx, cz, dx, dz, bx, bz)
  if (((d1 > 0 && d2 < 0) || (d1 < 0 && d2 > 0)) && ((d3 > 0 && d4 < 0) || (d3 < 0 && d4 > 0))) return true
  return false
}

function propContains(prop: SceneProp, x: number, z: number, pad = 0): boolean {
  const rad = (-prop.rotation * Math.PI) / 180
  const dx = x - prop.x
  const dz = z - prop.z
  const lx = dx * Math.cos(rad) - dz * Math.sin(rad)
  const lz = dx * Math.sin(rad) + dz * Math.cos(rad)
  if (prop.shape === 'cylinder') {
    const r = Math.max(prop.w, prop.d) / 2 + pad
    return lx * lx + lz * lz <= r * r
  }
  return Math.abs(lx) <= prop.w / 2 + pad && Math.abs(lz) <= prop.d / 2 + pad
}

function wallBlocksBody(layout: SceneLayout, x: number, z: number, radius: number, low: number, high: number): boolean {
  for (const wall of layout.walls) {
    for (const seg of wallSegments(wall)) {
      if (seg.y1 <= low || seg.y0 >= high) continue
      const e = segmentEndpoints(wall, seg)
      if (pointSegmentDistance(x, z, e.x1, e.z1, e.x2, e.z2) < radius + wall.thickness / 2) return true
    }
  }
  return false
}

function wallBlocksCamera(layout: SceneLayout, x: number, z: number, height: number): boolean {
  for (const wall of layout.walls) {
    for (const seg of wallSegments(wall)) {
      if (height < seg.y0 || height > seg.y1) continue
      const e = segmentEndpoints(wall, seg)
      if (pointSegmentDistance(x, z, e.x1, e.z1, e.x2, e.z2) < wall.thickness / 2 + 0.06) return true
    }
  }
  return false
}

function propBlocksBody(layout: SceneLayout, x: number, z: number, radius: number): boolean {
  return layout.props.some((p) => p.h > ACTOR_BODY_LOW && propContains(p, x, z, radius))
}

function propBlocksCamera(layout: SceneLayout, x: number, z: number, height: number): boolean {
  return layout.props.some((p) => height > 0 && height < p.h && propContains(p, x, z, 0.06))
}

function actorPoint(actor: BlockingActor, layout: SceneLayout) {
  return { x: clamp(actor.x, 0, 1) * layout.w, z: clamp(actor.y, 0, 1) * layout.h }
}

function cameraPoint(camera: BlockingCamera, layout: SceneLayout) {
  return { x: clamp(camera.x, -0.25, 1.25) * layout.w, z: clamp(camera.y, -0.25, 1.25) * layout.h }
}

function cameraLookPoint(camera: BlockingCamera, layout: SceneLayout) {
  return { x: clamp(camera.lookX, -0.25, 1.25) * layout.w, z: clamp(camera.lookY, -0.25, 1.25) * layout.h }
}

/** 按 0.05 采样两个关键帧之间的路径，避免“端点合法、中间穿墙” */
export function sampleBlockingPath(
  blocking: ShotBlocking,
  layout: SceneLayout,
  step = 0.05,
): { actor: string; t: number; x: number; y: number; face: number }[] {
  const keys = (blocking.keys ?? []).slice().sort((a, b) => a.t - b.t)
  if (keys.length === 0) return []
  const out: { actor: string; t: number; x: number; y: number; face: number }[] = []
  for (let i = 0; i < keys.length - 1; i++) {
    const a = keys[i]
    const b = keys[i + 1]
    const steps = Math.max(1, Math.ceil((b.t - a.t) / step))
    for (let s = 0; s <= steps; s++) {
      if (i > 0 && s === 0) continue
      const t = a.t + ((b.t - a.t) * s) / steps
      const p = interpolateBlocking(blocking, t)
      if (p) out.push(...p.actors.map((ac) => ({ actor: ac.name, t, x: ac.x, y: ac.y, face: ac.face })))
    }
  }
  if (keys.length === 1) {
    const k = keys[0]
    out.push(...k.actors.map((ac) => ({ actor: ac.name, t: k.t, x: ac.x, y: ac.y, face: ac.face })))
  }
  return out
}

export function validateBlocking(blocking: unknown, opts: BlockingValidationOpts): ValidationResult {
  const errors: Issue[] = []
  const warnings: Issue[] = []
  const b = (blocking || {}) as Record<string, unknown>
  const layout = opts.layout
  const roster = [...new Set((opts.roster ?? []).map(String).filter(Boolean))]
  const keys = Array.isArray(b.keys) ? (b.keys as unknown[]) : []
  if (keys.length < 1) {
    errors.push({ code: 'no-keys', message: '走位至少需要 1 个关键帧' })
    return { errors, warnings }
  }
  if (keys.length > SCENE_LIMITS.keys) {
    errors.push({ code: 'too-many-keys', message: `关键帧最多 ${SCENE_LIMITS.keys} 个` })
  }
  const parsed: BlockingKey[] = []
  keys.slice(0, SCENE_LIMITS.keys).forEach((raw, i) => {
    const k = (raw || {}) as Record<string, unknown>
    const t = num(k.t)
    const actorsRaw = Array.isArray(k.actors) ? k.actors : []
    const c = (k.camera || {}) as Record<string, unknown>
    if (t == null) errors.push({ code: 'bad-key-time', message: `关键帧 ${i + 1} 时间无效`, key: `keys.${i}.t` })
    if (t != null) {
      if (i === 0 && Math.abs(t) > 0.002) errors.push({ code: 'key-start', message: '首关键帧时间必须是 0' })
      if (keys.length > 1 && i === keys.length - 1 && Math.abs(t - 1) > 0.002) {
        errors.push({ code: 'key-end', message: '末关键帧时间必须是 1' })
      }
      if (i > 0) {
        const prev = num((keys[i - 1] as Record<string, unknown>)?.t)
        if (prev != null && t <= prev + EPS) errors.push({ code: 'key-order', message: '关键帧时间必须严格递增' })
      }
    }
    const actors: BlockingActor[] = []
    const seen = new Set<string>()
    for (const [ai, rawActor] of actorsRaw.entries()) {
      const a = (rawActor || {}) as Record<string, unknown>
      const name = String(a.name ?? '').trim()
      const x = num(a.x)
      const y = num(a.y)
      const face = num(a.face)
      if (!name) {
        errors.push({ code: 'actor-name', message: `关键帧 ${i + 1} 第 ${ai + 1} 个角色没有名字` })
        continue
      }
      if (seen.has(name)) errors.push({ code: 'actor-dup', message: `角色「${name}」在同一关键帧重复` })
      seen.add(name)
      if (!roster.includes(name)) errors.push({ code: 'actor-unknown', message: `角色「${name}」不在本镜在场名单` })
      if (x == null || y == null || face == null) {
        errors.push({ code: 'actor-finite', message: `角色「${name}」的坐标/朝向无效` })
        continue
      }
      if (x < -0.001 || x > 1.001 || y < -0.001 || y > 1.001) {
        errors.push({ code: 'actor-bounds', message: `角色「${name}」超出场地边界` })
      }
      actors.push({ name, x: clamp(x, 0, 1), y: clamp(y, 0, 1), face: normalizeFace(face) })
    }
    for (const name of roster) {
      if (!seen.has(name)) errors.push({ code: 'actor-missing', message: `关键帧 ${i + 1} 缺少角色「${name}」` })
    }
    const camera: BlockingCamera = {
      x: num(c.x) ?? NaN,
      y: num(c.y) ?? NaN,
      lookX: num(c.lookX) ?? NaN,
      lookY: num(c.lookY) ?? NaN,
      height: num(c.height) ?? NaN,
      fov: num(c.fov) ?? NaN,
    }
    const camNums = [camera.x, camera.y, camera.lookX, camera.lookY, camera.height, camera.fov]
    if (camNums.some((v) => !Number.isFinite(v))) {
      errors.push({ code: 'camera-finite', message: `关键帧 ${i + 1} 机位参数无效` })
    } else {
      if (camera.x < -0.25 || camera.x > 1.25 || camera.y < -0.25 || camera.y > 1.25) {
        errors.push({ code: 'camera-bounds', message: '机位超出允许范围' })
      }
      if (camera.lookX < -0.25 || camera.lookX > 1.25 || camera.lookY < -0.25 || camera.lookY > 1.25) {
        errors.push({ code: 'camera-look-bounds', message: '机位注视点超出允许范围' })
      }
      if (camera.height < 0.5 || camera.height > 8) errors.push({ code: 'camera-height', message: '机位高度需在 0.5~8 米' })
      if (camera.fov < 15 || camera.fov > 110) errors.push({ code: 'camera-fov', message: 'FOV 需在 15~110 度' })
      if (Math.hypot(camera.x - camera.lookX, camera.y - camera.lookY) < 0.02) {
        errors.push({ code: 'camera-look-same', message: '机位与注视点重合' })
      }
    }
    parsed.push({ t: t ?? i / Math.max(1, keys.length - 1), actors, camera })
  })

  // 角色/机位实体碰撞
  for (const [i, key] of parsed.entries()) {
    for (const actor of key.actors) {
      const p = actorPoint(actor, layout)
      if (wallBlocksBody(layout, p.x, p.z, ACTOR_RADIUS, ACTOR_BODY_LOW, ACTOR_BODY_HIGH)) {
        errors.push({ code: 'actor-wall', message: `关键帧 ${i + 1}：${actor.name} 站在墙体实体里`, key: actor.name })
      }
      if (propBlocksBody(layout, p.x, p.z, ACTOR_RADIUS)) {
        errors.push({ code: 'actor-prop', message: `关键帧 ${i + 1}：${actor.name} 与固定物重叠`, key: actor.name })
      }
    }
    if (Number.isFinite(key.camera.x) && Number.isFinite(key.camera.height)) {
      const cp = cameraPoint(key.camera, layout)
      if (wallBlocksCamera(layout, cp.x, cp.z, key.camera.height)) {
        errors.push({ code: 'camera-wall', message: `关键帧 ${i + 1}：机位在墙体实体里`, key: 'camera' })
      }
      if (propBlocksCamera(layout, cp.x, cp.z, key.camera.height)) {
        errors.push({ code: 'camera-prop', message: `关键帧 ${i + 1}：机位与固定物重叠`, key: 'camera' })
      }
    }
  }

  // 插值路径碰撞
  if (parsed.length > 1) {
    const full: ShotBlocking = { keys: parsed, source: 'ai' }
    const samples = sampleBlockingPath(full, layout, 0.05)
    for (const s of samples) {
      const x = s.x * layout.w
      const z = s.y * layout.h
      if (wallBlocksBody(layout, x, z, ACTOR_RADIUS, ACTOR_BODY_LOW, ACTOR_BODY_HIGH)) {
        errors.push({ code: 'actor-path-wall', message: `${s.actor} 的走位路径在 ${(s.t * 100).toFixed(0)}% 处穿过墙体`, key: s.actor })
        break
      }
      if (propBlocksBody(layout, x, z, ACTOR_RADIUS)) {
        errors.push({ code: 'actor-path-prop', message: `${s.actor} 的走位路径在 ${(s.t * 100).toFixed(0)}% 处穿过固定物`, key: s.actor })
        break
      }
    }
    // 机位路径同样检查
    for (let t = 0; t <= 1.0001; t += 0.05) {
      const p = interpolateBlocking(full, t)
      if (!p) continue
      const cp = cameraPoint(p.camera, layout)
      if (wallBlocksCamera(layout, cp.x, cp.z, p.camera.height)) {
        errors.push({ code: 'camera-path-wall', message: `机位路径在 ${(t * 100).toFixed(0)}% 处穿过墙体`, key: 'camera' })
        break
      }
    }
  }

  // 角色互相挤在一起：只提示，不阻止
  for (const [i, key] of parsed.entries()) {
    for (let a = 0; a < key.actors.length; a++) {
      for (let b = a + 1; b < key.actors.length; b++) {
        const pa = actorPoint(key.actors[a], layout)
        const pb = actorPoint(key.actors[b], layout)
        if (Math.hypot(pa.x - pb.x, pa.z - pb.z) < 0.45) {
          warnings.push({
            code: 'actor-overlap',
            message: `关键帧 ${i + 1}：${key.actors[a].name} 与 ${key.actors[b].name} 距离过近`,
          })
        }
      }
    }
  }

  // 视线遮挡 & 主体出画：帮助发现“合法但拍不到”的走位
  const aspect = aspectValue(opts.aspect)
  for (const [i, key] of parsed.entries()) {
    if (!Number.isFinite(key.camera.fov) || !Number.isFinite(key.camera.height)) continue
    const cp = cameraPoint(key.camera, layout)
    const lp = cameraLookPoint(key.camera, layout)
    const fwd = { x: lp.x - cp.x, z: lp.z - cp.z }
    const fwdLen = Math.hypot(fwd.x, fwd.z) || 1
    const halfH = (Math.atan(Math.tan((key.camera.fov * Math.PI) / 360) * aspect) * 180) / Math.PI
    for (const actor of key.actors) {
      const ap = actorPoint(actor, layout)
      const v = { x: ap.x - cp.x, z: ap.z - cp.z }
      const len = Math.hypot(v.x, v.z)
      if (len < 0.2) continue
      const cos = clamp((fwd.x * v.x + fwd.z * v.z) / (fwdLen * len), -1, 1)
      const angle = (Math.acos(cos) * 180) / Math.PI
      if (angle > halfH + 10) {
        warnings.push({
          code: 'actor-outside-frame',
          message: `关键帧 ${i + 1}：${actor.name} 可能在画面外（偏离 ${angle.toFixed(0)}°）`,
        })
      }
      // 视线穿墙：只看高度覆盖 1.2 米的墙段
      for (const wall of layout.walls) {
        for (const seg of wallSegments(wall)) {
          if (seg.y0 > 1.2 || seg.y1 < 1.2) continue
          const e = segmentEndpoints(wall, seg)
          if (segmentsIntersect(cp.x, cp.z, ap.x, ap.z, e.x1, e.z1, e.x2, e.z2)) {
            warnings.push({
              code: 'sight-blocked',
              message: `关键帧 ${i + 1}：机位到 ${actor.name} 的视线被墙体遮挡`,
            })
            break
          }
        }
      }
    }
  }

  return { errors, warnings }
}

function lerp(a: number, b: number, t: number) {
  return a + (b - a) * t
}
function smoothstep(t: number) {
  const x = clamp(t, 0, 1)
  return x * x * (3 - 2 * x)
}

export function interpolateBlocking(blocking: ShotBlocking | undefined, t: number): BlockingKey | null {
  const keys = (blocking?.keys ?? []).slice().sort((a, b) => a.t - b.t)
  if (!keys.length) return null
  const p = clamp(Number(t) || 0, 0, 1)
  if (keys.length === 1 || p <= keys[0].t) return structuredClone(keys[0])
  if (p >= keys[keys.length - 1].t) return structuredClone(keys[keys.length - 1])
  let i = 0
  while (i < keys.length - 1 && keys[i + 1].t < p) i++
  const a = keys[i]
  const b = keys[i + 1]
  const u = smoothstep((p - a.t) / Math.max(EPS, b.t - a.t))
  const byName = new Map(b.actors.map((x) => [x.name, x]))
  const actors = a.actors.map((aa) => {
    const bb = byName.get(aa.name) ?? aa
    return {
      name: aa.name,
      x: lerp(aa.x, bb.x, u),
      y: lerp(aa.y, bb.y, u),
      face: normalizeFace(aa.face + angleDelta(aa.face, bb.face) * u),
    }
  })
  return {
    t: p,
    actors,
    camera: {
      x: lerp(a.camera.x, b.camera.x, u),
      y: lerp(a.camera.y, b.camera.y, u),
      lookX: lerp(a.camera.lookX, b.camera.lookX, u),
      lookY: lerp(a.camera.lookY, b.camera.lookY, u),
      height: lerp(a.camera.height, b.camera.height, u),
      fov: lerp(a.camera.fov, b.camera.fov, u),
    },
  }
}

export function legacyLayoutToBlocking(layout: ShotLayout | undefined): ShotBlocking | undefined {
  if (!layout?.camera) return undefined
  return {
    keys: [
      {
        t: 0,
        actors: (layout.actors ?? []).map((a) => ({
          name: String(a.name || ''),
          x: Number.isFinite(a.x) ? a.x : 0.5,
          y: Number.isFinite(a.y) ? a.y : 0.5,
          face: Number.isFinite(a.face) ? a.face : 0,
        })),
        camera: {
          x: Number.isFinite(layout.camera.x) ? layout.camera.x : 0.5,
          y: Number.isFinite(layout.camera.y) ? layout.camera.y : 0.9,
          lookX: Number.isFinite(layout.camera.lookX) ? layout.camera.lookX : 0.5,
          lookY: Number.isFinite(layout.camera.lookY) ? layout.camera.lookY : 0.5,
          height: 1.6,
          fov: 45,
        },
      },
    ],
    source: 'legacy',
  }
}

export function fallbackBlocking(roster: string[], layout: SceneLayout): ShotBlocking {
  const names = [...new Set((roster ?? []).filter(Boolean))].slice(0, 8)
  const gap = names.length > 1 ? 0.46 / (names.length - 1) : 0
  return {
    keys: [
      {
        t: 0,
        actors: names.map((name, i) => ({
          name,
          x: names.length === 1 ? 0.5 : 0.27 + gap * i,
          y: 0.5,
          face: i % 2 === 0 ? 0 : 180,
        })),
        camera: {
          x: 0.5,
          y: 0.92,
          lookX: 0.5,
          lookY: 0.5,
          height: 1.6,
          fov: 45,
        },
      },
    ],
    source: 'fallback',
    notes: `兜底走位：${layout.sceneSlug || layout.id}`,
  }
}

/** 场景最多 4 人：超过的按出现顺序截断，避免录制时挤成一团 */
export function rosterOf(cast: unknown, dialogue: unknown): string[] {
  const out: string[] = []
  const add = (name: unknown) => {
    const n = String(name ?? '').trim()
    if (n && !out.includes(n)) out.push(n)
  }
  if (Array.isArray(cast)) for (const c of cast) add(c)
  const lines = Array.isArray(dialogue)
    ? dialogue
    : String(dialogue || '')
        .split('\n')
        .map((s) => s.trim())
        .filter(Boolean)
  for (const line of lines) {
    if (typeof line === 'string') {
      const m = line.match(/^([^：:]{1,20})[：:]\s*(.+)$/)
      if (m) add(m[1])
    } else if (line && typeof line === 'object') {
      const speaker = (line as { speaker?: unknown }).speaker
      const text = (line as { text?: unknown }).text
      if (speaker && String(text ?? '').trim()) add(speaker)
    }
  }
  return out.slice(0, 8)
}

export function actorPathDistance(layout: SceneLayout, blocking: ShotBlocking, name: string): number {
  const keys = (blocking.keys ?? []).slice().sort((a, b) => a.t - b.t)
  const a0 = keys[0]?.actors.find((a) => a.name === name)
  const a1 = keys[keys.length - 1]?.actors.find((a) => a.name === name)
  if (!a0 || !a1) return 0
  return Math.hypot((a1.x - a0.x) * layout.w, (a1.y - a0.y) * layout.h)
}

export function cameraPathDistance(layout: SceneLayout, blocking: ShotBlocking): number {
  const keys = (blocking.keys ?? []).slice().sort((a, b) => a.t - b.t)
  const c0 = keys[0]?.camera
  const c1 = keys[keys.length - 1]?.camera
  if (!c0 || !c1) return 0
  return Math.hypot((c1.x - c0.x) * layout.w, (c1.y - c0.y) * layout.h)
}

function dirFromAngle(face: number) {
  const r = (normalizeFace(face) * Math.PI) / 180
  return { x: Math.cos(r), z: Math.sin(r) }
}

export function motionNoteOf(
  layout: SceneLayout,
  blocking: ShotBlocking | undefined,
  duration: number,
  move?: string,
): string {
  const keys = (blocking?.keys ?? []).slice().sort((a, b) => a.t - b.t)
  if (!keys.length) return ''
  const first = keys[0]
  const last = keys[keys.length - 1]
  const c0 = cameraPoint(first.camera, layout)
  const c1 = cameraPoint(last.camera, layout)
  const l0 = cameraLookPoint(first.camera, layout)
  const l1 = cameraLookPoint(last.camera, layout)
  const camDist = Math.hypot(c1.x - c0.x, c1.z - c0.z)
  const heightDelta = last.camera.height - first.camera.height
  const look0 = { x: l0.x - c0.x, z: l0.z - c0.z }
  const look1 = { x: l1.x - c1.x, z: l1.z - c1.z }
  const ang0 = Math.atan2(look0.z, look0.x) * (180 / Math.PI)
  const ang1 = Math.atan2(look1.z, look1.x) * (180 / Math.PI)
  const pan = angleDelta(ang0, ang1)
  const parts: string[] = []

  if (camDist > 0.15) {
    const b0 = bearingOf(c0.x - layout.w / 2, c0.z - layout.h / 2)
    const b1 = bearingOf(c1.x - layout.w / 2, c1.z - layout.h / 2)
    parts.push(
      b0 === b1
        ? `机位向场地${b1}侧移动约 ${camDist.toFixed(1)} 米`
        : `机位从场地${b0}侧向${b1}侧移动约 ${camDist.toFixed(1)} 米`,
    )
  } else {
    const bc = bearingOf(c0.x - layout.w / 2, c0.z - layout.h / 2)
    parts.push(`机位固定在场地${bc}侧、高 ${first.camera.height.toFixed(1)} 米`)
  }
  if (Math.abs(heightDelta) > 0.08) {
    parts.push(`机位${heightDelta > 0 ? '升高' : '降低'}约 ${Math.abs(heightDelta).toFixed(1)} 米`)
  }
  if (Math.abs(pan) > 2) {
    parts.push(`镜头向${pan > 0 ? '顺时针' : '逆时针'}摇约 ${Math.abs(pan).toFixed(0)}°`)
  }
  for (const name of first.actors.map((a) => a.name)) {
    const a0 = first.actors.find((a) => a.name === name)!
    const a1 = last.actors.find((a) => a.name === name) ?? a0
    const d = Math.hypot((a1.x - a0.x) * layout.w, (a1.y - a0.y) * layout.h)
    if (d > 0.15) {
      const p0 = actorPoint(a0, layout)
      const p1 = actorPoint(a1, layout)
      const b0 = bearingOf(p0.x - layout.w / 2, p0.z - layout.h / 2)
      const b1 = bearingOf(p1.x - layout.w / 2, p1.z - layout.h / 2)
      parts.push(
        b0 === b1
          ? `${name}向场地${b1}侧移动约 ${d.toFixed(1)} 米`
          : `${name}从场地${b0}侧走到${b1}侧，约 ${d.toFixed(1)} 米`,
      )
    } else if (Math.abs(angleDelta(a0.face, a1.face)) > 5) {
      const dir = dirFromAngle(a1.face)
      parts.push(`${name}转向${bearingOf(dir.x, dir.z)}方向`)
    }
  }
  if (move === '手持') parts.push('手持呼吸抖动')
  parts.push(`全程约 ${Number(duration).toFixed(1)} 秒`)
  return parts.join('；')
}

function roundCanonical(v: unknown): unknown {
  if (typeof v === 'number') {
    if (!Number.isFinite(v)) return null
    return round(v, 6)
  }
  if (Array.isArray(v)) return v.map(roundCanonical)
  if (v && typeof v === 'object') {
    const out: Record<string, unknown> = {}
    for (const k of Object.keys(v as Record<string, unknown>).sort()) {
      const val = (v as Record<string, unknown>)[k]
      if (val === undefined) continue
      out[k] = roundCanonical(val)
    }
    return out
  }
  return v
}

export function canonicalJson(value: unknown): string {
  return JSON.stringify(roundCanonical(value))
}

function fnv1a(str: string, seed: number): number {
  let h = seed >>> 0
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i)
    h = Math.imul(h, 0x01000193) >>> 0
  }
  return h >>> 0
}

export function shortHash(str: string): string {
  return fnv1a(str, 0x811c9dc5).toString(16).padStart(8, '0') + fnv1a(str, 0x9e3779b9).toString(16).padStart(8, '0')
}

export function scheduleFingerprint(input: FingerprintInput): string {
  const l = input.layout
  const payload = {
    renderer: 1,
    duration: round(input.duration, 3),
    aspect: input.aspect,
    mode: input.mode,
    layout: {
      id: l.id,
      episode: l.episode,
      sceneNo: l.sceneNo,
      sceneSlug: l.sceneSlug ?? '',
      designId: l.designId ?? '',
      w: l.w,
      h: l.h,
      walls: l.walls,
      props: l.props,
      zones: l.zones,
      axis: l.axis ?? null,
    },
    blocking: (input.blocking.keys ?? []).map((k) => ({
      t: k.t,
      actors: k.actors.map((a) => ({ name: a.name, x: a.x, y: a.y, face: normalizeFace(a.face) })),
      camera: k.camera,
    })),
  }
  return shortHash(canonicalJson(payload))
}

export function isScheduleFresh(meta: ScheduleMeta | undefined, input: FingerprintInput): boolean {
  if (!meta || meta.version !== 1 || meta.mode !== 'clean') return false
  return meta.fingerprint === scheduleFingerprint(input)
}

/**
 * 渲染尺寸：长边 960，短边按画幅取偶数；保证两个维度都是偶数（H.264）。
 */
export function renderSize(aspect: string): { width: number; height: number } {
  const a = aspectValue(aspect)
  const long = 960
  let w: number
  let h: number
  if (a >= 1) {
    w = long
    h = Math.round(long / a / 2) * 2
  } else {
    h = long
    w = Math.round(long * a / 2) * 2
  }
  return { width: Math.max(2, w), height: Math.max(2, h) }
}

/** 编辑器/渲染共用：把关键帧的机位转成 Three.js 需要的米制参数 */
export function cameraMeters(layout: SceneLayout, key: BlockingKey) {
  return {
    x: clamp(key.camera.x, -0.25, 1.25) * layout.w,
    z: clamp(key.camera.y, -0.25, 1.25) * layout.h,
    lookX: clamp(key.camera.lookX, -0.25, 1.25) * layout.w,
    lookZ: clamp(key.camera.lookY, -0.25, 1.25) * layout.h,
    height: key.camera.height,
    fov: key.camera.fov,
  }
}

/** 角色在某一时刻的米制位置/朝向 */
export function actorMeters(layout: SceneLayout, actor: BlockingActor) {
  return {
    x: clamp(actor.x, 0, 1) * layout.w,
    z: clamp(actor.y, 0, 1) * layout.h,
    face: normalizeFace(actor.face),
  }
}

export function markBounds(marks: Mark[]): { x: number; y: number; w: number; h: number } | null {
  let minX = Infinity
  let minY = Infinity
  let maxX = -Infinity
  let maxY = -Infinity
  for (const m of marks ?? []) {
    if (m.kind === 'pen' && m.points?.length) {
      for (let i = 0; i + 1 < m.points.length; i += 2) {
        const x = m.points[i]
        const y = m.points[i + 1]
        if (!Number.isFinite(x) || !Number.isFinite(y)) continue
        minX = Math.min(minX, x)
        maxX = Math.max(maxX, x)
        minY = Math.min(minY, y)
        maxY = Math.max(maxY, y)
      }
    } else if (m.kind === 'rect') {
      const x = Number(m.x ?? 0)
      const y = Number(m.y ?? 0)
      const w = Number(m.w ?? 0)
      const h = Number(m.h ?? 0)
      if (![x, y, w, h].every(Number.isFinite)) continue
      minX = Math.min(minX, x)
      minY = Math.min(minY, y)
      maxX = Math.max(maxX, x + w)
      maxY = Math.max(maxY, y + h)
    }
  }
  if (!Number.isFinite(minX)) return null
  return { x: minX, y: minY, w: maxX - minX, h: maxY - minY }
}
