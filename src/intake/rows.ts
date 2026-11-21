/**
 * 表格文本 → 导入行。把 format / tableMap / normalize / diff 串起来。
 *
 * 这里不做任何写入：只产出行 + 需要人判断的提示，交给对话框预览。
 */
import type { ProjectEpisode } from '../api'
import type { DialogueDelivery } from '../types'
import type { IntakeDialogueLine } from './diff'
import { isTabular, markdownTableBlocks, parseTable, type IntakeFormat } from './format'
import { diffShots, type ImportShotRow, type IntakeDiff } from './diff'
import { normalizeMove, normalizeSize, parseDuration, splitDialogueCell } from './normalize'
import { mapHeaders, type ShotColumn } from './tableMap'
import { resolveCameraLexiconByName } from '../cameraLexicon'
import { parseCastCell, parsePerformanceCell, parseRefCell } from '../shotCellSyntax'

export type ParseTableResult = {
  rows: ImportShotRow[]
  diff: IntakeDiff
  /** 解析失败、无法导入的原因；有值时 rows 为空 */
  error?: string
  /** 表头识别结果，用于在预览里展示「哪些列被用上了」 */
  headers: { header: string; column: ShotColumn | null }[]
}

const pad = (n: number) => String(n).padStart(2, '0')

/** 收集该集已知的场次号，用于判断表格里的场次是否对得上 */
function knownScenes(episodes: ProjectEpisode[], epNo: number): Set<number> {
  const ep = episodes.find((x) => Number(x?.no) === epNo)
  const out = new Set<number>()
  for (const [i, sc] of (ep?.scenes ?? []).entries()) {
    const no = Number((sc as { no?: unknown })?.no) || i + 1
    out.add(no)
  }
  return out
}

/**
 * 解析表格为导入行。
 *
 * 缺镜号列一律拒绝（没有镜号就无法与现有数据对齐）。
 * 其余列缺失只留空，不用默认值冒充用户内容；
 * 唯一例外是结构上必须有值的字段（运镜），此时填默认并计入 defaultsFilled。
 */
export function rowsFromTable(
  text: string,
  kind: IntakeFormat,
  ctx: { epNo: number; episodes: ProjectEpisode[] },
): ParseTableResult {
  const emptyDiff: IntakeDiff = {
    added: 0,
    updated: 0,
    kept: 0,
    skipped: 0,
    involved: 0,
    episodeTotal: 0,
    scenesFallback: 0,
    defaultsFilled: {},
    ignoredColumns: [],
    unresolved: [],
    notices: [],
  }

  if (!isTabular(kind)) {
    return { rows: [], diff: emptyDiff, error: '不是表格内容', headers: [] }
  }

  // Markdown 文档里常有多张表（角色表、图片清单、分镜表…）。
  // 选「表头能映射出镜号」的那一张，而不是盲取第一张——实测整篇剧本里
  // 第一张表往往不是分镜表。
  let table = parseTable(text, kind)
  if (kind === 'markdown-table') {
    const blocks = markdownTableBlocks(text)
    const best = blocks.find((b) => mapHeaders(b[0] ?? []).hasShotNo)
    if (best) table = best.filter((cells) => !cells.every((c) => /^:?-{2,}:?$/.test(c.trim())))
  }
  if (table.length < 2) {
    return { rows: [], diff: emptyDiff, error: '表格至少需要表头行和一行数据', headers: [] }
  }

  const headerRow = table[0]
  const mapped = mapHeaders(headerRow)
  const headers = headerRow.map((h) => ({ header: String(h ?? '').trim(), column: null as ShotColumn | null }))
  for (const [idx, col] of mapped.columns) headers[idx].column = col

  if (!mapped.hasShotNo) {
    return {
      rows: [],
      diff: emptyDiff,
      error: '表格里没有可识别为镜号的列（可用表头：镜头 / 镜号 / No / Shot）',
      headers,
    }
  }

  const scenes = knownScenes(ctx.episodes, ctx.epNo)
  const rows: ImportShotRow[] = []
  let scenesFallback = 0

  for (let r = 1; r < table.length; r++) {
    const cells = table[r]
    if (!cells.some((c) => String(c ?? '').trim())) continue

    const get = (col: ShotColumn): string => {
      for (const [idx, c] of mapped.columns) if (c === col) return String(cells[idx] ?? '').trim()
      return ''
    }

    const rowNo = r
    const no = get('no')
    if (!no) {
      rows.push({ row: rowNo, no: '', error: '镜号为空' })
      continue
    }

    const filled: string[] = []

    // 时长
    const rawSeconds = get('seconds')
    let seconds: number | undefined
    if (rawSeconds) {
      const parsed = parseDuration(rawSeconds)
      if (parsed == null) {
        rows.push({ row: rowNo, no, error: `时长「${rawSeconds}」无法解析` })
        continue
      }
      seconds = parsed
    }

    // 景别：能归一化就归一化，认不出保留原文并提示
    const rawSize = get('size')
    let size: string | undefined
    let sizeNote = ''
    if (rawSize) {
      const norm = normalizeSize(rawSize)
      if (norm.size) {
        size = norm.size
        sizeNote = norm.note
      } else {
        filled.push('size')
        sizeNote = rawSize
      }
    }

    // 运镜：结构上必须有值，缺列时补固定并计数
    const rawMove = get('move')
    let move = normalizeMove(rawMove) ?? undefined
    if (!move) {
      move = '固定'
      if (!rawMove) filled.push('move')
    }

    // 台词：拆成台词 / 旁白 / 声音说明；标注随台词一起带出
    const rawDialogue = get('dialogue')
    const cell = rawDialogue ? splitDialogueCell(rawDialogue) : null
    const dialogue = cell && cell.speech.length ? cell.speech : undefined
    // 台词被写入时表演必须整组重建：下标已变，沿用旧数组会把 A 的语速挂到 B 的台词上
    const dialogueDelivery = rawDialogue ? (cell?.speech ?? []).map((l) => deliveryOfLine(l)) : undefined

    // 选角：只写文件真给了的名字
    const rawCast = get('cast')
    const cast = rawCast ? parseCastCell(rawCast) : undefined

    // 表演：文件给了才写；缺情绪/强度由解析器补默认值并计数
    const rawPerformance = get('performance')
    const perf = rawPerformance ? parsePerformanceCell(rawPerformance) : null

    // 运镜参照：只认精确匹配，解析不到就跳过并在预览点名
    const unresolvedRefs: string[] = []
    const rawLexicon = get('lexicon_ref_key')
    let lexiconRefKey: string | undefined
    if (rawLexicon) {
      const hit = resolveCameraLexiconByName(rawLexicon)
      if (hit.entry) lexiconRefKey = hit.entry.key
      else if (hit.candidates?.length) {
        unresolvedRefs.push(
          `运镜参照「${rawLexicon}」匹配到多个条目（${hit.candidates.map((c) => c.key).join('、')}），已跳过`,
        )
      } else {
        unresolvedRefs.push(`运镜参照「${rawLexicon}」在镜头语言库里不存在，已跳过`)
      }
    }

    // 参考：先留名字，节点 id 由调用方查画布解析
    const rawReference = get('reference')
    const reference = rawReference ? parseRefCell(rawReference) : undefined

    const descParts = [get('desc'), sizeNote].filter(Boolean)
    const desc = descParts.join('，').trim()

    // 场次：能对上已知场次才写值；对不上计入回退，由预览说明
    let sceneNo: number | undefined
    const rawScene = get('scene_no')
    if (rawScene) {
      const v = Number(rawScene)
      if (Number.isFinite(v) && v > 0) {
        if (scenes.has(v)) sceneNo = v
        else scenesFallback++
      }
    }

    rows.push({
      row: rowNo,
      no,
      episode: ctx.epNo,
      ...(sceneNo ? { scene_no: sceneNo } : {}),
      seconds,
      size,
      move,
      desc,
      dialogue,
      ...(dialogueDelivery ? { dialogue_delivery: dialogueDelivery } : {}),
      ...(cast && cast.length ? { cast } : {}),
      ...(perf && perf.entries.length ? { performance: perf.entries } : {}),
      ...(perf && perf.filled ? { filled: [...filled, 'performance'] } : filled.length ? { filled } : {}),
      ...(lexiconRefKey ? { lexicon_ref_key: lexiconRefKey } : {}),
      ...(reference && (reference.characters.length || reference.assets.length) ? { reference } : {}),
      ...(unresolvedRefs.length ? { unresolvedRefs } : {}),
      keyframe_prompt: get('keyframe_prompt') || undefined,
      video_prompt: get('video_prompt') || undefined,
    })

    if (cell?.sounds.length) {
      rows[rows.length - 1].desc = `${rows[rows.length - 1].desc}${rows[rows.length - 1].desc ? '；' : ''}声音：${cell.sounds
        .join(' ')}`.trim()
    }
  }

  const diff = diffShots([], rows, ctx.epNo, {
    ignoredColumns: mapped.ignored,
    scenesFallback,
  })

  return { rows, diff, headers }
}

/** 台词行 → 台词表演对象：只保留真正设置了的字段，空槽不写 */
function deliveryOfLine(line: IntakeDialogueLine): DialogueDelivery {
  const out: DialogueDelivery = {}
  if (line.emotion) out.emotion = line.emotion
  if (line.intensity !== undefined) out.intensity = line.intensity
  if (line.pace) out.pace = line.pace
  if (line.volume) out.volume = line.volume
  if (line.emphasis) out.emphasis = line.emphasis
  return out
}

/**
 * 导入行 → `buildShotsFromImport` 的入参形状。
 *
 * 两个对话框原本各抄一份字段清单，新增列时必然漏一边；
 * 收成一处的代价只有一个函数，收益是「少写一个字段」这类事故不再可能。
 * 只映射文件真给了值的字段：`undefined` 在合并语义里代表「文件没提」。
 */
export function rowsToShotInputs(rows: ImportShotRow[]): Record<string, unknown>[] {
  return rows.map((r) => ({
    no: r.no,
    scene_no: r.scene_no,
    seconds: r.seconds,
    size: r.size,
    move: r.move,
    desc: r.desc,
    dialogue: r.dialogue,
    dialogue_delivery: r.dialogue_delivery,
    cast: r.cast,
    performance: r.performance,
    refIds: r.refIds,
    lexicon_ref_key: r.lexicon_ref_key,
    keyframe_prompt: r.keyframe_prompt,
    video_prompt: r.video_prompt,
  }))
}

/** 供 UI 展示：镜号 → 稳定的 shot id 规则与 buildShotsFromModel 保持一致 */
export function shotIdOf(epNo: number, no: string): string {
  return `E${pad(epNo)}-${no}`
}
