import { useEffect, useRef, useState } from 'react'
import { createProject } from '../api'

const NAME_RE = /^[a-zA-Z0-9_-]{1,40}$/

type Props = {
  open: boolean
  onClose: () => void
  /** 创建成功：父级负责刷新项目列表并切换过去 */
  onCreated: (name: string) => void | Promise<void>
}

/**
 * 新建项目对话框。目录名同时是项目目录，因此只允许字母/数字/下划线/短横。
 * 入口在全局带，不再依赖镜头表工具条（窄宽度会整块隐藏）。
 */
export default function NewProjectDialog({ open, onClose, onCreated }: Props) {
  const [name, setName] = useState('')
  const [title, setTitle] = useState('')
  const [making, setMaking] = useState(false)
  const [error, setError] = useState('')
  const nameRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    if (!open) return
    setName('')
    setTitle('')
    setError('')
    setMaking(false)
    const t = window.setTimeout(() => nameRef.current?.focus(), 20)
    return () => window.clearTimeout(t)
  }, [open])

  useEffect(() => {
    if (!open) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && !making) {
        e.preventDefault()
        onClose()
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [open, making, onClose])

  if (!open) return null

  const submit = async () => {
    const clean = name.trim()
    if (!NAME_RE.test(clean)) {
      setError('目录名只能用字母/数字/下划线/短横，最长 40 字')
      return
    }
    setMaking(true)
    setError('')
    try {
      await createProject(clean, { title: title.trim() || clean })
      await onCreated(clean)
    } catch (e: any) {
      setError(e?.message || '新建项目失败')
    } finally {
      setMaking(false)
    }
  }

  return (
    <div className="st-modal-backdrop" role="presentation" onMouseDown={() => !making && onClose()}>
      <div
        className="st-modal proj-modal"
        role="dialog"
        aria-modal="true"
        aria-label="新建项目"
        data-new-project-dialog
        onMouseDown={(e) => e.stopPropagation()}
      >
        <header className="st-modal-head">
          <div>
            <h3>新建项目</h3>
            <p className="st-hint">目录名同时是项目文件夹名，只在本地创建，不会自动提交</p>
          </div>
          <span className="spacer" />
          <button className="btn-mini" onClick={() => !making && onClose()} title="关闭" data-new-project-cancel>
            ✕
          </button>
        </header>

        <div className="proj-form">
          <label className="proj-field">
            <span>目录名</span>
            <input
              ref={nameRef}
              data-new-project-name
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="如 my-drama"
              onKeyDown={(e) => {
                if (e.key === 'Enter') void submit()
              }}
            />
          </label>
          <label className="proj-field">
            <span>标题</span>
            <input
              data-new-project-title
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder="如 回收人（可空）"
              onKeyDown={(e) => {
                if (e.key === 'Enter') void submit()
              }}
            />
          </label>
          {error && <p className="proj-error" data-new-project-error>{error}</p>}
        </div>

        <footer className="st-modal-foot">
          <span className="spacer" />
          <button className="btn" onClick={onClose} disabled={making}>
            取消
          </button>
          <button
            className="btn primary"
            data-new-project-submit
            onClick={() => void submit()}
            disabled={making || !name.trim()}
          >
            {making ? '创建中…' : '创建'}
          </button>
        </footer>
      </div>
    </div>
  )
}
