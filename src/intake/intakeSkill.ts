/**
 * 「让模型整理」的唯一入口：把自由文本交给 intake 技能，产出契约形状的草稿。
 *
 * 注意这不是自动路径——只有用户在导入对话框里主动点按钮才会调用。
 * 超长文本按原文已有的集/场标记切块，没有标记就拒绝，绝不截断。
 */
import { callText } from '../api'
import { buildBoardSkillPrompt } from '../skills/board'
import { assertSkillOutput } from '../skills/board'

export type IntakeTarget = 'script' | 'shots' | 'prompts'

const SKILL_OF: Record<IntakeTarget, string> = {
  script: 'script-intake',
  shots: 'shotlist-intake',
  prompts: 'prompt-intake',
}

export const INTAKE_CONTRACT: Record<IntakeTarget, string> = {
  script: 'script-v1',
  shots: 'shots-v1',
  prompts: 'prompts-v1',
}

export const INTAKE_LABEL: Record<IntakeTarget, string> = {
  script: '剧本',
  shots: '镜头表',
  prompts: '提示词',
}

/** 单块超过这个字符数就不再一次性发送（多数模型窗口能容纳，但不该赌） */
export const CHUNK_CHARS = 60000

/** 按原文已有的集/场标记切块；没有标记返回 null，表示不能安全切 */
export function splitByStructure(raw: string): string[] | null {
  const text = String(raw ?? '')
  if (text.length <= CHUNK_CHARS) return [text]

  // 集级标记：第N集 / 第 N 集 / ## 第N集
  const epRe = /^(?:#{1,6}\s*)?第\s*[0-9一二三四五六七八九十百]+\s*集.*$/gm
  const epMarks = [...text.matchAll(epRe)].map((m) => m.index ?? 0)
  if (epMarks.length >= 2) return sliceAt(text, epMarks)

  // 场级标记兜底：场景 N / 第N场
  const scRe = /^(?:#{1,6}\s*)?(?:场景\s*[0-9]+|第\s*[0-9]+\s*场).*$/gm
  const scMarks = [...text.matchAll(scRe)].map((m) => m.index ?? 0)
  if (scMarks.length >= 2) return sliceAt(text, scMarks)

  return null
}

function sliceAt(text: string, marks: number[]): string[] {
  const out: string[] = []
  for (let i = 0; i < marks.length; i++) {
    const start = marks[i]
    const end = i + 1 < marks.length ? marks[i + 1] : text.length
    const piece = text.slice(start, end).trim()
    if (piece) out.push(piece)
  }
  // 首块前的引言不丢
  if (marks[0] > 0) {
    const head = text.slice(0, marks[0]).trim()
    if (head) out.unshift(head)
  }
  return out
}

export type IntakeResult = {
  /** 契约 JSON（未经业务合并） */
  json: unknown
  /** 用了几块（>1 表示切块合并过） */
  chunks: number
  modelLabel: string
}

/** 合并多块结果：按契约形状拼接，冲突时先出现的为准并记账 */
function mergeChunks(target: IntakeTarget, parts: unknown[]): unknown {
  if (target === 'script') {
    const byNo = new Map<number, Record<string, unknown>>()
    let logline = ''
    for (const p of parts) {
      const j = (p ?? {}) as { logline?: unknown; episodes?: unknown }
      if (!logline && typeof j.logline === 'string') logline = j.logline
      for (const ep of Array.isArray(j.episodes) ? j.episodes : []) {
        const no = Number((ep as { no?: unknown })?.no)
        if (!Number.isFinite(no)) continue
        if (!byNo.has(no)) byNo.set(no, ep as Record<string, unknown>)
      }
    }
    return { logline, episodes: [...byNo.values()].sort((a, b) => Number(a.no) - Number(b.no)) }
  }
  if (target === 'shots') {
    const byNo = new Map<string, Record<string, unknown>>()
    for (const p of parts) {
      for (const s of Array.isArray((p as { shots?: unknown })?.shots) ? (p as { shots: unknown[] }).shots : []) {
        const no = String((s as { no?: unknown })?.no ?? '').trim()
        if (!no) continue
        if (!byNo.has(no)) byNo.set(no, s as Record<string, unknown>)
      }
    }
    return { shots: [...byNo.values()] }
  }
  const byNo = new Map<string, Record<string, unknown>>()
  for (const p of parts) {
    for (const s of Array.isArray((p as { shots?: unknown })?.shots) ? (p as { shots: unknown[] }).shots : []) {
      const no = String((s as { no?: unknown })?.no ?? '').trim()
      if (!no) continue
      if (!byNo.has(no)) byNo.set(no, s as Record<string, unknown>)
    }
  }
  return { shots: [...byNo.values()] }
}

/**
 * 整理一次。失败时抛出可读错误（含超长但无法切块的明确提示）。
 * 调用方负责先确认用户点了按钮。
 */
export async function runIntake(opts: {
  target: IntakeTarget
  raw: string
  modelKey: string
  context?: { style?: string; aspect?: string; epCount?: number; targetSeconds?: number }
  signal?: AbortSignal
}): Promise<IntakeResult> {
  const { target, raw } = opts
  const text = String(raw ?? '')
  if (!text.trim()) throw new Error('没有可整理的内容')

  const chunks = splitByStructure(text)
  if (!chunks) {
    throw new Error(
      `内容超过 ${CHUNK_CHARS} 字且没有可识别的集/场标记，无法安全切块。请先手动按集拆分后再导入，不要直接整篇整理。`,
    )
  }

  const inputs: Record<string, unknown> = { raw: '' }
  if (target === 'script') {
    inputs.epCount = opts.context?.epCount ?? Math.max(1, countEpisodes(text))
    inputs.targetSeconds = opts.context?.targetSeconds ?? 75
    inputs.style = opts.context?.style || '近未来科幻写实'
  } else if (target === 'shots') {
    inputs.style = opts.context?.style || '近未来科幻写实'
    inputs.aspect = opts.context?.aspect || '16:9'
  } else {
    inputs.style = opts.context?.style || '近未来科幻写实'
  }

  const parts: unknown[] = []
  let modelLabel = ''
  for (const [i, chunk] of chunks.entries()) {
    if (opts.signal?.aborted) throw new Error('已取消')
    const skill = await buildBoardSkillPrompt(SKILL_OF[target], { ...inputs, raw: chunk })
    const r = await callText({
      system: skill.system,
      prompt: skill.task,
      modelKey: opts.modelKey,
      json: true,
      signal: opts.signal,
    })
    if (!modelLabel) modelLabel = r.modelLabel
    const json = r.json
    if (json === undefined) throw new Error(`第 ${i + 1} 块没有返回可解析的 JSON`)
    assertSkillOutput(INTAKE_CONTRACT[target], json)
    parts.push(json)
  }

  return { json: mergeChunks(target, parts), chunks: chunks.length, modelLabel }
}

function countEpisodes(text: string): number {
  const m = new Set<string>()
  for (const hit of String(text).matchAll(/第\s*([0-9一二三四五六七八九十百]+)\s*集/g)) m.add(hit[1])
  return Math.max(1, m.size)
}
