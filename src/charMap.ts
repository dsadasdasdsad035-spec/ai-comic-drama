import { ORBIT_SHEET_COLUMNS, ORBIT_SHEET_ROWS } from './characters'
import type {
  CharacterExpression,
  CharacterExpressionSheet,
  CharacterOrbitSheet,
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
  /** 八角度转盘总图；只服务预览页，不进分镜参考 */
  orbit_sheet?: CharacterOrbitSheet
  /** 可选角色音色样本；不改变 voiceId */
  voice_sample?: VoiceSample
  /** 参考图：生成三视图/表情总图的身份输入；不进入分镜参考 */
  reference_images?: string[]
}

type CharFields = Record<string, unknown>

/**
 * 双形状取值：接口形状（蛇形）优先，缺失或空串时回退界面模型（驼峰）。
 *
 * 项目快照来自 `GET /api/project`，是蛇形；界面里流转的是驼峰。两条路径都会经过
 * `toSheet`，所以这里必须两种都认，否则已经把形状弄混的存量对象会被读成空锚点。
 */
function pick<T>(o: CharFields, snake: string, camel: string): T | undefined {
  const blank = (v: unknown) => v === undefined || v === null || v === ''
  const a = o[snake]
  if (!blank(a)) return a as T
  const b = o[camel]
  if (!blank(b)) return b as T
  // 两种都缺失时保留蛇形的原始值（可能是 ''），保证 toProject 能写回空串而不是 undefined
  return (a === undefined || a === null ? b : a) as T | undefined
}

/**
 * project.json → 角色卡。
 * id 直接用角色名：中文名当 React key 没问题，且跨会话稳定（随机 uuid 会每次重建都对不上）。
 *
 * 入参同时接受蛇形（接口/存储形状）与驼峰（界面模型），字段缺失一律按空值处理，不抛错。
 */
export function toSheet(c: unknown): CharacterSheet {
  const raw = (c && typeof c === 'object' ? c : {}) as CharFields
  const name = String(pick<string>(raw, 'name', 'name') || '')
  const str = (snake: string, camel: string) => String(pick<string>(raw, snake, camel) || '')
  const list = (snake: string, camel: string) => {
    const v = pick<unknown>(raw, snake, camel)
    return Array.isArray(v) ? (v.filter(Boolean) as string[]) : undefined
  }
  const strList = (snake: string, camel: string) => {
    const v = pick<unknown>(raw, snake, camel)
    return Array.isArray(v) ? (v.filter((x) => typeof x === 'string') as string[]) : []
  }
  const activeIdx = pick<number>(raw, 'activeIdx', 'activeIdx')
  return {
    id: name.trim() || 'char',
    name,
    role: str('role', 'role'),
    age: pick<string>(raw, 'age', 'age'),
    lookCn: str('look_cn', 'lookCn'),
    lookEn: str('look_en', 'lookEn'),
    palette: str('palette', 'palette'),
    keywords: strList('keywords', 'keywords'),
    voiceId: pick<string>(raw, 'voice', 'voiceId') || undefined,
    voiceProvider: pick<string>(raw, 'voice_provider', 'voiceProvider') || undefined,
    voiceModelKey: pick<string>(raw, 'voice_model_key', 'voiceModelKey') || undefined,
    image: pick<string>(raw, 'image', 'image'),
    candidates: list('candidates', 'candidates'),
    activeIdx: typeof activeIdx === 'number' ? activeIdx : undefined,
    expressions: pick<CharacterSheet['expressions']>(raw, 'expressions', 'expressions'),
    expressionSheet: pick<CharacterSheet['expressionSheet']>(raw, 'expression_sheet', 'expressionSheet'),
    orbitSheet: pick<CharacterSheet['orbitSheet']>(raw, 'orbit_sheet', 'orbitSheet'),
    voiceSample: pick<CharacterSheet['voiceSample']>(raw, 'voice_sample', 'voiceSample'),
    referenceImages: list('reference_images', 'referenceImages'),
  }
}

/**
 * 项目角色数组的唯一读入口：不论入参是快照里的蛇形对象还是界面里的驼峰对象，
 * 都转成 `CharacterSheet`。新代码要读角色就用手这个函数，不要直接遍历裸数组。
 */
export function readCharacters(list: unknown): CharacterSheet[] {
  if (!Array.isArray(list)) return []
  return list
    .filter((c): c is ProjectChar => Boolean(c) && typeof c === 'object')
    .map((c) => toSheet(c))
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
  if (s.orbitSheet) {
    const orbitImage = local(s.orbitSheet.image)
    if (orbitImage) {
      out.orbit_sheet = {
        image: orbitImage,
        columns: ORBIT_SHEET_COLUMNS,
        rows: ORBIT_SHEET_ROWS,
        cells: (s.orbitSheet.cells ?? []).map((cell) => ({
          angle: Number(cell.angle) || 0,
          x: Number(cell.x) || 0,
          y: Number(cell.y) || 0,
          w: Number(cell.w) || 0,
          h: Number(cell.h) || 0,
          ...(local(cell.cropUrl) ? { cropUrl: local(cell.cropUrl) } : {}),
          ...(cell.cropFingerprint ? { cropFingerprint: cell.cropFingerprint } : {}),
        })),
        source: s.orbitSheet.source,
        fingerprint: String(s.orbitSheet.fingerprint || ''),
        ...(s.orbitSheet.stale ? { stale: true } : {}),
        ...(s.orbitSheet.modelKey ? { modelKey: s.orbitSheet.modelKey } : {}),
        ...(s.orbitSheet.createdAt ? { createdAt: s.orbitSheet.createdAt } : {}),
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
  // 参考图只写站内路径；dataURL 会撑爆 project.json
  const refs = (s.referenceImages ?? []).map(local).filter(Boolean) as string[]
  if (refs.length) out.reference_images = refs
  return out
}

/** 给 LLM 的角色外观锚点清单：keyframe_prompt 必须原样嵌入 look_en */
export function characterBible(chars: CharacterSheet[]): string {
  return chars
    .filter((c) => c.name && c.lookEn)
    .map((c) => `${c.name}：${c.lookEn}`)
    .join('\n')
}

/** 界面模型专有的驼峰字段：带着它们写库会被服务端忽略，锚点会静默丢失 */
const CAMEL_ONLY_KEYS = [
  'lookCn',
  'lookEn',
  'expressionSheet',
  'orbitSheet',
  'voiceSample',
  'voiceId',
  'voiceProvider',
  'voiceModelKey',
  'referenceImages',
] as const

/**
 * 角色落库前的本地契约自检：拦住「写出去的东西根本不是服务端认的形状」。
 *
 * 服务端 `saveProject` 对 characters 是整表重建，字段名不对不会报错，只会把值写成空串。
 * 所以这里必须在提交前发现，而不是提交后再读回——那时事务已经提交，无法回滚。
 *
 * 返回 null 表示可以写；返回字符串是给用户看的失败原因。
 */
export function checkCharacterWriteback(payload: unknown, merged: CharacterSheet[]): string | null {
  if (!Array.isArray(payload)) return '角色写回失败：待写角色不是数组'
  if (payload.length !== merged.length) {
    return `角色写回失败：待写 ${payload.length} 条与合并结果 ${merged.length} 条不一致，锚点可能未保存`
  }
  for (const [i, raw] of payload.entries()) {
    const o = (raw ?? {}) as Record<string, unknown>
    const name = String(o.name ?? '').trim()
    if (!name) return `角色写回失败：第 ${i + 1} 条没有角色名，服务端无法保存该角色的锚点`
    const camel = CAMEL_ONLY_KEYS.find((k) => k in o)
    if (camel) {
      return `角色写回失败：角色「${name}」带着界面字段 ${camel}；服务端只认蛇形字段，写进去锚点会变成空串`
    }
    const want = merged[i]
    if (String(o.look_cn ?? '') !== want.lookCn || String(o.look_en ?? '') !== want.lookEn) {
      return `角色写回失败：角色「${name}」的外观锚点未保存，写入内容与合并结果不一致`
    }
  }
  return null
}
