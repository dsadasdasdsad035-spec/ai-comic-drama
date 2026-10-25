import { DynamicStructuredTool } from '@langchain/core/tools'
import type { StructuredToolInterface } from '@langchain/core/tools'
import { z } from 'zod'
import { checkSceneCode } from '../sceneCodeSanitize'
import { codeHashOf } from '../sceneCodeFingerprint'
import { sceneDraftClient, type DraftScope, type DraftState } from '../sceneDraft'
import {
  DEFAULT_AGENT_LIMITS,
  DUEL_REQUIREMENTS,
  type AgentFrame,
  type AgentReview,
  type AgentReviewItem,
  type AgentTrial,
  type SceneAgentDeps,
  type SceneAgentResult,
} from './sceneAgentTypes'

export type SceneAgentSession = {
  code?: string
  codeHash?: string
  lineCount?: number
  codeOrigin?: 'baseline' | 'agent'
  /** 当前会话草稿；提交后 codeDraftId 才指向它 */
  draft?: {
    id: string
    project: string
    shotId: string
    lines: number
    chars: number
    updatedAt: number
    committedAt?: number
  }
  /** 当前 session.code 来自哪份草稿；用于只给真正试运行的草稿打状态 */
  codeDraftId?: string
  trial?: AgentTrial
  frames?: AgentFrame[]
  review?: AgentReview
  attempts: number
  reviewAttempts: number
  finished: boolean
  terminalError?: string
  summary: string
  events: SceneAgentResult['events']
}

export function createSceneAgentSession(): SceneAgentSession {
  return {
    attempts: 0,
    reviewAttempts: 0,
    finished: false,
    summary: '',
    events: [],
  }
}

function emit(session: SceneAgentSession, deps: SceneAgentDeps, event: SceneAgentResult['events'][number]) {
  session.events.push(event)
  deps.onEvent?.(event)
}

function fail(message: string) {
  return { ok: false as const, error: message }
}

function resultOk(data: Record<string, unknown>) {
  return { ok: true, ...data }
}

/** 少数模型把已经转义过的换行再次转义，代码会变成一行字面量 \n；只在没有真实换行时还原。 */
export function normalizeSceneCodeArg(code: string): string {
  if (code.includes('\n') || !code.includes('\\n')) return code
  return code.replace(/\\r/g, '').replace(/\\n/g, '\n').replace(/\\t/g, '\t')
}

async function withTimeout<T>(p: Promise<T>, ms: number, signal?: AbortSignal): Promise<T> {
  if (signal?.aborted) throw new DOMException('已取消', 'AbortError')
  let timer: ReturnType<typeof setTimeout> | undefined
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new Error(`工具超时（${Math.round(ms / 1000)}s）`)), ms)
  })
  const aborted = new Promise<never>((_, reject) => {
    if (!signal) return
    const onAbort = () => reject(new DOMException('已取消', 'AbortError'))
    signal.addEventListener('abort', onAbort, { once: true })
  })
  try {
    return await Promise.race([p, timeout, aborted])
  } finally {
    if (timer) clearTimeout(timer)
  }
}

/**
 * 工具集只通过 SceneAgentDeps 操作当前镜头的渲染/视觉。
 * 不提供 shell、网络、保存、渲染或其他镜头写入。
 */
export function createSceneAgentTools(
  deps: SceneAgentDeps,
  session: SceneAgentSession,
  defaultRequirements: string[] = ['画面主体可见', '构图与镜头符合用户描述'],
): {
  tools: StructuredToolInterface[]
  byName: Map<string, StructuredToolInterface>
} {
  const draftClient = deps.draftClient || sceneDraftClient

  const scopeOf = (): DraftScope => {
    const scope = deps.draftScope
    if (!scope?.project || !scope?.shotId) {
      throw new Error('当前会话没有草稿作用域（缺少项目或镜头）')
    }
    return scope
  }

  const errMessage = (e: unknown) => (e as Error)?.message || String(e)

  const updateDraft = (state: DraftState) => {
    if (!session.draft) throw new Error('草稿状态丢失，请重新 begin_scene_draft')
    const wasCommitted = Boolean(session.draft.committedAt)
    session.draft.id = state.id
    session.draft.lines = state.lines
    session.draft.chars = state.chars
    session.draft.updatedAt = Date.now()
    session.draft.committedAt = undefined
    // 草稿在提交后又被改动：session.code 仍是旧内容，不能再把下一次试运行算到这份草稿上。
    if (wasCommitted) session.codeDraftId = undefined
    return session.draft
  }

  /** 静态准入通过后设为当前 agent 代码；不碰工作台草稿。 */
  const applyCode = async (
    raw: string,
    draftId?: string,
  ): Promise<
    | { ok: false; error: string }
    | { ok: true; codeHash: string; lineCount: number; summary: string }
  > => {
    const checked = checkSceneCode(normalizeSceneCodeArg(raw))
    if (!checked.ok) return fail(`代码不可用：${checked.errors.slice(0, 3).join('；')}`)
    session.code = checked.code
    session.codeOrigin = 'agent'
    session.codeDraftId = draftId
    session.codeHash = await codeHashOf(checked.code)
    session.lineCount = checked.code.split('\n').length
    session.trial = undefined
    session.frames = undefined
    session.review = undefined
    emit(session, deps, {
      type: 'code',
      codeHash: session.codeHash,
      lineCount: session.lineCount,
    })
    return {
      ok: true,
      codeHash: session.codeHash,
      lineCount: session.lineCount,
      summary: `已提交 ${session.lineCount} 行代码，等待渲染试运行`,
    }
  }

  /** 读取整份当前草稿 → 准入 → 设为 session.code；不碰工作台草稿。 */
  const commitCurrentDraft = async (): Promise<
    | { ok: false; error: string }
    | { ok: true; draftId: string; codeHash: string; lineCount: number; summary: string }
  > => {
    const draft = session.draft
    if (!draft) return fail('当前没有草稿；先调用 begin_scene_draft')
    try {
      const result = await draftClient.commit(draft.id)
      const applied = await applyCode(result.code, draft.id)
      if (!applied.ok) {
        emit(session, deps, {
          type: 'draft_committed',
          draftId: draft.id,
          codeHash: '',
          lines: result.lines,
          ok: false,
          error: applied.error,
        })
        return fail(`草稿未通过准入：${applied.error}`)
      }
      draft.committedAt = Date.now()
      emit(session, deps, {
        type: 'draft_committed',
        draftId: draft.id,
        codeHash: applied.codeHash,
        lines: applied.lineCount,
        ok: true,
      })
      return {
        ok: true as const,
        draftId: draft.id,
        codeHash: applied.codeHash,
        lineCount: applied.lineCount,
        summary: `草稿已提交为当前代码（${applied.lineCount} 行），等待渲染试运行`,
      }
    } catch (e) {
      return fail(errMessage(e))
    }
  }

  const getShotContext = new DynamicStructuredTool({
    name: 'get_shot_context',
    description: '读取当前镜头的元数据、已选附件、当前代码摘要和草稿状态。只读。',
    schema: z.object({}),
    func: async () => {
      const base = await deps.getShotContext()
      // 代码摘要必须来自本会话的实时草稿；否则 set_scene_code 成功后仍会回报旧代码。
      const codeSummary = session.code
        ? `【当前代码】hash ${(session.codeHash || '').slice(0, 10)}，${session.code.split('\n').length} 行`
        : '【当前代码】无'
      const draftSummary = session.draft
        ? `【当前草稿】${session.draft.id.slice(0, 8)}，${session.draft.lines} 行 / ${session.draft.chars} 字符，${session.draft.committedAt ? '已提交' : '未提交'}`
        : '【当前草稿】无'
      return resultOk({ context: [base, codeSummary, draftSummary].filter(Boolean).join('\n\n') })
    },
  })

  const beginSceneDraft = new DynamicStructuredTool({
    name: 'begin_scene_draft',
    description:
      '为当前镜头创建或重置一个服务端草稿（不用也不能传路径）。长代码先 begin，再用 append 分片写入；短代码可直接 set_scene_code。',
    schema: z.object({}),
    func: async () => {
      try {
        const scope = scopeOf()
        const state = await draftClient.begin(scope)
        session.draft = {
          id: state.id,
          project: scope.project,
          shotId: scope.shotId,
          lines: state.lines,
          chars: state.chars,
          updatedAt: Date.now(),
        }
        session.codeDraftId = undefined
        emit(session, deps, {
          type: 'draft_started',
          draftId: state.id,
          lines: state.lines,
          chars: state.chars,
        })
        return resultOk({
          draftId: state.id,
          lines: state.lines,
          chars: state.chars,
          summary: '草稿已创建（0 行），可以开始 append 分片',
        })
      } catch (e) {
        return fail(errMessage(e))
      }
    },
  })

  const appendSceneDraft = new DynamicStructuredTool({
    name: 'append_scene_draft',
    description: '向当前草稿末尾追加一段代码（单次建议不超过 2000 字符；JSON 协议下过长容易截断）。大代码按 import/常量、build、pose、dispose 分段写入。',
    schema: z.object({
      chunk: z.string().min(1).max(8000).describe('要追加的代码片段；单次最多 8000 字符，建议 1500 以内'),
    }),
    func: async ({ chunk }) => {
      if (!session.draft) return fail('当前没有草稿；先调用 begin_scene_draft')
      try {
        const state = await draftClient.append(session.draft.id, chunk)
        const draft = updateDraft(state)
        emit(session, deps, {
          type: 'draft_progress',
          draftId: draft.id,
          lines: draft.lines,
          chars: draft.chars,
          op: 'append',
        })
        return resultOk({
          draftId: draft.id,
          lines: draft.lines,
          chars: draft.chars,
          summary: `已追加，草稿现在 ${draft.lines} 行 / ${draft.chars} 字符`,
        })
      } catch (e) {
        return fail(errMessage(e))
      }
    },
  })

  const readSceneDraft = new DynamicStructuredTool({
    name: 'read_scene_draft',
    description:
      '按 1-based 行范围读取当前草稿（最多 200 行/8KB）。patch 前先读要改的片段，返回带行号的文本和总行数。',
    schema: z.object({
      startLine: z.number().int().min(1).optional().describe('起始行，1-based，含'),
      endLine: z.number().int().min(2).optional().describe('结束行，不含；省略时最多读 200 行'),
    }),
    func: async ({ startLine, endLine }) => {
      if (!session.draft) return fail('当前没有草稿；先调用 begin_scene_draft')
      try {
        const result = await draftClient.read(session.draft.id, startLine, endLine)
        session.draft.lines = result.lines
        session.draft.chars = result.chars
        emit(session, deps, {
          type: 'draft_progress',
          draftId: session.draft.id,
          lines: result.lines,
          chars: result.chars,
          op: 'read',
        })
        return resultOk({
          draftId: session.draft.id,
          text: result.text,
          totalLines: result.totalLines,
          startLine: result.startLine,
          endLine: result.endLine,
        })
      } catch (e) {
        return fail(errMessage(e))
      }
    },
  })

  const patchSceneDraft = new DynamicStructuredTool({
    name: 'patch_scene_draft',
    description:
      '替换当前草稿的一个行范围：startLine 1-based 含，endLine 不含；一次只做一处编辑，避免多个范围互相错位。',
    schema: z.object({
      startLine: z.number().int().min(1),
      endLine: z.number().int().min(1),
      text: z.string().describe('替换后的内容；传空字符串表示删除该范围'),
    }),
    func: async ({ startLine, endLine, text }) => {
      if (!session.draft) return fail('当前没有草稿；先调用 begin_scene_draft')
      try {
        const state = await draftClient.patch(session.draft.id, startLine, endLine, text)
        const draft = updateDraft(state)
        emit(session, deps, {
          type: 'draft_progress',
          draftId: draft.id,
          lines: draft.lines,
          chars: draft.chars,
          op: 'patch',
        })
        return resultOk({
          draftId: draft.id,
          lines: draft.lines,
          chars: draft.chars,
          summary: `已替换第 ${startLine}-${Math.max(startLine, endLine - 1)} 行，草稿现在 ${draft.lines} 行`,
        })
      } catch (e) {
        return fail(errMessage(e))
      }
    },
  })

  const commitSceneDraft = new DynamicStructuredTool({
    name: 'commit_scene_draft',
    description:
      '读取整份草稿并做静态准入，通过后设为当前 agent 代码（仍不会覆盖工作台草稿）。提交后必须 run_render 试运行。',
    schema: z.object({}),
    func: async () => commitCurrentDraft(),
  })

  const discardSceneDraft = new DynamicStructuredTool({
    name: 'discard_scene_draft',
    description: '删除当前草稿。已提交的 session.code 不变；不会修改工作台草稿。',
    schema: z.object({}),
    func: async () => {
      const draft = session.draft
      if (!draft) return fail('当前没有草稿')
      try {
        await draftClient.discard(draft.id)
      } catch {
        /* 已经清理或网络失败都不阻塞会话；服务端启动时还会 sweep */
      }
      if (session.codeDraftId === draft.id) session.codeDraftId = undefined
      session.draft = undefined
      emit(session, deps, { type: 'draft_discarded', draftId: draft.id, reason: 'agent discard' })
      return resultOk({ summary: '草稿已删除' })
    },
  })

  const setSceneCode = new DynamicStructuredTool({
    name: 'set_scene_code',
    description:
      '提交完整短代码的快捷方式（等价于写入临时草稿并立即 commit）。提交后必须运行渲染试运行；失败代码不会成为当前草稿。' +
      '代码必须定义 build(ctx)/pose(t, mode)/dispose，使用 ctx.scene 和 ctx.camera，并把可见对象加入 ctx.scene。长代码请用 begin_scene_draft/append_scene_draft/commit_scene_draft。',
    schema: z.object({
      code: z.string().min(1).describe('完整 Blender Python 代码，必须定义 build/pose/dispose'),
    }),
    func: async ({ code }) => {
      const normalized = normalizeSceneCodeArg(code)
      // 短代码快捷方式：没有草稿作用域（例如单测/旧调用）时直接走同一套准入。
      if (!deps.draftScope) return applyCode(normalized)
      try {
        const scope = scopeOf()
        const state = await draftClient.begin(scope)
        session.draft = {
          id: state.id,
          project: scope.project,
          shotId: scope.shotId,
          lines: state.lines,
          chars: state.chars,
          updatedAt: Date.now(),
        }
        session.codeDraftId = undefined
        emit(session, deps, {
          type: 'draft_started',
          draftId: state.id,
          lines: state.lines,
          chars: state.chars,
        })
        const chunkBytes = 32 * 1024
        for (let offset = 0; offset < normalized.length; offset += chunkBytes) {
          const chunk = normalized.slice(offset, offset + chunkBytes)
          const next = await draftClient.append(state.id, chunk)
          const draft = updateDraft(next)
          emit(session, deps, {
            type: 'draft_progress',
            draftId: draft.id,
            lines: draft.lines,
            chars: draft.chars,
            op: 'append',
          })
        }
        return await commitCurrentDraft()
      } catch (e) {
        return fail(errMessage(e))
      }
    },
  })

  const runSandbox = new DynamicStructuredTool({
    name: 'run_render',
    description: '用本机 Blender 渲染当前代码草稿的开头与结尾帧（试运行），返回能否渲染。',
    schema: z.object({}),
    func: async () => {
      if (!session.code) return fail('还没有提交代码；先用 commit_scene_draft 或 set_scene_code')
      const trialDraftId =
        session.draft && session.codeDraftId === session.draft.id ? session.draft.id : undefined
      session.attempts++
      try {
        const trial = await withTimeout(
          deps.runTrial(session.code),
          DEFAULT_AGENT_LIMITS.toolMs,
          deps.signal,
        )
        session.trial = trial
        if (trial.ok) {
          const checked = checkSceneCode(session.code)
          if (checked.ok && session.codeOrigin !== 'baseline') deps.onDraftCode?.(session.code, checked)
          if (trialDraftId) {
            emit(session, deps, { type: 'draft_trial', draftId: trialDraftId, ok: true })
          }
          return resultOk({
            summary: '渲染试运行通过',
            attempts: session.attempts,
          })
        }
        if (trialDraftId) {
          emit(session, deps, {
            type: 'draft_trial',
            draftId: trialDraftId,
            ok: false,
            error: trial.error || '渲染试运行失败',
          })
        }
        return fail(trial.error || '渲染试运行失败')
      } catch (e) {
        const message = (e as Error).message || String(e)
        session.trial = { ok: false, error: message }
        if (trialDraftId) {
          emit(session, deps, { type: 'draft_trial', draftId: trialDraftId, ok: false, error: message })
        }
        if ((e as Error).name === 'AbortError') throw e
        return fail(message)
      }
    },
  })

  const captureFrames = new DynamicStructuredTool({
    name: 'capture_frames',
    description: '按秒抓取当前代码的关键帧，抓满 5 个时间点；必须先通过 run_render。',
    schema: z.object({
      times: z.array(z.number().min(0)).min(1).max(DEFAULT_AGENT_LIMITS.maxFrames).optional(),
    }),
    func: async ({ times }) => {
      if (!session.code || !session.trial?.ok) return fail('先提交代码并通过 run_render')
      const requested = (times || [0, 1, 2, 3, 4]).slice(0, DEFAULT_AGENT_LIMITS.maxFrames)
      try {
        const frames = await withTimeout(
          deps.captureFrames(session.code, requested),
          DEFAULT_AGENT_LIMITS.toolMs,
          deps.signal,
        )
        session.frames = frames
        emit(session, deps, { type: 'frames', frames })
        return resultOk({
          frames,
          summary: `已抓取 ${frames.length} 帧`,
        })
      } catch (e) {
        if ((e as Error).name === 'AbortError') throw e
        return fail((e as Error).message || '抓帧失败')
      }
    },
  })

  const reviewFrames = new DynamicStructuredTool({
    name: 'review_frames',
    description: '用视觉清单检查已抓取的关键帧。没有视觉模型时返回 needsHumanReview。',
    schema: z.object({
      requirements: z.array(z.string()).max(12).optional(),
    }),
    func: async ({ requirements }) => {
      if (!session.frames?.length) return fail('先调用 capture_frames')
      session.reviewAttempts++
      try {
        const review = await withTimeout(
          deps.reviewFrames(session.frames, requirements?.length ? requirements : defaultRequirements),
          DEFAULT_AGENT_LIMITS.toolMs,
          deps.signal,
        )
        session.review = review
        emit(session, deps, { type: 'review', items: review.items })
        return {
          ok: review.passed || Boolean(review.needsHumanReview),
          ...review,
          summary: review.summary || (review.passed ? '视觉验收通过' : review.needsHumanReview ? '需要人工验收' : '视觉验收未通过'),
        }
      } catch (e) {
        if ((e as Error).name === 'AbortError') throw e
        return fail((e as Error).message || '视觉验收失败')
      }
    },
  })

  const finish = new DynamicStructuredTool({
    name: 'finish',
    description: '声明当前镜头场景完成。必须已有通过的渲染试运行；视觉验收需通过或明确转人工。',
    schema: z.object({
      summary: z.string().min(1).max(500).describe('给用户的最终摘要'),
    }),
    func: async ({ summary }) => {
      if (!session.trial?.ok) return fail('场景未通过渲染试运行，不能结束')
      if (!session.review) return fail('尚未进行视觉验收，不能结束')
      if (!session.review.passed && !session.review.needsHumanReview) {
        return fail('视觉验收未通过，请修复后重试')
      }
      session.finished = true
      session.summary = summary
      emit(session, deps, { type: 'done', summary, code: session.code })
      return resultOk({ summary, needsHumanReview: Boolean(session.review.needsHumanReview) })
    },
  })

  const tools = [
    getShotContext,
    beginSceneDraft,
    appendSceneDraft,
    readSceneDraft,
    patchSceneDraft,
    commitSceneDraft,
    discardSceneDraft,
    setSceneCode,
    runSandbox,
    captureFrames,
    reviewFrames,
    finish,
  ]
  return { tools, byName: new Map(tools.map((t) => [t.name, t])) }
}

export function reviewItemsFromVision(raw: unknown): AgentReviewItem[] {
  const o = raw && typeof raw === 'object' ? (raw as Record<string, unknown>) : {}
  const items = Array.isArray(o.items) ? o.items : []
  return items
    .map((x) => {
      const item = x && typeof x === 'object' ? (x as Record<string, unknown>) : {}
      const label = String(item.label || item.key || '').trim().slice(0, 80)
      if (!label) return null
      return {
        key: String(item.key || label).slice(0, 80),
        label,
        ok: Boolean(item.ok),
        ...(item.reason ? { reason: String(item.reason).slice(0, 200) } : {}),
      }
    })
    .filter((x): x is AgentReviewItem => Boolean(x))
}
