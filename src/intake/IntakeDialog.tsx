/**
 * 导入对话框：上传文件或粘贴文本，先预览再应用。
 *
 * 设计要点：
 * - 零模型路径（JSON / 表格）立即出预览，不调模型；
 * - 只有认不出的自由文本才出现「让模型整理」按钮，且必须人点；
 * - 预览里必须能看出「新增/更新/保留/跳过/系统补了什么」；
 * - 应用永远交给调用方，本组件不写项目。
 */
import { useMemo, useRef, useState } from 'react'
import { hasTextModels, stageModelKey, type StagePick } from '../ModelSelect'
import type { AppSettings, ProjectEpisode, ProjectShot } from '../api'
import type { CharacterSheet } from '../characters'
import { buildShotsFromImport } from '../agent/shotDraft'
import { mergePromptDraft } from '../agent/promptDraft'
import { mergeScriptDraft } from '../agent/drafts'
import { mergeShotsDraft } from '../shotSync'
import { describeDiff, diffShots, type IntakeDiff } from './diff'
import { detectFormat, isTabular, type IntakeFormat } from './format'
import { INTAKE_LABEL, runIntake, type IntakeTarget } from './intakeSkill'
import { rowsFromTable, shotIdOf } from './rows'
import BundleDialog from './BundleDialog'

type Props = {
  target: IntakeTarget
  projectName: string
  epNo: number
  settings: AppSettings | null
  stagePick: StagePick
  shots: ProjectShot[]
  episodes: ProjectEpisode[]
  chars: Pick<CharacterSheet, 'name' | 'lookEn'>[]
  /** 完整角色卡（资料包分派角色档案时需要合并进现有角色） */
  characterSheets?: CharacterSheet[]
  toast: (m: string) => void
  onClose: () => void
  /** 应用结果：调用方负责写草稿/落库 */
  onApply: (result: {
    shots?: ProjectShot[]
    episodes?: ProjectEpisode[]
    characters?: CharacterSheet[]
    summary: string
    counts: Record<string, number>
  }) => void
}

const MAX_FILE_BYTES = 4 * 1024 * 1024

function readTextFile(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => resolve(String(reader.result || ''))
    reader.onerror = () => reject(new Error('读取文件失败'))
    reader.readAsText(file, 'utf-8')
  })
}

export default function IntakeDialog({
  target,
  projectName,
  epNo,
  settings,
  stagePick,
  shots,
  episodes,
  chars,
  characterSheets,
  toast,
  onClose,
  onApply,
}: Props) {
  const [mode, setMode] = useState<'paste' | 'file'>('paste')
  const [bundleOpen, setBundleOpen] = useState(false)
  const [raw, setRaw] = useState('')
  const [fileName, setFileName] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [replaceEpisode, setReplaceEpisode] = useState(false)
  /** 模型整理后的契约 JSON；有值就覆盖零模型路径的结果 */
  const [organized, setOrganized] = useState<unknown>(null)
  const [organizedBy, setOrganizedBy] = useState('')
  const fileRef = useRef<HTMLInputElement>(null)

  const format = useMemo(() => detectFormat(raw), [raw])
  const canUseModel = hasTextModels(settings)
  const stage = target === 'script' ? 'script' : target === 'shots' ? 'shot' : 'prompt'
  const modelKey = stageModelKey(settings, stage, stagePick)

  /** 零模型路径：表格直接映射成导入行 */
  const tableResult = useMemo(() => {
    if (target !== 'shots' || !isTabular(format.kind)) return null
    return rowsFromTable(raw, format.kind as IntakeFormat, { epNo, episodes })
  }, [target, format, raw, epNo, episodes])

  /** 由表格/契约 JSON 得到最终要写入的镜头与差异统计 */
  const plan = useMemo((): {
    shots?: ProjectShot[]
    episodes?: ProjectEpisode[]
    diff?: IntakeDiff
    summary: string
    counts: Record<string, number>
    notices: string[]
    blocked?: string
  } | null => {
    if (!raw.trim() && !organized) return null

    const source = organized ?? (format.kind === 'json' ? format.json : undefined)

    // 镜头表
    if (target === 'shots') {
      if (source) {
        const j = source as { shots?: unknown[] }
        const got = Array.isArray(j.shots) ? j.shots : []
        if (got.length === 0) return null
        const built = buildShotsFromImport(got, episodes, epNo)
        const merged = mergeShotsDraft(shots, built.shots, epNo, replaceEpisode ? 'replace' : 'merge')
        const diff = diffShots(shots, built.shots.map((s, i) => ({
          row: i + 1,
          no: String(s.no ?? ''),
          episode: epNo,
          filled: [] as string[],
        })), epNo)
        return {
          shots: merged.shots,
          diff: { ...diff, scenesFallback: built.sceneFallback },
          summary: `E${String(epNo).padStart(2, '0')}：新增 ${merged.added} · 更新 ${merged.updated} · 保留 ${merged.kept}`,
          counts: {
            added: merged.added,
            updated: merged.updated,
            kept: merged.kept,
            sceneFallback: built.sceneFallback,
            filledPerformance: built.filledPerformance,
          },
          notices: [
            ...(built.filledPerformance
              ? [`系统为 ${built.filledPerformance} 个说话角色补了默认表演（平静/3 度/说话中），可在镜头表里改`]
              : []),
            ...(built.sceneFallback ? [`${built.sceneFallback} 镜的场次号对不上，已归入第一场`] : []),
          ],
        }
      }
      if (tableResult) {
        if (tableResult.error) return { summary: '', counts: {}, notices: [], blocked: tableResult.error }
        if (!tableResult.rows.length) return null
        const built = buildShotsFromImport(
          tableResult.rows.map((r) => ({
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
          epNo,
        )
        const merged = mergeShotsDraft(shots, built.shots, epNo, replaceEpisode ? 'replace' : 'merge')
        const diff = diffShots(shots, tableResult.rows, epNo, {
          ignoredColumns: tableResult.diff.ignoredColumns,
          scenesFallback: tableResult.diff.scenesFallback,
        })
        const filled: Record<string, number> = {}
        for (const r of tableResult.rows) for (const f of r.filled ?? []) filled[f] = (filled[f] ?? 0) + 1
        return {
          shots: merged.shots,
          diff,
          summary: `E${String(epNo).padStart(2, '0')}：${describeDiff(diff)}`,
          counts: { added: merged.added, updated: merged.updated, kept: merged.kept, skipped: diff.skipped, involved: diff.involved },
          notices: [
            ...diff.notices,
            ...Object.entries(filled).map(([f, n]) => `${f === 'move' ? '运镜' : f} 缺列，系统补了默认值 ${n} 镜`),
          ],
        }
      }
      return null
    }

    // 剧本
    if (target === 'script') {
      if (!source) return null
      const j = source as { logline?: unknown; episodes?: unknown }
      const incoming = (Array.isArray(j.episodes) ? j.episodes : []) as ProjectEpisode[]
      if (!incoming.length) return null
      const merged = mergeScriptDraft(episodes, incoming, 'merge')
      return {
        episodes: merged.episodes,
        summary: `新增 ${merged.added} 集 · 更新 ${merged.updated} 集 · 保留 ${merged.kept} 集`,
        counts: { added: merged.added, updated: merged.updated, kept: merged.kept },
        notices:
          merged.updated > 0
            ? ['导入按集整集替换：文件里出现的集会被改写，未出现的集保持原样']
            : [],
      }
    }

    // 提示词
    if (target === 'prompts') {
      if (!source) return null
      const j = source as { shots?: { no: string | number; keyframe_prompt?: string; video_prompt?: string }[] }
      const got = Array.isArray(j.shots) ? j.shots : []
      if (!got.length) return null
      const merged = mergePromptDraft(shots, got, epNo, chars, { partial: true })
      return {
        shots: merged.shots,
        summary: `更新 ${merged.patched} 镜${merged.missing ? ` · ${merged.missing} 镜未匹配` : ''}`,
        counts: { updated: merged.patched, skipped: merged.missing, unresolved: merged.unresolved },
        notices: merged.missing ? [`${merged.missing} 个镜号在当前集找不到，已跳过`] : [],
      }
    }

    return null
  }, [raw, organized, format, target, tableResult, shots, episodes, epNo, chars, replaceEpisode])

  const pickFile = async (file: File | null) => {
    if (!file) return
    if (file.size > MAX_FILE_BYTES) {
      setError(`文件 ${(file.size / 1024 / 1024).toFixed(1)}MB 超过 4MB 上限；更大的内容请粘贴文本`)
      return
    }
    if (!/\.(json|md|markdown|csv|tsv|txt)$/i.test(file.name)) {
      setError('只支持 .json / .md / .csv / .tsv / .txt；docx 与 pdf 请先另存为文本')
      return
    }
    setError('')
    try {
      const text = await readTextFile(file)
      setRaw(text)
      setFileName(file.name)
      setOrganized(null)
      setOrganizedBy('')
      setMode('file')
    } catch (e) {
      setError((e as Error).message)
    }
  }

  const organize = async () => {
    setError('')
    if (!canUseModel) {
      setError('设置页还没有可用的文本模型，无法整理')
      return
    }
    setBusy(true)
    try {
      const r = await runIntake({
        target,
        raw,
        modelKey,
        context: {
          style: '',
          aspect: '16:9',
        },
      })
      setOrganized(r.json)
      setOrganizedBy(r.modelLabel)
      toast(`已整理 ${r.chunks} 块，请检查预览后再应用`)
    } catch (e) {
      setError((e as Error).message)
    } finally {
      setBusy(false)
    }
  }

  const apply = () => {
    if (!plan || plan.blocked) return
    onApply({
      shots: plan.shots,
      episodes: plan.episodes,
      summary: plan.summary,
      counts: plan.counts,
    })
    onClose()
  }

  const needsModel = format.kind === 'free-text' && !organized
  const blocked = Boolean(plan?.blocked)

  if (bundleOpen) {
    return (
      <BundleDialog
        projectName={projectName}
        epNo={epNo}
        settings={settings}
        stagePick={stagePick}
        shots={shots}
        episodes={episodes}
        characters={characterSheets ?? []}
        toast={toast}
        onClose={() => {
          setBundleOpen(false)
          onClose()
        }}
        onApply={onApply}
      />
    )
  }

  return (
    <div className="mp-backdrop" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className="mp-dialog intake-dialog" role="dialog" aria-modal="true" aria-labelledby="intake-title">
        <header className="mp-head">
          <div>
            <b id="intake-title">导入{INTAKE_LABEL[target]}</b>
            <span>先预览，确认后才写入</span>
          </div>
          <button type="button" className="mp-close" aria-label="关闭" onClick={onClose}>
            ×
          </button>
        </header>

        <div className="intake-body">
          <div className="intake-modes">
            <button type="button" className={mode === 'paste' ? 'on' : ''} onClick={() => setMode('paste')}>
              粘贴文本
            </button>
            <button type="button" className={mode === 'file' ? 'on' : ''} onClick={() => setMode('file')}>
              上传文件
            </button>
            <button
              type="button"
              data-intake-bundle
              onClick={() => setBundleOpen(true)}
              title="导入整个资料包（.zip）：解包后按内容分类，冲突需人工选择"
            >
              资料包 .zip
            </button>
            <span className="intake-format" data-intake-format={format.kind}>
              {raw.trim() ? `识别为：${format.reason}` : ''}
              {fileName ? ` · ${fileName}` : ''}
            </span>
          </div>

          {mode === 'paste' ? (
            <textarea
              data-intake-input
              className="intake-text"
              rows={12}
              value={raw}
              onChange={(e) => {
                setRaw(e.target.value)
                setOrganized(null)
                setOrganizedBy('')
              }}
              placeholder={
                target === 'shots'
                  ? '粘贴表格（Markdown / CSV / 从 Excel 复制的制表符分隔），或粘贴镜头契约 JSON'
                  : target === 'script'
                    ? '粘贴剧本 JSON，或整篇剧本原文（再点「让模型整理」）'
                    : '粘贴提示词 JSON，或按镜号列出的提示词原文（再点「让模型整理」）'
              }
            />
          ) : (
            <div className="intake-file">
              <button type="button" className="btn" onClick={() => fileRef.current?.click()}>
                选择文件
              </button>
              <span className="st-hint">支持 .json / .md / .csv / .tsv / .txt，单文件 ≤4MB</span>
              <input
                ref={fileRef}
                type="file"
                accept=".json,.md,.markdown,.csv,.tsv,.txt"
                hidden
                onChange={(e) => {
                  void pickFile(e.target.files?.[0] ?? null)
                  e.target.value = ''
                }}
              />
              {raw.trim() ? (
                <pre className="intake-preview-text">{raw.slice(0, 1200)}{raw.length > 1200 ? '\n…' : ''}</pre>
              ) : null}
            </div>
          )}

          {needsModel ? (
            <div className="intake-model-row">
              <span>这段内容需要整理成结构化草稿</span>
              <button type="button" className="btn" disabled={busy || !canUseModel} onClick={() => void organize()}>
                {busy ? '整理中…' : canUseModel ? '让模型整理' : '未配置文本模型'}
              </button>
            </div>
          ) : null}
          {organizedBy ? <div className="st-hint">已由 {organizedBy} 整理，请核对下方预览</div> : null}

          {error ? <div className="gen-error">{error}</div> : null}
          {blocked ? <div className="gen-error">{plan?.blocked}</div> : null}

          {plan && !blocked ? (
            <div className="intake-plan" data-intake-plan>
              <div className="intake-summary">{plan.summary}</div>
              {target === 'shots' ? (
                <label className="intake-replace">
                  <input
                    type="checkbox"
                    checked={replaceEpisode}
                    onChange={(e) => setReplaceEpisode(e.target.checked)}
                  />
                  按此文件替换整集（默认只改文件里出现的镜号；勾选后文件外的镜头会被删除）
                </label>
              ) : null}
              {plan.notices.length ? (
                <ul className="intake-notices">
                  {plan.notices.map((n, i) => (
                    <li key={i}>{n}</li>
                  ))}
                </ul>
              ) : null}
              {target === 'shots' && plan.shots ? (
                <div className="intake-rows">
                  {plan.shots
                    .filter((s) => (Number(s.episode) || 1) === epNo)
                    .slice(0, 12)
                    .map((s) => (
                      <div className="intake-row" key={s.id}>
                        <code>{s.no || shotIdOf(epNo, s.no ?? '')}</code>
                        <span>{s.seconds ?? '—'}s</span>
                        <span>{s.size ?? '—'}</span>
                        <span>{s.move ?? '—'}</span>
                        <em>{String(s.desc ?? '').slice(0, 40)}</em>
                      </div>
                    ))}
                  {plan.shots.filter((s) => (Number(s.episode) || 1) === epNo).length > 12 ? (
                    <div className="st-hint">仅预览前 12 镜</div>
                  ) : null}
                </div>
              ) : null}
            </div>
          ) : null}
        </div>

        <footer className="intake-foot">
          <span className="st-hint">{projectName ? '' : '先选择项目'}</span>
          <div className="spacer" />
          <button type="button" className="btn-ghost" onClick={onClose}>
            取消
          </button>
          <button
            type="button"
            className="btn primary"
            disabled={!plan || blocked || !projectName}
            onClick={apply}
            data-intake-apply
          >
            应用到草稿
          </button>
        </footer>
      </div>
    </div>
  )
}
