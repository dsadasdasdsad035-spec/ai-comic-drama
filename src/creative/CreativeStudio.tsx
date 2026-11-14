import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import {
  MessagePrimitive,
  useExternalStoreRuntime,
  type AppendMessage,
  type ThreadMessageLike,
} from '@assistant-ui/react'
import { type AppSettings, type Stage } from '../api'
import { stageModelKey, type StagePick } from '../ModelSelect'
import { ChatThreadBody, ChatThreadShell } from '../agent/ChatThreadShell'
import { WorkbenchInspector } from '../chat-ui/WorkbenchInspector'
import {
  buildCreativeTurnPayload,
  creativeTaskView,
  creativeWorkspaceNeedsShotEpisode,
  CREATIVE_INSPECT_PROFILE,
} from './creativeTurnPayload'
import { reloadSkills } from '../skills/registry'
import type { Skill } from '../skills/types'
import { ChatMessage } from '@/chat-ui/ChatMessage'
import { ChatText } from '@/chat-ui/ChatText'
import { ChatStep } from '@/chat-ui/ChatStep'
import { CreativeToolUis } from './CreativeToolUis'
import { useAgentMessages } from '../agent/useAgentMessages'
import { createBuiltinPlatformTools, mergeBuiltinWithSkillTools } from '../agent/builtinPlatformTools'
import { bindSkillTools, createPiNativeToolSet } from '../agent/stageTools'
import { runStageAgent } from '../agent/pi/stageRunner'
import type { AgentMessage } from '../agent/sceneAgentTypes'
import { CreativeSessionList } from './CreativeSessionList'
import { CreativeHeader } from './CreativeHeader'
import { CreativeEmpty } from './CreativeEmpty'
import {
  autoTitle,
  createCreativeSession,
  deleteCreativeSession,
  getCreativeSession,
  listCreativeSessions,
  loadCreativeThread,
  patchCreativeSession,
  saveCreativeThread,
  type CreativeSession,
  type CreativeSessionSummary,
} from './sessionStore'
import {
  listCreativeHostSkills,
  readStoredCreativeHostId,
  resolveCreativeHostId,
  storeCreativeHostId,
} from './creativeSkillHost'
import { creativeMcpToolNames, loadCreativeMcpTools } from '../agent/mcpCreativeTools'
import { fetchCreativeMcpToolDescriptors } from '../mcp/mcpApi'
import type { ToolDef } from '../agent/tool'
import { fetchExperts } from './expertApi'
import type { CreativeExpert } from './expertTypes'
import { EXPERT_NONE } from './expertTypes'
import { readStoredExpertId, storeExpertId } from './expertStorage'
import { buildCreativeExpertTools } from './expertTools'
import {
  wrapToolsForCreativeParamGate,
  type CreativeToolParamConfirmRequest,
} from './creativeToolParamGate'
import { ToolParamConfirmDialog, type ToolParamPrompt } from './ToolParamConfirmDialog'

const STEP_LINE = /^第 (\d+) 轮 · ([\s\S]*)$/
const PI_NATIVE_TOOLS = createPiNativeToolSet()

function textOfMessage(message: AgentMessage): string {
  return message.parts
    .filter((part) => part.type === 'text')
    .map((part) => part.text)
    .join('\n')
    .trim()
}

function appendText(message: AppendMessage): string {
  const content = message.content as unknown
  if (typeof content === 'string') return content.trim()
  if (!Array.isArray(content)) return ''
  return content
    .map((part) => {
      if (typeof part === 'string') return part
      if (part && typeof part === 'object' && 'text' in part) return String((part as { text?: unknown }).text || '')
      return ''
    })
    .filter(Boolean)
    .join('\n')
    .trim()
}

function convertMessage(message: AgentMessage): ThreadMessageLike {
  type Part = Exclude<ThreadMessageLike['content'], string>[number]
  const content: Part[] = []
  for (const part of message.parts) {
    if (part.type === 'text') {
      if (part.text) content.push({ type: 'text', text: part.text })
    } else if (part.type === 'step') {
      const chars = Number(part.chars) || 0
      const progress = chars > 0 ? `已生成 ${chars >= 1000 ? `${(chars / 1000).toFixed(1)}k` : chars} 字符` : '模型调用中…'
      const text =
        part.phase === 'start'
          ? `第 ${part.turn} 轮 · ${progress}`
          : part.phase === 'error'
            ? `第 ${part.turn} 轮 · 模型调用失败${part.text ? `：${part.text}` : ''}`
            : `第 ${part.turn} 轮 · ${part.text ? `模型说明：${part.text}` : '模型调用完成'}`
      content.push({ type: 'text', text })
    } else if (part.type === 'tool-call') {
      content.push({
        type: 'tool-call',
        toolCallId: part.toolCallId,
        toolName: part.toolName,
        ...(part.args ? { args: part.args as never } : {}),
        ...(part.result !== undefined ? { result: part.result } : {}),
        ...(part.isError ? { isError: true } : {}),
      })
    }
  }
  return {
    id: message.id,
    role: message.role,
    content,
    ...(message.role === 'assistant'
      ? {
          status:
            message.status === 'running'
              ? { type: 'running' as const }
              : message.status === 'complete'
                ? { type: 'complete' as const, reason: 'stop' as const }
                : { type: 'incomplete' as const, reason: 'other' as const },
        }
      : {}),
  }
}

function AssistantText({ text }: { text: string }) {
  if (text === '已取消') return <ChatText text="已取消本轮。" />
  if (text.startsWith('失败：')) return <ChatText text={text} />
  const match = STEP_LINE.exec(text)
  if (!match) return <ChatText text={text} />
  const turn = Number(match[1]) || 1
  const detail = match[2]
  if (detail.startsWith('模型说明：')) {
    const note = detail.slice('模型说明：'.length)
    return (
      <>
        <ChatStep turn={turn} phase="end">
          完成
        </ChatStep>
        {note ? <ChatText text={note} /> : null}
      </>
    )
  }
  if (detail.includes('失败')) return <ChatStep turn={turn} phase="error">{detail}</ChatStep>
  if (detail.includes('调用完成')) return <ChatStep turn={turn} phase="end">完成</ChatStep>
  if (detail === '模型调用中…' || detail.startsWith('已生成')) {
    return <ChatStep turn={turn} phase="start">
      {detail}
    </ChatStep>
  }
  return <ChatStep turn={turn} phase="end">{detail}</ChatStep>
}

function UserMessage() {
  return (
    <ChatMessage role="user" variant="workbench">
      <MessagePrimitive.Parts components={{ Text: ChatText }} />
    </ChatMessage>
  )
}

function AssistantMessage() {
  return (
    <ChatMessage role="assistant" variant="workbench">
      <MessagePrimitive.Parts components={{ Text: AssistantText }} unstable_showEmptyOnNonTextEnd={false} />
    </ChatMessage>
  )
}

export type CreativeStudioProps = {
  settings: AppSettings | null
  stagePick?: StagePick
  onPickStage?: (stage: Stage, key: string) => void
  onToast?: (message: string) => void
  /** 顶栏当前项目（内置平台读/写工具需要） */
  projectName?: string
  epNo?: number
  /** 打开设置 → SkillHub 市场 */
  onOpenAllSkills?: () => void
  /** 打开设置 → MCP */
  onOpenMcp?: () => void
  /** 打开设置 → 创意专家 */
  onOpenExperts?: () => void
}

/**
 * 创意工作室：纯 Pi 聊天。
 * 可选顶栏偏好技能；默认 Pi 用 list_installed_skills 发现包 + 平台/MCP 工具。
 */
export default function CreativeStudio({
  settings,
  stagePick,
  onPickStage,
  onToast,
  projectName = '',
  epNo = 1,
  onOpenAllSkills,
  onOpenMcp,
  onOpenExperts,
}: CreativeStudioProps) {
  const { messages, setMessages, running, setRunning, abortRef, begin, updateEvent, patchAssistant } = useAgentMessages()

  const [sessions, setSessions] = useState<CreativeSession[]>([])
  const [session, setSession] = useState<CreativeSessionSummary | null>(null)
  const [loading, setLoading] = useState(true)
  const [listOpen, setListOpen] = useState(false)
  const [loadError, setLoadError] = useState('')
  const [actionError, setActionError] = useState('')
  /**
   * 线程保存失败：按原因给可执行的下一步，绝不吞掉错误。
   * 超限（thread-too-large）重试必然再失败，所以这里不安排任何自动重试。
   */
  const reportSaveError = useCallback(
    (e: unknown, opts: { banner?: boolean } = {}) => {
      const err = e as Error & { kind?: string }
      const detail = err?.message || String(e)
      const msg =
        err?.kind === 'thread-too-large'
          ? `本轮未保存：${detail}。下一步：新建会话继续，或先清空当前会话再发送。`
          : `本轮未保存：${detail}。下一步：确认本地服务在运行后重新发送，或点「重试」。`
      if (opts.banner !== false) setActionError(msg)
      onToast?.(msg)
    },
    [onToast],
  )

  // 卸载清理只能挂一次；onToast 可能每次渲染都是新函数，用 ref 取最新实现，
  // 否则清理函数会随渲染反复执行并重复保存。
  const reportSaveErrorRef = useRef(reportSaveError)
  reportSaveErrorRef.current = reportSaveError
  const [hostSkill, setHostSkill] = useState<Skill | null>(null)
  const [mcpToolNames, setMcpToolNames] = useState<string[]>([])
  const mcpToolsRef = useRef<ToolDef[]>([])
  const [hostSkillId, setHostSkillId] = useState(() => readStoredCreativeHostId())
  const [skillCatalog, setSkillCatalog] = useState<Skill[]>([])
  const [totalSkillsCount, setTotalSkillsCount] = useState(0)
  const [inspectOpen, setInspectOpen] = useState(false)
  const [composerDraft, setComposerDraft] = useState('')
  const [skillError, setSkillError] = useState('')
  const [experts, setExperts] = useState<CreativeExpert[]>([])
  const [expertId, setExpertId] = useState(EXPERT_NONE)

  const sessionRef = useRef<CreativeSessionSummary | null>(null)
  sessionRef.current = session
  const messagesRef = useRef(messages)
  messagesRef.current = messages
  const saveTimer = useRef<number | null>(null)
  const epNoRef = useRef(epNo)
  const [toolParamPrompt, setToolParamPrompt] = useState<ToolParamPrompt | null>(null)

  useEffect(() => {
    epNoRef.current = epNo
  }, [epNo])

  const requestToolParamConfirm = useCallback(
    (req: CreativeToolParamConfirmRequest) =>
      new Promise<number | null>((resolve) => {
        setToolParamPrompt({
          ...req,
          resolve: (ok, episode) => {
            setToolParamPrompt(null)
            if (!ok) resolve(null)
            else resolve(episode ?? req.episode)
          },
        })
      }),
    [],
  )

  const modelKey = stageModelKey(settings, 'creative', stagePick)
  const modelLabel = settings?.models?.find((m) => m.key === modelKey)?.label || modelKey || ''
  const projectKey = projectName.trim()

  const activeExpert = useMemo(
    () => (expertId ? experts.find((e) => e.id === expertId) ?? null : null),
    [expertId, experts],
  )

  const expertNameById = useMemo(
    () => Object.fromEntries(experts.map((e) => [e.id, e.name] as const)),
    [experts],
  )

  const refreshCreativeMcp = useCallback(async () => {
    try {
      const descriptors = await fetchCreativeMcpToolDescriptors()
      setMcpToolNames(creativeMcpToolNames(descriptors))
      mcpToolsRef.current = await loadCreativeMcpTools()
    } catch {
      setMcpToolNames([])
      mcpToolsRef.current = []
    }
  }, [])

  useEffect(() => {
    void refreshCreativeMcp()
  }, [refreshCreativeMcp])

  useEffect(() => {
    const onMcp = () => void refreshCreativeMcp()
    window.addEventListener('creative-mcp-changed', onMcp)
    return () => window.removeEventListener('creative-mcp-changed', onMcp)
  }, [refreshCreativeMcp])

  const refreshExperts = useCallback(() => {
    void fetchExperts()
      .then((list) => setExperts(list))
      .catch(() => setExperts([]))
  }, [])

  useEffect(() => {
    refreshExperts()
  }, [refreshExperts])

  useEffect(() => {
    const onExperts = () => refreshExperts()
    window.addEventListener('creative-experts-changed', onExperts)
    return () => window.removeEventListener('creative-experts-changed', onExperts)
  }, [refreshExperts])

  useEffect(() => {
    if (!expertId || !experts.length) return
    if (!experts.some((e) => e.id === expertId)) {
      setExpertId(EXPERT_NONE)
      storeExpertId(projectKey, EXPERT_NONE)
      const sid = sessionRef.current?.id
      if (sid) void patchCreativeSession(sid, { expertId: EXPERT_NONE }).catch(() => {})
    }
  }, [experts, expertId, projectKey])

  useEffect(() => {
    let alive = true
    ;(async () => {
      if (activeExpert) {
        setHostSkill(null)
        setSkillError('')
        return
      }
      try {
        const { skills, issues } = await reloadSkills()
        if (!alive) return
        const hosts = listCreativeHostSkills(skills.values())
        setSkillCatalog(hosts)
        setTotalSkillsCount(hosts.length)

        const resolvedId = resolveCreativeHostId(hosts, hostSkillId)
        if (resolvedId !== hostSkillId) {
          setHostSkillId(resolvedId)
          return
        }

        if (!resolvedId) {
          setHostSkill(null)
          setSkillError('')
          return
        }

        const skill = skills.get(resolvedId)
        if (!skill) {
          setSkillError(issues.find((x) => x.id === resolvedId)?.message || `偏好技能「${resolvedId}」不可用`)
          setHostSkill(null)
          return
        }
        setSkillError('')
        setHostSkill(skill)
      } catch (e) {
        if (!alive) return
        setSkillError((e as Error).message || String(e))
      }
    })()
    return () => {
      alive = false
    }
  }, [hostSkillId, activeExpert])

  useEffect(() => {
    return () => {
      const id = sessionRef.current?.id
      const msgs = messagesRef.current
      if (!id || !msgs.length) return
      // 卸载时无法再渲染提示，交给父级 toast 兜底
      void saveCreativeThread(id, msgs, []).catch((e) => reportSaveErrorRef.current(e, { banner: false }))
    }
    // 仅卸载时保存一次：依赖必须为空，否则每次渲染都会触发一次保存
  }, [])

  const openSession = useCallback(
    async (id: string) => {
      if (sessionRef.current?.id === id) return
      if (sessionRef.current) {
        const prev = sessionRef.current.id
        try {
          await saveCreativeThread(prev, messagesRef.current, [])
        } catch (e) {
          // 保存失败不阻断切换，但不能静默：toast 里说明是上一个会话没存上
          reportSaveError(e, { banner: false })
        }
      }
      abortRef.current?.abort()
      abortRef.current = null
      setRunning(false)
      setMessages([])
      setActionError('')
      setLoading(true)
      try {
        const [summary, thread] = await Promise.all([getCreativeSession(id), loadCreativeThread(id)])
        setSession(summary)
        const boundExpert = String(summary.expertId || '').trim()
        setExpertId(boundExpert || readStoredExpertId(projectKey))
        setMessages(
          (thread.messages || []).map((m) => ({
            ...m,
            status: m.status === 'running' ? ('cancelled' as const) : m.status,
          })),
        )
        setListOpen(false)
      } catch (e) {
        setLoadError((e as Error).message || String(e))
      } finally {
        setLoading(false)
      }
    },
    [abortRef, projectKey, setMessages, setRunning],
  )

  useEffect(() => {
    let alive = true
    ;(async () => {
      if (!projectKey) {
        setSessions([])
        setSession(null)
        setMessages([])
        setLoadError('请先在顶栏选择项目')
        setLoading(false)
        return
      }
      setLoadError('')
      setLoading(true)
      abortRef.current?.abort()
      abortRef.current = null
      setRunning(false)
      try {
        const list = await listCreativeSessions(50, projectKey)
        if (!alive) return
        setSessions(list)
        const currentId = sessionRef.current?.id
        if (currentId && list.some((s) => s.id === currentId)) {
          setLoading(false)
          return
        }
        const pick = list[0] ?? (await createCreativeSession({ mode: 'plan', project: projectKey }))
        if (!alive) return
        if (!list.length) setSessions([pick])
        await openSession(pick.id)
      } catch (e) {
        if (!alive) return
        setLoadError((e as Error).message || String(e))
      } finally {
        if (alive) setLoading(false)
      }
    })()
    return () => {
      alive = false
    }
  }, [projectKey, openSession, setMessages, setRunning, abortRef])

  useEffect(() => {
    if (!session || running || !messages.length) return
    if (saveTimer.current) window.clearTimeout(saveTimer.current)
    saveTimer.current = window.setTimeout(() => {
      void saveCreativeThread(session.id, messages, []).catch(reportSaveError)
    }, 600)
    return () => {
      if (saveTimer.current) window.clearTimeout(saveTimer.current)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [messages, running, session?.id])

  const newSession = async () => {
    if (!projectKey) return
    const created = await createCreativeSession({ mode: 'plan', project: projectKey })
    setSessions((prev) => [created, ...prev])
    setSession(null)
    await openSession(created.id)
  }

  const renameSession = async (id: string, title: string) => {
    const updated = await patchCreativeSession(id, { title })
    setSessions((prev) => prev.map((s) => (s.id === id ? { ...s, ...updated } : s)))
    if (sessionRef.current?.id === id) setSession((cur) => (cur ? { ...cur, title: updated.title } : cur))
  }

  const removeSession = async (id: string) => {
    await deleteCreativeSession(id)
    const next = sessions.filter((s) => s.id !== id)
    setSessions(next)
    if (sessionRef.current?.id === id) {
      setSession(null)
      if (next[0]) await openSession(next[0].id)
      else {
        const created = await createCreativeSession({ mode: 'plan', project: projectKey })
        setSessions([created])
        await openSession(created.id)
      }
    }
  }

  const run = async (text: string) => {
    const draft = String(text || '').trim()
    if (running || !session || !draft) return
    if (!modelKey) {
      setActionError('没有可用的文本模型，请到设置页绑定「创意」环节')
      return
    }
    setActionError('')

    const turn = buildCreativeTurnPayload({
      host: activeExpert ? null : hostSkill,
      expert: activeExpert,
      projectName: projectKey,
      epNo,
      messages,
      draftText: draft,
      extraToolNames: mcpToolNames,
    })
    const getEpNo = () => epNoRef.current
    const setEpNoForTools = (n: number) => {
      epNoRef.current = n
    }
    const toolParamGate = {
      projectName: projectKey,
      getEpNo,
      setEpNo: setEpNoForTools,
      confirm: requestToolParamConfirm,
    }
    const platformTools = createBuiltinPlatformTools({ projectName: projectKey, epNo: getEpNo })
    const listExpertsTool = PI_NATIVE_TOOLS.byName.get('list_experts')
    let tools: ToolDef[]
    if (activeExpert && listExpertsTool) {
      tools = buildCreativeExpertTools(activeExpert, platformTools, mcpToolsRef.current, listExpertsTool)
    } else {
      const skillTools = hostSkill
        ? bindSkillTools(PI_NATIVE_TOOLS, [{ skill: hostSkill, mode: 'host' }])
        : bindSkillTools(PI_NATIVE_TOOLS, [])
      tools = [...mergeBuiltinWithSkillTools(platformTools, skillTools), ...mcpToolsRef.current]
    }
    tools = wrapToolsForCreativeParamGate(tools, toolParamGate)
    const { system, priorPiMessages } = turn

    begin(draft)
    const controller = new AbortController()
    abortRef.current = controller
    setRunning(true)
    try {
      const result = await runStageAgent({
        userText: draft,
        system,
        tools,
        priorMessages: priorPiMessages,
        sessionId: session.id,
        modelKey,
        stage: 'creative',
        signal: controller.signal,
        onEvent: updateEvent,
      })
      if (result.cancelled) {
        patchAssistant((m) => (m.status === 'cancelled' ? m : { ...m, status: 'cancelled' }))
      } else if (result.error) {
        patchAssistant((m) =>
          m.status === 'error' ? m : { ...m, status: 'error', parts: [...m.parts, { type: 'text', text: `失败：${result.error}` }] },
        )
        onToast?.(result.error)
      } else {
        patchAssistant((m) => ({ ...m, status: 'complete' }))
      }
    } catch (e) {
      const msg = (e as Error).message || String(e)
      patchAssistant((m) => ({ ...m, status: 'error', parts: [...m.parts, { type: 'text', text: `失败：${msg}` }] }))
      onToast?.(msg)
    } finally {
      abortRef.current = null
      setRunning(false)
      void saveCreativeThread(session.id, messagesRef.current, []).catch(reportSaveError)
      if (!session.title) {
        const title = autoTitle(draft)
        if (title) void renameSession(session.id, title)
      }
    }
  }

  const runtime = useExternalStoreRuntime({
    messages,
    convertMessage,
    isRunning: running,
    onNew: async (message) => {
      const text = appendText(message)
      if (!text) return
      await run(text)
    },
    onCancel: async () => {
      abortRef.current?.abort()
      setRunning(false)
    },
  })

  const canSend = Boolean(session && modelKey) && !running && !loading

  const taskView = useMemo(() => {
    const payload = buildCreativeTurnPayload({
      host: activeExpert ? null : hostSkill,
      expert: activeExpert,
      projectName: projectKey,
      epNo,
      messages,
      draftText: composerDraft,
      extraToolNames: mcpToolNames,
    })
    return creativeTaskView(activeExpert ? null : hostSkill, payload, modelLabel, activeExpert)
  }, [activeExpert, hostSkill, messages, composerDraft, modelLabel, mcpToolNames, projectKey, epNo])

  const onComposerDraftChange = useCallback((text: string) => {
    setComposerDraft(text)
  }, [])

  const pickHostSkill = useCallback((id: string) => {
    const next = String(id || '').trim()
    storeCreativeHostId(next)
    setHostSkillId(next)
  }, [])

  const pickExpert = useCallback(
    (id: string) => {
      const next = String(id || '').trim()
      storeExpertId(projectKey, next)
      setExpertId(next)
      const sid = sessionRef.current?.id
      if (sid) {
        setSessions((prev) => prev.map((s) => (s.id === sid ? { ...s, expertId: next } : s)))
        void patchCreativeSession(sid, { expertId: next }).catch(() => {})
      }
    },
    [projectKey],
  )

  const showEpisodeInHeader = creativeWorkspaceNeedsShotEpisode(activeExpert)

  const expertStale = Boolean(expertId && experts.length > 0 && !activeExpert)
  const headerSkillError =
    expertStale ? `专家「${expertId}」不可用，请重选或切回「无（技能目录）」` : skillError

  return (
    <div className="creative-studio" data-creative-studio>
      {toolParamPrompt ? (
        <ToolParamConfirmDialog
          prompt={toolParamPrompt}
          onResolve={(ok, episode) => toolParamPrompt.resolve(ok, episode)}
        />
      ) : null}
      <CreativeSessionList
        sessions={sessions}
        activeId={session?.id || ''}
        open={listOpen}
        onToggle={() => setListOpen((v) => !v)}
        onSelect={(id) => void openSession(id)}
        onNew={() => void newSession()}
        onRename={(id, title) => void renameSession(id, title)}
        onDelete={(id) => void removeSession(id)}
        expertNameById={expertNameById}
        projectCaption={projectKey ? `项目 · ${projectKey}` : undefined}
      />
      <div className="creative-main creative-chat-stage">
        <CreativeHeader
          sessionTitle={session?.title || ''}
          settings={settings}
          stagePick={stagePick}
          onPickStage={onPickStage}
          modelKey={modelKey}
          hostSkillId={hostSkillId}
          skillChoices={skillCatalog.map((s) => ({
            id: s.id,
            label: `${s.manifest.name || s.id} · ${s.manifest.stage}`,
          }))}
          onHostSkillChange={pickHostSkill}
          hideHostSkill={Boolean(activeExpert)}
          expertId={expertId}
          expertChoices={experts.map((e) => ({ id: e.id, label: e.name }))}
          onExpertChange={pickExpert}
          onOpenExperts={onOpenExperts}
          inspectOpen={inspectOpen}
          canInspect={Boolean(session && modelKey) && !loadError}
          catalogEmpty={skillCatalog.length === 0}
          onToggleInspect={() => setInspectOpen((v) => !v)}
          skillError={headerSkillError}
          running={running}
          onOpenList={() => setListOpen(true)}
          onOpenAllSkills={onOpenAllSkills}
          onOpenMcp={onOpenMcp}
          mcpToolCount={mcpToolNames.length}
          hostSkillOptions={skillCatalog.length}
          totalSkillsCount={totalSkillsCount}
          projectName={projectKey}
          epNo={epNo}
          showEpisode={showEpisodeInHeader}
        />

        {loadError ? (
          <div className="flex min-h-0 flex-1 flex-col items-center justify-center gap-2 px-4 text-center">
            <p className="text-[12px] text-destructive">{loadError}</p>
            <button
              type="button"
              className="rounded border border-border px-2 py-1 text-[11px]"
              onClick={() => {
                setLoadError('')
                setLoading(true)
                void listCreativeSessions(50, projectKey)
                  .then((list) => {
                    setSessions(list)
                    if (list[0]) return openSession(list[0].id)
                    if (!projectKey) return
                    return createCreativeSession({ mode: 'plan', project: projectKey }).then((s) => openSession(s.id))
                  })
                  .finally(() => setLoading(false))
              }}
            >
              重试
            </button>
          </div>
        ) : (
          <>
            {actionError ? (
              <div data-creative-error className="creative-banner creative-banner-error" role="alert">
                {actionError}
              </div>
            ) : null}
            <ChatThreadShell runtime={runtime} running={running} toolUis={<CreativeToolUis mcpToolNames={mcpToolNames} />}>
              {inspectOpen && taskView ? (
                <WorkbenchInspector
                  view={taskView}
                  profile={CREATIVE_INSPECT_PROFILE}
                  onClose={() => setInspectOpen(false)}
                  onToast={onToast}
                />
              ) : (
                <div className="creative-conversation">
                  <ChatThreadBody
                    onComposerDraftChange={onComposerDraftChange}
                    UserMessage={UserMessage}
                    AssistantMessage={AssistantMessage}
                    empty={
                      <CreativeEmpty
                        loading={loading}
                        expertMode={Boolean(activeExpert)}
                        expertName={activeExpert?.name}
                        onOpenAllSkills={onOpenAllSkills}
                        onOpenMcp={onOpenMcp}
                        onOpenExperts={onOpenExperts}
                      />
                    }
                    emptyAlign="bottom"
                    placeholder={
                      activeExpert
                        ? `以「${activeExpert.name}」方式聊；可 list_experts 换专家…`
                        : '说说你的想法；Pi 会先 list_installed_skills 再读 SKILL…'
                    }
                    inputLabel="创意聊天输入"
                    suggestions={
                      activeExpert
                        ? [
                            '先 read_characters 再看要补哪些角色',
                            '帮我校验一版 characters 草稿',
                            'list_experts 还有哪些专家',
                          ]
                        : [
                            '先 list_installed_skills 帮我选技能',
                            '给我三个 15 秒短剧方向',
                            '把这个想法拆成 8 个镜头',
                          ]
                    }
                    disabled={!canSend}
                    hint={
                      canSend
                        ? activeExpert
                          ? `Enter 发送 · 专家模式：${activeExpert.name}`
                          : 'Enter 发送 · 默认自动发现技能（顶栏可设偏好）'
                        : headerSkillError || loadError || '正在准备会话…'
                    }
                    cancelLabel="停止"
                  />
                </div>
              )}
            </ChatThreadShell>
          </>
        )}
      </div>
    </div>
  )
}

export type { CreativeSessionSummary }
