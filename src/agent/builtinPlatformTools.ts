import { z } from 'zod'
import {
  createProject,
  generateImage,
  generateVoice,
  getProject,
  listMedia,
  mergeProjectShots,
  patchProject,
  startVideo,
  type ProjectAsset,
  type ProjectData,
  type ProjectShot,
} from '../api'
import {
  contractWriteHint,
  getContractToolSchema,
  normalizeCharactersContractPayload,
  validateContract,
} from '../skills/contracts'
import type { DraftApplyResult, WorkbenchChatAdapter, WriteTool } from './workbenchChat'
import { applyProjectDraft, PLATFORM_WRITE_TOOLS, type ProjectDraftCtx } from '../platform/projectDraft'
import { DEFAULT_EXPERT_PLATFORM_TOOLS } from '../creative/expertToolGroups'
import { ASPECT_OPTIONS, isAspectOption } from '../project/aspect'
import { resolveProdKind } from '../shotProdKind'
import { dialogueToText, parseDialogue } from '../prompts'
import { voiceFingerprint } from '../performance'
import { createStageToolSet, createPiNativeToolSet, type StageToolSet } from './stageTools'
import type { CharacterExpressionSheet, CharacterSheet } from '../characters'
import { readCharacters, type ProjectChar } from '../charMap'
import { createMaterialTools } from './materialTools'
import { defineTool, type ToolDef } from './tool'
import { collectShotReferences, limitReferences } from '../shotReferences'
import {
  buildShotVideoRequest,
  effectiveVideoPrompt,
  videoOmitToastMessages,
  type VideoModelInput,
} from '../videoPrompt'
import { buildShotNodes } from '../canvasShots'
import type { ShotNodeType } from '../data'

/** 新建项目目录名规则，与新建项目对话框一致 */
const PROJECT_NAME_RE = /^[a-zA-Z0-9_-]{1,40}$/

/** Seedream 多参考图上限，与画布「参考图超过 10 张」提示共用同一个数 */
const MAX_REFERENCE_IMAGES = 10

/** 破坏性动作的确认请求；宿主决定怎么问，工具只管要不要 */
export type BuiltinConfirmRequest = {
  action: 'create_project' | 'update_project_meta' | 'delete_shots'
  title: string
  detail: string
  payload?: Record<string, unknown>
}

export type BuiltinConfirm = (req: BuiltinConfirmRequest) => Promise<boolean>

export type BuiltinPlatformCtx = {
  projectName: string
  /** 数字或 getter：创意会话确认卡可在一轮对话中更新默认写回集号 */
  epNo: number | (() => number)
  /** 可选：工作台已加载项目时传入，避免重复拉取 */
  getSnapshot?: () => ProjectData | null
  setSnapshot?: (p: ProjectData) => void
  /** 项目数据被写回后的回调：宿主据此重新拉快照，让画布立刻看到 Agent 的改动 */
  onProjectDataChanged?: () => void | Promise<void>
  /**
   * 破坏性动作的确认通道。未提供时创建项目/改项目元信息/删镜头一律 fail-closed：
   * 没有用户见过的确认，就不该落库。
   */
  confirm?: BuiltinConfirm
  /**
   * 生成类动作的成本确认通道。未提供时出图/出片/配音一律 fail-closed：
   * 没有确认过的成本，就不该花钱。
   */
  askCost?: (req: BuiltinCostRequest) => Promise<boolean>
  /** 新建项目成功后由宿主决定是否切换上下文；工具自己不切 */
  onProjectCreated?: (name: string) => void | Promise<void>
  /**
   * 画布素材卡（节点 id + 标题）。按标题连素材参考时必须它：
   * 素材卡节点 id 是随机 uid，`project.assets` 里没有，靠猜会写出指不到任何卡片的 refIds。
   */
  getCanvasAssets?: () => { id: string; title: string; url: string }[]
  /**
   * 角色图片类变更：立即落库并同步界面状态。
   * 不走角色整表草稿的防抖合并——`mergeCharacters` 有意保留旧图片，用它写图会被静默丢弃。
   */
  commitCharacters?: (next: ProjectChar[]) => void | Promise<void>
  /** 表情总图八格裁剪；默认走浏览器 canvas 实现，测试可注入桩 */
  cropSheet?: (sheet: CharacterExpressionSheet, project: string) => Promise<{ sheet: CharacterExpressionSheet; errors: string[] }>
  /**
   * 素材卡写回后同步画布节点。
   * 只写 project.assets 不行：画布已有节点时不会再从 assets 重建，用户会看到「提交成功但画布上没有卡」。
   */
  onAssetsWritten?: (assets: ProjectAsset[]) => void | Promise<void>
  /**
   * 画布生成上下文：参考连线解析要节点、角色表与坏链集合。
   * 缺省时退化成「用项目快照重建节点」，素材卡 token 会解析不到（strict 下报错而不是静默丢参考）。
   */
  getCanvasContext?: () => {
    nodes: ShotNodeType[]
    characters: CharacterSheet[]
    missingMedia: Set<string>
  }
  /** 画布当前选中的视频模型；出片沿用同一个渠道，否则两条路径会落到不同模型 */
  getSelectedVideoModel?: () => VideoModelInput | null
  /** 画布当前出片分辨率 */
  getVideoResolution?: () => string
}

function resolveEpNo(input: BuiltinPlatformCtx): number {
  const raw = typeof input.epNo === 'function' ? input.epNo() : input.epNo
  const n = Number(raw)
  return Number.isFinite(n) && n > 0 ? n : 1
}

/**
 * 项目快照上下文。
 *
 * 这里刻意**不再做模块级缓存**：缓存只按项目名 key，宿主的写入（画布改镜头、
 * 角色落库、导入分镜）都不会让它失效，于是同一页面会话里第二轮及以后的工具
 * 会读到第一轮的旧数据；写工具还会把整条旧镜头写回，覆盖用户刚改的字段。
 * 读取一律走 ensureProjectLoaded 现取，同一轮内的读取由 stageTools 的快照
 * promise 兜住，不会重复请求。
 */
function draftCtx(input: BuiltinPlatformCtx, snapshot?: ProjectData | null): ProjectDraftCtx {
  return {
    projectName: input.projectName,
    epNo: typeof input.epNo === 'function' ? input.epNo : resolveEpNo(input),
    getSnapshot: () => {
      if (snapshot) return snapshot
      if (input.getSnapshot) return input.getSnapshot()
      return null
    },
    setSnapshot: (p) => {
      input.setSnapshot?.(p)
    },
    onProjectDataChanged: input.onProjectDataChanged,
    onAssetsWritten: input.onAssetsWritten,
  }
}

async function ensureProjectLoaded(input: BuiltinPlatformCtx): Promise<ProjectData> {
  if (input.getSnapshot) {
    const snap = input.getSnapshot()
    if (snap) return snap
  }
  const name = input.projectName.trim()
  if (!name) throw new Error('请先在顶栏选择项目，平台读/写工具需要项目上下文')
  const data = await getProject(name)
  input.setSnapshot?.(data)
  return data
}

/**
 * 参考解析上下文：优先宿主当前画布，否则用项目快照重建镜头节点。
 *
 * 重建只覆盖镜头；素材卡节点 id 是运行时生成的，快照里没有，所以无画布时
 * `asset-` token 必然解析不到——交给 strict 报错，而不是静默少送一张图。
 */
function generationContext(
  input: BuiltinPlatformCtx,
  project: ProjectData,
): { nodes: ShotNodeType[]; characters: CharacterSheet[]; missingMedia: Set<string> } {
  const host = input.getCanvasContext?.()
  const base = host?.nodes ?? []
  // buildShotNodes 会复用已有节点（保留位置与手改数据），并为缺画面的镜头补一张，
  // 这样 Agent 处理非当前集的镜头时也能拿到邻居关系。
  const shotNodes = buildShotNodes(base, project.shots ?? [])
  const others = base.filter((n) => !String((n.data as unknown as { shotId?: string })?.shotId ?? ''))
  return {
    nodes: [...shotNodes, ...others],
    characters: host?.characters ?? readCharacters(project.characters),
    missingMedia: host?.missingMedia ?? new Set<string>(),
  }
}

function shotNodeOf(nodes: ShotNodeType[], shot: ProjectShot): ShotNodeType | undefined {
  return nodes.find((n) => String(n.data?.shotId ?? '') === shot.id)
}

function createReadAdapter(input: BuiltinPlatformCtx): WorkbenchChatAdapter {
  const ctx = draftCtx(input)
  return {
    surface: 'shots',
    skillId: 'builtin-platform',
    stage: 'creative',
    artifact: 'characters',
    writeTool: 'submit_characters',
    writeContract: 'characters-v1',
    threadKey: { project: input.projectName || '(未选)', surface: 'shots', episode: resolveEpNo(input) },
    scope: () =>
      input.projectName ? `项目「${input.projectName}」· 第 ${resolveEpNo(input)} 集` : '未选项目',
    inputs: () => ({}),
    ownDraft: () => undefined,
    projectSnapshot: () => ensureProjectLoaded(input),
    applyDraft: () => ({ ok: false, summary: '', error: '请使用 submit_* 平台工具写回' }),
  }
}

function createSubmitTool(input: BuiltinPlatformCtx, writeTool: WriteTool, contractId: string): ToolDef {
  const schema = getContractToolSchema(contractId)
  if (!schema) throw new Error(`未知契约：${contractId}`)
  const row = PLATFORM_WRITE_TOOLS.find((x) => x.tool === writeTool)
  const label = row?.label || contractId
  const hint = contractWriteHint(contractId)
  return defineTool({
    name: writeTool,
    description:
      `【平台内置】提交${label}草稿。payload 须符合契约 ${contractId}；写入当前顶栏项目（无项目时报错）。` +
      (hint ? `\n${hint}` : ''),
    schema,
    run: async (payload) => {
      let project: ProjectData
      try {
        project = await ensureProjectLoaded(input)
      } catch (e) {
        return { ok: false, error: (e as Error).message || String(e) }
      }
      const normalized =
        contractId === 'characters-v1' ? normalizeCharactersContractPayload(payload) : payload
      const checked = validateContract(contractId, normalized)
      if (!checked.ok) return { ok: false, error: `提交不符合契约：${checked.errors.join('；')}` }
      // 用刚取到的快照做合并基准：旧缓存在这里会把其它字段按过期值写回
      const applied: DraftApplyResult = await applyProjectDraft(
        contractId,
        checked.value,
        draftCtx(input, project),
      )
      if (!applied.ok) return { ok: false, error: applied.error || applied.summary }
      return {
        ok: true,
        summary: applied.summary,
        ...(applied.counts ? { counts: applied.counts } : {}),
        ...(applied.subjects?.length ? { subjects: applied.subjects } : {}),
        ...(applied.hash ? { hash: applied.hash } : {}),
      }
    },
  })
}

const validateContractTool = defineTool({
  name: 'validate_contract',
  description:
    '【平台内置】仅校验 payload 是否符合指定契约（characters-v1 / shots-v1 等），不写入项目。',
  schema: z.object({
    contract: z.string().min(1).describe('契约 id，例如 shots-v1'),
    payload: z.unknown().describe('待校验 JSON'),
  }),
  run: async ({ contract, payload }) => {
    const id = String(contract).trim()
    const normalized = id === 'characters-v1' ? normalizeCharactersContractPayload(payload) : payload
    const checked = validateContract(id, normalized)
    if (!checked.ok) return { ok: false, errors: checked.errors }
    return { ok: true, contract: id, valid: true }
  },
})

const SUBMIT_TOOL_NAMES = new Set(PLATFORM_WRITE_TOOLS.map((x) => x.tool))

/**
 * 平台动作工具名：写「对某个具体对象做一件事」，而不是整表草稿。
 * 是否要确认由各工具自己决定（删镜头/建项目要确认，连参考不要），
 * 名单只负责登记「这些是动作工具」，避免与 `submit_*` 混淆。
 */
export const PLATFORM_ACTION_TOOL_NAMES = [
  'create_project',
  'update_project_meta',
  'delete_shots',
  'generate_keyframe',
  'generate_clip',
  'generate_voice',
  'link_shot_refs',
  'set_shot_camera_lexicon',
  'set_character_visual',
  'generate_character_views',
  'generate_expression_sheet',
] as const

/** 确认通道缺失或用户取消时统一的失败形状 */
async function requireConfirm(
  input: BuiltinPlatformCtx,
  req: BuiltinConfirmRequest,
): Promise<{ ok: true } | { ok: false; error: string }> {
  if (!input.confirm) {
    return { ok: false, error: `${req.title}需要用户确认，当前会话没有确认通道，已拒绝执行` }
  }
  let yes = false
  try {
    yes = await input.confirm(req)
  } catch (e) {
    return { ok: false, error: `确认失败：${(e as Error)?.message || String(e)}` }
  }
  if (!yes) return { ok: false, error: '用户取消了操作' }
  return { ok: true }
}

/** 新建项目：与界面入口同一套目录名规则；不切换当前项目 */
function createCreateProjectTool(input: BuiltinPlatformCtx): ToolDef {
  return defineTool({
    name: 'create_project',
    description:
      '【平台内置】新建项目。目录名只接受字母/数字/下划线/短横且不超过 40 字符；同名已存在时报错。' +
      '写前必须取得用户确认。本工具不会切换当前选中的项目，由界面决定是否切过去。',
    schema: z.object({
      name: z.string().min(1).describe('目录名（同时是项目文件夹名）'),
      title: z.string().optional().describe('显示标题；省略则同目录名'),
      style: z.string().optional().describe('全片画风'),
      aspect: z
        .enum(ASPECT_OPTIONS)
        .optional()
        .describe(`画幅，可选 ${ASPECT_OPTIONS.join(' / ')}；省略为 16:9`),
    }),
    run: async (args) => {
      const name = String(args.name || '').trim()
      if (!PROJECT_NAME_RE.test(name)) {
        return { ok: false, error: '目录名只能用字母/数字/下划线/短横，最长 40 字符' }
      }
      const aspect = args.aspect
      if (aspect !== undefined && !isAspectOption(aspect)) {
        return { ok: false, error: `画幅只能是 ${ASPECT_OPTIONS.join(' / ')}` }
      }
      const title = String(args.title || '').trim()
      const style = String(args.style || '').trim()
      const gate = await requireConfirm(input, {
        action: 'create_project',
        title: '新建项目',
        detail: `项目「${name}」${title ? `（标题：${title}）` : ''}${style ? `，画风：${style}` : ''}${aspect ? `，画幅：${aspect}` : ''}`,
        payload: { name, ...(title ? { title } : {}), ...(style ? { style } : {}), ...(aspect ? { aspect } : {}) },
      })
      if (!gate.ok) return gate
      try {
        await createProject(name, {
          ...(title ? { title } : {}),
          ...(style ? { style } : {}),
          ...(aspect ? { aspect } : {}),
        })
      } catch (e) {
        return { ok: false, error: (e as Error)?.message || String(e) }
      }
      void input.onProjectCreated?.(name)
      return {
        ok: true,
        summary: `已创建项目「${name}」；未切换当前项目`,
        name,
        projectSwitched: false,
      }
    },
  })
}

/** 项目元信息：只写传入字段 */
function createUpdateProjectMetaTool(input: BuiltinPlatformCtx): ToolDef {
  return defineTool({
    name: 'update_project_meta',
    description:
      '【平台内置】修改当前项目的标题、梗概、画风或画幅。只写传入的字段，其余保持原值；' +
      '写前必须取得用户确认。画风/画幅是出首帧与出片提示词的基准，改前先说明影响。',
    schema: z.object({
      title: z.string().optional().describe('项目显示标题'),
      logline: z.string().optional().describe('一句话梗概'),
      style: z.string().optional().describe('全片画风'),
      aspect: z
        .enum(ASPECT_OPTIONS)
        .optional()
        .describe(`画幅，可选 ${ASPECT_OPTIONS.join(' / ')}`),
    }),
    run: async (args) => {
      const title = args.title === undefined ? undefined : String(args.title).trim()
      const logline = args.logline === undefined ? undefined : String(args.logline).trim()
      const style = args.style === undefined ? undefined : String(args.style).trim()
      const aspect = args.aspect
      if (title !== undefined && !title) return { ok: false, error: '标题不能为空' }
      if (aspect !== undefined && !isAspectOption(aspect)) {
        return { ok: false, error: `画幅只能是 ${ASPECT_OPTIONS.join(' / ')}` }
      }
      const fields = [
        title !== undefined ? `标题 → ${title}` : '',
        logline !== undefined ? `梗概 → ${logline}` : '',
        style !== undefined ? `画风 → ${style}` : '',
        aspect !== undefined ? `画幅 → ${aspect}` : '',
      ].filter(Boolean)
      if (!fields.length) return { ok: false, error: '至少提交一个字段（title / logline / style / aspect）' }
      const checked = validateContract('project-meta-v1', {
        ...(title !== undefined ? { title } : {}),
        ...(logline !== undefined ? { logline } : {}),
        ...(style !== undefined ? { style } : {}),
        ...(aspect !== undefined ? { aspect } : {}),
      })
      if (!checked.ok) return { ok: false, error: `项目设定不合规：${checked.errors.join('；')}` }
      const name = input.projectName.trim()
      if (!name) return { ok: false, error: '请先在顶栏选择项目' }
      const gate = await requireConfirm(input, {
        action: 'update_project_meta',
        title: '修改项目设定',
        detail: `项目「${name}」：${fields.join('；')}`,
        payload: {
          ...(title !== undefined ? { title } : {}),
          ...(logline !== undefined ? { logline } : {}),
          ...(style !== undefined ? { style } : {}),
          ...(aspect !== undefined ? { aspect } : {}),
        },
      })
      if (!gate.ok) return gate
      const patch = {
        ...(title !== undefined ? { title } : {}),
        ...(logline !== undefined ? { logline } : {}),
        ...(style !== undefined ? { style } : {}),
        ...(aspect !== undefined ? { aspect } : {}),
      }
      try {
        await patchProject(name, patch)
      } catch (e) {
        return { ok: false, error: (e as Error)?.message || String(e) }
      }
      // 本地快照同步：title 在 ProjectData 里就是 name
      const snap = draftCtx(input).getSnapshot()
      if (snap) {
        draftCtx(input).setSnapshot({
          ...snap,
          ...(title !== undefined ? { name: title } : {}),
          ...(logline !== undefined ? { logline } : {}),
          ...(style !== undefined ? { style } : {}),
          ...(aspect !== undefined ? { aspect } : {}),
        })
      }
      input.onProjectDataChanged?.()
      return { ok: true, summary: `项目设定已更新：${fields.join('；')}` }
    },
  })
}

/** 删除镜头：按当前集镜号解析 id，走既有的显式删除通道 */
function createDeleteShotsTool(input: BuiltinPlatformCtx): ToolDef {
  return defineTool({
    name: 'delete_shots',
    description:
      '【平台内置】删除当前项目当前集的分镜（按镜号）。写前必须取得用户确认。' +
      '不存在的镜号会在回执里列出，不影响其余镜号被删除。',
    schema: z.object({
      nos: z.array(z.string()).min(1).describe('要删除的镜号，例如 ["S03","S04"]'),
      episode: z.number().int().min(1).optional().describe('集号；省略用当前集'),
    }),
    run: async ({ nos, episode }) => {
      const name = input.projectName.trim()
      if (!name) return { ok: false, error: '请先在顶栏选择项目' }
      let project: ProjectData
      try {
        project = await ensureProjectLoaded(input)
      } catch (e) {
        return { ok: false, error: (e as Error)?.message || String(e) }
      }
      const ep = Number(episode) > 0 ? Math.floor(Number(episode)) : resolveEpNo(input)
      const wanted = [...new Set(nos.map((x) => String(x ?? '').trim()).filter(Boolean))]
      if (!wanted.length) return { ok: false, error: '镜号列表为空' }
      const byNo = new Map<string, string>()
      for (const s of project.shots || []) {
        if ((Number(s.episode) || 1) !== ep) continue
        const no = String(s.no ?? '').trim()
        if (no && s.id) byNo.set(no, String(s.id))
      }
      const ids: string[] = []
      const missing: string[] = []
      for (const no of wanted) {
        const id = byNo.get(no)
        if (id) ids.push(id)
        else missing.push(no)
      }
      if (!ids.length) {
        return { ok: false, error: `第 ${ep} 集找不到镜号：${missing.join('、')}` }
      }
      const gate = await requireConfirm(input, {
        action: 'delete_shots',
        title: '删除分镜',
        detail: `第 ${ep} 集：${wanted.filter((n) => byNo.has(n)).join('、')}（共 ${ids.length} 镜）${
          missing.length ? `；找不到：${missing.join('、')}` : ''
        }`,
        payload: { episode: ep, nos: wanted },
      })
      if (!gate.ok) return gate
      const drop = new Set(ids)
      const remaining = (project.shots || []).filter((s) => !drop.has(String(s.id)))
      try {
        // 整表写回：remaining 是删除后的全集，按 full 让服务端对缺席镜做保护性标记
        await mergeProjectShots(name, remaining, { deleteShotIds: ids, mode: 'full' })
      } catch (e) {
        return { ok: false, error: (e as Error)?.message || String(e) }
      }
      draftCtx(input).setSnapshot({ ...project, shots: remaining })
      input.onProjectDataChanged?.()
      return {
        ok: true,
        summary: `已删除 ${ids.length} 镜${missing.length ? `；${missing.length} 个镜号不存在` : ''}`,
        counts: { deleted: ids.length, missing: missing.length },
        ...(missing.length ? { missingNos: missing } : {}),
      }
    },
  })
}

/** 成本确认请求：出图/出片/配音都要先让用户看见钱 */
export type BuiltinCostRequest = {
  action: 'generate_keyframe' | 'generate_clip' | 'generate_voice' | 'generate_character_views' | 'generate_expression_sheet'
  title: string
  detail: string
  payload?: Record<string, unknown>
}

/** 成本确认通道：未提供时生成类工具一律 fail-closed */
async function requireCost(
  input: BuiltinPlatformCtx,
  req: BuiltinCostRequest,
): Promise<{ ok: true } | { ok: false; error: string }> {
  if (!input.askCost) {
    return { ok: false, error: `${req.title}需要成本确认，当前会话没有确认通道，已拒绝执行` }
  }
  let yes = false
  try {
    yes = await input.askCost(req)
  } catch (e) {
    return { ok: false, error: `成本确认失败：${(e as Error)?.message || String(e)}` }
  }
  if (!yes) return { ok: false, error: '用户取消了本次生成（未发起请求）' }
  return { ok: true }
}

function findShot(project: ProjectData, ep: number, no: string): ProjectShot | undefined {
  const want = String(no ?? '').trim()
  return (project.shots || []).find((s) => (Number(s.episode) || 1) === ep && String(s.no ?? '').trim() === want)
}

/** 把单镜改动写回项目：只发这一镜，服务端按 id 字段级合并 */
async function writeShotBack(
  input: BuiltinPlatformCtx,
  project: ProjectData,
  next: ProjectShot,
): Promise<{ ok: true } | { ok: false; error: string }> {
  const name = input.projectName.trim()
  try {
    // 局部写回（不标孤儿）：只发这一镜，其余镜头在服务端原样保留
    await patchProject(name, { shots: [next], shotsMode: 'partial' })
  } catch (e) {
    return { ok: false, error: (e as Error)?.message || String(e) }
  }
  const shots = (project.shots || []).map((s) => (s.id === next.id ? next : s))
  draftCtx(input).setSnapshot({ ...project, shots })
  input.onProjectDataChanged?.()
  return { ok: true }
}

/** 出首帧：只对生图镜开放；成功写 keyframe 并追加候选，不碰参考连线 */
function createGenerateKeyframeTool(input: BuiltinPlatformCtx): ToolDef {
  return defineTool({
    name: 'generate_keyframe',
    description:
      '【平台内置】给一个生图镜生成首帧。只对工位为「生图」的镜开放；出片镜请先切回生图。' +
      '会把该镜画布连线上的角色三视图、素材图与表情参考作为多参考图送出（上限 10 张），没连线就是纯提示词出图。' +
      '连线指向的角色没有三视图、素材卡不在画布上时直接失败且不发起请求。' +
      '生成前必须取得成本确认。成功写回该镜 keyframe 并追加候选；不创建素材卡、不改参考连线。',
    schema: z.object({
      no: z.string().min(1).describe('镜号，例如 S03'),
      prompt: z.string().optional().describe('首帧提示词；省略用该镜已存的首帧提示词'),
      episode: z.number().int().min(1).optional().describe('集号；省略用当前集'),
    }),
    run: async ({ no, prompt, episode }) => {
      const name = input.projectName.trim()
      if (!name) return { ok: false, error: '请先在顶栏选择项目' }
      let project: ProjectData
      try {
        project = await ensureProjectLoaded(input)
      } catch (e) {
        return { ok: false, error: (e as Error)?.message || String(e) }
      }
      const ep = Number(episode) > 0 ? Math.floor(Number(episode)) : resolveEpNo(input)
      const shot = findShot(project, ep, no)
      if (!shot) return { ok: false, error: `第 ${ep} 集找不到镜号 ${String(no).trim()}` }
      const kind = resolveProdKind(shot)
      if (kind !== 'image') {
        return {
          ok: false,
          error: `镜 ${shot.no} 的工位是出片，不能直接出首帧。下一步：在画布把该镜切回生图，或改用 generate_clip。`,
          prodKind: kind,
        }
      }
      const text = String(prompt ?? '').trim() || String(shot.keyframe_prompt ?? '').trim() || String(shot.desc ?? '').trim()
      if (!text) {
        return {
          ok: false,
          error: `镜 ${shot.no} 还没有首帧提示词。下一步：先用 submit_shots 写入 keyframe_prompt 或 desc，再出图。`,
        }
      }
      // 参考解析放在成本确认之前：注定出一张没参考的图，就不该先问用户花不花这笔钱
      const ctx = generationContext(input, project)
      const node = shotNodeOf(ctx.nodes, shot)
      if (!node) {
        return { ok: false, error: `镜 ${shot.no} 不在画布上，无法解析参考连线。下一步：刷新画布后重试` }
      }
      const collected = collectShotReferences({
        node,
        nodes: ctx.nodes,
        characters: ctx.characters,
        missingMedia: ctx.missingMedia,
        strict: true,
      })
      if (collected.missing.length) {
        const first = collected.missing[0]
        return {
          ok: false,
          error: `${first.label}：${first.reason}。下一步：补上参考素材后重试，或在画布删除这条参考连线`,
        }
      }
      // 与画布同构：不占「当前镜预览」位，全部额度留给连线参考（Seedream 上限 10 张）
      const limited = limitReferences(collected.refs, MAX_REFERENCE_IMAGES)
      const refUrls = limited.used.map((r) => r.url)
      const refLabels = limited.used.map((r, i) => `图${i + 1}=${r.label}`)
      const finalPrompt = refLabels.length
        ? `${text}\n\n参考图说明：${refLabels.join('，')}。对应主体必须与参考图保持一致。`
        : text
      const omittedNotes = limited.omitted.map((r) => r.label)
      const ratio = String(project.aspect || '').trim() || '16:9'
      const gate = await requireCost(input, {
        action: 'generate_keyframe',
        title: '生成首帧',
        detail: `项目「${name}」第 ${ep} 集 镜 ${shot.no}，画幅 ${ratio}（单张）· 参考图 ${refUrls.length} 张`,
        payload: { project: name, episode: ep, no: shot.no, ratio, refs: refUrls.length },
      })
      if (!gate.ok) return gate
      let urls: string[] = []
      try {
        const res = await generateImage({
          prompt: finalPrompt,
          ratio,
          n: 1,
          project: name,
          ...(refUrls.length ? { refImages: refUrls } : {}),
        })
        urls = (res.urls?.length ? res.urls : [res.url]).filter(Boolean)
      } catch (e) {
        return { ok: false, error: (e as Error)?.message || String(e) }
      }
      const primary = urls[0]
      if (!primary) return { ok: false, error: '生图渠道没有返回图片地址' }
      // 本次结果放候选首位：画布按 activeIdx（默认 0）取当前图，重开就能看到新图
      const candidates = [primary, ...(shot.candidates || []).filter((u) => u && u !== primary)]
      const next: ProjectShot = { ...shot, keyframe: primary, candidates }
      const written = await writeShotBack(input, project, next)
      if (!written.ok) return written
      return {
        ok: true,
        summary: `镜 ${shot.no} 已出首帧并写回${refUrls.length ? `（参考 ${refUrls.length} 张）` : ''}`,
        no: shot.no,
        keyframe: primary,
        candidates,
        refs: refUrls.length,
        ...(omittedNotes.length ? { omitted: omittedNotes } : {}),
      }
    },
  })
}

/**
 * 出片：只提交任务，立即返回 jobId。
 *
 * 视频经常超过一轮对话的时长预算，等下去会把整轮拖死；结果由既有任务中心轮询落库。
 */
function createGenerateClipTool(input: BuiltinPlatformCtx): ToolDef {
  return defineTool({
    name: 'generate_clip',
    description:
      '【平台内置】为一个分镜提交出片任务，提交成功立刻返回 jobId，不等成片。' +
      '参考图、参考视频、音频与首帧由该镜画布连线经统一拼装决定，并沿用画布当前视频模型与分辨率；' +
      '既没有首帧也没有连线参考时会拒绝提交。' +
      '生成前必须取得成本确认。成片由任务中心轮询落库，这里不会写 clip 字段。',
    schema: z.object({
      no: z.string().min(1).describe('镜号，例如 S03'),
      prompt: z.string().optional().describe('出片提示词；省略用该镜已存的视频提示词'),
      episode: z.number().int().min(1).optional().describe('集号；省略用当前集'),
    }),
    run: async ({ no, prompt, episode }) => {
      const name = input.projectName.trim()
      if (!name) return { ok: false, error: '请先在顶栏选择项目' }
      let project: ProjectData
      try {
        project = await ensureProjectLoaded(input)
      } catch (e) {
        return { ok: false, error: (e as Error)?.message || String(e) }
      }
      const ep = Number(episode) > 0 ? Math.floor(Number(episode)) : resolveEpNo(input)
      const shot = findShot(project, ep, no)
      if (!shot) return { ok: false, error: `第 ${ep} 集找不到镜号 ${String(no).trim()}` }
      const text =
        String(prompt ?? '').trim() ||
        String(shot.video_prompt_rendered ?? '').trim() ||
        String(shot.video_prompt ?? '').trim() ||
        String(shot.keyframe_prompt ?? '').trim() ||
        String(shot.desc ?? '').trim()
      if (!text) {
        return {
          ok: false,
          error: `镜 ${shot.no} 还没有出片提示词。下一步：先用 submit_prompts 或 submit_shots 写入视频提示词。`,
        }
      }
      const ratio = String(project.aspect || '').trim() || '16:9'
      const ctx = generationContext(input, project)
      const node = shotNodeOf(ctx.nodes, shot)
      if (!node) {
        return { ok: false, error: `镜 ${shot.no} 不在画布上，无法解析参考连线。下一步：刷新画布后重试` }
      }
      // 与画布出片同一个拼装入口：参考图/参考视频/音频/首帧/正文全部由它决定
      const videoModel = input.getSelectedVideoModel?.() ?? null
      const request = buildShotVideoRequest({
        data: node.data,
        nodeId: node.id,
        nodes: ctx.nodes,
        characters: ctx.characters,
        missingMedia: ctx.missingMedia,
        model: videoModel,
        resolution: input.getVideoResolution?.() ?? '',
      })
      const blocked = request.blocking[0]
      if (blocked) return { ok: false, error: `${blocked.message}（镜 ${shot.no}）` }
      const effective = effectiveVideoPrompt(request, node.data.videoPromptOverride)
      const seconds = request.seconds || Math.max(1, Number(shot.seconds) || 5)
      const imageUrls = request.refs.map((r) => r.url)
      const resolution = request.resolution === '480p' || request.resolution === '720p' ? request.resolution : undefined
      const modelKey = videoModel?.key || ''
      const omitted = videoOmitToastMessages(request)
      const gate = await requireCost(input, {
        action: 'generate_clip',
        title: '提交出片任务',
        detail:
          `项目「${name}」第 ${ep} 集 镜 ${shot.no}，${seconds}s，画幅 ${ratio}` +
          `，参考图 ${imageUrls.length} 张${request.video ? '，参考视频 1 条' : ''}` +
          `${request.mode === 'native' ? '，原生音频' : ''}`,
        payload: {
          project: name,
          episode: ep,
          no: shot.no,
          seconds,
          ratio,
          mode: request.mode,
          refs: imageUrls.length,
        },
      })
      if (!gate.ok) return gate
      try {
        const submitted = await startVideo({
          ...(request.mode === 'native'
            ? {
                refImages: imageUrls,
                generateAudio: true,
                ...(request.audio ? { audioRef: request.audio.url } : {}),
              }
            : request.video
              ? {
                  refVideos: [request.video.url],
                  ...(imageUrls.length > 0 ? { refImages: imageUrls } : {}),
                }
              : imageUrls.length > 0
                ? { refImages: imageUrls }
                : { image: request.firstFrame?.url || '' }),
          prompt: effective.text,
          seconds,
          ratio,
          ...(resolution ? { resolution } : {}),
          ...(request.video || request.mode === 'native' ? {} : { cameraFixed: node.data.move === '固定' }),
          ...(modelKey ? { modelKey } : {}),
        })
        return {
          ok: true,
          summary: `镜 ${shot.no} 出片任务已受理，成片由任务中心轮询落库`,
          no: shot.no,
          jobId: submitted.id,
          ...(submitted.mode ? { mode: submitted.mode } : {}),
          ...(omitted.length ? { omitted } : {}),
        }
      } catch (e) {
        return { ok: false, error: (e as Error)?.message || String(e) }
      }
    },
  })
}

/** 配音：成功写 audio_ref + voice_meta；失败不动原引用 */
function createGenerateVoiceTool(input: BuiltinPlatformCtx): ToolDef {
  return defineTool({
    name: 'generate_voice',
    description:
      '【平台内置】为一个分镜生成台词配音。文本省略时用该镜已有台词。' +
      '生成前必须取得成本确认；成功写回该镜声音引用与配音元数据，失败不改原值。',
    schema: z.object({
      no: z.string().min(1).describe('镜号，例如 S03'),
      text: z.string().optional().describe('要合成的台词；省略用该镜已有台词'),
      episode: z.number().int().min(1).optional().describe('集号；省略用当前集'),
    }),
    run: async ({ no, text, episode }) => {
      const name = input.projectName.trim()
      if (!name) return { ok: false, error: '请先在顶栏选择项目' }
      let project: ProjectData
      try {
        project = await ensureProjectLoaded(input)
      } catch (e) {
        return { ok: false, error: (e as Error)?.message || String(e) }
      }
      const ep = Number(episode) > 0 ? Math.floor(Number(episode)) : resolveEpNo(input)
      const shot = findShot(project, ep, no)
      if (!shot) return { ok: false, error: `第 ${ep} 集找不到镜号 ${String(no).trim()}` }
      const spoken = String(text ?? '').trim() || dialogueToText(shot.dialogue).trim()
      if (!spoken) {
        return { ok: false, error: `镜 ${shot.no} 没有台词。下一步：写入台词，或用 text 参数直接给要合成的文本。` }
      }
      const lines = parseDialogue(spoken)
      const speaker = String(lines[0]?.speaker ?? '').trim()
      const char = speaker
        ? readCharacters(project.characters).find((c) => c.name === speaker)
        : undefined
      const voiceId = String(char?.voiceId ?? '').trim()
      const gate = await requireCost(input, {
        action: 'generate_voice',
        title: '生成台词配音',
        detail: `项目「${name}」第 ${ep} 集 镜 ${shot.no}：${spoken.slice(0, 60)}${spoken.length > 60 ? '…' : ''}`,
        payload: { project: name, episode: ep, no: shot.no, speaker },
      })
      if (!gate.ok) return gate
      let voice
      try {
        voice = await generateVoice({
          text: spoken,
          project: name,
          ...(voiceId ? { voice: voiceId } : {}),
        })
      } catch (e) {
        return { ok: false, error: (e as Error)?.message || String(e) }
      }
      if (!voice.url) return { ok: false, error: '配音渠道没有返回音频地址' }
      const next: ProjectShot = {
        ...shot,
        audio_ref: { character: speaker || '旁白', url: voice.url },
        voice_meta: {
          engine: voice.engine,
          ...(voiceId ? { voice: voiceId } : {}),
          applied: voice.applied ?? [],
          unsupported: voice.unsupported ?? [],
          fingerprint: voiceFingerprint(spoken),
          createdAt: new Date().toISOString(),
        },
      }
      const written = await writeShotBack(input, project, next)
      if (!written.ok) return written
      return {
        ok: true,
        summary: `镜 ${shot.no} 已配音并写回`,
        no: shot.no,
        audio: voice.url,
        seconds: voice.seconds,
      }
    },
  })
}

/** 仅读 + 校验（与工作台 adapter 的 submit 草稿并存时用，避免重复 submit 名） */
export function createBuiltinPlatformReadTools(input: BuiltinPlatformCtx): ToolDef[] {
  return createBuiltinPlatformTools(input).filter((t) => !SUBMIT_TOOL_NAMES.has(t.name))
}

/** 始终提供给 Pi 的平台读/写工具（不依赖 SkillHub 技能 manifest） */
export function createBuiltinPlatformTools(input: BuiltinPlatformCtx): ToolDef[] {
  const reads = createStageToolSet(createReadAdapter(input))
  const pi = createPiNativeToolSet()
  const byName = new Map<string, ToolDef>()
  for (const t of reads.byName.values()) byName.set(t.name, t)
  for (const t of pi.byName.values()) byName.set(t.name, t)
  for (const { tool, contract } of PLATFORM_WRITE_TOOLS) {
    byName.set(tool, createSubmitTool(input, tool as WriteTool, contract))
  }
  byName.set(validateContractTool.name, validateContractTool)
  byName.set('create_project', createCreateProjectTool(input))
  byName.set('update_project_meta', createUpdateProjectMetaTool(input))
  byName.set('delete_shots', createDeleteShotsTool(input))
  byName.set('generate_keyframe', createGenerateKeyframeTool(input))
  byName.set('generate_clip', createGenerateClipTool(input))
  byName.set('generate_voice', createGenerateVoiceTool(input))
  for (const t of createMaterialTools({
    projectName: () => input.projectName,
    epNo: () => resolveEpNo(input),
    load: () => ensureProjectLoaded(input),
    setSnapshot: (p) => draftCtx(input).setSnapshot(p),
    onChanged: () => input.onProjectDataChanged?.(),
    writeShot: (project, next) => writeShotBack(input, project, next),
    askCost: input.askCost
      ? async (req) => {
          try {
            const yes = await input.askCost!(req as BuiltinCostRequest)
            return yes ? ({ ok: true } as const) : ({ ok: false, error: '用户取消了本次生成（未发起请求）' } as const)
          } catch (e) {
            return { ok: false, error: `成本确认失败：${(e as Error)?.message || String(e)}` } as const
          }
        }
      : undefined,
    getCanvasAssets: input.getCanvasAssets,
    commitCharacters: input.commitCharacters,
    cropSheet: input.cropSheet,
  })) {
    byName.set(t.name, t)
  }
  const tools = [...byName.values()]
  // 每次构造都校验：幽灵工具（名单有、注册无）必须当场暴露，不能带病启动
  assertPlatformToolConsistency(tools.map((t) => t.name))
  return tools
}

/** 平台内置工具名清单：技能 manifest、专家白名单与检查器都从这里取名字 */
const PLATFORM_READ_TOOL_NAMES = [
  'read_source',
  'read_episodes',
  'read_episode',
  'read_characters',
  'read_designs',
  'read_shots',
  'read_shot_detail',
  'read_shot_video_prompt',
  'read_transition_recipes',
  'read_asset_inventory',
  'read_asset_detail',
  'list_camera_lexicon',
  'get_camera_lexicon',
  'read_skill',
  'read_skill_text',
  'list_installed_skills',
  'list_experts',
]

export function builtinPlatformToolNames(): string[] {
  return [
    ...PLATFORM_READ_TOOL_NAMES,
    'validate_contract',
    ...PLATFORM_WRITE_TOOLS.map((x) => x.tool),
    ...PLATFORM_ACTION_TOOL_NAMES,
  ]
}

export type PlatformToolNameDiff = {
  /** 名单里有、运行时没注册 */
  declaredNotRegistered: string[]
  /** 运行时注册了、名单里没有 */
  registeredNotDeclared: string[]
  /** 默认专家白名单里有、名单里没有 */
  expertNotDeclared: string[]
}

/**
 * 比较名字清单与运行时注册。
 *
 * 留成纯函数是为了能直接测「少一个名字」的失败路径：真实工具集不容易造出幽灵工具，
 * 但清单与注册脱节恰恰是本变更要堵的那类事故。
 */
export function platformToolNameDiff(registered: Iterable<string>): PlatformToolNameDiff {
  const declared = new Set(builtinPlatformToolNames())
  const actual = new Set(registered)
  const expert = new Set(DEFAULT_EXPERT_PLATFORM_TOOLS)
  return {
    declaredNotRegistered: [...declared].filter((n) => !actual.has(n)),
    registeredNotDeclared: [...actual].filter((n) => !declared.has(n)),
    expertNotDeclared: [...expert].filter((n) => !declared.has(n)),
  }
}

/** 名字清单、运行时注册、默认专家白名单三者不一致时抛错并列出差异 */
export function assertPlatformToolConsistency(registered: Iterable<string>): void {
  const diff = platformToolNameDiff(registered)
  const problems: string[] = []
  if (diff.declaredNotRegistered.length) {
    problems.push(`清单有但未注册：${diff.declaredNotRegistered.join('、')}`)
  }
  if (diff.registeredNotDeclared.length) {
    problems.push(`已注册但未列入清单：${diff.registeredNotDeclared.join('、')}`)
  }
  if (diff.expertNotDeclared.length) {
    problems.push(`默认专家白名单不在清单里：${diff.expertNotDeclared.join('、')}`)
  }
  if (problems.length) {
    throw new Error(`平台工具清单不一致：${problems.join('；')}`)
  }
}

export function mergeBuiltinWithSkillTools(
  platform: ToolDef[],
  skillTools: ToolDef[],
): ToolDef[] {
  const byName = new Map<string, ToolDef>()
  for (const t of platform) byName.set(t.name, t)
  for (const t of skillTools) byName.set(t.name, t)
  return [...byName.values()]
}

export type { StageToolSet }