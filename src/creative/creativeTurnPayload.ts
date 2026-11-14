import type { AgentMessage } from '../agent/sceneAgentTypes'
import type { ChatAttachment } from '../agent/chatAttachments'
import type { WorkbenchProfile, WorkbenchTaskView } from '../agent/workbenchChat'
import { describePiThreadMemory, uiThreadToPiMessages } from '../agent/pi/threadMemory'
import { builtinPlatformToolNames } from '../agent/builtinPlatformTools'
import { isMarketInstalledSkill } from './creativeSkillHost'
import { isAgentPackSkill } from '../skills/agentPack'
import type { Skill } from '../skills/types'
import { expertHasAllSkills, type CreativeExpert } from './expertTypes'
import { expertToolNames } from './expertTools'
import { expertUsesShotEpisodeTools } from './creativeToolParamGate'

/** 创意会话检查器用的静态 profile（无草稿保存语义） */
export const CREATIVE_INSPECT_PROFILE: WorkbenchProfile = {
  title: '创意助手',
  emptyTitle: '',
  emptyBody: '',
  suggestions: [],
  placeholder: '',
  saveMode: 'immediate',
  inputLabels: {},
}

/** 物料盘点指引：自主模式与启用盘点工具的专家共用同一句（见 creative-asset-tools 规格） */
export const CREATIVE_MATERIAL_HINT =
  '不确定项目里有哪些角色、场景、道具、素材卡或自定义白模时，先调用 read_asset_inventory 取得各分类计数与 key，再按需用 read_asset_detail 取单条；不要凭猜测的 id 引用物料。'

const CREATIVE_PLATFORM_LINES = [
  '平台内置工具（read_* / submit_* / validate_contract / list_installed_skills / read_skill_text）始终可用；写项目前须已选顶栏项目。',
  CREATIVE_MATERIAL_HINT,
  '扩展能力：设置 → MCP 勾选的 HTTP 工具。',
]

export type CreativeWorkspaceCtx = {
  projectName?: string
  epNo?: number
}

export type CreativeWorkspaceFormatOpts = {
  /** 为 false 时不强调集号/分镜（角色、素材等项目级专家） */
  includeShotEpisode?: boolean
}

/** 创意 Pi system 共用的项目锚点；集号仅在与分镜类工具相关时说明 */
export function formatCreativeWorkspaceContext(
  ctx: CreativeWorkspaceCtx,
  opts?: CreativeWorkspaceFormatOpts,
): string {
  const name = String(ctx.projectName || '').trim()
  const includeShotEpisode = opts?.includeShotEpisode !== false
  const ep = Number(ctx.epNo) > 0 ? Number(ctx.epNo) : 1

  if (!includeShotEpisode) {
    if (!name) {
      return [
        '【当前上下文】',
        '项目：未选择（读/写项目数据前须先让用户在顶栏选项目）',
        '角色表与素材设定为项目级：read_characters / read_designs / submit_characters / submit_designs 不绑分集与镜头，无集号确认卡。',
      ].join('\n')
    }
    return [
      '【当前上下文】',
      `项目：${name}`,
      '角色与素材为项目级数据，不涉及集号与分镜；上述 read/submit 工具直接读写全项目角色表与设定卡。',
    ].join('\n')
  }

  if (!name) {
    return [
      '【当前上下文】',
      '项目：未选择（读/写项目数据前须先让用户在顶栏选项目）',
      `分镜默认集号：第 ${ep} 集（仅 read_shots / read_episode / submit_shots 等会弹出集号确认卡；角色与素材不绑集号）`,
    ].join('\n')
  }
  return [
    '【当前上下文】',
    `项目：${name}`,
    `分镜默认集号：第 ${ep} 集（仅分镜类工具执行前确认集号；read_characters / read_designs 等为项目级，不按集过滤）`,
  ].join('\n')
}

function withWorkspaceContext(
  body: string,
  workspace?: CreativeWorkspaceCtx,
  opts?: CreativeWorkspaceFormatOpts,
): string {
  const ctxBlock = workspace ? formatCreativeWorkspaceContext(workspace, opts) : ''
  if (!ctxBlock) return body
  return body ? `${body}\n\n${ctxBlock}` : ctxBlock
}

export function creativeWorkspaceNeedsShotEpisode(expert: CreativeExpert | null | undefined): boolean {
  if (!expert) return true
  return expertUsesShotEpisodeTools(expert.toolIds)
}

/** 无顶栏偏好宿主：由技能目录驱动 */
export function buildCreativePiSystemAutonomous(): string {
  return [
    '你是 Agent（Pi）。',
    '创意会话不要求用户预选技能。每轮先理解用户意图；在需要执行某套工作流、或用户问「有什么技能/该用哪个包」时，必须先调用 list_installed_skills（可选 hostsOnly 只看 Agent 包），用中文向用户说明推荐项，再对选定 id 调用 read_skill_text 读 SKILL.md 全文并严格遵循。',
    '同一对话中若已读过某技能全文，本轮未换任务类型时可不再重复读取；换技能或用户明确要求时再 read_skill_text。',
    ...CREATIVE_PLATFORM_LINES,
  ].join('\n')
}

/** 创意 Pi system：可选顶栏偏好宿主 + 目录发现 */
export function buildCreativePiSystem(
  host: Skill | null,
  workspace?: CreativeWorkspaceCtx,
  workspaceOpts?: CreativeWorkspaceFormatOpts,
): string {
  if (!host) return withWorkspaceContext(buildCreativePiSystemAutonomous(), workspace, workspaceOpts)

  const autonomous = buildCreativePiSystemAutonomous()
  if (isAgentPackSkill(host)) {
    const declared = host.agentPack?.allowedTools?.length
      ? host.agentPack.allowedTools.join('、')
      : '（未声明）'
    return withWorkspaceContext(
      [
        autonomous,
        '',
        '【顶栏偏好技能】用户在界面指定了默认包；与用户意图一致时优先 read_skill_text 读本 id，再执行。若用户明确要换包，先 list_installed_skills 再改读其它技能。',
        `偏好 id：${host.id} · v${host.manifest.version} · ${host.source}`,
        host.manifest.description ? `说明：${host.manifest.description.slice(0, 500)}` : '',
        'declared allowed-tools（仅对照，不自动绑定 Codex 壳）：' + declared,
      ]
        .filter(Boolean)
        .join('\n'),
      workspace,
      workspaceOpts,
    )
  }
  if (!isMarketInstalledSkill(host)) {
    return withWorkspaceContext(
      [autonomous, '', `【顶栏偏好】${host.id} 非 SkillHub Agent 包；仍可用 read_skill 读工作台技能。`].join('\n'),
      workspace,
      workspaceOpts,
    )
  }
  return withWorkspaceContext(
    [autonomous, '', '【顶栏偏好技能】优先 read_skill_text：' + `${host.id} · v${host.manifest.version}`].join('\n'),
    workspace,
    workspaceOpts,
  )
}

/** 本轮 composer 附件摘要，进入 user 前缀供模型与检查器看到 */
export function creativeAttachmentBlock(attachments: ChatAttachment[]): string {
  if (!attachments.length) return ''
  const lines = ['【本轮附件】']
  for (const a of attachments) {
    if (a.kind === 'image') {
      lines.push(`- 图片「${a.label}」`)
      continue
    }
    if (a.kind === 'video') {
      lines.push(`- 视频「${a.label}」${a.bytes ? `（${Math.round(a.bytes / 1024 / 1024)}MB）` : ''}（发送后将摄取到当前创意会话）`)
      continue
    }
    const body = String(a.text || '').trim()
    lines.push(
      `- ${a.kind === 'doc' ? '文档' : '文本'}「${a.label}」${body ? `：${body.slice(0, 200)}` : ''}`,
    )
  }
  return `${lines.join('\n')}\n\n`
}

/** 与 bindCreativeTools 过滤规则一致，仅用于展示 */
export function listCreativeToolNames(skills: Array<{ skill: Skill; mode: 'host' | 'readonly' }>): string[] {
  const names = new Set<string>()
  for (const { skill, mode } of skills) {
    for (const name of skill.manifest.tools) {
      if (
        mode === 'readonly' &&
        (name.startsWith('submit_') || name.startsWith('generate_') || name.startsWith('ingest_'))
      ) {
        continue
      }
      names.add(name)
    }
  }
  names.add('read_skill')
  names.add('read_skill_text')
  names.add('list_installed_skills')
  names.add('list_experts')
  for (const n of builtinPlatformToolNames()) names.add(n)
  return [...names].sort()
}

/** soul 占位符：项目/集/专家名/技能白名单 */
export function interpolateExpertSoul(
  soul: string,
  ctx: { projectName?: string; epNo?: number; expert: CreativeExpert },
): string {
  const skillIds = expertHasAllSkills(ctx.expert.skillIds)
    ? '全部已安装技能（*）'
    : ctx.expert.skillIds.length
      ? ctx.expert.skillIds.join('、')
      : '（空：禁止 read_skill*）'
  return String(soul || '')
    .replaceAll('{{projectName}}', ctx.projectName?.trim() || '未选项目')
    .replaceAll('{{epNo}}', String(ctx.epNo ?? 1))
    .replaceAll('{{expertName}}', ctx.expert.name)
    .replaceAll('{{expertId}}', ctx.expert.id)
    .replaceAll('{{skillIds}}', skillIds)
    .trim()
}

/** 专家模式：soul（占位符替换后）+ 统一的【当前上下文】 */
export function buildExpertSystem(
  expert: CreativeExpert,
  ctx: { projectName?: string; epNo?: number },
): string {
  const soul = interpolateExpertSoul(expert.soul, { ...ctx, expert })
  const workspaceOpts: CreativeWorkspaceFormatOpts = {
    includeShotEpisode: creativeWorkspaceNeedsShotEpisode(expert),
  }
  // 专家未启用盘点工具时不提示，避免让它调用白名单外的工具
  const materialHint = expert.toolIds.includes('read_asset_inventory') ? CREATIVE_MATERIAL_HINT : ''
  const body = [soul, materialHint].filter(Boolean).join('\n\n')
  return withWorkspaceContext(body, { projectName: ctx.projectName, epNo: ctx.epNo }, workspaceOpts)
}

export type CreativeTurnPayload = {
  system: string
  /** 本轮单条 user 正文（不含历史摘要） */
  userForModel: string
  toolNames: string[]
  /** 检查器展示：本轮历史规模说明（历史按原文送出） */
  piMemoryPreview: string
  priorPiMessages: ReturnType<typeof uiThreadToPiMessages>
}

export function buildCreativeTurnPayload(input: {
  host: Skill | null
  expert?: CreativeExpert | null
  projectName?: string
  epNo?: number
  messages: AgentMessage[]
  draftText: string
  attachments?: ChatAttachment[]
  extraToolNames?: string[]
}): CreativeTurnPayload {
  const attach = creativeAttachmentBlock(input.attachments || [])
  const draft = String(input.draftText || '').trim()
  const priorPiMessages = uiThreadToPiMessages(input.messages)
  const piMemoryPreview = describePiThreadMemory(input.messages, draft)

  if (input.expert) {
    const mcpExtra = (input.extraToolNames || []).filter((n) => input.expert!.toolIds.includes(n))
    return {
      system: buildExpertSystem(input.expert, {
        projectName: input.projectName,
        epNo: input.epNo,
      }),
      userForModel: attach + draft,
      toolNames: [...expertToolNames(input.expert), ...mcpExtra].sort(),
      piMemoryPreview,
      priorPiMessages,
    }
  }

  const workspace = { projectName: input.projectName, epNo: input.epNo }
  const bindings = input.host ? [{ skill: input.host, mode: 'host' as const }] : []
  return {
    system: buildCreativePiSystem(input.host, workspace),
    userForModel: attach + draft,
    toolNames: [...listCreativeToolNames(bindings), ...(input.extraToolNames || [])].sort(),
    piMemoryPreview,
    priorPiMessages,
  }
}

export function creativeTaskView(
  host: Skill | null,
  payload: CreativeTurnPayload,
  modelLabel: string,
  expert?: CreativeExpert | null,
): WorkbenchTaskView {
  return {
    system: payload.system,
    task: [payload.piMemoryPreview, payload.userForModel].filter(Boolean).join('\n\n'),
    inputs: {},
    references: [],
    missing: [],
    modelLabel,
    skillId: expert ? expert.id : host?.id || 'auto',
    skillTitle: expert ? `专家 · ${expert.name}` : host ? host.manifest.name || host.id : '自动（技能目录）',
    skillSource: expert ? (expert.source === 'custom' ? 'override' : 'builtin') : host?.source ?? 'builtin',
    skillVersion: expert ? 1 : host?.manifest.version ?? 0,
    readonly: expert
      ? expertHasAllSkills(expert.skillIds)
        ? []
        : expert.skillIds.map((id) => ({ id, version: 1 }))
      : [],
    readTools: payload.toolNames,
    saveMode: 'immediate',
  }
}