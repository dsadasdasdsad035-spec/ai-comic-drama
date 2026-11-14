/**
 * 分集剧本导入：JSON 直通 script-v1，自由文本可走 script-intake 整理。
 */
import { useMemo, useRef, useState } from 'react'
import type { AppSettings, ProjectEpisode } from '../api'
import { hasTextModels, stageModelKey, type StagePick } from '../ModelSelect'
import { detectFormat } from '../intake/format'
import { episodesFromScriptJson, planScriptImport } from './scriptIntake'
import { INTAKE_LABEL, runIntake } from '../intake/intakeSkill'

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
  settings: AppSettings | null
  stagePick: StagePick
  projectStyle?: string
  toast: (m: string) => void
  onClose: () => void
  onApply: (episodes: ProjectEpisode[], summary: string) => void | Promise<void>
}

export default function EpisodeScriptImportDialog({
  projectName,
  episodes,
  hintEpNo,
  settings,
  stagePick,
  projectStyle,
  toast,
  onClose,
  onApply,
}: Props) {
  const [mode, setMode] = useState<'paste' | 'file'>('paste')
  const [raw, setRaw] = useState('')
  const [fileName, setFileName] = useState('')
  const [busy, setBusy] = useState(false)
  const [applying, setApplying] = useState(false)
  const [applyError, setApplyError] = useState('')
  const [error, setError] = useState('')
  const [organized, setOrganized] = useState<unknown>(null)
  const [organizedBy, setOrganizedBy] = useState('')
  const fileRef = useRef<HTMLInputElement>(null)

  const format = useMemo(() => detectFormat(raw), [raw])
  const canUseModel = hasTextModels(settings)
  const modelKey = stageModelKey(settings, 'creative', stagePick)

  const plan = useMemo(() => {
    try {
      const source = organized ?? (format.kind === 'json' ? format.json : undefined)
      if (!source) return null
      const incoming = episodesFromScriptJson(source)
      return planScriptImport(episodes, incoming)
    } catch (e) {
      return { blocked: (e as Error).message } as const
    }
  }, [raw, organized, format, episodes])

  const pickFile = async (file: File | null) => {
    if (!file) return
    if (file.size > MAX_FILE_BYTES) {
      setError(`文件超过 4MB，请粘贴文本或拆分后再传`)
      return
    }
    if (!/\.(json|md|markdown|txt)$/i.test(file.name)) {
      setError('支持 .json / .md / .txt')
      return
    }
    setError('')
    try {
      setRaw(await readTextFile(file))
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
        target: 'script',
        raw,
        modelKey,
        context: { style: projectStyle, epNo: hintEpNo, episodes },
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

  const needsModel = format.kind === 'free-text' && !organized
  const blocked = plan && 'blocked' in plan ? plan.blocked : ''

  return (
    <div className="mp-backdrop" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div
        className="mp-dialog intake-dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby="script-intake-title"
        data-board-import-script
      >
        <header className="mp-head">
          <div>
            <b id="script-intake-title">导入{INTAKE_LABEL.script}</b>
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
                setOrganized(null)
                setOrganizedBy('')
              }}
              placeholder="粘贴分集剧本（含第 N 集标题），或粘贴 script-v1 JSON（含 episodes 数组）"
            />
          ) : (
            <div className="intake-file">
              <button type="button" className="btn" onClick={() => fileRef.current?.click()}>
                选择文件
              </button>
              <input
                ref={fileRef}
                type="file"
                accept=".json,.md,.markdown,.txt"
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

          {needsModel ? (
            <div className="intake-model-row">
              <span>剧本原文需要整理成结构化分集（需已安装 script-intake 技能）</span>
              <button type="button" className="btn" disabled={busy || !canUseModel} onClick={() => void organize()}>
                {busy ? '整理中…' : canUseModel ? '让模型整理' : '未配置文本模型'}
              </button>
            </div>
          ) : null}
          {organizedBy ? <div className="st-hint">已由 {organizedBy} 整理，请核对下方预览</div> : null}

          {error ? <div className="gen-error">{error}</div> : null}
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
