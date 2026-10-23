import type { SceneLayout, ShotBlocking, VisualBrief } from './types'
import { effectiveSeconds } from './types'
import {
  fallbackSceneLayout,
  sanitizeSceneLayout,
  validateBlocking,
  type Issue,
} from './scheduleGeometry'
import { buildBlockingContext, buildSceneContext, type BlockingContextInput, type SceneContextInput } from './scheduleContext'
import { visualBriefText } from './visualBrief'

/**
 * 3D 调度生成编排。`ask` 由调用方注入（编辑器/快速出片传 callText），
 * 这样纯函数测试可以完整覆盖解析、修复和取消，不依赖网络。
 */
export type AskOpts = {
  system: string
  prompt: string
  json: true
  maxTokens: number
  signal?: AbortSignal
}
export type AskResult = { json?: unknown; text?: string; modelLabel?: string }
export type Ask = (opts: AskOpts) => Promise<AskResult>

export type SceneGenerateInput = {
  context: SceneContextInput
  existing?: SceneLayout
  ask: Ask
  signal?: AbortSignal
}
export type BlockingGenerateInput = {
  context: BlockingContextInput
  roster: string[]
  ask: Ask
  signal?: AbortSignal
}
export type GenerateResult<T> = { value: T; warnings: string[] }
export class ScheduleAIError extends Error {
  issues: Issue[]
  constructor(message: string, issues: Issue[] = []) {
    super(message)
    this.name = 'ScheduleAIError'
    this.issues = issues
  }
}

const abortError = () => {
  if (typeof DOMException !== 'undefined') return new DOMException('已取消', 'AbortError')
  const e = new Error('已取消')
  e.name = 'AbortError'
  return e
}
const checkAbort = (signal?: AbortSignal) => {
  if (signal?.aborted) throw abortError()
}

const asObject = (v: unknown): Record<string, unknown> | null =>
  v && typeof v === 'object' && !Array.isArray(v) ? (v as Record<string, unknown>) : null

const parseJson = (r: AskResult): unknown => {
  if (r.json !== undefined) return r.json
  const t = String(r.text || '').trim()
  if (!t) return null
  const fenced = t.match(/```(?:json)?\s*([\s\S]*?)```/i)
  const body = fenced ? fenced[1] : t
  try {
    return JSON.parse(body)
  } catch {
    const a = body.indexOf('{')
    const b = body.lastIndexOf('}')
    if (a >= 0 && b > a) {
      try {
        return JSON.parse(body.slice(a, b + 1))
      } catch {
        return null
      }
    }
    return null
  }
}

const unwrap = (raw: unknown, keys: string[]): unknown => {
  const o = asObject(raw)
  if (!o) return raw
  for (const k of keys) {
    if (o[k] !== undefined) return o[k]
  }
  return raw
}

export const SCENE_SYSTEM = `你是电影预演的空间指导。根据场次剧本、同场镜头和场景设定，输出可直接用于 3D 白模的俯视场景布局。
只输出 JSON，不要解释。

硬约束：
1. w/h 是场地米制尺寸（3~40 米）；坐标原点在场地左上角，x 向右、z 向下。
2. 墙是线段：x1/z1/x2/z2、height、thickness；门窗是 openings，at 是沿墙起点偏移，width/height 是洞口尺寸，window 还要 sill（窗台高）。
3. 固定物只放剧情/走位需要的物体，shape 只能是 box 或 cylinder；不要放背景杂物。
4. zones 是功能分区（action/floor/blocked），用半透明区域帮助理解，不是家具。
5. 空间必须给人物留出可走动的区域：不要把门洞、表演区堵死；机位通常放在场地一端或场外。
6. 只依据文字信息；不要假装看过场景图。风格、材质、贴图不在你的任务里。`

export const BLOCKING_SYSTEM = `你是场记兼分镜调度师。根据一个镜头的画面、台词、运镜、秒数和场景布局，输出 3D 白模的走位与机位关键帧。
只输出 JSON，不要解释。

硬约束：
1. 只能使用给定的在场角色名，不能新增、改名或漏人；旁白/画外音不算出场。
2. keys 为 1~3 个，t 从 0 到 1 严格递增；首帧 t=0，末帧 t=1（只有一帧时 t=0）。
3. 每个关键帧的 actors 必须包含同一套角色；x/y 归一化 0~1，face 角度 0=+x、90=+z。
4. camera 记录画内机位（不是观众视角）：x/y/lookX/lookY 归一化，height 米，fov 垂直视场角度。
5. 用关键帧表达运镜：推/拉改变机位到主体的距离，摇改变注视点，移/跟改变机位位置，升降改变 height。固定机位只需一帧。
6. 说话人面向听者；机位要保留对话关系与轴线，不要把主体放到画外。
7. 不能把人或机位放进墙体/固定物实体；路径中间也不能穿墙。`
export const SCENE_OUTPUT = `输出 JSON：
{"w":10,"h":8,
 "walls":[{"x1":0,"z1":0,"x2":10,"z2":0,"height":2.8,"thickness":0.18,
           "openings":[{"at":6.2,"width":1.0,"height":2.1,"kind":"door"}]}],
 "props":[{"name":"金属货架","shape":"box","x":2,"z":3,"w":1.4,"d":0.5,"h":2,"rotation":0}],
 "zones":[{"name":"表演区","kind":"action","x":3,"z":3,"w":4,"d":3}],
 "axis":{"a":{"x":3,"z":4},"b":{"x":7,"z":4},"label":"对话轴"}}`
export const SHOT_BUNDLE_SYSTEM = `你是电影预演的场记、分镜师和空间指导。你要同时生成一个镜头独立的 3D 空间和走位。\n只输出 JSON，不要解释。\n\n硬约束：\n1. 空间属于当前镜头，不修改其他镜头；有 seed 时保留未被当前画面否定的墙/门/固定物。\n2. 只能使用给定的在场角色名，不能新增、改名或漏人。\n3. 关键帧 1~3 个，t 从 0 到 1；每帧记录所有角色与机位。\n4. 视觉 brief 只是感知线索，不能直接当米制坐标；坐标必须结合 seed/场景卡生成。\n5. 人和机位不能位于墙体/固定物实体内部，路径中间也不能穿墙。`

export const BLOCKING_OUTPUT = `输出 JSON：
{"keys":[
  {"t":0,"actors":[{"name":"角色名","x":0.3,"y":0.5,"face":0}],
   "camera":{"x":0.5,"y":0.92,"lookX":0.5,"lookY":0.5,"height":1.6,"fov":45}},
  {"t":1,"actors":[{"name":"角色名","x":0.4,"y":0.5,"face":8}],
   "camera":{"x":0.5,"y":0.84,"lookX":0.5,"lookY":0.5,"height":1.6,"fov":42}}
 ],
 "notes":"走位与运镜说明"}`

function newId(prefix: string, used: Set<string>): string {
  let i = 1
  while (used.has(`${prefix}${i}`)) i++
  const id = `${prefix}${i}`
  used.add(id)
  return id
}

function wallMid(w: { x1: number; z1: number; x2: number; z2: number }) {
  return { x: (w.x1 + w.x2) / 2, z: (w.z1 + w.z2) / 2, len: Math.hypot(w.x2 - w.x1, w.z2 - w.z1) }
}

/** 名称/几何相近的旧对象保留 id，避免每次 AI 生成都让 React key 抖动 */
export function keepSceneIds(layout: SceneLayout, existing?: SceneLayout): SceneLayout {
  if (!existing) {
    const used = new Set(layout.walls.map((w) => w.id))
    layout.props.forEach((p) => used.add(p.id))
    layout.zones.forEach((z) => used.add(z.id))
    return layout
  }
  const oldWalls = existing.walls.map((w) => ({ w, m: wallMid(w) }))
  const usedWalls = new Set<string>()
  const walls = layout.walls.map((w) => {
    const m = wallMid(w)
    const hit = oldWalls.find(
      ({ w: ow, m: om }) =>
        !usedWalls.has(ow.id) &&
        Math.hypot(m.x - om.x, m.z - om.z) < 1.0 &&
        Math.abs(m.len - om.len) < 1.0,
    )
    if (hit) {
      usedWalls.add(hit.w.id)
      return { ...w, id: hit.w.id }
    }
    return { ...w, id: newId('w', usedWalls) }
  })
  const oldProps = new Map(existing.props.map((p) => [p.name, p]))
  const usedProps = new Set<string>()
  const props = layout.props.map((p) => {
    const old = oldProps.get(p.name)
    if (old && !usedProps.has(old.id)) {
      usedProps.add(old.id)
      return { ...p, id: old.id }
    }
    return { ...p, id: newId('p', usedProps) }
  })
  const oldZones = new Map(existing.zones.map((z) => [z.name, z]))
  const usedZones = new Set<string>()
  const zones = layout.zones.map((z) => {
    const old = oldZones.get(z.name)
    if (old && !usedZones.has(old.id)) {
      usedZones.add(old.id)
      return { ...z, id: old.id }
    }
    return { ...z, id: newId('z', usedZones) }
  })
  return { ...layout, walls, props, zones }
}

export function normalizeSceneLayout(
  raw: unknown,
  input: { episode: number; sceneNo: number; sceneSlug?: string; designId?: string; existing?: SceneLayout },
): GenerateResult<SceneLayout> {
  const r = unwrap(raw, ['scene', 'layout', 'sceneLayout'])
  const clean = sanitizeSceneLayout(r, {
    episode: input.episode,
    sceneNo: input.sceneNo,
    sceneSlug: input.sceneSlug,
    designId: input.designId,
  })
  const withIds = keepSceneIds(clean.layout, input.existing)
  const warnings = [...clean.warnings]
  if (!withIds.walls.length) warnings.push('模型没有给出墙体，空间是开放地面')
  return {
    value: {
      ...withIds,
      id: input.existing?.id || withIds.id,
      episode: input.episode,
      sceneNo: input.sceneNo,
      ...(input.sceneSlug ? { sceneSlug: input.sceneSlug } : {}),
      ...(input.designId || input.existing?.designId
        ? { designId: input.designId || input.existing?.designId }
        : {}),
      source: 'ai',
      updatedAt: new Date().toISOString(),
    },
    warnings,
  }
}

export async function generateSceneLayout(input: SceneGenerateInput): Promise<GenerateResult<SceneLayout>> {
  checkAbort(input.signal)
  const ctx = buildSceneContext(input.context)
  const base = input.context.layout ?? input.existing
  const r = await input.ask({
    system: SCENE_SYSTEM,
    prompt:
      `${ctx.text}\n\n` +
      `场次键：E${String(input.context.episode?.no ?? 1).padStart(2, '0')}-SC${String(input.context.sceneNo).padStart(2, '0')}\n` +
      (base ? '已有布局（尽量保留空间结构，只有明确需要时才改）：\n' + JSON.stringify(base).slice(0, 7000) + '\n' : '') +
      SCENE_OUTPUT,
    json: true,
    maxTokens: 2600,
    signal: input.signal,
  })
  checkAbort(input.signal)
  const raw = parseJson(r)
  if (!raw) throw new ScheduleAIError('场景模型没有返回可解析的 JSON')
  return normalizeSceneLayout(raw, {
    episode: input.context.episode?.no ?? 1,
    sceneNo: input.context.sceneNo,
    sceneSlug: input.context.scene?.slug,
    designId: ctx.design?.id,
    existing: input.existing,
  })
}

export function coerceBlocking(raw: unknown): ShotBlocking {
  const obj = asObject(unwrap(raw, ['blocking', 'shotBlocking', 'layout'])) ?? {}
  const keysRaw = Array.isArray(obj.keys) ? obj.keys : []
  const keys = keysRaw.slice(0, 3).map((k) => {
    const ko = asObject(k) ?? {}
    const actorsRaw = Array.isArray(ko.actors) ? ko.actors : []
    const c = asObject(ko.camera) ?? {}
    return {
      t: Number(ko.t),
      actors: actorsRaw.map((a) => {
        const ao = asObject(a) ?? {}
        return {
          name: String(ao.name ?? '').trim(),
          x: Number(ao.x),
          y: Number(ao.y),
          face: Number(ao.face),
        }
      }),
      camera: {
        x: Number(c.x),
        y: Number(c.y),
        lookX: Number(c.lookX),
        lookY: Number(c.lookY),
        height: Number(c.height),
        fov: Number(c.fov),
      },
    }
  })
  return {
    keys,
    ...(typeof obj.notes === 'string' && obj.notes.trim() ? { notes: obj.notes.trim().slice(0, 600) } : {}),
    source: 'ai',
  }
}

function repairPrompt(contextText: string, raw: unknown, issues: Issue[]) {
  return (
    `${contextText}\n\n` +
    `上一版输出（只修复，不重写无关部分）：\n${JSON.stringify(raw).slice(0, 12000)}\n\n` +
    `校验错误：\n${issues.map((e, i) => `${i + 1}. ${e.message}`).join('\n')}\n\n` +
    `${BLOCKING_OUTPUT}\n` +
    '请只输出修复后的完整 JSON，必须保留所有在场角色，关键帧 t 从 0 到 1。'
  )
}

export async function generateShotBlocking(input: BlockingGenerateInput): Promise<GenerateResult<ShotBlocking>> {
  checkAbort(input.signal)
  const duration = effectiveSeconds(input.context.shot.seconds)
  const contextText = buildBlockingContext(input.context)
  const roster = [...new Set(input.roster.filter(Boolean))]
  const prompt =
    `${contextText}\n\n` +
    `本镜在场角色（只能使用这些名字）：${roster.length ? roster.join('、') : '（无角色，纯空间镜头）'}\n` +
    `本镜有效时长：${duration} 秒。` +
    (Number(input.context.shot.seconds) !== duration
      ? `（原秒数 ${Number(input.context.shot.seconds)}s 已按 2~12 秒夹取）\n`
      : '\n') +
    BLOCKING_OUTPUT
  const first = parseJson(
    await input.ask({
      system: BLOCKING_SYSTEM,
      prompt,
      json: true,
      maxTokens: 3200,
      signal: input.signal,
    }),
  )
  checkAbort(input.signal)
  if (!first) throw new ScheduleAIError('走位模型没有返回可解析的 JSON')
  let coerce = coerceBlocking(first)
  let validation = validateBlocking(coerce, {
    layout: input.context.scene,
    roster,
    aspect: input.context.aspect,
    duration,
  })
  const warnings = [...validation.warnings.map((w) => w.message)]
  if (validation.errors.length) {
    const repaired = parseJson(
      await input.ask({
        system: BLOCKING_SYSTEM,
        prompt: repairPrompt(contextText, first, validation.errors),
        json: true,
        maxTokens: 3200,
        signal: input.signal,
      }),
    )
    checkAbort(input.signal)
    if (!repaired) {
      throw new ScheduleAIError('走位修复失败：模型没有返回可解析的 JSON', validation.errors)
    }
    coerce = coerceBlocking(repaired)
    validation = validateBlocking(coerce, {
      layout: input.context.scene,
      roster,
      aspect: input.context.aspect,
      duration,
    })
    warnings.push(...validation.warnings.map((w) => w.message))
  }
  if (validation.errors.length) {
    throw new ScheduleAIError(
      `走位校验未通过：${validation.errors.slice(0, 4).map((e) => e.message).join('；')}`,
      validation.errors,
    )
  }
  return {
    value: {
      ...coerce,
      source: 'ai',
      updatedAt: new Date().toISOString(),
    },
    warnings,
  }
}

export type ShotBundleInput = {
  sceneContext: SceneContextInput
  blockingContext: BlockingContextInput
  roster: string[]
  seedScene?: SceneLayout
  existingScene?: SceneLayout
  visualBrief?: VisualBrief
  ask: Ask
  signal?: AbortSignal
}

export type ShotBundle = { scene: SceneLayout; blocking: ShotBlocking; warnings: string[] }

/**
 * 每镜联合生成：一次文本调用同时给 ShotScene + ShotBlocking。
 * 视觉 brief 只作为软约束；有 seedScene 时要求保留未被当前画面否定的结构。
 */
export async function generateShotBundle(input: ShotBundleInput): Promise<ShotBundle> {
  checkAbort(input.signal)
  const sc = buildSceneContext({
    ...input.sceneContext,
    layout: input.seedScene ?? input.existingScene,
  })
  const bc = buildBlockingContext({
    ...input.blockingContext,
    visualBriefText: input.visualBrief ? visualBriefText(input.visualBrief) : input.blockingContext.visualBriefText,
  })
  const seedBlock = input.seedScene
    ? `\n【上一镜空间种子】\n${JSON.stringify(input.seedScene).slice(0, 9000)}\n保留未被当前画面否定的结构；只改当前镜头可见部分。`
    : '\n【上一镜空间种子】无，从场次/场景卡/当前画面生成。'
  const prompt =
    `${sc.text}\n\n${bc}\n${seedBlock}\n\n` +
    `在场角色（严格使用）：${input.roster.length ? input.roster.join('、') : '（无角色，纯空间镜头）'}\n` +
    `输出 JSON，同时包含 scene 与 blocking：\n` +
    `{"scene":{...SceneLayout...},"blocking":{...keys...},"notes":"空间与走位说明"}\n` +
    `scene 使用上面场景布局字段（w/h/walls/props/zones/axis），blocking 使用 1~3 个关键帧。`
  const first = parseJson(
    await input.ask({
      system: SHOT_BUNDLE_SYSTEM,
      prompt,
      json: true,
      maxTokens: 4200,
      signal: input.signal,
    }),
  )
  checkAbort(input.signal)
  if (!first) throw new ScheduleAIError('3D 模型没有返回可解析的 JSON')
  const raw = asObject(first) ?? {}
  let scene = normalizeSceneLayout(raw.scene ?? raw.shotScene ?? raw, {
    episode: input.sceneContext.episode?.no ?? 1,
    sceneNo: input.sceneContext.sceneNo,
    sceneSlug: input.sceneContext.scene?.slug,
    designId: sc.design?.id,
    existing: input.existingScene,
  })
  let blocking = coerceBlocking(raw.blocking ?? raw.shotBlocking ?? raw)
  let validation = validateBlocking(blocking, {
    layout: scene.value,
    roster: input.roster,
    aspect: input.blockingContext.aspect,
    duration: effectiveSeconds(input.blockingContext.shot.seconds),
  })
  const warnings = [...scene.warnings, ...validation.warnings.map((w) => w.message)]
  if (validation.errors.length) {
    const repairedRaw = parseJson(
      await input.ask({
        system: SHOT_BUNDLE_SYSTEM,
        prompt:
          `${prompt}\n\n上一版输出：\n${JSON.stringify(first).slice(0, 14000)}\n\n` +
          `校验错误：\n${validation.errors.map((e, i) => `${i + 1}. ${e.message}`).join('\n')}\n\n` +
          '只输出修复后的完整 {scene, blocking} JSON，保留所有在场角色。',
        json: true,
        maxTokens: 4200,
        signal: input.signal,
      }),
    )
    checkAbort(input.signal)
    if (!repairedRaw) throw new ScheduleAIError('3D 修复失败：模型没有返回可解析 JSON', validation.errors)
    const ro = asObject(repairedRaw) ?? {}
    scene = normalizeSceneLayout(ro.scene ?? ro.shotScene ?? ro, {
      episode: input.sceneContext.episode?.no ?? 1,
      sceneNo: input.sceneContext.sceneNo,
      sceneSlug: input.sceneContext.scene?.slug,
      designId: sc.design?.id,
      existing: input.existingScene,
    })
    blocking = coerceBlocking(ro.blocking ?? ro.shotBlocking ?? ro)
    validation = validateBlocking(blocking, {
      layout: scene.value,
      roster: input.roster,
      aspect: input.blockingContext.aspect,
      duration: effectiveSeconds(input.blockingContext.shot.seconds),
    })
    warnings.push(...validation.warnings.map((w) => w.message))
  }
  if (validation.errors.length) {
    throw new ScheduleAIError(
      `3D 校验未通过：${validation.errors.slice(0, 4).map((e) => e.message).join('；')}`,
      validation.errors,
    )
  }
  return {
    scene: {
      ...scene.value,
      source: 'ai',
      ...(input.seedScene ? { seedFrom: input.seedScene.id } : {}),
    },
    blocking: { ...blocking, source: 'ai', updatedAt: new Date().toISOString() },
    warnings: [...new Set(warnings)].slice(0, 8),
  }
}

/** 首次没有数据时给 UI 的兜底；source 明确标 fallback */
export function fallbackSceneFor(episode: number, sceneNo: number, sceneSlug?: string): SceneLayout {
  return fallbackSceneLayout(episode, sceneNo, sceneSlug)
}
