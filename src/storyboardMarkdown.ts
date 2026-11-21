/**
 * 分镜表 Markdown 导出：把项目里的分集与分镜写成可回灌的分镜表。
 *
 * 为什么不用画布节点：节点只含当前集，且没有 `desc`（画面与动作）——
 * 该字段只存在于 project.json；节点还带坐标与标注，属于工程态。
 *
 * 为什么格式被导入侧钉死：`intake/classify.ts` 与 `intake/rows.ts` 已经定义了
 * 「什么样的 Markdown 算分镜表」——首列表头可识别为镜号、全文件只有一个
 * `第 N 集` 级标题、只取第一张带镜号的表。导出反向满足这些条件，才能原路回灌。
 */
import { strToU8, zipSync } from 'fflate'
import type { ProjectEpisode, ProjectShot } from './api'
import { getCameraLexiconEntry } from './cameraLexicon'
import { formatEpisodeLabel } from './shotRows'
import {
  renderCastCell,
  renderDialogueLine,
  renderPerformanceCell,
  renderRefCell,
} from './shotCellSyntax'
import type { DialogueDelivery } from './types'
import { effectLabel, normalizeEffect } from './transition'

/** 文件名里不能出现的字符（POSIX 与 Windows 并集，含路径分隔符） */
const ILLEGAL_FILENAME = /[\\/:*?"<>|]/g

/**
 * 单元格净化。
 *
 * 表格里一行就是一条记录，所以换行必须换写法：导出用 `<br>`，
 * 导入侧在 `splitDialogueCell` 入口把它还原成换行。
 * 竖线会把一行切出多余的列，换成全角 `｜`（导入侧按 `|` 切分，不做反转义，
 * 所以只能由导出侧单边处理，不能写成 `\|`）。
 *
 * 不截断内容：台词与提示词多长都原样写。
 */
export function mdCell(raw: unknown): string {
  return String(raw ?? '')
    .replace(/\r\n?/g, '\n')
    .trim()
    .replace(/[ \t]*\n[ \t]*/g, '<br>')
    .replace(/\|/g, '｜')
}

/** 集标签：复用画布卡头的写法，避免两处各写一份 `E01` */
export const episodeLabel = formatEpisodeLabel

/** 把任意标题压成可用作文件名的一段：非法字符与空白转连字符 */
function safeName(raw: unknown): string {
  return String(raw ?? '')
    .replace(ILLEGAL_FILENAME, '-')
    .replace(/[\s\u3000]+/g, '-')
    .replace(/-{2,}/g, '-')
    .replace(/^[-.]+/, '')
    .replace(/[-.]+$/, '')
}

/**
 * 导出文件名：`E01-雨夜.md`。
 * 标题为空（或净化后为空）时退化为 `E01.md`，绝不出现只有连字符的文件名。
 */
export function mdFileName(epNo: number, title?: string): string {
  const no = episodeLabel(epNo)
  // 长标题截断只是文件名长度限制，不影响文件内容
  const t = safeName(title).slice(0, 60).replace(/[-.]+$/, '')
  return t ? `${no}-${t}.md` : `${no}.md`
}

/** 全部集导出的 zip 名：`{项目名}-分镜表.zip` */
export function exportZipName(projectName?: string): string {
  const t = safeName(projectName).slice(0, 60).replace(/[-.]+$/, '')
  return t ? `${t}-分镜表.zip` : '分镜表.zip'
}

// ------------------------------------------------------------------ 分镜表

/**
 * 表头必须是导入别名表里认得的写法，且首列可识别为镜号。
 * 顺序固定：新增列只追加在末尾——插入中间会让用户手写的旧文件按位置理解时整体错位。
 */
export const SHOT_TABLE_HEADER = [
  '镜头',
  '场次',
  '时长',
  '景别',
  '运镜',
  '画面与动作',
  '台词与声音',
  '首帧提示词',
  '视频提示词',
  '选角',
  '表演',
  '运镜参照',
  '参考',
] as const

/** 分隔行：每列至少三个减号，导入侧按 `:?-{2,}:?` 识别 */
const HEADER_SEPARATOR = `| ${SHOT_TABLE_HEADER.map(() => '---').join(' | ')} |`

/** 秒数保留一位小数，去掉 `4.0` 这种噪音 */
const round1 = (n: number) => String(Math.round(n * 10) / 10)

/** 时长单元格：0 与非法值留空 */
function fmtSeconds(raw: unknown): string {
  const n = Number(raw)
  if (!Number.isFinite(n) || n <= 0) return ''
  return round1(n)
}

/**
 * 台词：既有数据可能是字符串，也可能是 `{speaker,text}[]`。
 *
 * 台词表演按说话人之后的标注内联，而不是另开一列——另开一列就得按行号对齐，
 * 而表格的行号在人工编辑时极容易错位，一旦错位就会把 A 的语速挂到 B 的台词上。
 */
function dialogueCell(raw: ProjectShot['dialogue'], delivery?: DialogueDelivery[]): string {
  if (!raw) return ''
  // 字符串台词没有分行结构，挂不上逐条的表演标注
  if (typeof raw === 'string') return raw
  if (!Array.isArray(raw)) return ''
  return raw
    .map((line, i) => {
      const speaker = String(line?.speaker ?? '').trim()
      const text = String(line?.text ?? '')
      return renderDialogueLine(speaker, text, delivery?.[i])
    })
    .filter((s) => s.trim())
    .join('\n')
}

/**
 * 运镜参照：只认绑定的条目 key，绝不从景别或运镜反推。
 * 反推会让「运镜=推」的镜头凭空多出一条从未绑定过的参照，导入时又写回绑定，
 * 等于系统自己制造了一堆用户没选过的条目。
 */
function lexiconCell(shot: ProjectShot): string {
  const key = String(shot.lexicon_ref_key ?? '').trim()
  if (!key) return ''
  return getCameraLexiconEntry(key)?.cn || key
}

/**
 * 单镜一行。
 *
 * 为什么画面与动作和首帧提示词互不填充：很多项目只有提示词、desc 为空，
 * 一旦把提示词抄进画面列，回灌时就会把提示词写进画面描述，属于语义污染。
 * 宁可留空——空单元格导入时会被当作「文件没给值」，不会覆盖已有内容。
 */
export function renderShotRow(shot: ProjectShot, index?: RefIndex): string {
  const refs = resolveShotRefs(shot.refIds, index)
  const cells = [
    mdCell(shot.no),
    mdCell(shot.scene_no ?? ''),
    fmtSeconds(shot.seconds),
    mdCell(shot.size),
    mdCell(shot.move),
    mdCell(shot.desc),
    mdCell(dialogueCell(shot.dialogue, shot.dialogue_delivery)),
    mdCell(shot.keyframe_prompt),
    mdCell(shot.video_prompt),
    mdCell(renderCastCell(shot.cast)),
    mdCell(renderPerformanceCell(shot.performance)),
    mdCell(lexiconCell(shot)),
    mdCell(renderRefCell({ characters: refs.characters, assets: refs.assets })),
  ]
  return `| ${cells.join(' | ')} |`
}

/** 表头 + 分隔行；没有镜头时返回空串（调用方不写空表） */
export function renderShotTable(shots: ProjectShot[], index?: RefIndex): string {
  if (shots.length === 0) return ''
  return [`| ${SHOT_TABLE_HEADER.join(' | ')} |`, HEADER_SEPARATOR, ...shots.map((s) => renderShotRow(s, index))].join(
    '\n',
  )
}

// ------------------------------------------------------------------ 单集文档

/** 导出源：只需要项目元数据、分集与镜头，不接受画布节点 */
export type StoryboardSource = {
  projectName?: string
  logline?: string
  style?: string
  aspect?: string
  episodes?: ProjectEpisode[]
  shots?: ProjectShot[]
  /**
   * 参考名字索引：由调用方从画布节点构造。
   *
   * 为什么不在本模块里查画布：这个模块是纯函数，能在 Node 里直接测，
   * 也可以在没有画布的压缩包导入路径里跑。素材卡标题只在画布节点上，
   * 所以由调用方查好后传进来，本模块只做查表。
   */
  refIndex?: RefIndex
}

/** 参考 id → 可读名字的索引 */
export type RefIndex = {
  /** 素材节点 id（`asset-<uid>`）→ 素材标题 */
  assetTitles?: Record<string, string>
  /** 角色 id 或角色名 → 角色显示名 */
  characterNames?: Record<string, string>
  /** 素材标题 → 节点 id 列表；重名时多于一项，导入按歧义处理 */
  assetIds?: Record<string, string[]>
  /** 角色原始列表：名字反查 id 时不能靠 characterNames 猜哪个键是 id */
  characters?: { id: string; name: string }[]
}

export type ResolvedRefs = {
  characters: string[]
  assets: string[]
  /** 解析不到的目标说明，写进附注；不写进参考列 */
  unresolved: string[]
}

/**
 * 把镜头参考 id 解析成可读名字。
 *
 * `char-miss-<名字>` 按名字保留：它本身就是可读的，丢掉只会让用户以为参考没了；
 * 但会在附注里点明该角色还没有角色卡。
 * 其余指不到卡片的 id 一律进 unresolved——参考列必须是可重新解析的名字集合，
 * 写 `asset-9f2a` 既不可读，导入时也会被当成一个不存在的素材名。
 */
export function resolveShotRefs(refIds: string[] | undefined, index?: RefIndex): ResolvedRefs {
  const out: ResolvedRefs = { characters: [], assets: [], unresolved: [] }
  const seen = new Set<string>()
  const push = (arr: string[], v: string) => {
    if (!seen.has(v)) {
      seen.add(v)
      arr.push(v)
    }
  }
  for (const raw of refIds ?? []) {
    const token = String(raw ?? '').trim()
    if (!token) continue
    if (token.startsWith('char-miss-')) {
      const key = token.slice('char-miss-'.length).trim()
      if (!key) continue
      push(out.characters, index?.characterNames?.[key] || key)
      out.unresolved.push(`角色「${key}」还没有角色卡`)
      continue
    }
    if (token.startsWith('char-')) {
      const key = token.slice('char-'.length).trim()
      if (!key) continue
      const name = index?.characterNames?.[key]
      if (name) push(out.characters, name)
      else out.unresolved.push(`角色「${key}」已不存在`)
      continue
    }
    if (token.startsWith('asset-')) {
      const title = index?.assetTitles?.[token]
      if (title) push(out.assets, title)
      else out.unresolved.push(`素材「${token}」已不存在`)
    }
  }
  return out
}

export type EpisodeMarkdown = {
  epNo: number
  title: string
  fileName: string
  text: string
}

export type EpisodeMarkdownOptions = {
  /** 固定导出时间，便于测试断言 */
  exportedAt?: Date
}

const sceneNoOf = (s: ProjectShot) => {
  const n = Number(s.scene_no)
  return Number.isFinite(n) && n > 0 ? n : null
}

/** 镜号里的数字：`S07` / `07` / `第7镜` 都能取到 7，排序用 */
function noNumber(no: unknown): number {
  const m = String(no ?? '').match(/(\d+)/)
  return m ? Number(m[1]) : Number.MAX_SAFE_INTEGER
}

/** 集内镜头按镜号数字序；同号按原始下标，保证稳定 */
function sortShots(shots: ProjectShot[]): ProjectShot[] {
  return shots
    .map((s, i) => ({ s, i, n: noNumber(s.no) }))
    .sort((a, b) => a.n - b.n || a.i - b.i)
    .map((x) => x.s)
}

const shotOfEpisode = (shots: ProjectShot[], epNo: number) =>
  sortShots(shots.filter((s) => (Number(s.episode) || 1) === epNo))

function resolveEpisode(src: StoryboardSource, epNo: number): ProjectEpisode {
  const declared = (src.episodes ?? []).find((e) => Number(e?.no) === epNo)
  // 有镜头但没写 episodes 的集不能因此消失：导出仍然要出这份文件
  return declared ?? { no: epNo, scenes: [] }
}

const fmtOne = round1

function totalSeconds(shots: ProjectShot[]): number {
  return shots.reduce((acc, s) => acc + (Number(s.seconds) || 0), 0)
}

/** 场次小节：标题绝不写「第 N 集」，否则整份文件会被判成多集大纲 */
function sceneHeadings(ep: ProjectEpisode, shots: ProjectShot[]): string[] {
  const declared = ep.scenes ?? []
  const known = new Set<number>()
  const blocks: string[] = []

  for (const [i, sc] of declared.entries()) {
    const no = Number(sc?.no) || i + 1
    known.add(no)
    const head = [`场 ${no}`, sc?.place, sc?.time].filter((x) => String(x ?? '').trim()).join(' · ')
    const lines: string[] = [`### ${head}`]
    const cast = (sc?.characters ?? []).map((c) => String(c ?? '').trim()).filter(Boolean)
    if (cast.length) lines.push(`- 出场：${cast.join('、')}`)
    const meta = [
      Number.isFinite(Number(sc?.intensity)) && sc?.intensity !== undefined ? `冲突 ${sc?.intensity}` : '',
      String(sc?.tone ?? '').trim() ? `基调：${sc?.tone}` : '',
    ].filter(Boolean)
    if (meta.length) lines.push(`- ${meta.join(' · ')}`)
    if (String(sc?.beats ?? '').trim()) lines.push(`- 剧情：${String(sc?.beats).trim()}`)
    blocks.push(lines.join('\n'))
  }

  // 镜头上有场次、但分集元数据没登记：仍然给出小节，否则场次信息只活在表格一列里
  const extra = [...new Set(shots.map(sceneNoOf).filter((n): n is number => n !== null))]
    .filter((n) => !known.has(n))
    .sort((a, b) => a - b)
  for (const no of extra) {
    const slug = shots.find((s) => sceneNoOf(s) === no && String(s.scene_slug ?? '').trim())?.scene_slug
    blocks.push([`### 场 ${no}${slug ? ` · ${String(slug).trim()}` : ''}`].join('\n'))
  }

  return blocks
}

/** 转场、缺项与未解析参考写表格外：它们是接缝与健康度，不是镜头字段 */
function footnote(shots: ProjectShot[], allShots: ProjectShot[], index?: RefIndex): string {
  const byId = new Map(allShots.map((s) => [s.id, s]))
  const transitions: string[] = []
  for (const s of shots) {
    const t = s.transition_out
    if (!t) continue
    const target = byId.get(t.to)
    const targetNo = String(target?.no ?? t.to).trim()
    const effect = normalizeEffect(t.effect)
    transitions.push(
      `${String(s.no).trim() || s.id} → ${targetNo}：${effectLabel(effect)} ${fmtOne(effect.seconds)}s`,
    )
  }

  const missingKeyframe = shots
    .filter((s) => !String(s.keyframe_prompt ?? '').trim())
    .map((s) => String(s.no ?? '').trim())
    .filter(Boolean)
  const missingVideo = shots
    .filter((s) => !String(s.video_prompt ?? '').trim())
    .map((s) => String(s.no ?? '').trim())
    .filter(Boolean)

  const lines: string[] = []
  if (transitions.length) lines.push(`- 转场：${transitions.join('；')}`)
  if (missingKeyframe.length) lines.push(`- 缺首帧提示词：${missingKeyframe.join('、')}`)
  if (missingVideo.length) lines.push(`- 缺视频提示词：${missingVideo.join('、')}`)

  // 未解析的参考必须点名到这里：写进参考列会变成一个导入时对不上的名字
  const unresolved: string[] = []
  for (const s of shots) {
    const r = resolveShotRefs(s.refIds, index)
    if (!r.unresolved.length) continue
    unresolved.push(`${String(s.no ?? '').trim() || s.id} ${r.unresolved.join('、')}`)
  }
  if (unresolved.length) lines.push(`- 未解析参考：${unresolved.join('；')}`)
  return lines.length ? `#### 附注\n\n${lines.join('\n')}` : ''
}

/**
 * 单集文档。
 *
 * 结构约束（都来自导入侧识别规则，改动前先看 classify.ts）：
 * - 全文件只有一个 `## 第 N 集`，场次小节标题不许带集标记；
 * - 只有一张分镜表，且表头首列可识别为镜号。
 */
export function episodeMarkdown(
  src: StoryboardSource,
  epNo: number,
  opts: EpisodeMarkdownOptions = {},
): EpisodeMarkdown {
  const ep = resolveEpisode(src, epNo)
  const all = src.shots ?? []
  const shots = shotOfEpisode(all, epNo)
  const title = String(ep.title ?? '').trim()
  const when = opts.exportedAt ?? new Date()

  const head: string[] = [`# 《${String(src.projectName ?? '').trim() || '未命名'}》分镜表`, '']
  const meta: string[] = []
  if (String(src.logline ?? '').trim()) meta.push(`> ${String(src.logline).trim()}`)
  const tags = [
    String(src.style ?? '').trim() ? `风格：${String(src.style).trim()}` : '',
    String(src.aspect ?? '').trim() ? `画幅：${String(src.aspect).trim()}` : '',
    `导出于 ${when.toLocaleString('zh-CN', { hour12: false })}`,
  ].filter(Boolean)
  if (tags.length) meta.push(`> ${tags.join(' · ')}`)
  if (meta.length) head.push(...meta, '')

  const body: string[] = [`## 第 ${epNo} 集${title ? ` ${title}` : ''}`, '']
  const epMeta: string[] = []
  if (String(ep.hook ?? '').trim()) epMeta.push(`- 钩子：${String(ep.hook).trim()}`)
  const target = Number(ep.targetSeconds)
  const total = totalSeconds(shots)
  epMeta.push(
    `- ${shots.length} 镜 · 总时长 ${fmtOne(total)}s${Number.isFinite(target) && target > 0 ? ` / 目标 ${fmtOne(target)}s` : ''}`,
  )
  body.push(epMeta.join('\n'), '')

  const scenes = sceneHeadings(ep, shots)
  if (scenes.length) body.push(scenes.join('\n\n'), '')

  const table = renderShotTable(shots, src.refIndex)
  if (table) body.push(table, '')

  const notes = footnote(shots, all, src.refIndex)
  if (notes) body.push(notes, '')

  return {
    epNo,
    title,
    fileName: mdFileName(epNo, title),
    text: [...head, ...body].join('\n').replace(/\n{3,}/g, '\n\n').trimEnd() + '\n',
  }
}

/**
 * 全部集：按集号升序各出一份文档。
 *
 * 为什么不合成一个文件：导入侧按全文件的 `第 N 集` 计数判断单集/多集，
 * 多集文件会被判成「多集大纲」而跳过写入——那样导出的东西就回不来了。
 */
export function allEpisodeMarkdowns(src: StoryboardSource, opts: EpisodeMarkdownOptions = {}): EpisodeMarkdown[] {
  const declared = (src.episodes ?? []).map((e) => Number(e?.no) || 1)
  const fromShots = (src.shots ?? []).map((s) => Number(s.episode) || 1)
  const nos = [...new Set([...declared, ...fromShots])]
    .filter((n) => Number.isFinite(n) && n > 0)
    .sort((a, b) => a - b)
  return nos.map((no) => episodeMarkdown(src, no, opts))
}

/** 打包结果：条目名与字节都在，下载由调用方触发 */
export type StoryboardZip = {
  fileName: string
  entries: string[]
  /** 必须是 ArrayBuffer 背书的视图：Blob 不接受 SharedArrayBuffer 背书 */
  bytes: Uint8Array<ArrayBuffer>
}

/**
 * 全部集打成 zip：每集一份 `.md`。
 *
 * 为什么不合成一个大文件：`BundleDialog` 会把含多个 `第 N 集` 的文件判成
 * 多集大纲并跳过写入；一集一文件才能原样传回导入入口。
 */
export function buildStoryboardZip(src: StoryboardSource, opts: EpisodeMarkdownOptions = {}): StoryboardZip {
  const docs = allEpisodeMarkdowns(src, opts)
  const files: Record<string, Uint8Array> = {}
  for (const doc of docs) files[doc.fileName] = strToU8(doc.text)
  return {
    fileName: exportZipName(src.projectName),
    entries: docs.map((d) => d.fileName),
    bytes: new Uint8Array(zipSync(files)),
  }
}

// ------------------------------------------------------------------ 触发下载

function saveBlob(blob: Blob, fileName: string) {
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = fileName
  a.rel = 'noopener'
  document.body.appendChild(a)
  a.click()
  a.remove()
  setTimeout(() => URL.revokeObjectURL(url), 1000)
}

/** 下载单集 Markdown */
export function downloadEpisodeMarkdown(
  src: StoryboardSource,
  epNo: number,
  opts: EpisodeMarkdownOptions = {},
): EpisodeMarkdown {
  const doc = episodeMarkdown(src, epNo, opts)
  // text/markdown 带 charset：Windows 记事本打开不会乱码
  saveBlob(new Blob([doc.text], { type: 'text/markdown;charset=utf-8' }), doc.fileName)
  return doc
}

/** 下载全部集 zip */
export function downloadStoryboardZip(src: StoryboardSource, opts: EpisodeMarkdownOptions = {}): StoryboardZip {
  const zip = buildStoryboardZip(src, opts)
  saveBlob(new Blob([zip.bytes], { type: 'application/zip' }), zip.fileName)
  return zip
}
