import type {
  CharacterExpression,
  CharacterExpressionSheet,
  CharacterSheet,
  VoiceSample,
} from './characters'
import type { PerformanceEmotion } from './types'

/** project.json 里的角色结构（与 manga-pipeline/prompts.py 的 CHARACTER_SYS 一致） */
export type ProjectChar = {
  name: string
  role?: string
  age?: string
  look_cn?: string
  look_en?: string
  palette?: string
  keywords?: string[]
  voice?: string
  voice_provider?: string
  voice_model_key?: string
  /** 选中的三视图（本地相对路径；dataURL 不写文件，只在浏览器里保留） */
  image?: string
  candidates?: string[]
  activeIdx?: number
  /** 可选旧表情参考；只读兼容，不再新增 */
  expressions?: Partial<Record<PerformanceEmotion, CharacterExpression>>
  /** 一张 4×2 表情总图；优先于旧 expressions */
  expression_sheet?: CharacterExpressionSheet
  /** 可选角色音色样本；不改变 voiceId */
  voice_sample?: VoiceSample
}

/**
 * project.json → 角色卡。
 * id 直接用角色名：中文名当 React key 没问题，且跨会话稳定（随机 uuid 会每次重建都对不上）。
 */
export function toSheet(c: ProjectChar): CharacterSheet {
  return {
    id: String(c.name || '').trim() || 'char',
    name: c.name || '',
    role: c.role || '',
    age: c.age,
    lookCn: c.look_cn || '',
    lookEn: c.look_en || '',
    palette: c.palette || '',
    keywords: Array.isArray(c.keywords) ? c.keywords : [],
    voiceId: c.voice || undefined,
    voiceProvider: c.voice_provider || undefined,
    voiceModelKey: c.voice_model_key || undefined,
    image: c.image,
    candidates: Array.isArray(c.candidates) ? c.candidates.filter(Boolean) : undefined,
    activeIdx: typeof c.activeIdx === 'number' ? c.activeIdx : undefined,
    expressions: c.expressions,
    expressionSheet: c.expression_sheet,
    voiceSample: c.voice_sample,
  }
}

/** 角色卡 → project.json，蛇形字段名保持一致 */
export function toProject(s: CharacterSheet): ProjectChar {
  const out: ProjectChar = {
    name: s.name,
    role: s.role,
    look_cn: s.lookCn,
    look_en: s.lookEn,
    palette: s.palette,
    keywords: s.keywords ?? [],
  }
  if (s.age) out.age = s.age
  if (s.voiceId) out.voice = s.voiceId
  if (s.voiceProvider) out.voice_provider = s.voiceProvider
  if (s.voiceModelKey) out.voice_model_key = s.voiceModelKey
  // 只有本地相对路径才写进项目文件；上传产生的 dataURL 太大会把文件撑爆
  const local = (u?: string) => (u && u.startsWith('/') && !u.startsWith('/api') ? u.split('?')[0] : undefined)
  const img = local(s.image)
  if (img) out.image = img
  const cands = (s.candidates ?? []).map(local).filter(Boolean) as string[]
  if (cands.length) out.candidates = cands
  if (typeof s.activeIdx === 'number') out.activeIdx = s.activeIdx
  const expressions: Partial<Record<PerformanceEmotion, CharacterExpression>> = {}
  for (const [emotion, value] of Object.entries(s.expressions ?? {})) {
    if (!value) continue
    const img = local(value.image)
    const expressionCandidates = (value.candidates ?? []).map(local).filter(Boolean) as string[]
    if (!img && expressionCandidates.length === 0) continue
    expressions[emotion as PerformanceEmotion] = {
      ...(img ? { image: img } : {}),
      ...(expressionCandidates.length ? { candidates: expressionCandidates } : {}),
      ...(typeof value.activeIdx === 'number' ? { activeIdx: value.activeIdx } : {}),
      ...(value.source ? { source: value.source } : {}),
      ...(value.fingerprint ? { fingerprint: value.fingerprint } : {}),
      ...(value.stale ? { stale: true } : {}),
    }
  }
  if (Object.keys(expressions).length) out.expressions = expressions
  if (s.expressionSheet) {
    const sheetImage = local(s.expressionSheet.image)
    if (sheetImage) {
      out.expression_sheet = {
        image: sheetImage,
        columns: 4,
        rows: 2,
        cells: (s.expressionSheet.cells ?? []).map((cell) => ({
          emotion: cell.emotion,
          x: Number(cell.x) || 0,
          y: Number(cell.y) || 0,
          w: Number(cell.w) || 0,
          h: Number(cell.h) || 0,
          ...(local(cell.cropUrl) ? { cropUrl: local(cell.cropUrl) } : {}),
          ...(cell.cropFingerprint ? { cropFingerprint: cell.cropFingerprint } : {}),
        })),
        source: s.expressionSheet.source,
        fingerprint: String(s.expressionSheet.fingerprint || ''),
        ...(s.expressionSheet.stale ? { stale: true } : {}),
        ...(s.expressionSheet.modelKey ? { modelKey: s.expressionSheet.modelKey } : {}),
        ...(s.expressionSheet.createdAt ? { createdAt: s.expressionSheet.createdAt } : {}),
      }
    }
  }
  if (s.voiceSample) {
    const sampleUrl = local(s.voiceSample.url)
    if (sampleUrl) {
      out.voice_sample = {
        ...s.voiceSample,
        url: sampleUrl,
        text: String(s.voiceSample.text || ''),
        seconds: Math.max(0, Number(s.voiceSample.seconds) || 0),
        engine: String(s.voiceSample.engine || ''),
        voiceId: String(s.voiceSample.voiceId || ''),
        fingerprint: String(s.voiceSample.fingerprint || ''),
      }
    }
  }
  return out
}

/** 给 LLM 的角色外观锚点清单：keyframe_prompt 必须原样嵌入 look_en */
export function characterBible(chars: CharacterSheet[]): string {
  return chars
    .filter((c) => c.name && c.lookEn)
    .map((c) => `${c.name}：${c.lookEn}`)
    .join('\n')
}
