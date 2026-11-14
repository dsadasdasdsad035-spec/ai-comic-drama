import { z } from 'zod'
import { getProject, type ProjectData } from '../api'
import {
  getContractToolSchema,
  normalizeCharactersContractPayload,
  validateContract,
} from '../skills/contracts'
import type { DraftApplyResult, WorkbenchChatAdapter, WriteTool } from './workbenchChat'
import { applyProjectDraft, PLATFORM_WRITE_TOOLS, type ProjectDraftCtx } from '../platform/projectDraft'
import { createStageToolSet, createPiNativeToolSet, type StageToolSet } from './stageTools'
import { defineTool, type ToolDef } from './tool'

export type BuiltinPlatformCtx = {
  projectName: string
  /** 数字或 getter：创意会话确认卡可在一轮对话中更新默认写回集号 */
  epNo: number | (() => number)
  /** 可选：工作台已加载项目时传入，避免重复拉取 */
  getSnapshot?: () => ProjectData | null
  setSnapshot?: (p: ProjectData) => void
  onProjectDataChanged?: () => void
}

let projectCache: { name: string; data: ProjectData } | null = null

function resolveEpNo(input: BuiltinPlatformCtx): number {
  const raw = typeof input.epNo === 'function' ? input.epNo() : input.epNo
  const n = Number(raw)
  return Number.isFinite(n) && n > 0 ? n : 1
}

function draftCtx(input: BuiltinPlatformCtx): ProjectDraftCtx {
  return {
    projectName: input.projectName,
    epNo: typeof input.epNo === 'function' ? input.epNo : resolveEpNo(input),
    getSnapshot: () => {
      if (input.getSnapshot) return input.getSnapshot()
      if (!input.projectName.trim()) return null
      if (projectCache?.name === input.projectName) return projectCache.data
      return null
    },
    setSnapshot: (p) => {
      projectCache = { name: input.projectName, data: p }
      input.setSnapshot?.(p)
    },
    onProjectDataChanged: input.onProjectDataChanged,
  }
}

async function ensureProjectLoaded(input: BuiltinPlatformCtx): Promise<ProjectData> {
  const cached = draftCtx(input).getSnapshot()
  if (cached) return cached
  const name = input.projectName.trim()
  if (!name) throw new Error('请先在顶栏选择项目，平台读/写工具需要项目上下文')
  const data = await getProject(name)
  projectCache = { name, data }
  input.setSnapshot?.(data)
  return data
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
  return defineTool({
    name: writeTool,
    description:
      `【平台内置】提交${label}草稿。payload 须符合契约 ${contractId}；写入当前顶栏项目（无项目时报错）。`,
    schema,
    run: async (payload) => {
      try {
        await ensureProjectLoaded(input)
      } catch (e) {
        return { ok: false, error: (e as Error).message || String(e) }
      }
      const normalized =
        contractId === 'characters-v1' ? normalizeCharactersContractPayload(payload) : payload
      const checked = validateContract(contractId, normalized)
      if (!checked.ok) return { ok: false, error: `提交不符合契约：${checked.errors.join('；')}` }
      const applied: DraftApplyResult = applyProjectDraft(contractId, checked.value, draftCtx(input))
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
  return [...byName.values()]
}

export function builtinPlatformToolNames(): string[] {
  const readNames = [
    'read_source',
    'read_episodes',
    'read_episode',
    'read_characters',
    'read_designs',
    'read_shots',
    'read_transition_recipes',
    'read_asset_inventory',
    'read_asset_detail',
    'list_camera_lexicon',
    'get_camera_lexicon',
    'read_skill',
    'read_skill_text',
    'list_installed_skills',
    'list_experts',
    'validate_contract',
    ...PLATFORM_WRITE_TOOLS.map((x) => x.tool),
  ]
  return readNames
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