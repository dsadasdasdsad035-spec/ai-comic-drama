import type {
  AppSettings,
  ProjectData,
  ProviderChatMessage,
  ProviderToolCall,
  ProviderToolCallDelta,
} from './api'
import { callText } from './api'
import type { MediaBrief } from './mediaBrief'
import type { PreparedSceneAsset } from './sceneCodeAssets'
import type { Shot3DContext, ShotData } from './types'
import type { Shot3DContextCatalog } from './shot3dContextCatalog'
import { stageModelKey, type StagePick } from './ModelSelect'
import { checkSceneCode } from './sceneCodeSanitize'
import { codeHashOf } from './sceneCodeFingerprint'
import {
  buildSceneCodeChatPrompt,
  buildSceneCodeGeneratePrompt,
  parseSceneCodeResult,
} from './sceneCodePrompt'
import { getSkill } from './skills/registry'
import { buildSceneJobSystem } from './skills/sceneJob'

class SceneCodeTrialError extends Error {
  code: string
  constructor(message: string, code: string) {
    super(message)
    this.name = 'SceneCodeTrialError'
    this.code = code
  }
}

const isAbortError = (e: unknown) => (e as Error)?.name === 'AbortError'

export type SceneCodeChatMessage = { role: 'user' | 'assistant'; text: string }

export type SceneCodeAsk = (opts: {
  system?: string
  /** 旧方式：system + prompt；原生工具调用改用 messages */
  prompt?: string
  messages?: ProviderChatMessage[]
  tools?: unknown[]
  toolChoice?: string | Record<string, unknown>
  json?: boolean
  maxTokens?: number
  temperature?: number
  modelKey?: string
  signal?: AbortSignal
  /** 流式进度：已接收的字符数（L1） */
  onProgress?: (chars: number) => void
  /** 原生工具参数增量（只用于进度，参数完整前不执行工具） */
  onToolCallDelta?: (delta: ProviderToolCallDelta) => void
}) => Promise<{
  json?: unknown
  text?: string
  modelKey?: string
  modelLabel?: string
  /** provider 的结束原因；length 表示输出被截断 */
  finishReason?: string
  /** 原生工具调用 */
  toolCalls?: ProviderToolCall[]
  usage?: Record<string, unknown>
}>

export type SceneCodeJobInput = {
  shot: ShotData
  project?: ProjectData | null
  context: Shot3DContext
  catalog: Shot3DContextCatalog
  assets: PreparedSceneAsset[]
  mediaBrief?: MediaBrief
  videoBrief?: string
  duration: number
  aspect: string
  settings: AppSettings | null
  stagePick?: StagePick
  /** 本机 Blender 版本，写进提示词 */
  engineVersion?: string
  /** chat 时必传 */
  mode?: 'generate' | 'chat'
  currentCode?: string
  previousCode?: string
  legacyScene?: unknown
  message?: string
  history?: SceneCodeChatMessage[]
  signal?: AbortSignal
  ask?: SceneCodeAsk
  /** 拿到代码后、返回前做渲染试运行；失败应 throw */
  trial?: (code: string, input: SceneCodeJobInput) => Promise<void>
}

export type SceneCodeJobResult = {
  reply: string
  code: string
  codeHash: string
  motionNote?: string
  modelKey?: string
  modelLabel?: string
  usedVision: boolean
}

function parseJsonText(text: string): unknown {
  const s = String(text || '').trim()
  if (!s) return undefined
  const fence = s.match(/```(?:json)?\s*([\s\S]*?)```/i)
  const body = fence ? fence[1] : s
  try {
    return JSON.parse(body)
  } catch {
    const start = body.indexOf('{')
    const end = body.lastIndexOf('}')
    if (start >= 0 && end > start) {
      try {
        return JSON.parse(body.slice(start, end + 1))
      } catch {
        return undefined
      }
    }
    return undefined
  }
}

/**
 * 首次代码生成和聊天改写共用：选代码模型 → 解析完整代码 → 准入门禁 → 可选渲染试运行。
 * 失败直接抛错；调用方保留旧代码。
 */
export async function runSceneCodeJob(input: SceneCodeJobInput): Promise<SceneCodeJobResult> {
  const key = stageModelKey(input.settings, 'sceneCode', input.stagePick)
  if (!key) {
    throw new Error('没有可用的 3D 代码文本模型，请到设置页「生成环节默认模型」绑定，或直接手写代码')
  }
  const ask: SceneCodeAsk =
    input.ask ||
    ((o) =>
      callText({
        system: o.system,
        prompt: o.prompt,
        json: o.json,
        maxTokens: o.maxTokens,
        temperature: o.temperature,
        modelKey: o.modelKey,
        signal: o.signal,
      }))
  const chat = input.mode === 'chat'
  const skill = await getSkill(chat ? 'scene-code-chat' : 'scene-code')
  const system = buildSceneJobSystem(skill)
  const prompt = chat
    ? buildSceneCodeChatPrompt({ ...input, videoBrief: undefined }, String(input.message || ''), input.history || [])
    : buildSceneCodeGeneratePrompt(input)
  const attempt = async (attemptPrompt: string, attemptSystem: string) => {
    const r = await ask({
      system: attemptSystem,
      prompt: attemptPrompt,
      json: true,
      maxTokens: 12000,
      temperature: chat ? 0.45 : 0.55,
      modelKey: key,
      signal: input.signal,
    })
    const raw = r.json ?? parseJsonText(String(r.text || ''))
    if (!raw) throw new Error('代码模型没有返回可解析的 JSON（可能被截断）')
    const parsed = parseSceneCodeResult(raw)
    const checked = checkSceneCode(parsed.code)
    if (!checked.ok) throw new Error(`代码不可用：${checked.errors.slice(0, 3).join('；')}`)
    if (input.trial) {
      try {
        await input.trial(checked.code, input)
      } catch (e) {
        if (isAbortError(e)) throw e
        throw new SceneCodeTrialError((e as Error).message || String(e), checked.code)
      }
    }
    return { parsed, checked, r }
  }

  let result: Awaited<ReturnType<typeof attempt>>
  try {
    result = await attempt(prompt, system)
  } catch (e) {
    if (!(e instanceof SceneCodeTrialError) || !input.trial) throw e
    // 运行错误允许修复一次；仍然必须通过试运行才返回，失败不会写项目。
    const repairPrompt =
      `${prompt}\n\n【上次代码】\n\`\`\`python\n${String(e.code || '').slice(0, 20000)}\n\`\`\`\n` +
      `【运行错误】${e.message}\n` +
      '请只修复这个运行错误，保持用户要求的场景，返回完整代码和 JSON。'
    const repairSystem = `${system}\n你正在修复上一次代码的运行错误。必须返回完整 Blender Python 代码；如果错误是“build 之后场景里没有任何对象”，必须添加可见对象并调整 ctx.camera 朝向主体。`
    try {
      result = await attempt(repairPrompt, repairSystem)
    } catch (repairError) {
      throw repairError
    }
  }
  return {
    reply: result.parsed.reply,
    code: result.checked.code,
    codeHash: await codeHashOf(result.checked.code),
    ...(result.parsed.motionNote ? { motionNote: result.parsed.motionNote } : {}),
    ...(result.r.modelKey ? { modelKey: result.r.modelKey } : {}),
    ...(result.r.modelLabel ? { modelLabel: result.r.modelLabel } : {}),
    usedVision: Boolean(input.mediaBrief?.usedVision),
  }
}
