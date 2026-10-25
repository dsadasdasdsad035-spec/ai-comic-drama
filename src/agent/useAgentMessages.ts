import { useRef, useState } from 'react'
import { applyAgentEvent } from './agentMessageReducer'
import type { AgentEvent, AgentMessage } from './sceneAgentTypes'

function makeId() {
  return typeof crypto !== 'undefined' && 'randomUUID' in crypto
    ? crypto.randomUUID()
    : `agent-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
}

/** 聊天消息状态：用户/助手消息、运行状态、取消和事件归约。 */
export function useAgentMessages() {
  const [messages, setMessages] = useState<AgentMessage[]>([])
  const [running, setRunning] = useState(false)
  const abortRef = useRef<AbortController | null>(null)
  const messageRef = useRef<AgentMessage | null>(null)

  const patchAssistant = (fn: (message: AgentMessage) => AgentMessage) => {
    setMessages((prev) => {
      const target = messageRef.current
      if (!target) return prev
      return prev.map((m) => (m.id === target.id ? fn(m) : m))
    })
  }

  const patchMessage = (messageId: string, fn: (message: AgentMessage) => AgentMessage) => {
    setMessages((prev) => prev.map((m) => (m.id === messageId ? fn(m) : m)))
  }

  const begin = (userText: string) => {
    const user: AgentMessage = {
      id: makeId(),
      role: 'user',
      parts: [{ type: 'text', text: userText }],
      status: 'complete',
    }
    const assistant: AgentMessage = { id: makeId(), role: 'assistant', parts: [], status: 'running' }
    messageRef.current = assistant
    setMessages((prev) => [...prev, user, assistant])
    return { user, assistant }
  }

  const updateEvent = (event: AgentEvent) => {
    patchAssistant((message) => applyAgentEvent(message, event))
  }

  const reset = () => {
    messageRef.current = null
    setMessages([])
  }

  const cancel = () => {
    abortRef.current?.abort()
    setRunning(false)
  }

  return {
    messages,
    setMessages,
    running,
    setRunning,
    abortRef,
    messageRef,
    patchAssistant,
    patchMessage,
    begin,
    updateEvent,
    reset,
    cancel,
  }
}
