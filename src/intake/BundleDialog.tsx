/**
 * 压缩包导入：上传 → 分类清单（可改判/排除）→ 冲突选择 → 分组预览 → 一次性应用。
 *
 * 分类与冲突都在前端做（规则会随真实输入演进，改前端即生效）；
 * 服务端只负责安全解包与列清单。解包产物落系统临时目录，取消或导入完成后清理。
 */
import { useMemo, useRef, useState } from 'react'
import type { AppSettings, ProjectEpisode, ProjectShot } from '../api'
import type { CharacterSheet } from '../characters'
import type { StagePick } from '../ModelSelect'
import { buildShotsFromImport } from '../agent/shotDraft'
import { mergeScriptDraft } from '../agent/drafts'
import { mergeShotsDraft } from '../shotSync'
import { rowsFromTable } from './rows'
import { mergeImportedCharacters, parseCharacterDrafts } from './characters'
import {
  classifyFile,
  findConflicts,
  LABEL_TEXT,
  shotCountOf,
  type BundleConflict,
  type BundleLabel,
  type ClassifiedFile,
} from './classify'
import type { IntakeTarget } from './intakeSkill'

type BundleFileRec = {
  id: string
  path: string
  name: string
  kind: 'text' | 'image'
  size: number
  textPreview?: string
  encoding?: string
}

type Props = {
  projectName: string
  epNo: number
  settings: AppSettings | null
  stagePick: StagePick
  shots: ProjectShot[]
  episodes: ProjectEpisode[]
  characters: CharacterSheet[]
  toast: (m: string) => void
  onClose: () => void
  /** 应用结果：调用方负责写草稿/落库。图片已由本组件落盘后随结果返回 */
  onApply: (result: {
    shots?: ProjectShot[]
    episodes?: ProjectEpisode[]
    characters?: CharacterSheet[]
    summary: string
    counts: Record<string, number>
  }) => void
}

const ALL_LABELS: BundleLabel[] = ['script', 'shotlist', 'prompts', 'characters', 'image']

function mb(n: number) {
  return n >= 1024 * 1024 ? `${(n / 1024 / 1024).toFixed(1)}MB` : `${Math.max(1, Math.round(n / 1024))}KB`
}

export default function BundleDialog({
  projectName,
  epNo,
  shots,
  episodes,
  characters,
  toast,
  onClose,
  onApply,
}: Props) {
  const [bundleId, setBundleId] = useState('')
  const [files, setFiles] = useState<ClassifiedFile[]>([])
  const [rejected, setRejected] = useState<{ path: string; reason: string }[]>([])
  const [ignored, setIgnored] = useState<string[]>([])
  const [warnings, setWarnings] = useState<string[]>([])
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  /** 冲突决定：key → 选中的 fileId 或 'split'（分别导入） */
  const [decisions, setDecisions] = useState<Record<string, string>>({})
  const fileRef = useRef<HTMLInputElement>(null)
  /** 保留原始预览文本，用于解析 */
  const previewsRef = useRef<Record<string, string>>({})

  const conflicts = useMemo(() => findConflicts(files), [files])

  const upload = async (file: File | null) => {
    if (!file) return
    setError('')
    setBusy(true)
    try {
      if (!/\.zip$/i.test(file.name)) throw new Error('只支持 .zip 压缩包；rar / 7z / 加密包不支持')
      const r = await fetch('/api/import/bundle', {
        method: 'POST',
        headers: { 'Content-Type': 'application/octet-stream', 'X-File-Name': encodeURIComponent(file.name) },
        body: file,
      })
      const j = await r.json().catch(() => ({}))
      if (!j.ok) throw new Error(j.message || '解包失败')
      const recs: BundleFileRec[] = j.files || []
      previewsRef.current = Object.fromEntries(
        recs.filter((f) => f.textPreview).map((f) => [f.id, f.textPreview as string]),
      )
      const classified: ClassifiedFile[] = recs.map((f) => {
        const base = classifyFile({
          path: f.path,
          name: f.path.split('/').pop() || f.name,
          kind: f.kind,
          textPreview: f.textPreview,
        })
        return {
          ...base,
          id: f.id,
          size: f.size,
          // 冲突选择需要并列显示镜数，预览随记录带一份（不参与分类）
          ...(f.textPreview ? { textPreview: f.textPreview } : {}),
        } as ClassifiedFile
      })
      setBundleId(j.bundleId || '')
      setFiles(classified)
      setRejected(j.rejected || [])
      setIgnored(j.ignored || [])
      setWarnings(j.warnings || [])
      setDecisions({})
      toast(`已解包 ${classified.length} 个可导入文件`)
    } catch (e) {
      setError((e as Error).message)
    } finally {
      setBusy(false)
    }
  }

  const cleanup = async () => {
    if (!bundleId) return
    await fetch(`/api/import/bundle/${bundleId}`, { method: 'DELETE' }).catch(() => {})
    setBundleId('')
  }

  const cancel = async () => {
    await cleanup()
    onClose()
  }

  const toggleLabel = (fileId: string, label: BundleLabel) => {
    setFiles((prev) =>
      prev.map((f) => {
        if (f.id !== fileId) return f
        const current = f.override ?? f.labels
        const next = current.includes(label) ? current.filter((x) => x !== label) : [...current, label]
        return { ...f, override: next }
      }),
    )
  }

  const toggleExclude = (fileId: string) => {
    setFiles((prev) => prev.map((f) => (f.id === fileId ? { ...f, excluded: !f.excluded, override: null } : f)))
  }

  /** 冲突未解决就不能应用 */
  const unresolvedConflicts = conflicts.filter((c) => !decisions[c.key])

  /** 计划：按用途分组，逐组算出将写入的内容 */
  const plan = useMemo(() => {
    const active = files.filter((f) => !f.excluded)
    const images = active.filter((f) => (f.override ?? f.labels).includes('image'))
    const scripts = active.filter(
      (f) => (f.override ?? f.labels).includes('script') && f.episodeScope === 'single',
    )
    const shotlists = active.filter((f) => (f.override ?? f.labels).includes('shotlist') && f.episodeScope === 'single')
    const prompts = active.filter((f) => (f.override ?? f.labels).includes('prompts'))

    let nextShots: ProjectShot[] = shots
    let shotAdded = 0
    let shotUpdated = 0
    const shotNotes: string[] = []
    // 分镜表：同集冲突时只用用户选中的那一个
    for (const f of shotlists) {
      const key = `shotlist:${f.episodeNo}`
      const conflict = conflicts.find((c) => c.key === key)
      if (conflict) {
        const decision = decisions[key]
        if (!decision) continue
        if (decision === 'split') {
          shotNotes.push(`${f.name}：按「分别导入」处理，仅预览不写入，请单独导入到指定集`)
          continue
        }
        if (decision !== f.id) continue
      }
      const preview = previewsRef.current[f.id] || ''
      const parsed = rowsFromTable(preview, 'markdown-table', { epNo: f.episodeNo || epNo, episodes })
      if (parsed.error || !parsed.rows.length) {
        shotNotes.push(`${f.name}：${parsed.error || '没有可用行'}`)
        continue
      }
      const built = buildShotsFromImport(
        parsed.rows.map((r) => ({
          no: r.no,
          seconds: r.seconds,
          size: r.size,
          move: r.move,
          desc: r.desc,
          dialogue: r.dialogue,
          keyframe_prompt: r.keyframe_prompt,
          video_prompt: r.video_prompt,
        })),
        episodes,
        f.episodeNo || epNo,
      )
      const merged = mergeShotsDraft(nextShots, built.shots, f.episodeNo || epNo, 'merge')
      nextShots = merged.shots
      shotAdded += merged.added
      shotUpdated += merged.updated
      if (built.filledPerformance) {
        shotNotes.push(`${f.name}：系统为 ${built.filledPerformance} 个说话角色补了默认表演`)
      }
      if (parsed.diff.ignoredColumns.length) {
        shotNotes.push(`${f.name}：忽略列 ${parsed.diff.ignoredColumns.join('、')}`)
      }
    }

    // 剧本：按集合并（只改文件里出现的集）
    let nextEpisodes = episodes
    let epAdded = 0
    let epUpdated = 0
    for (const f of scripts) {
      const preview = previewsRef.current[f.id] || ''
      if (!/^#{1,6}\s*第\s*\d+\s*集/m.test(preview)) continue
      const no = f.episodeNo || epNo
      const titleMatch = preview.match(/^#{1,6}\s*第\s*\d+\s*集\s*《?([^》\n]*)》?/m)
      const scenes = [...preview.matchAll(/^#{2,6}\s*(.+?)\s*$/gm)]
        .map((m) => m[1].trim())
        .filter((t) => !/^第\s*\d+\s*集/.test(t))
      const ep = {
        no,
        title: (titleMatch?.[1] || '').trim() || `第 ${no} 集`,
        scenes: scenes.map((t, i) => ({ no: i + 1, slug: t, beats: '' })),
      }
      const merged = mergeScriptDraft(nextEpisodes, [ep], 'merge')
      nextEpisodes = merged.episodes
      epAdded += merged.added
      epUpdated += merged.updated
    }

    // 角色档案：解析名称与外观锚点，与已有角色合并（已有锚点不覆盖）
    let nextCharacters = characters
    let charAdded = 0
    let charFilled = 0
    let charSkipped = 0
    const charNames: string[] = []
    for (const f of active) {
      if (!(f.override ?? f.labels).includes('characters')) continue
      const preview = previewsRef.current[f.id] || ''
      const drafts = parseCharacterDrafts(preview)
      if (!drafts.length) continue
      const merged = mergeImportedCharacters(nextCharacters, drafts)
      nextCharacters = merged.next
      charAdded += merged.added.length
      charFilled += merged.filled.length
      charSkipped += merged.skipped.length
      charNames.push(...drafts.map((d) => d.name))
    }

    const skippedMulti = active.filter(
      (f) => (f.override ?? f.labels).includes('script') && f.episodeScope === 'multi',
    )
    const pending = active.filter((f) => (f.override ?? f.labels).length === 0)
    const pendingPrompts = prompts.length
    const pendingChars = active.filter((f) => (f.override ?? f.labels).includes('characters')).length

    return {
      nextShots,
      nextEpisodes,
      shotAdded,
      shotUpdated,
      epAdded,
      epUpdated,
      imageCount: images.length,
      nextCharacters,
      charAdded,
      charFilled,
      charSkipped,
      charNames,
      promptFileCount: pendingPrompts,
      charFileCount: pendingChars,
      shotNotes,
      skippedMulti: skippedMulti.map((f) => f.name),
      pending: pending.map((f) => f.name),
      untouched: active.filter(
        (f) => (f.override ?? f.labels).includes('prompts') || (f.override ?? f.labels).includes('characters'),
      ).map((f) => f.name),
    }
  }, [files, shots, episodes, epNo, conflicts, decisions, characters])

  const apply = async () => {
    if (unresolvedConflicts.length) return
    setBusy(true)
    try {
      const parts: string[] = []
      const counts: Record<string, number> = {}
      if (plan.shotAdded || plan.shotUpdated) {
        parts.push(`镜头新增 ${plan.shotAdded} · 更新 ${plan.shotUpdated}`)
        counts.shotsAdded = plan.shotAdded
        counts.shotsUpdated = plan.shotUpdated
      }
      if (plan.epAdded || plan.epUpdated) {
        parts.push(`剧本新增 ${plan.epAdded} 集 · 更新 ${plan.epUpdated} 集`)
        counts.episodesAdded = plan.epAdded
        counts.episodesUpdated = plan.epUpdated
      }
      if (plan.charAdded || plan.charFilled) {
        parts.push(`角色新增 ${plan.charAdded} · 补全 ${plan.charFilled}`)
        counts.charactersAdded = plan.charAdded
        counts.charactersFilled = plan.charFilled
      }
      if (plan.imageCount) {
        parts.push(`${plan.imageCount} 张参考图待上传`)
        counts.images = plan.imageCount
      }
      if (!parts.length) throw new Error('没有可应用的内容：请检查分类或冲突选择')
      onApply({
        shots: plan.shotAdded || plan.shotUpdated ? plan.nextShots : undefined,
        episodes: plan.epAdded || plan.epUpdated ? plan.nextEpisodes : undefined,
        characters: plan.charAdded || plan.charFilled ? plan.nextCharacters : undefined,
        summary: parts.join(' · '),
        counts,
      })
      await cleanup()
      onClose()
    } catch (e) {
      setError((e as Error).message)
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="mp-backdrop" onMouseDown={(e) => e.target === e.currentTarget && void cancel()}>
      <div className="mp-dialog bundle-dialog" role="dialog" aria-modal="true" aria-labelledby="bundle-title">
        <header className="mp-head">
          <div>
            <b id="bundle-title">导入资料包</b>
            <span>解包在服务端完成；清单可逐项改判，冲突必须由你选择</span>
          </div>
          <button type="button" className="mp-close" aria-label="关闭" onClick={() => void cancel()}>
            ×
          </button>
        </header>

        <div className="bundle-body">
          <div className="bundle-upload">
            <button className="btn" disabled={busy} onClick={() => fileRef.current?.click()} data-bundle-pick>
              {busy ? '处理中…' : files.length ? '换一个压缩包' : '选择 .zip'}
            </button>
            <span className="st-hint">支持 zip；rar / 7z / 加密包 / 分卷包不支持。单包上限 200MB。</span>
            <input
              ref={fileRef}
              type="file"
              accept=".zip"
              hidden
              onChange={(e) => {
                void upload(e.target.files?.[0] ?? null)
                e.target.value = ''
              }}
            />
          </div>

          {error ? <div className="gen-error">{error}</div> : null}
          {warnings.length ? (
            <ul className="bundle-warn">
              {warnings.map((w, i) => (
                <li key={i}>{w}</li>
              ))}
            </ul>
          ) : null}

          {files.length > 0 ? (
            <>
              <div className="bundle-summary">
                {files.length} 个可导入文件 · 图片 {plan.imageCount} · 分镜来源{' '}
                {files.filter((f) => (f.override ?? f.labels).includes('shotlist') && !f.excluded).length} · 待判断{' '}
                {plan.pending.length}
                {rejected.length ? ` · 拒绝 ${rejected.length}` : ''}
              </div>

              <div className="bundle-list" data-bundle-list>
                {files.map((f) => {
                  const labels = f.override ?? f.labels
                  return (
                    <div className={`bundle-row ${f.excluded ? 'excluded' : ''}`} key={f.id} data-bundle-file={f.id}>
                      <div className="bundle-row-main">
                        <span className={`bundle-badge ${f.kind}`}>{f.kind === 'image' ? '图' : '文'}</span>
                        <span className="bundle-name" title={f.path}>
                          {f.name}
                        </span>
                        <span className="bundle-size">{mb(f.size)}</span>
                        {f.episodeScope === 'multi' ? <span className="bundle-tag warn">多集大纲</span> : null}
                        {f.episodeScope === 'single' && f.episodeNo ? (
                          <span className="bundle-tag">E{f.episodeNo}</span>
                        ) : null}
                        {labels.length === 0 ? <span className="bundle-tag warn">待判断</span> : null}
                      </div>
                      <div className="bundle-row-labels">
                        {ALL_LABELS.filter((l) => l !== 'image' || f.kind === 'image').map((label) => (
                          <button
                            key={label}
                            type="button"
                            className={`bundle-label ${labels.includes(label) ? 'on' : ''}`}
                            disabled={f.excluded}
                            onClick={() => toggleLabel(f.id, label)}
                            data-bundle-label={`${f.id}:${label}`}
                          >
                            {LABEL_TEXT[label]}
                          </button>
                        ))}
                        <button
                          type="button"
                          className={`bundle-label skip ${f.excluded ? 'on' : ''}`}
                          onClick={() => toggleExclude(f.id)}
                          data-bundle-exclude={f.id}
                        >
                          排除
                        </button>
                        <span className="bundle-reason">{f.reason}</span>
                      </div>
                    </div>
                  )
                })}
              </div>

              {conflicts.length ? (
                <div className="bundle-conflicts" data-bundle-conflicts>
                  <b>需要你选择</b>
                  {conflicts.map((c) => (
                    <ConflictRow key={c.key} conflict={c} files={files} decision={decisions[c.key] || ''} onDecide={(v) => setDecisions((prev) => ({ ...prev, [c.key]: v }))} />
                  ))}
                </div>
              ) : null}

              <div className="bundle-plan" data-bundle-plan>
                <div className="bundle-plan-line">
                  镜头：新增 {plan.shotAdded} · 更新 {plan.shotUpdated} · 剧本：新增 {plan.epAdded} 集 · 更新{' '}
                  {plan.epUpdated} 集 · 角色：新增 {plan.charAdded} · 补全 {plan.charFilled}
                </div>
                {plan.charNames.length ? (
                  <div className="st-hint">识别到角色：{plan.charNames.join('、')}（无英文锚点的需到角色页补齐）</div>
                ) : null}
                {plan.charSkipped ? (
                  <div className="st-hint">{plan.charSkipped} 个已有角色保留原锚点，未被导入覆盖</div>
                ) : null}
                {plan.shotNotes.length ? (
                  <ul className="bundle-warn">
                    {plan.shotNotes.map((n, i) => (
                      <li key={i}>{n}</li>
                    ))}
                  </ul>
                ) : null}
                {plan.skippedMulti.length ? (
                  <div className="st-hint">
                    多集大纲不自动写入（结构不等价于单集剧本）：{plan.skippedMulti.join('、')}
                  </div>
                ) : null}
                {plan.untouched.length ? (
                  <div className="st-hint">
                    本轮只处理剧本/分镜/图片；提示词与角色档案需到对应工作台单独导入：
                    {plan.untouched.join('、')}
                  </div>
                ) : null}
                {plan.pending.length ? (
                  <div className="st-hint">待判断文件会被跳过：{plan.pending.join('、')}</div>
                ) : null}
                {rejected.length ? (
                  <div className="st-hint">被拒绝的条目：{rejected.map((r) => `${r.path}（${r.reason}）`).join('；')}</div>
                ) : null}
                {ignored.length ? <div className="st-hint">忽略的系统文件 {ignored.length} 个</div> : null}
              </div>
            </>
          ) : null}
        </div>

        <footer className="intake-foot">
          <span className="st-hint">{projectName ? '' : '先选择项目'}</span>
          <div className="spacer" />
          <button type="button" className="btn-ghost" onClick={() => void cancel()}>
            取消
          </button>
          <button
            type="button"
            className="btn primary"
            disabled={busy || !files.length || !projectName || unresolvedConflicts.length > 0}
            onClick={() => void apply()}
            data-bundle-apply
          >
            应用
          </button>
        </footer>
      </div>
    </div>
  )
}

function ConflictRow({
  conflict,
  files,
  decision,
  onDecide,
}: {
  conflict: BundleConflict
  files: ClassifiedFile[]
  decision: string
  onDecide: (v: string) => void
}) {
  return (
    <div className="bundle-conflict" data-conflict={conflict.key}>
      <div className="bundle-conflict-head">
        {LABEL_TEXT[conflict.label]} · 第 {conflict.episodeNo} 集有 {conflict.files.length} 个来源，不会自动合并
      </div>
      <div className="bundle-conflict-opts">
        {conflict.files.map((f) => {
          const rec = files.find((x) => x.id === f.id)
          const n = shotCountOf((rec as unknown as { textPreview?: string })?.textPreview || '')
          return (
            <label key={f.id} className={`bundle-conflict-opt ${decision === f.id ? 'on' : ''}`}>
              <input
                type="radio"
                name={`conflict-${conflict.key}`}
                checked={decision === f.id}
                onChange={() => onDecide(f.id)}
                data-conflict-pick={`${conflict.key}:${f.id}`}
              />
              <span className="bundle-conflict-name">{f.name}</span>
              <span className="bundle-conflict-meta">{n ? `${n} 镜` : '未数出镜数'}</span>
            </label>
          )
        })}
        <label className={`bundle-conflict-opt ${decision === 'split' ? 'on' : ''}`}>
          <input
            type="radio"
            name={`conflict-${conflict.key}`}
            checked={decision === 'split'}
            onChange={() => onDecide('split')}
            data-conflict-pick={`${conflict.key}:split`}
          />
          <span className="bundle-conflict-name">分别导入到不同集号</span>
          <span className="bundle-conflict-meta">本轮不写入，改完集号后单独导入</span>
        </label>
      </div>
    </div>
  )
}
