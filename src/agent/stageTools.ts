import { z } from 'zod'
import type { ProjectAsset, ProjectData, ProjectShot, Stage } from '../api'
import type { CharacterSheet } from '../characters'
import { readCharacters, toProject } from '../charMap'
import { assetNodesFromAssets, composeShotCanvasNodes } from '../canvasShots'
import { nodeToShot } from '../shotSync'
import type { ShotNodeType } from '../data'
import { buildShotVideoRequest, type VideoModelInput } from '../videoPrompt'
import { buildTransitionVideoPreview, transitionNativeAudioReadiness, transitionRefCandidateView } from '../transitionGen'
import {
  contractWriteHint,
  getContractToolSchema,
  normalizeCharactersContractPayload,
  validateContract,
} from '../skills/contracts'
import type { Skill } from '../skills/types'
import {
  consumeCursor,
  fingerprintOf,
  pagingPlan,
  readCursor,
  stashPending,
  SUBMIT_CHAR_LIMIT,
  takeBatchByChars,
} from '../skills/writePaging'
import { isAgentPackSkill, parseAgentPackMeta } from '../skills/agentPack'
import { isCreativeHostSkill } from '../creative/creativeSkillHost'
import { getSkill, getSkillTextRecord, loadSkills, skillAttachmentList } from '../skills/registry'
import { readSkillFile } from '../skills/api'
import { boundJson, type WorkbenchChatAdapter } from './workbenchChat'
import {
  packFields,
  packRecords,
  recordSize,
  truncationNote,
} from './readBudget'
import type { PromptRenderBundle } from '../promptRender'
import { defineTool, type ToolDef } from './tool'

/** 取契约主集合；不是数组就视为「不可分批」 */
function readCollection(payload: Record<string, unknown>, key: string): { items: unknown[] } | null {
  const value = payload[key]
  return Array.isArray(value) ? { items: value } : null
}

/** 用本批已接受的条目替换主集合，其余字段原样带上 */
function withCollection(
  payload: Record<string, unknown>,
  key: string,
  items: unknown[],
): Record<string, unknown> {
  return { ...payload, [key]: items }
}

export type LoadedSkill = { skill: Skill; mode: 'host' | 'readonly' }
export type StageToolSet = {
  read: Map<string, ToolDef>
  submit?: ToolDef
  byName: Map<string, ToolDef>
  /** 跨工具调用前清空，避免宿主桥复用工具表时读到陈旧项目快照 */
  resetSnapshot?: () => void
}

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' ? (value as Record<string, unknown>) : {}
}

function ownOr(value: unknown, fallback: unknown): unknown {
  return value === undefined || value === null ? fallback : value
}

function filterByName<T extends { name?: unknown }>(items: T[], names?: string[]): T[] {
  if (!names?.length) return items
  const set = new Set(names.map(String))
  return items.filter((x) => set.has(String(x.name || '')))
}

/** 单条物料记录的上限：超过也只标 oversized，不切字段 */
const SINGLE_RECORD_BUDGET = 12_000

/**
 * 单条记录的返回形状：整条给出，不切 JSON。
 * 单条本身就超预算时标 `oversized` 与 `chars`，让调用方自己决定要不要再要。
 */
function singleRecord(value: unknown): Record<string, unknown> {
  const packed = packRecords([value], SINGLE_RECORD_BUDGET)
  return {
    record: packed.items[0],
    ...(packed.oversized ? { oversized: true, chars: recordSize(value) } : {}),
  }
}

function shotIdOf(shot: Record<string, unknown>): string {
  return String(shot.id || '').trim()
}

function shotNoOf(shot: Record<string, unknown>): string {
  return String(shot.no || '').trim()
}

export type ShotLocator = { shotId?: string; no?: string; episode?: number }

/**
 * 出片输入解析用的画布上下文。
 * 宿主给了实时上下文就用实时的；没给就按项目快照重建分镜节点**与素材卡节点**——
 * 没有素材卡节点时，`refIds` 里的 `asset-<canvasId>` 解析不到会被静默少送一张图，
 * 于是工具报的参考顺序与真实出片请求不一致。
 */
function shotVideoInputsContext(
  project: ProjectData,
  host?: ReturnType<NonNullable<WorkbenchChatAdapter['shotVideoContext']>>,
): {
  nodes: ShotNodeType[]
  characters: CharacterSheet[]
  missingMedia: Set<string>
  model: VideoModelInput | null
  resolution: string
} {
  const shots = Array.isArray(project.shots) ? (project.shots as ProjectShot[]) : []
  const assets = Array.isArray(project.assets) ? (project.assets as ProjectAsset[]) : []
  return {
    nodes: host?.nodes ?? composeShotCanvasNodes(assetNodesFromAssets(assets), shots),
    characters: host?.characters ?? readCharacters(project.characters),
    missingMedia: host?.missingMedia ?? new Set<string>(),
    model: host?.model ?? null,
    resolution: host?.resolution ?? '',
  }
}

/**
 * 转场预览要的模型形状：`label` 用于回显，`features.lastFrame` 决定是否真提交尾帧。
 * 只传 `model` 名不够——尾帧能力判错会让「参考图与尾帧互斥」的判断反掉。
 */
function transitionModelOf(
  model: VideoModelInput | null,
): { label?: string; model?: string; providerKind?: string; features?: { lastFrame?: boolean; textToVideo?: boolean; audioOut?: boolean } } | null {
  if (!model) return null
  const features = model.features ?? (model.audioOut != null ? { audioOut: model.audioOut } : undefined)
  return {
    ...(model.label ? { label: model.label } : {}),
    ...(model.model ? { model: model.model } : {}),
    ...(model.providerKind ? { providerKind: model.providerKind } : {}),
    ...(features ? { features } : {}),
  }
}

export type ShotVideoPromptRead = {  text: string | null
  /** 与画布出片预览同序：手改快照 → 语义层 video_prompt；都没有即阻断 */
  source: 'override' | 'video_prompt' | 'blocked'
  /** 手改快照指纹与最近一次模板渲染指纹不一致；只提示，不阻止出片 */
  stale: boolean
  note?: string
}/**
 * 该镜最终会发给视频模型的正文。
 *
 * 顺序对齐画布 `buildShotVideoRequest` + `effectiveVideoPrompt`：手改快照整段逐字发送；
 * 否则 `video_prompt`；两者都没有时画布直接阻断出片——所以这里也返回 `blocked`，
 * 不给首帧正文或脚本拼装的近似结果。
 */
export function resolveShotVideoPrompt(shot: Record<string, unknown>): ShotVideoPromptRead {
  const override = asRecord(shot.video_prompt_override)
  const overrideText = typeof override.text === 'string' ? override.text : ''
  if (overrideText.trim()) {
    const meta = asRecord(shot.video_prompt_render_meta)
    const fp = String(override.fingerprint || '')
    const stale = Boolean(fp && meta.fingerprint && String(meta.fingerprint) !== fp)
    return {
      text: overrideText,
      source: 'override',
      stale,
      ...(stale
        ? { note: '手改快照与最近一次模板渲染指纹不一致：画布内容可能已变，出片预览会提示过期（但仍按手改发送）' }
        : {}),
    }
  }
  const vp = typeof shot.video_prompt === 'string' ? shot.video_prompt : ''
  if (vp.trim()) return { text: vp, source: 'video_prompt', stale: false }
  return {
    text: null,
    source: 'blocked',
    stale: false,
    note: '该镜没有出片正文：画布会阻断出片。下一步：用 submit_prompts 写入 video_prompt，或让用户在「运动提示词」里填写',
  }
}

type LocateShotResult =
  | { ok: true; shot: Record<string, unknown> }
  | { ok: false; [key: string]: unknown }

/** 按 shotId 或镜号定位单镜；找不到/有歧义时给出可读原因与可用范围 */
export async function locateShot(
  loadShots: () => Promise<Array<Record<string, unknown>>>,
  loc: ShotLocator,
): Promise<LocateShotResult> {
  const all = await loadShots()
  const episode = loc.episode
  const scoped = episode ? all.filter((s) => Number(s.episode) === Number(episode)) : all
  const wantId = String(loc.shotId || '').trim()
  const wantNo = String(loc.no || '').trim()

  if (!wantId && !wantNo) {
    return {
      ok: false,
      error: '需要 shotId 或 no 之一来定位镜头',
      hint: '先用 read_shots / read_episode 拿到镜号或镜 id',
    }
  }

  if (wantId) {
    const hit = scoped.find((s) => shotIdOf(s) === wantId)
    if (hit) return { ok: true, shot: hit }
    // 给了 episode 却不在这一集：说清楚它属于哪一集，比「找不到」有用
    const elsewhere = all.find((s) => shotIdOf(s) === wantId)
    if (elsewhere) {
      const ep = Number(elsewhere.episode) || 0
      return {
        ok: false,
        error: `shotId「${wantId}」不在${episode ? `第 ${episode} 集` : '当前范围'}${ep ? `，它属于第 ${ep} 集` : ''}`,
        hint: ep ? `去掉 episode，或改成 episode: ${ep}` : '去掉 episode 过滤',
      }
    }
  } else {
    const matches = scoped.filter((s) => shotNoOf(s).toUpperCase() === wantNo.toUpperCase())
    if (matches.length === 1) return { ok: true, shot: matches[0] }
    if (matches.length > 1) {
      return {
        ok: false,
        error: `镜号「${wantNo}」在${episode ? `第 ${episode} 集` : '多集'}中了 ${matches.length} 次，无法确定是哪一镜`,
        candidates: matches.slice(0, 20).map((s) => ({
          shotId: shotIdOf(s),
          no: shotNoOf(s),
          episode: Number(s.episode) || 0,
        })),
        hint: '补 episode，或直接用 shotId',
      }
    }
  }

  return {
    ok: false,
    error: `找不到镜头${wantId ? ` shotId「${wantId}」` : ` 镜号「${wantNo}」`}${episode ? `（第 ${episode} 集）` : ''}`,
    available: {
      ...(episode ? { episode } : {}),
      count: scoped.length,
      shotNos: scoped.map(shotNoOf).filter(Boolean).slice(0, 60),
      shotIds: scoped.slice(0, 20).map(shotIdOf),
    },
    hint: '镜号形如 S01/S02；可先用 read_shots 确认该集实际镜号',
  }
}

/** 物料分类：角色 / 场景 / 道具 / 素材卡 / 项目级自定义白模 */
export const MATERIAL_CATEGORIES = ['characters', 'scenes', 'props', 'assets', 'whitebox'] as const
export type MaterialCategory = (typeof MATERIAL_CATEGORIES)[number]

/** 白模代码返回上限：整段 build_scene 才算可用，切太短没有价值 */
const MATERIAL_CODE_MAX = 20_000
const MATERIAL_ROW_LIMIT = 200

/**
 * 素材卡在 `shot.refIds` 里的 token 前缀，与画布节点 id 同形（`asset-<canvasId>`）。
 * 读工具据此把 Agent 手里的 token 反查成素材卡记录。
 */
const ASSET_TOKEN_PREFIX = 'asset-'

type LiveReadContext = ReturnType<NonNullable<WorkbenchChatAdapter['shotVideoContext']>>

function projectRevisionOf(p: ProjectData): number {
  const n = Number(p.revision)
  return Number.isFinite(n) && n >= 0 ? Math.floor(n) : 0
}

/** 实况 projectRevision 与落库一致才允许 overlay（避免旧画布盖住新 DB） */
function canvasShotOverlayAllowed(live: LiveReadContext | undefined, project: ProjectData): boolean {
  if (!live?.nodes?.length) return false
  if (live.projectRevision === undefined || live.projectRevision === null) return false
  return Number(live.projectRevision) === projectRevisionOf(project)
}

function isAssetCanvasNode(n: ShotNodeType): boolean {
  return (n as { type?: string }).type === 'asset'
}

function mergeAssetMaterialRows(project: ProjectData, nodes: ShotNodeType[]): MaterialRow[] {
  const rows = materialRowsOf(project, 'assets')
  const byUrl = new Map(rows.map((r) => [r.key, { ...r }]))
  const byCanvasId = new Map<string, MaterialRow>()
  for (const r of rows) {
    if (r.canvasId) byCanvasId.set(r.canvasId, r)
  }
  for (const n of nodes) {
    if (!isAssetCanvasNode(n)) continue
    const d = (n.data || {}) as Record<string, unknown>
    const nodeId = String(n.id || '')
    const canvasId = nodeId.startsWith(ASSET_TOKEN_PREFIX) ? nodeId.slice(ASSET_TOKEN_PREFIX.length) : nodeId
    const url = String(d.url || '').trim() || (canvasId ? `canvas:${canvasId}` : '')
    if (!url) continue
    const prev = byUrl.get(url) ?? (canvasId ? byCanvasId.get(canvasId) : undefined)
    const merged: MaterialRow = {
      category: 'assets',
      key: url,
      title: String(d.title || prev?.title || url),
      kind: String(d.kind || prev?.kind || 'image'),
      url,
      ...(canvasId ? { canvasId } : {}),
      ...(d.designId
        ? { designId: String(d.designId) }
        : prev?.designId
          ? { designId: prev.designId }
          : {}),
      ...(d.characterName
        ? { characterName: String(d.characterName) }
        : prev?.characterName
          ? { characterName: prev.characterName }
          : {}),
    }
    byUrl.set(url, merged)
    if (canvasId) byCanvasId.set(canvasId, merged)
  }
  return [...byUrl.values()]
}

function mergeCharactersFromCanvas(project: ProjectData, live: LiveReadContext | undefined): unknown[] {
  const base = Array.isArray(project.characters) ? project.characters.map((c) => ({ ...asRecord(c) })) : []
  const liveChars = live?.characters
  if (!liveChars?.length) return base
  const byName = new Map<string, Record<string, unknown>>()
  for (const raw of base) {
    const name = String(raw.name || '').trim()
    if (name) byName.set(name, raw)
  }
  for (const sheet of liveChars) {
    const mapped = toProject(sheet as CharacterSheet)
    const name = String(mapped.name || '').trim()
    if (!name) continue
    const prev = byName.get(name) || {}
    byName.set(name, { ...prev, ...mapped })
  }
  return [...byName.values()]
}

function assetMaterialRows(project: ProjectData, adapter: WorkbenchChatAdapter): MaterialRow[] {
  const live = adapter.shotVideoContext?.()
  if (!canvasShotOverlayAllowed(live, project)) return materialRowsOf(project, 'assets')
  return mergeAssetMaterialRows(project, live!.nodes!)
}

/**
 * 读工具的字符预算，按「装整条」生效（见 readBudget.ts）。
 * 分镜最占地方：16 镜左右约 2.4 万字符，一集 31 镜分两次游标续读即可读完。
 */
const SHOT_LIST_BUDGET = 24_000
/** 分镜按 id 精确读的单次条数上限；超出时显式列出未返回的 id */
const SHOT_ID_LIMIT = 100
/** 角色 / 设定卡 / 转场食谱 / 分集等非分镜列表 */
const LIST_BUDGET = 8_000

export type MaterialRow = {
  category: MaterialCategory
  key: string
  title: string
  kind?: string
  url?: string
  /** 素材卡的画布身份：`shot.refIds` 里写作 `asset-<canvasId>` */
  canvasId?: string
  characterName?: string
  designId?: string
  hasImage?: boolean
  hasVideo?: boolean
  hasCode?: boolean
}

/** 按分类把项目里的物料摊平成一维列表；素材卡无 id，用 url 作 key */
function materialRowsOf(project: ProjectData, category: MaterialCategory): MaterialRow[] {
  if (category === 'characters') {
    // 透传原始形状：快照里的角色是蛇形，这里只读 id/name/image，两种形状字段名一致
    const list = Array.isArray(project.characters) ? project.characters : []
    return list
      .map((raw) => {
        const o = asRecord(raw)
        const key = String(o.id || o.name || '').trim()
        if (!key) return null
        return {
          category,
          key,
          title: String(o.name || key),
          hasImage: Boolean(o.image),
        }
      })
      .filter(Boolean) as MaterialRow[]
  }
  if (category === 'scenes' || category === 'props') {
    const want = category === 'scenes' ? 'scene' : 'prop'
    const list = Array.isArray(project.designs) ? project.designs : []
    return list
      .filter((d) => String(asRecord(d).kind || '') === want)
      .map((raw) => {
        const o = asRecord(raw)
        const key = String(o.id || '').trim()
        if (!key) return null
        return {
          category,
          key,
          title: String(o.name || key),
          kind: want,
          hasImage: Boolean(o.image),
        }
      })
      .filter(Boolean) as MaterialRow[]
  }
  if (category === 'assets') {
    const list = Array.isArray(project.assets) ? project.assets : []
    const seen = new Set<string>()
    const rows: MaterialRow[] = []
    for (const raw of list) {
      const o = asRecord(raw)
      const url = String(o.url || '').trim()
      if (!url || seen.has(url)) continue
      seen.add(url)
      rows.push({
        category,
        key: url,
        title: String(o.title || url),
        kind: String(o.kind || 'image'),
        url,
        // 有了 canvasId，Agent 才能把 refIds 里的 `asset-<canvasId>` 对上这张卡
        ...(o.canvasId ? { canvasId: String(o.canvasId) } : {}),
        ...(o.characterName ? { characterName: String(o.characterName) } : {}),
        ...(o.designId ? { designId: String(o.designId) } : {}),
      })
    }
    return rows
  }
  const list = Array.isArray(project.lexiconWhitebox) ? project.lexiconWhitebox : []
  return list
    .map((raw) => {
      const o = asRecord(raw)
      const key = String(o.id || '').trim()
      if (!key) return null
      const code = asRecord(o.sceneCode).code
      return {
        category,
        key,
        title: String(o.title || key),
        hasVideo: Boolean(o.video),
        hasCode: typeof code === 'string' && code.length > 0,
      }
    })
    .filter(Boolean) as MaterialRow[]
}

/**
 * 工具集只通过 adapter 取数/写草稿：
 * 自己的产物读活草稿，上游产物读已保存项目；提交只产生草稿，合并交给宿主。
 */
export function createStageToolSet(
  adapter: WorkbenchChatAdapter,
  options?: { freshReads?: boolean },
): StageToolSet {
  let snapshotPromise: Promise<ProjectData> | null = null
  const snapshot = () =>
    options?.freshReads ? adapter.projectSnapshot() : (snapshotPromise ??= adapter.projectSnapshot())

  /** 有活草稿用数组（含空数组）；非数组则读已保存项目，避免创意等平台 adapter 未填草稿时误返回 [] */
  const listForArtifact = async (
    ownArtifact: boolean,
    pickFromProject: (p: ProjectData) => unknown[],
  ): Promise<unknown[]> => {
    if (ownArtifact) {
      const own = adapter.ownDraft()
      if (Array.isArray(own)) return own
    }
    const p = await snapshot()
    return pickFromProject(p)
  }

  const scriptData = async (): Promise<{
    title: string
    source: string
    logline: string
    episodes: unknown[]
    style: string
    aspect: string
  }> => {
    const p = await snapshot()
    return {
      title: String(p.name || ''),
      source: String(p.source || ''),
      logline: String(p.logline || ''),
      episodes: Array.isArray(p.episodes) ? p.episodes : [],
      style: String(p.style || ''),
      aspect: String(p.aspect || ''),
    }
  }

  const charactersData = async (): Promise<unknown[]> => {
    const p = await snapshot()
    const base = await listForArtifact(adapter.artifact === 'characters', (proj) =>
      Array.isArray(proj.characters) ? proj.characters : [],
    )
    const live = adapter.shotVideoContext?.()
    if (!canvasShotOverlayAllowed(live, p)) return base
    return mergeCharactersFromCanvas(p, live)
  }

  const designsData = async (): Promise<unknown[]> =>
    listForArtifact(adapter.artifact === 'designs', (p) =>
      Array.isArray(p.designs) ? p.designs : [],
    )

  const shotsData = async (): Promise<Array<Record<string, unknown>>> => {
    const p = await snapshot()
    const base = (await listForArtifact(adapter.artifact === 'shots' || adapter.artifact === 'prompts', (proj) =>
      Array.isArray(proj.shots) ? proj.shots : [],
    )) as Array<Record<string, unknown>>
    const live = adapter.shotVideoContext?.()
    const nodes = live?.nodes
    if (!nodes?.length || !canvasShotOverlayAllowed(live, p)) return base
    const byId = new Map<string, Record<string, unknown>>()
    for (const row of base) {
      const id = String(row.id ?? '')
      if (id) byId.set(id, row)
    }
    for (const n of nodes) {
      const data = n.data
      const shotId = data?.shotId ? String(data.shotId) : ''
      if (!shotId) continue
      const fromCanvas = nodeToShot(data, shotId) as unknown as Record<string, unknown>
      const prev = byId.get(shotId)
      byId.set(shotId, prev ? { ...prev, ...fromCanvas } : fromCanvas)
    }
    return [...byId.values()]
  }

  const readSource = defineTool({
    name: 'read_source',
    description:
      '读取当前项目的原著与项目设定。只读；原著正文可能被截断，标题/梗概/画风/画幅始终给出。' +
      '画风与画幅是出首帧与出片提示词的必要上下文，未填时为空值。',
    schema: z.object({}),
    run: async () => {
      const d = await scriptData()
      return {
        ok: true,
        title: d.title,
        source: d.source,
        chars: d.source.length,
        logline: d.logline,
        style: d.style,
        aspect: d.aspect,
      }
    },
  })

  const readEpisodes = defineTool({
    name: 'read_episodes',
    description: '读取分集与场次。只读；可用 episode 只取某一集。',
    schema: z.object({
      episode: z.number().int().min(1).optional().describe('只读第 N 集；省略则读全部分集'),
    }),
    run: async ({ episode }) => {
      const d = await scriptData()
      const episodes = episode
        ? d.episodes.filter((e) => Number(asRecord(e).no) === Number(episode))
        : d.episodes
      const packed = packRecords(episodes, LIST_BUDGET)
      const note = truncationNote(packed)
      return {
        ok: true,
        episodes: packed.items,
        ...packFields(packed),
        ...(note ? { note: `${note}；也可以用 episode 只读某一集` } : {}),
      }
    },
  })

  const readCharacters = defineTool({
    name: 'read_characters',
    description: '读取角色表与外观锚点。只读；可用 names 过滤。',
    schema: z.object({
      names: z.array(z.string()).max(50).optional().describe('只读这些角色名'),
    }),
    run: async ({ names }) => {
      let list: unknown[]
      try {
        list = await charactersData()
      } catch (e) {
        return { ok: false, error: (e as Error).message || '读取项目失败' }
      }
      const filtered = names?.length
        ? list.filter((x) => names.includes(String(asRecord(x).name || '')))
        : list
      const packed = packRecords(filtered, LIST_BUDGET)
      const note = truncationNote(packed)
      return {
        ok: true,
        characters: packed.items,
        ...packFields(packed),
        ...(note ? { note } : {}),
      }
    },
  })

  const readDesigns = defineTool({
    name: 'read_designs',
    description: '读取场景/道具设定卡。只读；可用 kind 和 names 过滤。',
    schema: z.object({
      kind: z.enum(['scene', 'prop']).optional().describe('scene 场景 / prop 道具'),
      names: z.array(z.string()).max(50).optional().describe('只读这些名称'),
    }),
    run: async ({ kind, names }) => {
      let list: unknown[]
      try {
        list = await designsData()
      } catch (e) {
        return { ok: false, error: (e as Error).message || '读取项目失败' }
      }
      const filtered = list.filter((x) => {
        const o = asRecord(x)
        if (kind && o.kind !== kind) return false
        if (names?.length && !names.includes(String(o.name || ''))) return false
        return true
      })
      const packed = packRecords(filtered, LIST_BUDGET)
      const note = truncationNote(packed)
      return {
        ok: true,
        designs: packed.items,
        ...packFields(packed),
        ...(note ? { note } : {}),
      }
    },
  })

  const readShots = defineTool({
    name: 'read_shots',
    description:
      '读取分镜（项目镜头数据）。只读；可用 episode / shotIds / cursor 过滤，limit 控制条数。' +
      '响应按整条装填（不会切半个镜头）：拿到的每条都是完整记录，含 video_prompt、transition_out、refIds 等末尾字段。' +
      'truncated 为 true 时带 nextCursor，原样回传即可续读，直到 nextCursor 消失。',
    schema: z.object({
      episode: z.number().int().min(1).optional().describe('只读第 N 集'),
      shotIds: z
        .array(z.string())
        .optional()
        .describe('只读这些 shot.id；此时返回完整记录，不受列表预算影响'),
      cursor: z.string().optional().describe('续读游标：上一次响应返回的 nextCursor（即上一批最后一镜的 shot.id）'),
      limit: z.number().int().min(1).max(200).optional().describe('最多返回多少镜'),
    }),
    run: async ({ episode, shotIds, cursor, limit }) => {
      const all = await shotsData()
      let list = all
      if (episode) list = list.filter((s) => Number(s.episode) === Number(episode))

      // 按 id 精确读：每次都是完整记录，只受条数上限约束
      if (shotIds?.length) {
        const set = new Set(shotIds.map(String))
        const hit = list.filter((s) => set.has(String(s.id || '')))
        const kept = hit.slice(0, SHOT_ID_LIMIT)
        const notReturned = hit.slice(SHOT_ID_LIMIT).map((s) => String(s.id || ''))
        const notFound = shotIds.map(String).filter((id) => !hit.some((s) => String(s.id || '') === id))
        return {
          ok: true,
          shots: kept,
          total: hit.length,
          returned: kept.length,
          ...(notReturned.length
            ? {
                truncated: true,
                notReturned,
                note: `单次按 id 最多取 ${SHOT_ID_LIMIT} 镜；未返回的 id 见 notReturned，分批再取`,
              }
            : {}),
          ...(notFound.length ? { notFound } : {}),
        }
      }

      // 游标指向上一批最后一镜；镜头被删或换了集时不猜位置，让调用方从头读
      let start = 0
      const cur = String(cursor || '').trim()
      if (cur) {
        const at = list.findIndex((s) => String(s.id || '') === cur)
        if (at < 0) {
          return {
            ok: false,
            error: `续读游标「${cur}」在本集找不到：镜头可能已删除，或 cursor 属于另一集`,
            hint: '去掉 cursor 重新从头部读取，再用新的 nextCursor 续读',
            firstIds: list.slice(0, 5).map((s) => String(s.id || '')),
          }
        }
        start = at + 1
      }
      const rest = start > 0 ? list.slice(start) : list
      const scoped = limit ? rest.slice(0, limit) : rest
      const packed = packRecords(scoped, SHOT_LIST_BUDGET)
      const hasMore = packed.truncated || scoped.length < rest.length
      const last = packed.items[packed.items.length - 1]
      const nextCursor = hasMore && last ? String(last.id || '') : undefined
      const remaining = list.length - start - packed.returned
      return {
        ok: true,
        shots: packed.items,
        total: list.length,
        returned: packed.returned,
        ...(hasMore ? { truncated: true } : {}),
        ...(packed.oversized ? { oversized: true } : {}),
        ...(nextCursor ? { nextCursor } : {}),
        ...(hasMore && nextCursor
          ? { note: `本次返回 ${packed.returned} 镜（本集共 ${list.length} 镜，剩 ${remaining} 镜）：用 cursor: "${nextCursor}" 续读` }
          : {}),
      }
    },
  })

  const listCameraLexicon = defineTool({
    name: 'list_camera_lexicon',
    description:
      '只读：列出内置运镜/镜头语法白膜库。可按 category、move、size、章节关键词过滤；返回 key/cn/en/url/sectionTitle。',
    schema: z.object({
      category: z.enum(['camera-move', 'shot-grammar']).optional(),
      move: z.string().optional().describe('运镜枚举，如 推、拉'),
      size: z.string().optional().describe('景别枚举，如 中景、特写'),
      q: z.string().optional(),
      limit: z.number().int().min(1).max(80).optional(),
    }),
    run: async ({ category, move, size, q, limit }) => {
      const { listCameraLexicon: list } = await import('../cameraLexicon')
      const rows = list({ category, move, size, q, limit })
      const packed = packRecords(
        rows.map((e) => ({
          key: e.key,
          cn: e.cn,
          en: e.en,
          url: e.url,
          sectionTitle: e.sectionTitle,
          lexiconCategory: e.lexiconCategory,
          mapsToMove: e.mapsToMove,
          mapsToSize: e.mapsToSize,
        })),
        LIST_BUDGET,
      )
      return {
        ok: true,
        entries: packed.items,
        ...packFields(packed),
        attribution: 'hong hou zi',
      }
    },
  })

  const getCameraLexicon = defineTool({
    name: 'get_camera_lexicon',
    description: '只读：按 key 读取一条内置运镜/镜头语法条目。',
    schema: z.object({
      key: z.string().min(1),
    }),
    run: async ({ key }) => {
      const { getCameraLexiconEntry } = await import('../cameraLexicon')
      const e = getCameraLexiconEntry(String(key).trim())
      if (!e) return { ok: false, error: `未知 key：${key}` }
      return {
        ok: true,
        entry: boundJson({
          key: e.key,
          cn: e.cn,
          en: e.en,
          url: e.url,
          sectionTitle: e.sectionTitle,
          lexiconCategory: e.lexiconCategory,
          grammarGroup: e.grammarGroup,
          mapsToMove: e.mapsToMove,
          mapsToSize: e.mapsToSize,
        }),
      }
    },
  })

  const readTransitionRecipes = defineTool({
    name: 'read_transition_recipes',
    description:
      '读取转场食谱索引。可按 taxonomy 或关键词过滤。卡片可能含 whenToUse（适用接缝）、energy（能量等级）、durationHint（秒）、principle（视觉机制）、variants（技法卡多式）、pitfalls（已知坑）、seedanceHints（可直接进提示词的完整句子）。',
    schema: z.object({
      taxonomy: z
        .enum(['scene', 'character', 'space', 'vfx', 'camera', 'ai_video'])
        .optional()
        .describe('六类接缝主分类'),
      q: z.string().optional().describe('标题/intent/tags 关键词'),
      limit: z.number().int().min(1).max(40).optional(),
    }),
    run: async ({ taxonomy, q, limit }) => {
      const { listTransitionRecipes, searchTransitionRecipes } = await import('../transitionRecipes')
      let list = listTransitionRecipes()
      if (taxonomy) list = list.filter((r) => r.taxonomy === taxonomy)
      if (q?.trim()) list = searchTransitionRecipes(q.trim())
      if (limit) list = list.slice(0, limit)
      const packed = packRecords(list, LIST_BUDGET)
      const note = truncationNote(packed)
      return {
        ok: true,
        recipes: packed.items,
        ...packFields(packed),
        ...(note ? { note: `${note}；可用 taxonomy / q / limit 收窄` } : {}),
      }
    },
  })

  const readEpisode = defineTool({
    name: 'read_episode',
    description: '读取某一集的场次与镜头摘要。只读。',
    schema: z.object({
      episode: z.number().int().min(1).describe('第 N 集'),
    }),
    run: async ({ episode }) => {
      const d = await scriptData()
      const ep = d.episodes.find((x) => Number(asRecord(x).no) === Number(episode))
      if (!ep) return { ok: false, error: `没有第 ${episode} 集` }
      const shots = (await shotsData()).filter((s) => Number(s.episode) === Number(episode))
      // 摘要是「看个大概」，所以按整条装填一小批；要完整提示词请用 read_shot_detail / read_shot_video_prompt
      const packed = packRecords(shots, LIST_BUDGET)
      const note = truncationNote(packed)
      return {
        ok: true,
        episode: ep,
        shots: packed.items,
        shotTotal: shots.length,
        shotReturned: packed.returned,
        ...(packed.truncated ? { truncated: true } : {}),
        ...(note ? { note: `${note}；单镜完整数据用 read_shot_detail` } : {}),
      }
    },
  })

  const readShotDetail = defineTool({
    name: 'read_shot_detail',
    description:
      '只读：按 shotId 或镜号取单镜完整记录，不受列表预算影响。' +
      '返回该镜全部已存字段：keyframe_prompt、video_prompt、video_prompt_override（手改正文）、' +
      'video_prompt_rendered 与 video_prompt_render_meta（模板渲染正文与元数据）、motionNote、' +
      'transition_out、refIds、refExtras、handEdited、visual_brief 等。',
    schema: z.object({
      shotId: z.string().optional().describe('定稿 shot.id（如 E01-S03）；与 no 同时给时以 shotId 为准'),
      no: z.string().optional().describe('镜号，如 S03；多集同名镜号需同时给 episode'),
      episode: z.number().int().min(1).optional().describe('第 N 集，用于消歧'),
    }),
    run: async ({ shotId, no, episode }) => {
      const found = await locateShot(shotsData, { shotId, no, episode })
      if (!found.ok) return found
      const shot = found.shot
      return {
        ok: true,
        shotId: shotIdOf(shot),
        no: shotNoOf(shot),
        episode: Number(shot.episode) || 0,
        chars: recordSize(shot),
        shot,
      }
    },
  })

  const readShotVideoPrompt = defineTool({
    name: 'read_shot_video_prompt',
    description:
      '只读：读取某镜最终会提交给视频模型的出片正文，并标出来源（override 手改 / video_prompt 运动提示词）。' +
      '顺序与画布出片预览一致；两个来源都为空时返回 text:null 与 source:blocked（画布会阻断出片），不给近似结果。' +
      '要写正文请先用 read_shot_video_inputs 拿到参考槽位顺序。',
    schema: z.object({
      shotId: z.string().optional().describe('定稿 shot.id（如 E01-S03）；与 no 同时给时以 shotId 为准'),
      no: z.string().optional().describe('镜号，如 S03；多集同名镜号需同时给 episode'),
      episode: z.number().int().min(1).optional().describe('第 N 集，用于消歧'),
    }),
    run: async ({ shotId, no, episode }) => {
      const found = await locateShot(shotsData, { shotId, no, episode })
      if (!found.ok) return found
      const shot = found.shot
      return {
        ok: true,
        shotId: shotIdOf(shot),
        no: shotNoOf(shot),
        episode: Number(shot.episode) || 0,
        ...resolveShotVideoPrompt(shot),
        ...(typeof shot.video_prompt_rendered === 'string' && shot.video_prompt_rendered.trim()
          ? {
              // 模板渲染正文全文返回；chars 只做长度提示，不代替正文
              templateRendered: shot.video_prompt_rendered,
              templateRenderedChars: shot.video_prompt_rendered.length,
            }
          : {}),
      }
    },
  })

  /**
   * 出片输入读取：把「实际会提交的参考顺序与请求参数」交给 Agent。
   * 正文不在这里给出（用 read_shot_video_prompt）；这里只给写正文需要的材料。
   */
  const readShotVideoInputs = defineTool({
    name: 'read_shot_video_inputs',
    description:
      '只读：读取某镜出片请求的实际输入——模式、镜头秒数与请求秒数、按提交顺序排列的参考图槽位（index 从 1 起）、' +
      '被省略的参考与原因、参考视频与音色参考。用它来写分镜出片正文：参考图按这里的 index 对应 [图N]，' +
      '不要凭字段臆测顺序。数值按项目快照计算，画布上未保存的改动不在其中。',
    schema: z.object({
      shotId: z.string().optional().describe('定稿 shot.id（如 E01-S03）；与 no 同时给时以 shotId 为准'),
      no: z.string().optional().describe('镜号，如 S03；多集同名镜号需同时给 episode'),
      episode: z.number().int().min(1).optional().describe('第 N 集，用于消歧'),
    }),
    run: async ({ shotId, no, episode }) => {
      const found = await locateShot(shotsData, { shotId, no, episode })
      if (!found.ok) return found
      const shot = found.shot
      const project = await snapshot()
      const ctx = shotVideoInputsContext(project, adapter.shotVideoContext?.())
      const wantId = shotIdOf(shot)
      const node = ctx.nodes.find((n) => String(n.data?.shotId ?? '') === wantId)
      if (!node) {
        return {
          ok: false,
          error: `镜 ${shotNoOf(shot)} 不在画布上，无法解析参考连线。下一步：刷新画布或重新导入分镜后重试`,
        }
      }
      const request = buildShotVideoRequest({
        data: node.data,
        nodeId: node.id,
        nodes: ctx.nodes,
        characters: ctx.characters,
        missingMedia: ctx.missingMedia,
        model: ctx.model,
        resolution: ctx.resolution,
      })
      return {
        ok: true,
        shotId: wantId,
        no: shotNoOf(shot),
        episode: Number(shot.episode) || 0,
        mode: request.mode,
        seconds: request.seconds,
        shotSeconds: request.shotSeconds,
        resolution: request.resolution,
        refs: request.refs.map((r) => ({
          index: r.index,
          label: r.label,
          purpose: r.purpose,
          source: r.source ?? '',
        })),
        refTotal: request.refs.length,
        omitted: request.omitted,
        omittedVideos: request.omittedVideos,
        video: request.video
          ? { label: request.video.label, purpose: request.video.purpose }
          : null,
        audio: request.audio
          ? { label: request.audio.label, purpose: request.audio.purpose, character: request.audio.character ?? '' }
          : null,
        // 有 blocking 时这份输入还发不出去：先按提示补正文或补连线
        blocking: request.blocking.map((b) => ({ code: b.code, message: b.message })),
        warnings: request.warnings.map((w) => ({ code: w.code, message: w.message })),
        fingerprint: request.fingerprint,
        promptEmpty: !request.prompt.trim(),
        note: '正文由人或 Agent 写入（video_prompt / submit_prompts / set_shot_video_override），运行时不再追加任何段落。',
      }
    },
  })

  /**
   * 转场出片输入读取：与分镜的 `read_shot_video_inputs` 对等。
   * 有序参考、省略项、互斥原因与请求时长全部取自出片同一处的预览计算，
   * 不给正文（正文用 read_shot_detail 的 transition_out.generated.prompt）。
   */
  const readTransitionVideoInputs = defineTool({
    name: 'read_transition_video_inputs',
    description:
      '只读：读取某个镜间转场（接缝）出片请求的实际输入——输入模式、桥接方式、是否提交尾帧、镜头秒数与请求秒数、' +
      '按提交顺序排列的参考图槽位（index 从 1 起）、被互斥或截断的参考与原因、参考视频与音轨。' +
      '同时回候选参考池（candidates：能选什么、各自是否已提交）与原生音频就绪度（audio.caps / audio.sample / readinessReason），' +
      '以及一句 candidateSummary。' +
      '用它来写转场正文：参考图按这里的 index 对应 [图N]，不要凭 refIds 臆测顺序。' +
      '本工具不返回正文；正文用 read_shot_detail 读 transition_out.generated.prompt，写入用 submit_joins。' +
      '补参考用 attach_transition_refs，开关角色音色用 set_transition_audio。',
    schema: z.object({
      after_no: z.string().describe('接缝前镜（源镜）的镜号，如 S03'),
      to_no: z
        .string()
        .optional()
        .describe('接缝后镜（目标镜）的镜号；省略时取源镜 transition_out.to 指向的镜头'),
      episode: z.number().int().min(1).optional().describe('第 N 集，用于消歧'),
    }),
    run: async ({ after_no, to_no, episode }) => {
      const found = await locateShot(shotsData, { no: after_no, episode })
      if (!found.ok) return found
      const sourceShot = found.shot
      const project = await snapshot()
      const ctx = shotVideoInputsContext(project, adapter.shotVideoContext?.())
      const sourceId = shotIdOf(sourceShot)
      const sourceNode = ctx.nodes.find((n) => String(n.data?.shotId ?? '') === sourceId)
      if (!sourceNode) {
        return {
          ok: false,
          error: `镜 ${shotNoOf(sourceShot)} 不在画布上，无法解析转场参考。下一步：刷新画布或重新导入分镜后重试`,
        }
      }
      const out = sourceNode.data.transitionOut
      if (!out) {
        return {
          ok: false,
          error: `镜 ${shotNoOf(sourceShot)} 未配置转场（transition_out 为空）。下一步：先用 submit_joins 建立接缝，或在画布上连线后重试`,
        }
      }
      // 目标镜：显式镜号优先；否则按 transition_out.to 的稳定键（shotId 或节点 id）找回
      let targetNode: ShotNodeType | undefined
      if (to_no) {
        const target = await locateShot(shotsData, { no: to_no, episode })
        if (!target.ok) return target
        const targetId = shotIdOf(target.shot)
        targetNode = ctx.nodes.find((n) => String(n.data?.shotId ?? '') === targetId)
        if (!targetNode) {
          return {
            ok: false,
            error: `镜 ${shotNoOf(target.shot)} 不在画布上，无法解析转场参考。下一步：刷新画布或重新导入分镜后重试`,
          }
        }
      } else {
        const wanted = String(out.to ?? '')
        targetNode =
          ctx.nodes.find((n) => String(n.data?.shotId ?? '') === wanted) ??
          ctx.nodes.find((n) => n.id === wanted)
        if (!targetNode) {
          return {
            ok: false,
            error: `转场目标「${wanted || '(空)'}」找不到对应镜头。下一步：用 read_shots 确认镜号，或用 submit_joins 重设接缝`,
          }
        }
      }

      const preview = buildTransitionVideoPreview({
        source: sourceNode,
        target: targetNode,
        generated: out.generated,
        model: transitionModelOf(ctx.model),
        nodes: ctx.nodes,
        characters: ctx.characters,
        missingMedia: ctx.missingMedia,
      })
      const recordedTo = String(out.to ?? '')
      const refView = transitionRefCandidateView({
        source: sourceNode,
        target: targetNode,
        nodes: ctx.nodes,
        characters: ctx.characters,
        missingMedia: ctx.missingMedia,
        generated: out.generated,
      })
      const audioReadiness = transitionNativeAudioReadiness({
        source: sourceNode,
        target: targetNode,
        characters: ctx.characters,
        model: transitionModelOf(ctx.model),
        targetSeconds: preview.seconds,
        submitsLastFrame: preview.submitsLastFrame,
      })
      return {
        ok: true,
        seam: {
          after_no: shotNoOf(sourceShot),
          after_shot_id: sourceId,
          to_no: String(targetNode.data?.no ?? ''),
          recorded_to: recordedTo,
          mode: out.mode,
          overridden: Boolean(to_no) && recordedTo !== String(targetNode.data?.shotId ?? ''),
        },
        inputMode: preview.inputMode,
        bridging: preview.bridging,
        submitsLastFrame: preview.submitsLastFrame,
        supportsLastFrame: preview.supportsLastFrame,
        seconds: preview.seconds,
        requestSeconds: preview.requestSeconds,
        ...(preview.trimTo ? { trimTo: preview.trimTo } : {}),
        modelLabel: preview.modelLabel ?? '',
        refs: preview.refs.map((r) => ({
          index: r.index,
          label: r.label,
          purpose: r.purpose,
          source: r.source ?? '',
        })),
        refTotal: preview.refs.length,
        submittedStyleCount: preview.submittedStyleCount,
        styleRefs: preview.styleRefs.map((r) => ({
          token: r.token,
          label: r.label,
          kind: r.kind,
          submitted: r.submitted,
          ...(r.omittedReason ? { omittedReason: r.omittedReason } : {}),
        })),
        styleOmitted: preview.styleOmitted.map((r) => ({ token: r.token, label: r.label, reason: r.reason })),
        omitted: preview.omitted,
        omittedVideos: preview.omittedVideos,
        candidates: refView.candidates,
        candidateSummary: refView.summary,
        video: preview.video ? { label: preview.video.label, purpose: preview.video.purpose } : null,
        audio: {
          mode: preview.audio.mode,
          label: preview.audio.label,
          detail: preview.audio.detail,
          ...(preview.audio.character ? { character: preview.audio.character } : {}),
          caps: audioReadiness.caps,
          sample: audioReadiness.sample,
          ...(audioReadiness.reason ? { readinessReason: audioReadiness.reason } : {}),
        },
        blocking: preview.blocking.map((b) => ({ code: b.code, message: b.message })),
        warnings: preview.warnings.map((w) => ({ code: w.code, message: w.message })),
        promptSource: preview.promptSource,
        promptStale: preview.promptStale,
        promptEmpty: !preview.prompt.trim(),
        note: '正文由人或 Agent 写入（submit_joins 的 generated.prompt），运行时不再追加任何段落。',
      }
    },
  })

  const readAssetInventory = defineTool({
    name: 'read_asset_inventory',
    description:
      '只读：项目物料地图。默认只回各分类计数（characters/scenes/props/assets/whitebox + 内置运镜库）；' +
      '传 category + includeRows:true 时回该分类的轻量行，每行带 key，可原样传给 read_asset_detail。' +
      '不含白模代码正文，也不含图片/视频数据地址。',
    schema: z.object({
      category: z.enum(MATERIAL_CATEGORIES).optional().describe('要列明细的分类；省略则只回计数'),
      includeRows: z.boolean().optional().describe('true 时回该分类的行；须同时给 category'),
      kind: z
        .string()
        .optional()
        .describe('assets 细分过滤：image / video / audio / scene / prop / expression-sheet'),
      q: z.string().optional().describe('标题或类型关键词'),
      limit: z.number().int().min(1).max(MATERIAL_ROW_LIMIT).optional().describe('默认 50'),
    }),
    run: async ({ category, includeRows, kind, q, limit }) => {
      let project: ProjectData
      try {
        project = await snapshot()
      } catch (e) {
        return { ok: false, error: (e as Error).message || '读取项目失败' }
      }

      const assetRows = assetMaterialRows(project, adapter)
      const assetsByKind: Record<string, number> = {}
      for (const row of assetRows) {
        const k = row.kind || 'image'
        assetsByKind[k] = (assetsByKind[k] || 0) + 1
      }
      let cameraLexicon = 0
      try {
        const { getCameraLexiconCatalog } = await import('../cameraLexicon')
        cameraLexicon = getCameraLexiconCatalog().count
      } catch {
        cameraLexicon = 0
      }
      const counts = {
        characters: materialRowsOf(project, 'characters').length,
        scenes: materialRowsOf(project, 'scenes').length,
        props: materialRowsOf(project, 'props').length,
        assets: assetRows.length,
        whitebox: materialRowsOf(project, 'whitebox').length,
        assetsByKind,
        cameraLexicon,
      }
      const projectName = String(project.name || '')

      if (!category || !includeRows) {
        return {
          ok: true,
          project: projectName,
          counts,
          ...(includeRows && !category ? { note: 'includeRows 需要同时给 category' } : {}),
          next: category
            ? `传 includeRows: true 查看 ${category} 明细`
            : '传 category + includeRows:true 看某分类明细；再 read_asset_detail({category,key}) 取单条。内置运镜库用 list_camera_lexicon 检索，whitebox 只含项目自定义白模。',
        }
      }

      let rows = category === 'assets' ? assetMaterialRows(project, adapter) : materialRowsOf(project, category)
      if (category === 'assets' && kind) {
        const want = String(kind).trim()
        rows = rows.filter((r) => r.kind === want)
      }
      const query = String(q || '').trim().toLowerCase()
      if (query) {
        rows = rows.filter(
          (r) =>
            r.title.toLowerCase().includes(query) || String(r.kind || '').toLowerCase().includes(query),
        )
      }
      const total = rows.length
      const page = rows.slice(0, limit ?? 50)
      return {
        ok: true,
        project: projectName,
        category,
        total,
        truncated: total > page.length,
        rows: page,
        ...(total > page.length
          ? { note: '结果被 limit 截断；可用 q 收窄，或直接用 read_asset_detail 取单条' }
          : {}),
        next: '用 read_asset_detail({category, key}) 取单条完整记录',
      }
    },
  })

  const readAssetDetail = defineTool({
    name: 'read_asset_detail',
    description:
      '只读：按 category + key 取单条物料完整记录。key 原样取自 read_asset_inventory（素材卡 key 即其 url）。' +
      '白模默认不返回代码正文，需要时传 includeCode:true。',
    schema: z.object({
      category: z.enum(MATERIAL_CATEGORIES),
      key: z.string().min(1).describe('read_asset_inventory 返回的 key，原样回传'),
      includeCode: z
        .boolean()
        .optional()
        .describe('仅 whitebox：true 时返回 Blender 代码（超长会截断）'),
    }),
    run: async ({ category, key, includeCode }) => {
      let project: ProjectData
      try {
        project = await snapshot()
      } catch (e) {
        return { ok: false, error: (e as Error).message || '读取项目失败' }
      }
      const wanted = String(key).trim()
      const rows =
        category === 'assets' ? assetMaterialRows(project, adapter) : materialRowsOf(project, category)
      // 素材卡有三种等价写法：inventory 的 key（url）、裸 canvasId、`asset-<canvasId>`
      const wantedCanvasId =
        category === 'assets' ? (wanted.startsWith(ASSET_TOKEN_PREFIX) ? wanted.slice(ASSET_TOKEN_PREFIX.length) : wanted) : ''
      const matched = rows.some(
        (r) =>
          r.key === wanted ||
          (category === 'assets' &&
            Boolean(r.canvasId) &&
            (r.canvasId === wanted || r.canvasId === wantedCanvasId)),
      )
      if (!matched) {
        return {
          ok: false,
          error: `在 ${category} 里找不到 key「${wanted}」`,
          availableKeys: rows.slice(0, 10).map((r) => r.key),
          hint: `可用分类：${MATERIAL_CATEGORIES.join(' / ')}；先用 read_asset_inventory 取 key` +
            (category === 'assets' ? '（素材卡也接受 canvasId 或 asset-<canvasId>）' : ''),
        }
      }

      if (category === 'characters') {
        // 透传原始形状：只按 id/name 找卡，蛇形与驼峰字段名一致
        const list = Array.isArray(project.characters) ? project.characters : []
        const hit = list.find((raw) => {
          const o = asRecord(raw)
          return String(o.id || o.name || '').trim() === wanted
        })
        if (!hit) return { ok: false, error: `角色「${wanted}」读取失败` }
        return { ok: true, category, key: wanted, ...singleRecord(hit) }
      }

      if (category === 'scenes' || category === 'props') {
        const want = category === 'scenes' ? 'scene' : 'prop'
        const list = Array.isArray(project.designs) ? project.designs : []
        const hit = list.find(
          (raw) =>
            String(asRecord(raw).kind || '') === want && String(asRecord(raw).id || '') === wanted,
        )
        if (!hit) return { ok: false, error: `设定卡「${wanted}」读取失败` }
        return { ok: true, category, key: wanted, ...singleRecord(hit) }
      }

      if (category === 'assets') {
        const list = Array.isArray(project.assets) ? project.assets : []
        const hit = list.find((raw) => {
          const o = asRecord(raw)
          const url = String(o.url || '').trim()
          if (url && url === wanted) return true
          const cid = String(o.canvasId || '').trim()
          return Boolean(cid) && (cid === wanted || cid === wantedCanvasId)
        })
        const row = rows.find(
          (r) =>
            r.key === wanted ||
            Boolean(r.canvasId) &&
              (r.canvasId === wanted || r.canvasId === wantedCanvasId || r.key === wanted),
        )
        if (hit) return { ok: true, category, key: wanted, ...singleRecord(hit) }
        if (row) {
          return {
            ok: true,
            category,
            key: row.key,
            record: {
              title: row.title,
              kind: row.kind,
              url: row.url ?? row.key,
              ...(row.canvasId ? { canvasId: row.canvasId } : {}),
              ...(row.characterName ? { characterName: row.characterName } : {}),
              ...(row.designId ? { designId: row.designId } : {}),
            },
            note: '该素材卡可能尚未落库，字段来自画布实况',
          }
        }
        return { ok: false, error: `素材卡「${wanted}」读取失败` }
      }

      // whitebox：代码必须显式请求
      const list = Array.isArray(project.lexiconWhitebox) ? project.lexiconWhitebox : []
      const hit = list.find((raw) => String(asRecord(raw).id || '').trim() === wanted)
      if (!hit) return { ok: false, error: `白模「${wanted}」读取失败` }
      const o = asRecord(hit)
      const sceneCode = asRecord(o.sceneCode)
      const code = typeof sceneCode.code === 'string' ? sceneCode.code : ''
      const { code: _omitCode, ...codeHead } = sceneCode
      const base: Record<string, unknown> = {
        id: String(o.id || ''),
        title: String(o.title || o.id || ''),
        seconds: o.seconds ?? null,
        motionNote: String(o.motionNote || ''),
        hasVideo: Boolean(o.video),
        video: String(o.video || ''),
        updatedAt: String(o.updatedAt || ''),
        codeChars: code.length,
      }
      if (Object.keys(codeHead).length) base.sceneCode = codeHead
      if (!includeCode) {
        return {
          ok: true,
          category,
          key: wanted,
          record: base,
          note: '代码未返回；需要代码时传 includeCode: true',
        }
      }
      const truncated = code.length > MATERIAL_CODE_MAX
      return {
        ok: true,
        category,
        key: wanted,
        record: {
          ...base,
          ...(Object.keys(codeHead).length || code
            ? {
                sceneCode: {
                  ...codeHead,
                  code: truncated ? code.slice(0, MATERIAL_CODE_MAX) : code,
                },
              }
            : {}),
        },
        codeChars: code.length,
        truncated,
        ...(truncated ? { note: `代码超过 ${MATERIAL_CODE_MAX} 字符已截断` } : {}),
      }
    },
  })

  const readSkill = createReadSkillTool()

  const readByName = new Map<string, ToolDef>([
    [readSkill.name, readSkill],
    [readSource.name, readSource],
    [readEpisodes.name, readEpisodes],
    [readCharacters.name, readCharacters],
    [readDesigns.name, readDesigns],
    [readShots.name, readShots],
    [readShotDetail.name, readShotDetail],
    [readShotVideoPrompt.name, readShotVideoPrompt],
    [readShotVideoInputs.name, readShotVideoInputs],
    [readTransitionVideoInputs.name, readTransitionVideoInputs],
    [readTransitionRecipes.name, readTransitionRecipes],
    [listCameraLexicon.name, listCameraLexicon],
    [getCameraLexicon.name, getCameraLexicon],
    [readEpisode.name, readEpisode],
    [readAssetInventory.name, readAssetInventory],
    [readAssetDetail.name, readAssetDetail],
  ])

  const contractId = adapter.writeContract
  const submitSchema = getContractToolSchema(contractId)
  if (!submitSchema) throw new Error(`未知输出契约：${contractId}`)
  const plan = pagingPlan(contractId)
  const submit = defineTool({
    name: adapter.writeTool,
    description:
      '提交当前工作台的产物草稿。写入当前项目并返回新增/更新数量；大产物不要重复贴给用户。' +
      (plan
        ? `\n支持分批：可选 limit（本批最多条数）与 cursor（上一批回执里的 nextCursor）。` +
          `一次提交超限时会返回 suggestedLimit 与 hint，按提示拆批即可，未写完的部分留在宿主，不必重发。`
        : '') +
      (contractWriteHint(contractId) ? `\n${contractWriteHint(contractId)}` : ''),
    schema: submitSchema,
    run: async (rawPayload) => {
      // 分页字段是传输层参数，必须先剥离再校验：契约 schema 不知道它们的存在。
      const { cursor: rawCursor, limit: rawLimit, ...rest } = rawPayload as Record<string, unknown>
      const cursor = typeof rawCursor === 'string' ? rawCursor.trim() : ''
      const limit = Number(rawLimit) > 0 ? Math.floor(Number(rawLimit)) : 0
      const fingerprint = fingerprintOf(adapter.ownDraft?.())
      const reread = plan?.reread || '对应的 read_* 读取工具'
      const collection = plan ? readCollection(rest, plan.key) : null

      let pendingItems: unknown[] | null = null
      let cursorSeq = 0
      if (cursor) {
        if (!plan) {
          return { ok: false, error: `契约 ${contractId} 不支持分批写入；请一次提交完整载荷` }
        }
        const read = readCursor(cursor, contractId, fingerprint)
        if (!read.ok) return { ok: false, error: read.error, hint: read.hint }
        // 同一次游标调用可以只带游标（承接宿主留存的剩余条目），也可以补带新条目。
        pendingItems = read.pending?.items || null
        cursorSeq = read.data.seq
      }

      const baseLimit = limit || plan?.defaultLimit || 0
      const incomingItems = collection ? collection.items : []
      const incoming = pendingItems ? [...pendingItems, ...incomingItems] : incomingItems.slice()
      let batch = rest
      let remainingItems: unknown[] = []
      let partial = false

      if (plan && (incoming.length > 0 || pendingItems !== null)) {
        // 先按条数切；再按字符上限收窄，保证单批请求不会撑爆模型输出。
        const byCount = baseLimit > 0 ? incoming.slice(0, baseLimit) : incoming
        const taken = takeBatchByChars(byCount, SUBMIT_CHAR_LIMIT, Math.max(1, byCount.length))
        const accepted = taken ? taken.batch : []
        // 字符预算没吃掉的首批尾部 + 超出条数上限的部分，都留到下一批
        remainingItems = [...(taken ? (taken.rest as unknown[]) : byCount), ...incoming.slice(byCount.length)]
        batch = withCollection(rest, plan.key, accepted) as Record<string, unknown>
        // 只要这次调用属于分批流程（带游标或还有剩余），写回就必须走 partial，
        // 否则未提交的镜头会被当成「已删除」。
        partial = Boolean(cursor) || remainingItems.length > 0
      }

      // 单条自身就超过字符上限：不写入任何数据，直接给拆条建议。
      const chars = JSON.stringify(batch).length
      if (chars > SUBMIT_CHAR_LIMIT) {
        const count = incomingItems.length || 1
        const suggestedLimit = Math.max(1, Math.min(count, Math.floor(SUBMIT_CHAR_LIMIT / 4000)))
        return {
          ok: false,
          error: `本次提交约 ${chars} 字符，超过单次上限 ${SUBMIT_CHAR_LIMIT}；未写入任何数据`,
          suggestedLimit,
          hint:
            `请改用 limit=${suggestedLimit} 分批提交（可同时带 cursor 承接上一批），` +
            `或先用 ${reread} 确认现状再缩小单条内容`,
        }
      }

      const normalized =
        contractId === 'characters-v1' ? normalizeCharactersContractPayload(batch) : batch
      const checked = validateContract(contractId, normalized)
      if (!checked.ok) return { ok: false, error: `提交不符合契约：${checked.errors.join('；')}` }
      const body = checked.value as Record<string, unknown>
      const gate = adapter.promptRenderGate
      if (gate && adapter.writeContract === 'prompt-renders-v1') {
        if (gate.kind === 'shot') {
          const shots = Array.isArray(body.shots) ? body.shots : []
          if (shots.length !== 1) {
            return { ok: false, error: `本改稿会话仅允许写回镜号 ${gate.shotNo}，收到 ${shots.length} 条` }
          }
          const no = String((shots[0] as Record<string, unknown>).no || '')
          if (no && no !== gate.shotNo) {
            return { ok: false, error: `镜号须为 ${gate.shotNo}，收到 ${no}` }
          }
        } else {
          const joins = Array.isArray(body.joins) ? body.joins : []
          if (joins.length !== 1) {
            return { ok: false, error: '本改稿会话仅允许写回一条接缝' }
          }
          const j = joins[0] as Record<string, unknown>
          if (String(j.after_no) !== gate.afterNo || String(j.to_no) !== gate.toNo) {
            return { ok: false, error: `接缝须为 ${gate.afterNo}→${gate.toNo}` }
          }
        }
      }
      const applied = await adapter.applyDraft(checked.value, { partial })
      adapter.onDraftChanged?.()
      if (!applied.ok) return { ok: false, error: applied.error || applied.summary }

      const acceptedCount =
        plan && Array.isArray((checked.value as Record<string, unknown>)?.[plan.key])
          ? ((checked.value as Record<string, unknown>)[plan.key] as unknown[]).length
          : 0
      let nextCursor: string | undefined
      if (plan && remainingItems.length) {
        // 指纹要在本批写入之后取：下一批校验的是「本批写完之后」的状态。
        const nextFingerprint = fingerprintOf(adapter.ownDraft?.())
        const last = remainingItems[remainingItems.length - 1]
        const lastKey = String((last as Record<string, unknown>)?.[plan.identity] ?? '')
        nextCursor = stashPending(contractId, remainingItems, nextFingerprint, cursorSeq + 1, lastKey)
        // 旧游标写成功后才消费，失败批次还能重试
        if (cursor) consumeCursor(cursor)
      } else if (cursor) {
        consumeCursor(cursor)
      }

      return {
        ok: true,
        summary: applied.summary,
        ...(applied.counts ? { counts: applied.counts } : {}),
        ...(plan
          ? {
              accepted: acceptedCount,
              remaining: remainingItems.length,
              ...(nextCursor ? { nextCursor } : {}),
              ...(remainingItems.length
                ? {
                    hint: `还有 ${remainingItems.length} 条未写入：带 cursor=${nextCursor} 再提交一次即可（不必重发已写入的数据）。`,
                  }
                : { hint: '本批已写完，没有后续批次。' }),
            }
          : {}),
        // 回执上的「用它生成三视图」靠它定位目标角色，不解析文本
        ...(applied.subjects?.length ? { subjects: applied.subjects } : {}),
        ...(applied.hash ? { hash: applied.hash } : {}),
      }
    },
  })

  const byName = new Map(readByName)
  byName.set(submit.name, submit)

  if (adapter.promptRenderBundle) {
    const readBundle = defineTool({
      name: 'read_prompt_render_bundle',
      description: '读取当前镜头或转场接缝的 PromptRenderBundle（只读）。',
      schema: z.object({}),
      run: async () => {
        const bundle = adapter.promptRenderBundle?.() ?? null
        if (!bundle) return { ok: false, error: 'bundle 不可用' }
        // 整份返回：模板渲染的正文要能逐字核对，不能折叠成 preview
        return { ok: true, bundle: bundle as PromptRenderBundle }
      },
    })
    readByName.set(readBundle.name, readBundle)
    byName.set(readBundle.name, readBundle)
  }

  return {
    read: readByName,
    submit,
    byName,
    resetSnapshot: () => {
      snapshotPromise = null
    },
  }
}

/**
 * 绑定技能声明的工具：宿主技能可读写；只读技能只能拿到读工具。
 * 技能声明了运行时没有的工具时直接跳过（装载期已校验，不静默假装可用）。
 */
/** Pi 创意等无工作台 adapter 的场景：仅注册 read_skill，其余能力由技能自行在对话中完成或后续扩展。 */
function createReadSkillTool(): ToolDef {
  return defineTool({
    name: 'read_skill',
    description:
      '读取已解析的工作台技能：完整 SKILL.md 与 manifest（tools/inputs/契约）。工作台宿主优先用此工具。',
    schema: z.object({
      id: z.string().min(1).describe('技能 id，例如 character、asset、shotlist、transition-director'),
    }),
    run: async ({ id }) => {
      try {
        const skill = await getSkill(String(id).trim())
        return {
          ok: true,
          id: skill.id,
          profile: skill.profile || 'workbench',
          version: skill.manifest.version,
          source: skill.source,
          tools: skill.manifest.tools,
          inputs: skill.manifest.inputs,
          output: skill.manifest.output,
          contracts: skill.manifest.contracts,
          text: skill.text,
        }
      } catch (e) {
        return { ok: false, error: (e as Error).message || String(e) }
      }
    },
  })
}

/** 技能列表行：描述原样输出，不按字符裁剪 */
export function skillSummaryRow(s: Skill) {
  const files = skillAttachmentList(s.id)
  return {
    id: s.id,
    name: s.manifest.name || s.id,
    description: s.manifest.description || '',
    stage: s.manifest.stage,
    profile: s.profile || 'workbench',
    source: s.source,
    version: s.manifest.version,
    readWith: (s.profile || 'workbench') === 'agent-pack' ? 'read_skill_text' : 'read_skill',
    /** 包内附加文件：非空时用 read_skill_file 按需读取，不要把全文当正文拼进上下文 */
    files: files.map((f) => f.path),
    fileCount: files.length,
    /** 安装记录在、目录不在：正文可用但包内文件缺失，用户需重装；别让模型反复试读 */
    ...(s.filesMissing ? { filesMissing: true } : {}),
  }
}

type PiNativeToolDeps = {
  expertAllowlist?: () => readonly string[] | null | undefined
}

function createListInstalledSkillsTool(deps?: PiNativeToolDeps): ToolDef {
  return defineTool({
    name: 'list_installed_skills',
    description:
      '列出当前已安装的技能目录（id、名称、环节、profile、来源）。不确定技能 id 时先调用本工具，再用 read_skill_text（Agent 包）或 read_skill（工作台技能）读取正文。',
    schema: z.object({
      stage: z.string().optional().describe('按环节过滤，例如 creative、character'),
      profile: z.enum(['workbench', 'agent-pack']).optional().describe('按 profile 过滤'),
      hostsOnly: z
        .boolean()
        .optional()
        .describe('为 true 时仅返回可作创意宿主的 Agent 技能包（不按安装来源过滤）'),
    }),
    run: async ({ stage, profile, hostsOnly }) => {
      const { skills, issues } = await loadSkills()
      let list = [...skills.values()]
      const stageFilter = stage ? String(stage).trim() : ''
      if (stageFilter) {
        list = list.filter((s) => s.manifest.stage === (stageFilter as Stage))
      }
      if (profile) {
        list = list.filter((s) => (s.profile || 'workbench') === profile)
      }
      if (hostsOnly) {
        list = list.filter(isCreativeHostSkill)
      }
      const allowIds = deps?.expertAllowlist?.()
      let restrictedCount = 0
      if (allowIds && allowIds.length > 0) {
        const allow = new Set(allowIds.map((id) => String(id)))
        const before = list.length
        list = list.filter((s) => allow.has(s.id))
        restrictedCount = before - list.length
      }
      list.sort((a, b) => (a.manifest.name || a.id).localeCompare(b.manifest.name || b.id, 'zh'))
      return {
        ok: true,
        count: list.length,
        skills: list.map((s) => skillSummaryRow(s)),
        loadIssues: issues.map((x) => ({ id: x.id, message: x.message })),
        ...(restrictedCount > 0
          ? {
              restrictedCount,
              summary: `共 ${list.length} 个技能在本专家白名单内（另有 ${restrictedCount} 个已安装技能未列出）`,
            }
          : {}),
      }
    },
  })
}

function createListExpertsTool(): ToolDef {
  return defineTool({
    name: 'list_experts',
    description:
      '列出当前可用创意专家（id、名称、说明）。用户想换专家或未选专家时，先调用本工具推荐 id，并提示在创意顶栏「专家」下拉切换。',
    schema: z.object({}),
    run: async () => {
      try {
        const res = await fetch('/api/experts')
        const j = (await res.json()) as { ok?: boolean; experts?: Array<Record<string, unknown>>; message?: string }
        if (!res.ok || j.ok === false) {
          return { ok: false, error: j.message || `HTTP ${res.status}` }
        }
        const experts = Array.isArray(j.experts) ? j.experts : []
        return {
          ok: true,
          count: experts.length,
          experts: experts.map((e) => ({
            id: e.id,
            name: e.name,
            description: e.description,
            imageDescription: e.imageDescription,
            // skillIds 含 "*"：不逐个列技能，直接表示全部已安装技能
            skillCount: Array.isArray(e.skillIds)
              ? e.skillIds.includes('*')
                ? null
                : e.skillIds.length
              : 0,
            skillAll: Array.isArray(e.skillIds) && e.skillIds.includes('*'),
            toolCount: Array.isArray(e.toolIds) ? e.toolIds.length : 0,
            source: e.source,
          })),
        }
      } catch (e) {
        return { ok: false, error: (e as Error).message || String(e) }
      }
    },
  })
}

function createReadSkillTextTool(): ToolDef {
  return defineTool({
    name: 'read_skill_text',
    description:
      '读取任意已安装技能的 SKILL.md 原文（含 SkillHub / Agent 包）。宿主为 agent-pack 时应用此工具读宿主与其它技能。',
    schema: z.object({
      id: z.string().min(1).describe('技能 id，例如 short-drama、byted-sol-seedance-prompt'),
    }),
    run: async ({ id }) => {
      try {
        const sid = String(id).trim()
        const record = await getSkillTextRecord(sid)
        const meta = parseAgentPackMeta(record.id, record.text)
        let profile: string = 'agent-pack'
        let manifest: Record<string, unknown> | undefined
        try {
          const skill = await getSkill(sid)
          profile = skill.profile || 'workbench'
          manifest = {
            version: skill.manifest.version,
            tools: skill.manifest.tools,
            inputs: skill.manifest.inputs,
            output: skill.manifest.output,
            stage: skill.manifest.stage,
          }
        } catch {
          /* 仅原文可读 */
        }
        return {
          ok: true,
          id: record.id,
          profile,
          source: record.source,
          description: meta?.description || '',
          allowedTools: meta?.allowedTools || [],
          manifest,
          text: record.text,
        }
      } catch (e) {
        return { ok: false, error: (e as Error).message || String(e) }
      }
    },
  })
}

function createReadSkillFileTool(): ToolDef {
  return defineTool({
    name: 'read_skill_file',
    description:
      '读取技能包内的单个附件文件（references/、scripts/、assets/ 等相对路径）。先用 list_installed_skills 看该技能的 files 清单，再按需读一个文件；路径越界、文件不存在或超过单文件上限都会直接失败并说明原因。',
    schema: z.object({
      id: z.string().min(1).describe('技能 id，例如 short-drama-video-prompts'),
      path: z.string().min(1).describe('包内相对路径，例如 references/video-prompt-guide.md'),
    }),
    run: async ({ id, path }) => {
      try {
        const sid = String(id).trim()
        const rel = String(path || '').trim()
        if (!sid) return { ok: false, error: '缺少技能 id' }
        if (!rel) return { ok: false, error: '缺少文件路径' }
        const got = await readSkillFile(sid, rel)
        return {
          ok: true,
          id: sid,
          path: got.path,
          bytes: got.bytes,
          source: got.source,
          text: got.text,
        }
      } catch (e) {
        return { ok: false, error: (e as Error).message || String(e) }
      }
    },
  })
}

export function createPiNativeToolSet(deps?: PiNativeToolDeps): StageToolSet {
  const readSkill = createReadSkillTool()
  const readSkillText = createReadSkillTextTool()
  const readSkillFile = createReadSkillFileTool()
  const listSkills = createListInstalledSkillsTool(deps)
  const listExperts = createListExpertsTool()
  const byName = new Map<string, ToolDef>([
    [readSkill.name, readSkill],
    [readSkillText.name, readSkillText],
    [readSkillFile.name, readSkillFile],
    [listSkills.name, listSkills],
    [listExperts.name, listExperts],
  ])
  return { read: byName, byName }
}

/** 技能声明了、但本次绑定拿不到的工具；用于装载期可见提示与检查器如实展示 */
export type SkippedSkillTool = {
  skillId: string
  name: string
  reason: string
}

/**
 * 绑定技能声明的工具，并回报被跳过的名字。
 *
 * 跳过本身是合法行为（只读技能不能提交、技能可能声明别的场景的作业工具），
 * 但不能静默：调用方要能拿到「声明了却没绑定」的清单，检查器据此只展示真实可用的工具。
 */
export function bindSkillToolsDetailed(
  set: StageToolSet,
  loaded: LoadedSkill[],
): { tools: ToolDef[]; skipped: SkippedSkillTool[] } {
  const byName = new Map<string, ToolDef>()
  const skipped: SkippedSkillTool[] = []
  for (const { skill, mode } of loaded) {
    for (const name of skill.manifest.tools) {
      if (mode === 'readonly' && name.startsWith('submit_')) {
        skipped.push({ skillId: skill.id, name, reason: '只读技能不能使用写回工具' })
        continue
      }
      const tool = set.byName.get(name)
      if (tool) byName.set(name, tool)
      else skipped.push({ skillId: skill.id, name, reason: '运行时没有注册该工具' })
    }
  }
  const readSkillTool = set.byName.get('read_skill')
  if (readSkillTool) byName.set('read_skill', readSkillTool)
  const readSkillTextTool = set.byName.get('read_skill_text')
  if (readSkillTextTool) byName.set('read_skill_text', readSkillTextTool)
  const listSkillsTool = set.byName.get('list_installed_skills')
  if (listSkillsTool) byName.set('list_installed_skills', listSkillsTool)
  const listExpertsTool = set.byName.get('list_experts')
  if (listExpertsTool) byName.set('list_experts', listExpertsTool)
  return { tools: [...byName.values()], skipped }
}

export function bindSkillTools(
  set: StageToolSet,
  loaded: LoadedSkill[],
  opts?: { onSkipped?: (skipped: SkippedSkillTool[]) => void },
): ToolDef[] {
  const { tools, skipped } = bindSkillToolsDetailed(set, loaded)
  if (skipped.length) opts?.onSkipped?.(skipped)
  return tools
}
