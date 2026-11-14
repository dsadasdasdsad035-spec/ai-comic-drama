import { defineTool, type ToolDef } from '../agent/tool'

/** 创意聊天执行前须经用户确认集号的平台工具 */
export const CREATIVE_EPISODE_GATED_TOOLS = new Set([
  'read_shots',
  'read_episode',
  'read_episodes',
  'submit_shots',
  'submit_prompts',
  'submit_joins',
])

export const CREATIVE_TOOL_LABELS: Record<string, string> = {
  read_shots: '读取分镜表',
  read_episode: '读取单集摘要',
  read_episodes: '读取分集/场次',
  submit_shots: '写回分镜',
  submit_prompts: '写回提示词',
  submit_joins: '写回镜间接缝',
}

const READ_TOOLS_WITH_EPISODE_ARG = new Set(['read_shots', 'read_episode', 'read_episodes'])

export type CreativeToolParamConfirmRequest = {
  toolName: string
  toolLabel: string
  projectName: string
  /** 模型提议或顶栏默认集号 */
  episode: number
  modelEpisode?: number
}

export type CreativeToolParamGate = {
  projectName: string
  getEpNo: () => number
  setEpNo: (ep: number) => void
  /** 返回确认的集号；null 表示用户取消 */
  confirm: (req: CreativeToolParamConfirmRequest) => Promise<number | null>
}

export function shouldGateCreativeTool(name: string): boolean {
  return CREATIVE_EPISODE_GATED_TOOLS.has(name)
}

/** 专家白名单是否含分镜/集号相关工具（角色、素材专家通常为 false） */
export function expertUsesShotEpisodeTools(toolIds: string[]): boolean {
  return toolIds.some((t) => CREATIVE_EPISODE_GATED_TOOLS.has(t))
}

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' ? (value as Record<string, unknown>) : {}
}

/** 包装平台/技能工具：分镜相关调用前弹出确认卡并注入 episode */
export function wrapToolsForCreativeParamGate(tools: ToolDef[], gate: CreativeToolParamGate): ToolDef[] {
  return tools.map((tool) => {
    if (!shouldGateCreativeTool(tool.name)) return tool
    const label = CREATIVE_TOOL_LABELS[tool.name] || tool.name
    return defineTool({
      name: tool.name,
      description: tool.description,
      schema: tool.schema,
      run: async (args) => {
        const raw = asRecord(args)
        const modelEp =
          typeof raw.episode === 'number' && Number.isFinite(raw.episode) && raw.episode > 0
            ? Math.floor(raw.episode)
            : undefined
        const defaultEp = modelEp ?? gate.getEpNo()
        const chosen = await gate.confirm({
          toolName: tool.name,
          toolLabel: label,
          projectName: gate.projectName,
          episode: defaultEp,
          ...(modelEp !== undefined ? { modelEpisode: modelEp } : {}),
        })
        if (chosen === null) return { ok: false, error: '用户取消了工具调用' }
        gate.setEpNo(chosen)
        const merged: Record<string, unknown> = { ...raw }
        if (READ_TOOLS_WITH_EPISODE_ARG.has(tool.name)) merged.episode = chosen
        return tool.run(merged as never)
      },
    })
  })
}