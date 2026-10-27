import type { AgentEvent } from './sceneAgentTypes'

/**
 * 取消后的事件闸门。
 *
 * 规范要求：终止后不得再向消费方提供新的文本增量、工具开始或运行完成事件。
 * 已经发生的工具结果仍保留在 session.events 审计轨迹里，但不再推给 UI。
 * cancelled / error 是终止本身的收尾事件，必须放行。
 */
export function gateAgentEvents(
  onEvent: ((event: AgentEvent) => void) | undefined,
  isAborted: () => boolean,
): (event: AgentEvent) => void {
  return (event) => {
    if (isAborted() && event.type !== 'cancelled' && event.type !== 'error') return
    onEvent?.(event)
  }
}
