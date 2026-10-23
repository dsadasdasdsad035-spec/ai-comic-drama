import type { AppSettings, ProjectData } from './api'
import { callText } from './api'
import type { MediaBrief } from './mediaBrief'
import type { PreparedSceneAsset } from './sceneCodeAssets'
import type { Shot3DContext, ShotData } from './types'
import type { Shot3DContextCatalog } from './shot3dContextCatalog'
import { stageModelKey, type StagePick } from './ModelSelect'
import { checkSceneCode } from './sceneCodeSanitize'
import { codeHashOf } from './sceneCodeFingerprint'
import {
  SCENE_CODE_CHAT_SYSTEM,
  SCENE_CODE_SYSTEM,
  buildSceneCodeChatPrompt,
  buildSceneCodeGeneratePrompt,
  parseSceneCodeResult,
} from './sceneCodePrompt'

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
  prompt: string
  json?: boolean
  maxTokens?: number
  temperature?: number
  modelKey?: string
  signal?: AbortSignal
}) => Promise<{ json?: unknown; text?: string; modelKey?: string; modelLabel?: string }>

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
  /** chat 时必传 */
  mode?: 'generate' | 'chat'
  currentCode?: string
  previousCode?: string
  legacyScene?: unknown
  message?: string
  history?: SceneCodeChatMessage[]
  signal?: AbortSignal
  ask?: SceneCodeAsk
  /** 拿到代码后、返回前做沙箱试运行；失败应 throw */
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
 * 首次代码生成和聊天改写共用：选代码模型 → 解析完整代码 → 准入门禁 → 可选沙箱试运行。
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
  const system = chat ? SCENE_CODE_CHAT_SYSTEM : SCENE_CODE_SYSTEM
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
      `${prompt}\n\n【上次代码】\n\`\`\`js\n${String(e.code || '').slice(0, 20000)}\n\`\`\`\n` +
      `【运行错误】${e.message}\n` +
      '请只修复这个运行错误，保持用户要求的场景，返回完整代码和 JSON。'
    const repairSystem = `${system}\n你正在修复上一次代码的运行错误。必须返回完整代码，且保持 function init(ctx) 的参数名；如果错误是“首帧没有绘制任何对象”，必须添加可见 mesh 并设置 ctx.camera。`
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
