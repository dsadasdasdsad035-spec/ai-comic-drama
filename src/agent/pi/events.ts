import type { AgentEvent as PiAgentEvent } from '@earendil-works/pi-agent-core'
import type { AgentEvent } from '../sceneAgentTypes'
import { sanitizeToolInput } from '../sceneAgentEvents'
import { textMessageIdForTurn } from '../agentMessageReducer'

function contentText(content: unknown): string {
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

/** tool_execution_end 的 result 是 AgentToolResult；UI 要的是里面的 details。 */
function detailOf(result: unknown): unknown {
  if (result && typeof result === 'object' && 'details' in result) {
    return (result as { details?: unknown }).details
  }
  return result
}

export type PiEventBridge = {
  map: (event: PiAgentEvent) => AgentEvent[]
  readonly turnCount: number
}

/**
 * pi 事件 → 项目 AgentEvent。
 *
 * 三类事件与 LangGraph 引擎保持一致：步骤生命周期、文本生命周期、工具生命周期。
 * thinking_* 一律丢弃，不把隐藏推理带进 UI 或线程记录。
 */
export function createPiEventBridge(): PiEventBridge {
  let turn = 0
  let textStarted = false
  const startedTools = new Set<string>()
  const endedTools = new Set<string>()

  const map = (event: PiAgentEvent): AgentEvent[] => {
    switch (event.type) {
      case 'turn_start': {
        turn += 1
        textStarted = false
        return [{ type: 'agent_step', turn, phase: 'start' }]
      }

      case 'message_update': {
        const update = event.assistantMessageEvent
        if (update.type === 'text_start') {
          if (textStarted) return []
          textStarted = true
          return [{ type: 'text_message_start', messageId: textMessageIdForTurn(turn), role: 'assistant' }]
        }
        if (update.type === 'text_delta') {
          if (!textStarted) {
            textStarted = true
            return [
              { type: 'text_message_start', messageId: textMessageIdForTurn(turn), role: 'assistant' },
              { type: 'text_message_content', messageId: textMessageIdForTurn(turn), delta: update.delta },
            ]
          }
          return [{ type: 'text_message_content', messageId: textMessageIdForTurn(turn), delta: update.delta }]
        }
        // thinking_* / toolcall_* 不进事件流：工具生命周期由 tool_execution_* 负责。
        return []
      }

      case 'message_end': {
        if (event.message.role !== 'assistant') return []
        const events: AgentEvent[] = []
        if (textStarted) {
          events.push({ type: 'text_message_end', messageId: textMessageIdForTurn(turn) })
        }
        const text = contentText(event.message.content).trim()
        events.push({
          type: 'agent_step',
          turn,
          phase: 'end',
          ...(text ? { text } : {}),
        })
        return events
      }

      case 'tool_execution_start': {
        if (startedTools.has(event.toolCallId)) return []
        startedTools.add(event.toolCallId)
        return [
          {
            type: 'tool_start',
            toolCallId: event.toolCallId,
            toolName: event.toolName,
            args: sanitizeToolInput(event.args),
          },
        ]
      }

      case 'tool_execution_end': {
        if (endedTools.has(event.toolCallId)) return []
        endedTools.add(event.toolCallId)
        return [
          {
            type: 'tool_end',
            toolCallId: event.toolCallId,
            toolName: event.toolName,
            result: detailOf(event.result),
            isError: event.isError,
          },
        ]
      }

      // agent_start / agent_end / turn_end / message_start / tool_execution_update
      // 不产生独立事件：生命周期由门面统一收尾。
      default:
        return []
    }
  }

  return {
    map,
    get turnCount() {
      return turn
    },
  }
}
