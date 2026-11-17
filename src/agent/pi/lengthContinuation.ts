/**
 * 输出长度上限的续写规则：3D 调度与创意/工作台聊天共用一套次数与文案。
 *
 * 撞上限不是渠道失败：已流出的正文保留，模型被要求从断点接着做。
 * 但续写必须封顶，否则「一直写不完」会变成永不结束的循环——总时长与
 * 步数安全阀仍由各运行器兜底。
 */

/** 正文续写：让模型接着往下写 */
export const MAX_TEXT_CONTINUATIONS = 3
/** 工具参数续写：让模型改用拆批策略，而不是重写同一坨超长 payload */
export const MAX_TOOL_CONTINUATIONS = 2

export const TEXT_CONTINUATION_NUDGE =
  '上一次输出因长度上限被截断。请紧接着断点继续往下写，不要重复已经写过的内容，也不要重新输出已完成的段落。'

export const TOOL_CONTINUATION_NUDGE =
  '上一次工具调用因输出长度上限被截断，参数不完整，已整体丢弃且未执行。' +
  '请缩小单次输出：能给分页参数的写入工具就分批提交（limit + cursor），否则把一次调用拆成多次更小的调用；' +
  '不要重复已经成功写入的内容。'

/** 续写用尽后的可读错误：说明已保留什么、下一步该怎么做，以及这次的预算从哪来 */
export function lengthExhaustedMessage(
  kind: 'text' | 'tools',
  budget?: { maxTokens?: number; source?: 'configured' | 'stage-default' | 'unset' },
): string {
  const where =
    budget?.source === 'configured' && budget.maxTokens
      ? `本次上限 ${budget.maxTokens} tokens（设置页配置）`
      : budget?.maxTokens
        ? `本次上限 ${budget.maxTokens} tokens（环节默认）`
        : '本次上限为渠道默认（设置页未配置输出上限）'
  const head =
    kind === 'tools'
      ? `模型输出连续 ${MAX_TOOL_CONTINUATIONS} 次达到长度上限，工具参数始终无法完整生成；已保留生成内容，请缩小单次写入或改用分批提交`
      : `模型输出连续 ${MAX_TEXT_CONTINUATIONS} 次达到长度上限；已保留生成部分，可让它继续往下写，或把产出拆成更小的部分`
  return `${head}；${where}`
}
