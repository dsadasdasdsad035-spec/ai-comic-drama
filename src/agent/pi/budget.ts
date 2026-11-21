import type { AgentMessage } from '@earendil-works/pi-agent-core'

/**
 * 历史预算：送往模型的投影，不是持久化内容。
 *
 * 原则（与 creative-thread-context 的现行要求一致）：
 * 1. 最近若干轮的工具结果保持原文——模型正在用的东西不能被替换。
 * 2. 更早的工具结果换成一行指针 stub——原文没被改写，只是卸载；
 *    项目数据与技能全文都能用现有读工具重取，所以这是无损的。
 * 3. 仍超预算才摘要化更早的助手正文（有损兜底），并报告轮数。
 *
 * 界面历史与落库线程都不经过这里，工具卡片永远显示完整结果。
 */

/** 默认字符预算；与规格里既有的历史阈值口径一致（项目没有 tokenizer） */
export const HISTORY_BUDGET_CHARS = 48_000
/** 上下文超限重试时的激进预算：宁可让模型重读，也不能再被 400 挡住 */
export const AGGRESSIVE_HISTORY_BUDGET = 12_000
/** 原文保真的轮次数：最近几轮的工具体不能被卸载 */
export const HISTORY_KEEP_ROUNDS = 2

export type HistoryBudgetOptions = {
  budget?: number
  keepRounds?: number
}

export type HistoryBudgetResult = {
  messages: AgentMessage[]
  /** 被替换成指针 stub 的工具结果条数 */
  stubbed: number
  /** 被摘要化的更早助手正文条数 */
  summarized: number
  charsBefore: number
  charsAfter: number
}

type Shaped = { role?: unknown; content?: unknown; toolName?: unknown; toolCallId?: unknown }

function shape(message: AgentMessage): Shaped {
  return message as unknown as Shaped
}

function blocksOf(message: AgentMessage): unknown[] {
  const content = shape(message).content
  return Array.isArray(content) ? content : []
}

function textOfContent(content: unknown): string {
  if (typeof content === 'string') return content
  if (!Array.isArray(content)) return ''
  return content
    .map((part) => {
      if (!part || typeof part !== 'object') return ''
      const block = part as { type?: unknown; text?: unknown }
      return block.type === 'text' ? String(block.text ?? '') : ''
    })
    .filter(Boolean)
    .join('')
}

function sizeOf(messages: readonly AgentMessage[]): number {
  try {
    return JSON.stringify(messages).length
  } catch {
    return messages.length * 200
  }
}

/** 工具 → 重取入口。读写同名的工具直接用自己；其余给最接近的读工具提示。 */
const REREAD_HINTS: Record<string, string> = {
  read_shots: 'read_shots',
  read_shot_detail: 'read_shot_detail',
  read_shot_video_prompt: 'read_shot_video_prompt',
  read_shot_video_inputs: 'read_shot_video_inputs',
  read_episode: 'read_episode',
  read_episodes: 'read_episodes',
  read_characters: 'read_characters',
  read_designs: 'read_designs',
  read_asset_inventory: 'read_asset_inventory',
  read_asset_detail: 'read_asset_detail',
  read_skill: 'read_skill',
  read_skill_text: 'read_skill_text',
}

function rereadFor(toolName: string): string {
  const known = REREAD_HINTS[toolName]
  if (known) return known
  if (toolName.startsWith('submit_') || toolName.startsWith('generate_') || toolName.startsWith('ingest_')) {
    return '对应的 read_* 读取工具'
  }
  return toolName.startsWith('read_') ? toolName : '对应的 read_* 读取工具'
}

function stubText(toolName: string, original: string): string {
  const tool = toolName || '工具'
  const chars = original.length
  return `[${tool} 结果已卸载：约 ${chars} 字符；需要时用 ${rereadFor(toolName)} 重新读取]`
}

/**
 * 按预算投影历史。纯函数：不改写入参，不产生持久化副作用。
 *
 * @param messages 送往模型的历史（pi 的 AgentMessage）
 * @param opts     budget 字符预算；keepRounds 原文保真的轮次数
 */
export function applyHistoryBudget(
  messages: readonly AgentMessage[],
  opts: HistoryBudgetOptions = {},
): HistoryBudgetResult {
  const budget = Number.isFinite(opts.budget) ? Math.max(1, Math.floor(opts.budget!)) : HISTORY_BUDGET_CHARS
  const keepRounds = Number.isFinite(opts.keepRounds)
    ? Math.max(0, Math.floor(opts.keepRounds!))
    : HISTORY_KEEP_ROUNDS
  const charsBefore = sizeOf(messages)

  // 未超预算：一条都不动，避免「没超也在折叠」的隐性变化。
  if (charsBefore <= budget) {
    return { messages: [...messages], stubbed: 0, summarized: 0, charsBefore, charsAfter: charsBefore }
  }

  // 轮次边界：每条含工具调用的助手消息开启一轮，其后紧跟的 toolResult 属于该轮。
  const roundOf: number[] = []
  let round = -1
  messages.forEach((message, index) => {
    const role = shape(message).role
    if (role === 'assistant') {
      const hasToolCall = blocksOf(message).some(
        (part) => (part as { type?: unknown })?.type === 'toolCall',
      )
      if (hasToolCall) round += 1
    }
    roundOf[index] = round
  })
  const totalRounds = round + 1
  const keepFrom = Math.max(0, totalRounds - keepRounds)

  let stubbed = 0
  const afterStub = messages.map((message, index) => {
    if (shape(message).role !== 'toolResult') return message
    if (roundOf[index] >= keepFrom) return message
    const original = textOfContent(shape(message).content)
    if (!original) return message
    stubbed += 1
    return {
      ...(message as object),
      content: [{ type: 'text', text: stubText(String(shape(message).toolName || ''), original) }],
    } as AgentMessage
  })

  const charsAfterStub = sizeOf(afterStub)
  if (charsAfterStub <= budget) {
    return { messages: afterStub, stubbed, summarized: 0, charsBefore, charsAfter: charsAfterStub }
  }

  // 仍超预算：摘要化更早的助手正文（保留首行，避免模型把它当新指令）。
  let summarized = 0
  const afterSummary = afterStub.map((message, index) => {
    if (shape(message).role !== 'assistant') return message
    if (roundOf[index] >= keepFrom) return message
    const original = textOfContent(shape(message).content)
    if (!original) return message
    const head = original.split('\n').find((line) => line.trim())?.trim() || ''
    if (!head) return message
    summarized += 1
    const next = `[早期输出已摘要：${original.length} 字符] ${head.slice(0, 80)}`
    const rest = blocksOf(message).filter(
      (part) => (part as { type?: unknown })?.type !== 'text',
    )
    return {
      ...(message as object),
      content: [{ type: 'text', text: next }, ...rest],
    } as AgentMessage
  })

  return {
    messages: afterSummary,
    stubbed,
    summarized,
    charsBefore,
    charsAfter: sizeOf(afterSummary),
  }
}
