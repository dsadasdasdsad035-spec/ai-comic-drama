/**
 * 分集剧本导入：仅 Markdown，short-drama 场次标题零模型解析。
 */
import { useMemo, useRef, useState } from 'react'
import type { ProjectEpisode } from '../api'
import { detectFormat } from '../intake/format'
import { parseScriptMarkdown } from '../intake/scriptMarkdown'
import { episodesFromScriptJson, planScriptImport } from './scriptIntake'

const MAX_FILE_BYTES = 4 * 1024 * 1024

function readTextFile(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => resolve(String(reader.result || ''))
    reader.onerror = () => reject(new Error('读取文件失败'))
    reader.readAsText(file, 'utf-8')
  })
}

type Props = {
  projectName: string
  episodes: ProjectEpisode[]
  /** 从「新增分集」进入时可提示默认集号 */
  hintEpNo?: number
  toast: (m: string) => void
  onClose: () => void
  onApply: (episodes: ProjectEpisode[], summary: string) => void | Promise<void>
}

export default function EpisodeScriptImportDialog({
  projectName,
  episodes,
  hintEpNo,
  onClose,
  onApply,
}: Props) {
  const [mode, setMode] = useState<'paste' | 'file'>('paste')
  const [raw, setRaw] = useState('')
  const [fileName, setFileName] = useState('')
  const [applying, setApplying] = useState(false)
  const [applyError, setApplyError] = useState('')
  const [error, setError] = useState('')
  const fileRef = useRef<HTMLInputElement>(null)

  const format = useMemo(() => detectFormat(raw, { intake: 'script' }), [raw])

  const parseResult = useMemo(() => {
    if (format.kind !== 'script-markdown' || !raw.trim()) return null
    return parseScriptMarkdown(raw, { hintEpNo })
  }, [raw, format.kind, hintEpNo])

  const plan = useMemo(() => {
    if (!parseResult?.ok) return null
    try {
      const incoming = episodesFromScriptJson({ episodes: parseResult.episodes })
      return planScriptImport(episodes, incoming)
    } catch (e) {
      return { blocked: (e as Error).message } as const
    }
  }, [parseResult, episodes])

  const pickFile = async (file: File | null) => {
    if (!file) return
    if (file.size > MAX_FILE_BYTES) {
      setError(`文件超过 4MB，请粘贴文本或拆分后再传`)
      return
    }
    if (!/\.(md|markdown)$/i.test(file.name)) {
      setError('分集剧本仅支持 .md / .markdown')
      return
    }
    setError('')
    try {
      setRaw(await readTextFile(file))
      setFileName(file.name)
      setMode('file')
    } catch (e) {
      setError((e as Error).message)
    }
  }

  const apply = async () => {
    if (!plan || 'blocked' in plan || applying) return
    setApplying(true)
    setApplyError('')
    try {
      await onApply(plan.episodes, plan.summary)
      onClose()
    } catch (e) {
      setApplyError((e as Error).message || '写入项目失败')
    } finally {
      setApplying(false)
    }
  }

  const parseError =
    parseResult && !parseResult.ok
      ? parseResult.error
      : format.kind === 'free-text' && raw.trim()
        ? format.reason
        : ''
  const blocked = plan && 'blocked' in plan ? plan.blocked : ''
  const warnings = parseResult?.ok ? parseResult.warnings : []

  return (
    <div className="mp-backdrop" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div
        className="mp-dialog intake-dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby="script-intake-title"
        data-script-import
      >
        <header className="mp-head">
          <div>
            <b id="script-intake-title">导入剧本大纲</b>
            <span>
              项目 {projectName}
              {hintEpNo ? ` · 建议集号 E${String(hintEpNo).padStart(2, '0')}` : ''}
            </span>
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
            <span className="intake-format" data-intake-format={format.kind}>
              {raw.trim() ? `识别为：${format.reason}` : ''}
              {fileName ? ` · ${fileName}` : ''}
            </span>
          </div>

          {mode === 'paste' ? (
            <textarea
              className="intake-text"
              rows={12}
              value={raw}
              onChange={(e) => {
                setRaw(e.target.value)
                setError('')
              }}
              placeholder={'# EP001 集名\n\n## EP001-SC001 内 · 地点 · 时间\n场次正文…'}
            />
          ) : (
            <div className="intake-file">
              <button type="button" className="btn" onClick={() => fileRef.current?.click()}>
                选择文件
              </button>
              <input
                ref={fileRef}
                type="file"
                accept=".md,.markdown"
                hidden
                onChange={(e) => {
                  void pickFile(e.target.files?.[0] ?? null)
                  e.target.value = ''
                }}
              />
              {raw.trim() ? (
                <pre className="intake-preview-text">
                  {raw.slice(0, 1200)}
                  {raw.length > 1200 ? '\n…' : ''}
                </pre>
              ) : null}
            </div>
          )}

          {warnings.length ? (
            <ul className="st-hint">
              {warnings.map((w) => (
                <li key={w}>{w}</li>
              ))}
            </ul>
          ) : null}

          {error ? <div className="gen-error">{error}</div> : null}
          {parseError ? <div className="gen-error">{parseError}</div> : null}
          {applyError ? <div className="gen-error">{applyError}</div> : null}
          {blocked ? <div className="gen-error">{blocked}</div> : null}

          {plan && !('blocked' in plan) ? (
            <div className="intake-plan">
              <b>{plan.summary}</b>
              <p className="st-hint">合并后项目共 {plan.episodes.length} 集；只更新/新增导入里出现的集号，其余集保留。</p>
            </div>
          ) : null}
        </div>

        <footer className="mp-foot">
          <button type="button" className="btn-ghost" onClick={onClose}>
            取消
          </button>
          <button
            type="button"
            className="btn primary"
            disabled={!plan || 'blocked' in plan || applying}
            onClick={() => void apply()}
          >
            {applying ? '写入中…' : '确认导入'}
          </button>
        </footer>
      </div>
    </div>
  )
}