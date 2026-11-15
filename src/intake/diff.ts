/**
 * 导入预览的差异统计。
 *
 * 预览必须说清「哪些行会被改、哪些会留、哪些系统替你补了什么」，
 * 因为这些事一旦静默发生，用户就分不出「我写的」和「系统编的」。
 */
import type { ProjectShot } from '../api'
import type { DialogueDelivery, PerformanceEntry } from '../types'

/** 台词行：可能带内联表演标注，导出与导入共用同一组字段名 */
export type IntakeDialogueLine = { speaker: string; text: string } & DialogueDelivery

export type IntakeDiff = {
  /** 文件里出现、库里没有的镜号 */
  added: number
  /** 文件里出现、库里也有的镜号 */
  updated: number
  /** 库里存在、文件没提，因此保留的行 */
  kept: number
  /** 解析失败或镜号重复被跳过的行 */
  skipped: number
  /** 本次涉及的镜数（added + updated） */
  involved: number
  /** 该集当前总镜数 */
  episodeTotal: number
  /** 镜号与当前集场次对不上的镜数 */
  scenesFallback: number
  /** 系统补了默认值的字段计数（如缺运镜列） */
  defaultsFilled: Record<string, number>
  /** 表头里没有对应字段、被忽略的列名 */
  ignoredColumns: string[]
  /** 参考与运镜参照解析不到时，需要人判断的条目 */
  unresolved: string[]
  /** 需要人判断的逐条说明 */
  notices: string[]
}

export type ImportShotRow = {
  /** 行号（表格里的第几行数据行，从 1 开始），用于报错定位 */
  row: number
  no: string
  episode?: number
  /** 所属场次：只在能对上该集已知场次时给值，否则留空由下游回退第一场 */
  scene_no?: number
  seconds?: number
  size?: string
  move?: string
  desc?: string
  dialogue?: IntakeDialogueLine[]
  /** 台词表演：与 dialogue 下标平行；有台词列时总是整组给出，避免下标错位 */
  dialogue_delivery?: DialogueDelivery[]
  /** 镜级出场角色 */
  cast?: string[]
  /** 表演条目；缺情绪/强度时已补默认值并计入 filled */
  performance?: PerformanceEntry[]
  /** 已按镜头语言库解析出的条目标识；解析不到则不给 */
  lexicon_ref_key?: string
  /** 参考列里的可读名字，尚未解析成节点 id */
  reference?: { characters: string[]; assets: string[] }
  /** 已解析出的参考 id token（`char-*` / `asset-*`） */
  refIds?: string[]
  /** 参考或运镜参照没解析成功时的逐条说明，进预览 */
  unresolvedRefs?: string[]
  keyframe_prompt?: string
  video_prompt?: string
  /** 解析过程中发现的问题；有值表示这行会被跳过 */
  error?: string
  /** 系统补的默认值字段名 */
  filled?: string[]
}

/**
 * 统计差异。rows 里带 error 的计入 skipped，其余按镜号与现有行比对。
 * 调用方拿这个结果渲染预览，不参与任何写入。
 */
export function diffShots(
  current: ProjectShot[],
  rows: ImportShotRow[],
  epNo: number,
  opts: { ignoredColumns?: string[]; scenesFallback?: number } = {},
): IntakeDiff {
  const visible = current.filter((s) => (Number(s.episode) || 1) === epNo)
  const existing = new Set(visible.map((s) => String(s.no ?? '').trim()))

  let added = 0
  let updated = 0
  let skipped = 0
  const defaultsFilled: Record<string, number> = {}
  const notices: string[] = []
  // 参考解析失败必须逐条点名：静默丢弃会让用户以为导进来了却没连上
  const unresolved: string[] = []
  const seen = new Set<string>()

  for (const r of rows) {
    if (r.error) {
      skipped++
      notices.push(`第 ${r.row} 行跳过：${r.error}`)
      continue
    }
    const no = String(r.no ?? '').trim()
    if (!no) {
      skipped++
      notices.push(`第 ${r.row} 行跳过：镜号为空`)
      continue
    }
    if (seen.has(no)) {
      skipped++
      notices.push(`第 ${r.row} 行跳过：镜号「${no}」在文件里重复`)
      continue
    }
    seen.add(no)
    if (existing.has(no)) updated++
    else added++
    for (const f of r.filled ?? []) defaultsFilled[f] = (defaultsFilled[f] ?? 0) + 1
    for (const u of r.unresolvedRefs ?? []) unresolved.push(`${no}：${u}`)
  }

  const involved = added + updated
  const kept = Math.max(0, visible.length - updated)

  if (opts.scenesFallback && opts.scenesFallback > 0) {
    notices.push(
      `${opts.scenesFallback} 镜的场次号在当前集不存在，将归入第一场；检查表里的场次号是否与分集元数据一致`,
    )
  }
  if (involved > 0 && involved < visible.length) {
    notices.push(`本次只涉及 ${involved} 镜，该集共 ${visible.length} 镜，其余 ${visible.length - involved} 镜保持原样`)
  }
  const ignored = opts.ignoredColumns ?? []
  if (ignored.length) {
    notices.push(`忽略了无法识别为镜头字段的列：${ignored.join('、')}`)
  }
  if (unresolved.length) {
    notices.push(`参考未能解析（这些字段会被跳过）：${unresolved.join('；')}`)
  }

  return {
    added,
    updated,
    kept,
    skipped,
    involved,
    episodeTotal: visible.length,
    scenesFallback: opts.scenesFallback ?? 0,
    defaultsFilled,
    ignoredColumns: ignored,
    unresolved,
    notices,
  }
}

/** 预览用的单行摘要 */
export function describeDiff(d: IntakeDiff): string {
  const parts = [`新增 ${d.added}`, `更新 ${d.updated}`, `保留 ${d.kept}`]
  if (d.skipped) parts.push(`跳过 ${d.skipped}`)
  return parts.join(' · ')
}
