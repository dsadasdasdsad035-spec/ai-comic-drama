import { DynamicStructuredTool } from '@langchain/core/tools'
import type { StructuredToolInterface } from '@langchain/core/tools'
import { z } from 'zod'
import { checkSceneCode } from '../sceneCodeSanitize'
import { codeHashOf } from '../sceneCodeFingerprint'
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
  return { ok: false, error: message }
}

function resultOk(data: Record<string, unknown>) {
  return { ok: true, ...data }
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
 * 工具集只通过 SceneAgentDeps 操作当前镜头的沙箱/视觉。
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
  const getShotContext = new DynamicStructuredTool({
    name: 'get_shot_context',
    description: '读取当前镜头的文本、参考内容和当前代码摘要。只读。',
    schema: z.object({}),
    func: async () => resultOk({ context: await deps.getShotContext() }),
  })

  const setSceneCode = new DynamicStructuredTool({
    name: 'set_scene_code',
    description:
      '提交完整的 Three.js 场景代码草稿。提交后必须运行沙盒；失败代码不会成为当前草稿。' +
      '代码必须定义 init(ctx)/renderAt(t)/dispose，使用 ctx.scene 和 ctx.camera，并把可见对象加入 ctx.scene。',
    schema: z.object({
      code: z.string().min(1).describe('完整 Three.js 代码，必须定义 init/renderAt/dispose'),
    }),
    func: async ({ code }) => {
      const checked = checkSceneCode(code)
      if (!checked.ok) return fail(`代码不可用：${checked.errors.slice(0, 3).join('；')}`)
      session.code = checked.code
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
      return resultOk({
        codeHash: session.codeHash,
        lineCount: session.lineCount,
        summary: `已提交 ${session.lineCount} 行代码，等待沙箱运行`,
      })
    },
  })

  const runSandbox = new DynamicStructuredTool({
    name: 'run_sandbox',
    description: '在隔离沙箱中运行当前代码草稿，执行 init、renderAt(0) 和 renderAt(duration)。',
    schema: z.object({}),
    func: async () => {
      if (!session.code) return fail('还没有提交代码；先调用 set_scene_code')
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
          if (checked.ok) deps.onDraftCode?.(session.code, checked)
          return resultOk({
            summary: '沙箱试运行通过',
            attempts: session.attempts,
          })
        }
        return fail(trial.error || '沙箱试运行失败')
      } catch (e) {
        const message = (e as Error).message || String(e)
        session.trial = { ok: false, error: message }
        if ((e as Error).name === 'AbortError') throw e
        return fail(message)
      }
    },
  })

  const captureFrames = new DynamicStructuredTool({
    name: 'capture_frames',
    description: '按秒抓取当前代码的关键帧，抓满 5 个时间点；必须先通过 run_sandbox。',
    schema: z.object({
      times: z.array(z.number().min(0)).min(1).max(DEFAULT_AGENT_LIMITS.maxFrames).optional(),
    }),
    func: async ({ times }) => {
      if (!session.code || !session.trial?.ok) return fail('先提交代码并通过 run_sandbox')
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
    description: '声明当前镜头场景完成。必须已有通过的沙箱；视觉验收需通过或明确转人工。',
    schema: z.object({
      summary: z.string().min(1).max(500).describe('给用户的最终摘要'),
    }),
    func: async ({ summary }) => {
      if (!session.trial?.ok) return fail('场景未通过沙箱，不能结束')
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

  const tools = [getShotContext, setSceneCode, runSandbox, captureFrames, reviewFrames, finish]
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
