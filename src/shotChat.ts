import type { BlockingCamera, SceneLayout, SceneProp, SceneWall, SceneWallOpening, ShotBlocking, ShotScene } from './types'
import { sanitizeSceneLayout, validateBlocking } from './scheduleGeometry'

/**
 * 聊天改 3D 的受限操作集。
 * 模型只能返回这些 op；客户端按顺序原子应用，最后统一校验。自由 JSON 不直接覆盖场景。
 */
export type Shot3DPatchOp =
  | { op: 'set_camera'; key: number; x?: number; y?: number; lookX?: number; lookY?: number; height?: number; fov?: number }
  | { op: 'move_actor'; key: number; name: string; x?: number; y?: number; face?: number }
  | { op: 'move_wall'; id: string; x1?: number; z1?: number; x2?: number; z2?: number; height?: number; thickness?: number }
  | { op: 'add_wall'; wall: Partial<SceneWall> }
  | { op: 'remove_wall'; id: string }
  | { op: 'set_opening'; wallId: string; index?: number; opening: Partial<SceneWallOpening> }
  | { op: 'remove_opening'; wallId: string; index: number }
  | { op: 'add_prop'; prop: Partial<SceneProp> }
  | { op: 'move_prop'; id: string; x?: number; z?: number; rotation?: number; w?: number; d?: number; h?: number }
  | { op: 'remove_prop'; id: string }
  | { op: 'set_floor'; w?: number; h?: number }
  | { op: 'copy_previous_scene' }
  | { op: 'regenerate_scene' }
  | { op: 'regenerate_blocking' }

export type Shot3DChatResult = { reply: string; ops: Shot3DPatchOp[] }

export const SHOT3D_CHAT_SYSTEM = `你是 3D 调度的聊天编辑助手。用户会用自然语言修改当前镜头的 ShotScene 或 ShotBlocking。
只输出 JSON：{"reply":"给用户的一句话","ops":[...]}。
只能使用以下 ops，不能输出自由场景 JSON：
set_camera / move_actor / move_wall / add_wall / remove_wall / set_opening / remove_opening /
add_prop / move_prop / remove_prop / set_floor / copy_previous_scene / regenerate_scene / regenerate_blocking。
规则：
- 只改当前镜头；不能提及其他镜头。
- 角色名必须来自当前在场名单。
- 坐标/尺寸必须有限且合理。
- 只改用户要求的部分，不要顺手重写整个空间。
- 无法完成时返回空 ops 并说明原因。`

const finite = (v: unknown): number | null => (Number.isFinite(Number(v)) ? Number(v) : null)
const clamp = (n: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, n))
const clone = <T,>(v: T): T => structuredClone(v)
const sameCamera = (c: BlockingCamera) => {
  for (const v of [c.x, c.y, c.lookX, c.lookY, c.height, c.fov]) if (!Number.isFinite(v)) return false
  return true
}

export function parseShot3DChatResult(raw: unknown): Shot3DChatResult {
  const o = raw && typeof raw === 'object' ? (raw as Record<string, unknown>) : {}
  const ops = Array.isArray(o.ops) ? (o.ops.filter((x) => x && typeof x === 'object') as Shot3DPatchOp[]) : []
  return { reply: String(o.reply || '').slice(0, 500), ops: ops.slice(0, 12) }
}

type ApplyInput = {
  scene: ShotScene
  blocking: ShotBlocking
  roster: string[]
  aspect?: string
  duration?: number
  selectedKey?: number
  previousScene?: ShotScene
}

export type ApplyResult = {
  scene: ShotScene
  blocking: ShotBlocking
  errors: string[]
  needsRegenerate?: 'scene' | 'blocking'
}

/** 原子应用：任意一步不合法都返回原对象，不部分写入 */
export function applyShot3DPatch(input: ApplyInput, ops: Shot3DPatchOp[]): ApplyResult {
  let scene = clone(input.scene)
  let blocking = clone(input.blocking)
  let needsRegenerate: 'scene' | 'blocking' | undefined
  let keyIndex = clamp(Number(input.selectedKey) || 0, 0, Math.max(0, blocking.keys.length - 1))

  const fail = (message: string): ApplyResult => ({
    scene: input.scene,
    blocking: input.blocking,
    errors: [message],
  })
  const camera = (idx = keyIndex) => blocking.keys[idx]?.camera
  const findWall = (id: string) => scene.walls.find((w) => w.id === id)
  const newId = (prefix: string, used: Set<string>) => {
    let i = 1
    while (used.has(`${prefix}${i}`)) i++
    const id = `${prefix}${i}`
    used.add(id)
    return id
  }

  for (const op of ops) {
    if (!op || typeof op !== 'object' || typeof (op as { op?: unknown }).op !== 'string') {
      return fail('patch 里有无法识别的操作')
    }
    if (op.op === 'regenerate_scene' || op.op === 'regenerate_blocking') {
      needsRegenerate = op.op === 'regenerate_scene' ? 'scene' : 'blocking'
      continue
    }
    if (op.op === 'set_camera') {
      const idx = clamp(Number(op.key) || 0, 0, blocking.keys.length - 1)
      const c = camera(idx)
      if (!c) return fail('关键帧不存在')
      const next = { ...c }
      for (const k of ['x', 'y', 'lookX', 'lookY', 'height', 'fov'] as const) {
        if (op[k] !== undefined) {
          const v = finite(op[k])
          if (v == null) return fail(`机位 ${k} 不是数字`)
          next[k] = v
        }
      }
      if (!sameCamera(next)) return fail('机位参数无效')
      blocking.keys[idx] = { ...blocking.keys[idx], camera: next }
      continue
    }
    if (op.op === 'move_actor') {
      const idx = clamp(Number(op.key) || 0, 0, blocking.keys.length - 1)
      const name = String(op.name || '').trim()
      if (!input.roster.includes(name)) return fail(`角色「${name}」不在本镜在场名单`)
      const actor = blocking.keys[idx]?.actors.find((a) => a.name === name)
      if (!actor) return fail(`关键帧 ${idx + 1} 没有角色「${name}」`)
      const next = { ...actor }
      for (const k of ['x', 'y', 'face'] as const) {
        if (op[k] !== undefined) {
          const v = finite(op[k])
          if (v == null) return fail(`角色 ${k} 不是数字`)
          next[k] = v
        }
      }
      if (next.x < 0 || next.x > 1 || next.y < 0 || next.y > 1) return fail('角色位置超出场地')
      blocking.keys[idx] = {
        ...blocking.keys[idx],
        actors: blocking.keys[idx].actors.map((a) => (a.name === name ? next : a)),
      }
      continue
    }
    if (op.op === 'move_wall') {
      const wall = findWall(String(op.id))
      if (!wall) return fail(`墙「${op.id}」不存在`)
      const next = { ...wall }
      for (const k of ['x1', 'z1', 'x2', 'z2', 'height', 'thickness'] as const) {
        if (op[k] !== undefined) {
          const v = finite(op[k])
          if (v == null) return fail(`墙 ${k} 不是数字`)
          ;(next as any)[k] = v
        }
      }
      if (Math.hypot(next.x2 - next.x1, next.z2 - next.z1) < 0.1) return fail('墙长至少 0.1 米')
      scene.walls = scene.walls.map((w) => (w.id === wall.id ? next : w))
      continue
    }
    if (op.op === 'add_wall') {
      const p = op.wall || {}
      if ([p.x1, p.z1, p.x2, p.z2, p.height, p.thickness].some((v) => finite(v) == null)) {
        return fail('新增墙缺少有效坐标/尺寸')
      }
      const wall: SceneWall = {
        id: String(p.id || ''),
        x1: Number(p.x1),
        z1: Number(p.z1),
        x2: Number(p.x2),
        z2: Number(p.z2),
        height: Number(p.height),
        thickness: Number(p.thickness),
        ...(Array.isArray(p.openings) ? { openings: p.openings } : {}),
      }
      if (Math.hypot(wall.x2 - wall.x1, wall.z2 - wall.z1) < 0.1) return fail('新增墙太短')
      const used = new Set(scene.walls.map((w) => w.id))
      wall.id = wall.id || newId('w', used)
      scene.walls = [...scene.walls, wall]
      continue
    }
    if (op.op === 'remove_wall') {
      if (!findWall(String(op.id))) return fail(`墙「${op.id}」不存在`)
      scene.walls = scene.walls.filter((w) => w.id !== op.id)
      continue
    }
    if (op.op === 'set_opening' || op.op === 'remove_opening') {
      const wall = findWall(String(op.wallId))
      if (!wall) return fail(`墙「${op.wallId}」不存在`)
      const openings = [...(wall.openings ?? [])]
      if (op.op === 'remove_opening') {
        const idx = Number(op.index)
        if (!Number.isInteger(idx) || idx < 0 || idx >= openings.length) return fail('洞口不存在')
        openings.splice(idx, 1)
      } else {
        const o = op.opening || {}
        if (finite(o.at) == null || finite(o.width) == null || finite(o.height) == null) {
          return fail('洞口缺少位置/尺寸')
        }
        const opening: SceneWallOpening = {
          at: Number(o.at),
          width: Number(o.width),
          height: Number(o.height),
          kind: o.kind === 'window' ? 'window' : 'door',
          ...(o.kind === 'window' && finite(o.sill) != null ? { sill: Number(o.sill) } : {}),
        }
        if (opening.width <= 0.1 || opening.height <= 0.1) return fail('洞口尺寸太小')
        const idx = op.index == null ? openings.length : Number(op.index)
        if (!Number.isInteger(idx) || idx < 0 || idx > openings.length) return fail('洞口索引无效')
        openings.splice(idx, 0, opening)
      }
      scene.walls = scene.walls.map((w) => (w.id === wall.id ? { ...w, openings } : w))
      continue
    }
    if (op.op === 'add_prop') {
      const p = op.prop || {}
      if (finite(p.x) == null || finite(p.z) == null || finite(p.w) == null || finite(p.d) == null || finite(p.h) == null) {
        return fail('新增固定物缺少坐标/尺寸')
      }
      const prop: SceneProp = {
        id: String(p.id || ''),
        name: String(p.name || '固定物').slice(0, 30),
        shape: p.shape === 'cylinder' ? 'cylinder' : 'box',
        x: Number(p.x),
        z: Number(p.z),
        w: Number(p.w),
        d: Number(p.d),
        h: Number(p.h),
        rotation: Number(p.rotation) || 0,
      } as SceneProp
      const used = new Set(scene.props.map((x) => x.id))
      prop.id = prop.id || newId('p', used)
      if (prop.w <= 0.05 || prop.d <= 0.05 || prop.h <= 0.05) return fail('固定物尺寸太小')
      scene.props = [...scene.props, prop]
      continue
    }
    if (op.op === 'move_prop' || op.op === 'remove_prop') {
      const prop = scene.props.find((p) => p.id === String(op.id))
      if (!prop) return fail(`固定物「${op.id}」不存在`)
      if (op.op === 'remove_prop') {
        scene.props = scene.props.filter((p) => p.id !== op.id)
        continue
      }
      const next = { ...prop }
      for (const k of ['x', 'z', 'rotation', 'w', 'd', 'h'] as const) {
        if (op[k] !== undefined) {
          const v = finite(op[k])
          if (v == null) return fail(`固定物 ${k} 不是数字`)
          ;(next as any)[k] = v
        }
      }
      if (next.w <= 0.05 || next.d <= 0.05 || next.h <= 0.05) return fail('固定物尺寸太小')
      scene.props = scene.props.map((p) => (p.id === prop.id ? next : p))
      continue
    }
    if (op.op === 'set_floor') {
      if (op.w !== undefined) {
        const w = finite(op.w)
        if (w == null || w < 2 || w > 80) return fail('场地宽需在 2~80 米')
        scene.w = w
      }
      if (op.h !== undefined) {
        const h = finite(op.h)
        if (h == null || h < 2 || h > 80) return fail('场地深需在 2~80 米')
        scene.h = h
      }
      continue
    }
    if (op.op === 'copy_previous_scene') {
      if (!input.previousScene) return fail('没有可继承的上一镜空间')
      scene = clone(input.previousScene)
      scene.id = input.scene.id
      scene.episode = input.scene.episode
      scene.sceneNo = input.scene.sceneNo
      scene.seedFrom = input.previousScene.id
      continue
    }
    return fail(`不支持的操作：${(op as { op: string }).op}`)
  }

  const clean = sanitizeSceneLayout(scene, {
    episode: scene.episode,
    sceneNo: scene.sceneNo,
    sceneSlug: scene.sceneSlug,
    designId: scene.designId,
  })
  if (clean.warnings.length) return fail(clean.warnings[0])
  const validation = validateBlocking(blocking, {
    layout: clean.layout,
    roster: input.roster,
    aspect: input.aspect,
    duration: input.duration,
  })
  if (validation.errors.length) return fail(validation.errors[0].message)
  return { scene: clean.layout, blocking, errors: [], ...(needsRegenerate ? { needsRegenerate } : {}) }
}
