import type {
  AgentContextPart,
  AgentDraftPart,
  AgentEvent,
  AgentMessage,
  AgentStepPart,
  AgentTextPart,
  AgentToolPart,
} from './sceneAgentTypes'

/** 流式文本与模型轮次一一对应；重试会拿到新的 turn，因此 id 天然隔离。 */
export function textMessageIdForTurn(turn: number): string {
  return `msg-${turn}`
}

function appendText(message: AgentMessage, part: AgentTextPart): AgentMessage {
  return { ...message, parts: [...message.parts, part] }
}

function upsertStreamingText(message: AgentMessage, id: string): AgentMessage {
  if (message.parts.some((p) => p.type === 'text' && p.id === id)) return message
  return { ...message, parts: [...message.parts, { type: 'text', text: '', id, streaming: true }] }
}

function appendTextDelta(message: AgentMessage, id: string, delta: string): AgentMessage {
  if (!delta) return message
  let found = false
  const parts = message.parts.map((p) => {
    if (p.type !== 'text' || p.id !== id) return p
    found = true
    return { ...p, text: p.text + delta }
  })
  if (!found) parts.push({ type: 'text', text: delta, id, streaming: true })
  return { ...message, parts }
}

function endStreamingText(message: AgentMessage, id: string): AgentMessage {
  return {
    ...message,
    parts: message.parts.map((p) =>
      p.type === 'text' && p.id === id ? { ...p, streaming: false } : p,
    ),
  }
}

function endAllStreaming(message: AgentMessage): AgentMessage {
  return {
    ...message,
    parts: message.parts.map((p) => (p.type === 'text' && p.streaming ? { ...p, streaming: false } : p)),
  }
}

/** 最近一个模型轮次；用于把进度和错误挂到当前轮。 */
function currentTurn(message: AgentMessage): number | undefined {
  const steps = message.parts.filter((p): p is AgentStepPart => p.type === 'step')
  return steps.length ? steps[steps.length - 1].turn : undefined
}

function upsertStep(
  message: AgentMessage,
  turn: number,
  phase: AgentStepPart['phase'],
  text?: string,
): AgentMessage {
  const exists = message.parts.some((p) => p.type === 'step' && p.turn === turn)
  if (exists) {
    return {
      ...message,
      parts: message.parts.map((p) =>
        p.type === 'step' && p.turn === turn
          ? { ...p, phase, ...(text != null ? { text } : {}), ...(phase === 'end' ? { chars: undefined } : {}) }
          : p,
      ),
    }
  }
  return {
    ...message,
    parts: [...message.parts, { type: 'step', turn, phase, ...(text != null ? { text } : {}) }],
  }
}

function findTool(message: AgentMessage, toolCallId: string): AgentToolPart | undefined {
  return message.parts.find(
    (p): p is AgentToolPart => p.type === 'tool-call' && p.toolCallId === toolCallId,
  )
}

function updateTool(
  message: AgentMessage,
  toolCallId: string,
  patch: Partial<AgentToolPart>,
  fallbackName = 'tool',
): AgentMessage {
  const existing = findTool(message, toolCallId)
  if (!existing) {
    return {
      ...message,
      parts: [
        ...message.parts,
        {
          type: 'tool-call',
          toolCallId,
          toolName: fallbackName,
          status: 'running',
          startedAt: Date.now(),
          ...patch,
        },
      ],
    }
  }
  return {
    ...message,
    parts: message.parts.map((p) => (p === existing ? { ...p, ...patch } : p)),
  }
}

function upsertDraftPart(
  message: AgentMessage,
  draftId: string,
  patch: Partial<Omit<AgentDraftPart, 'type' | 'draftId'>>,
): AgentMessage {
  const exists = message.parts.some((p): p is AgentDraftPart => p.type === 'draft' && p.draftId === draftId)
  if (!exists) {
    return {
      ...message,
      parts: [
        ...message.parts,
        { type: 'draft', draftId, lines: 0, chars: 0, status: 'staged', ...patch },
      ],
    }
  }
  return {
    ...message,
    parts: message.parts.map((p) =>
      p.type === 'draft' && p.draftId === draftId ? { ...p, ...patch } : p,
    ),
  }
}

/**
 * 纯事件归约：只负责把一条事件并入当前助手消息。
 * 副作用（代码哈希、视频卡片等）仍由调用方处理。
 */
export function applyAgentEvent(message: AgentMessage, event: AgentEvent): AgentMessage {
  switch (event.type) {
    case 'agent_step': {
      // 有流式文本时，步骤结束不再重复写一遍模型说明。
      const streamed = message.parts.some(
        (p) => p.type === 'text' && p.id === textMessageIdForTurn(event.turn),
      )
      const text = event.phase === 'end' && streamed ? undefined : event.text
      return upsertStep(message, event.turn, event.phase, text)
    }

    case 'message':
      return appendText(message, { type: 'text', text: event.text })

    case 'text_message_start':
      return upsertStreamingText(message, event.messageId)

    case 'text_message_content':
      return appendTextDelta(message, event.messageId, event.delta)

    case 'text_message_end':
      return endStreamingText(message, event.messageId)

    case 'tool_start': {
      const existing = message.parts.find(
        (p): p is AgentToolPart =>
          p.type === 'tool-call' &&
          (p.toolCallId === event.toolCallId || p.toolName === event.toolName),
      )
      if (existing) {
        return {
          ...message,
          parts: message.parts.map((p) =>
            p === existing ? { ...p, status: 'running', args: event.args } : p,
          ),
        }
      }
      return {
        ...message,
        parts: [
          ...message.parts,
          {
            type: 'tool-call',
            toolCallId: event.toolCallId,
            toolName: event.toolName,
            args: event.args,
            status: 'running',
            startedAt: Date.now(),
          },
        ],
      }
    }

    case 'tool_call_args': {
      const existing = findTool(message, event.toolCallId)
      if (!existing) {
        // 原生流式参数先于 tool_start 到达：先建一张进度卡，执行开始后由 tool_start 更新。
        return {
          ...message,
          parts: [
            ...message.parts,
            {
              type: 'tool-call',
              toolCallId: event.toolCallId,
              toolName: event.toolName || 'tool',
              status: 'running',
              argsChars: event.delta.length,
              startedAt: Date.now(),
            },
          ],
        }
      }
      const nextChars = (existing.argsChars || 0) + event.delta.length
      return updateTool(message, event.toolCallId, { argsChars: nextChars })
    }

    case 'tool_call_input_available':
      return updateTool(message, event.toolCallId, { args: event.input })

    case 'tool_end':
      return updateTool(
        message,
        event.toolCallId,
        {
          status: event.isError ? 'error' : 'done',
          result: event.result,
          isError: event.isError,
          endedAt: Date.now(),
        },
        event.toolName,
      )

    case 'custom': {
      if (event.name !== 'progress') return message
      const value = (event.value || {}) as { chars?: unknown; turn?: unknown }
      const chars = Number(value.chars) || 0
      const turn = Number(value.turn) || currentTurn(message)
      if (turn == null) return message
      return {
        ...message,
        parts: message.parts.map((p) =>
          p.type === 'step' && p.turn === turn ? { ...p, chars } : p,
        ),
      }
    }

    case 'code':
      return message

    case 'draft_started':
      return upsertDraftPart(message, event.draftId, {
        lines: event.lines,
        chars: event.chars,
        status: 'staged',
      })

    case 'draft_progress':
      return upsertDraftPart(message, event.draftId, {
        lines: event.lines,
        chars: event.chars,
        // read 不修改草稿，不能把已提交/已生效状态降回暂存。
        ...(event.op === 'read' ? {} : { status: 'staged' as const }),
      })

    case 'draft_committed':
      return upsertDraftPart(message, event.draftId, {
        lines: event.lines,
        status: event.ok ? 'committed' : 'failed',
        ...(event.codeHash ? { codeHash: event.codeHash } : {}),
        ...(event.error ? { error: event.error } : {}),
      })

    case 'draft_trial':
      return upsertDraftPart(message, event.draftId, {
        status: event.ok ? 'trial-passed' : 'failed',
        ...(event.error ? { error: event.error } : { error: undefined }),
      })

    case 'draft_discarded':
      return upsertDraftPart(message, event.draftId, { status: 'discarded' })

    case 'context_manifest': {
      const part: AgentContextPart = {
        type: 'context',
        turn: event.turn,
        keys: event.keys,
        counts: event.counts,
        metadata: event.metadata,
      }
      const exists = message.parts.some((p) => p.type === 'context' && p.turn === event.turn)
      return exists
        ? {
            ...message,
            parts: message.parts.map((p) =>
              p.type === 'context' && p.turn === event.turn ? part : p,
            ),
          }
        : { ...message, parts: [...message.parts, part] }
    }

    case 'done':
      return appendText(message, { type: 'text', text: '代码阶段完成，开始 MP4 视频验收…' })

    case 'cancelled': {
      if (message.status === 'cancelled') return message
      const ended = endAllStreaming(message)
      return {
        ...ended,
        status: 'cancelled',
        parts: [...ended.parts, { type: 'text', text: '已取消' }],
      }
    }

    case 'error': {
      const turn = currentTurn(message)
      const dropped = message.parts.filter(
        (p) => !(p.type === 'text' && p.id != null && turn != null && p.id === textMessageIdForTurn(turn)),
      )
      return {
        ...message,
        status: 'error',
        parts: [
          ...dropped.map((p) =>
            p.type === 'step' && p.turn === turn && p.phase === 'start'
              ? { ...p, phase: 'error' as const }
              : p,
          ),
          { type: 'text', text: `失败：${event.message}` },
        ],
      }
    }

    default:
      return message
  }
}
