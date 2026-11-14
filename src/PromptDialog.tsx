import { useEffect, useRef, useState } from 'react'

type Props = {
  open: boolean
  title: string
  label?: string
  hint?: string
  placeholder?: string
  defaultValue?: string
  confirmText?: string
  onCancel: () => void
  onConfirm: (value: string) => void
}

/**
 * 通用单行输入弹窗。
 *
 * 不要用 window.prompt：Electron 桌面端没有实现 prompt()，调用会直接抛
 * 「prompt() is not supported」，表现为按钮点了毫无反应。
 * 需要用户输入文本的地方统一走这个弹窗，保证 Web 与桌面行为一致。
 */
export default function PromptDialog({
  open,
  title,
  label,
  hint,
  placeholder,
  defaultValue = '',
  confirmText = '确定',
  onCancel,
  onConfirm,
}: Props) {
  const [value, setValue] = useState(defaultValue)
  const inputRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    if (!open) return
    setValue(defaultValue)
    const timer = window.setTimeout(() => inputRef.current?.focus(), 20)
    return () => window.clearTimeout(timer)
  }, [open, defaultValue])

  useEffect(() => {
    if (!open) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault()
        onCancel()
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [open, onCancel])

  if (!open) return null

  const submit = () => onConfirm(value)

  return (
    <div className="st-modal-backdrop" role="presentation" onMouseDown={onCancel}>
      <div
        className="st-modal proj-modal"
        role="dialog"
        aria-modal="true"
        aria-label={title}
        data-prompt-dialog
        onMouseDown={(e) => e.stopPropagation()}
      >
        <header className="st-modal-head">
          <div>
            <h3>{title}</h3>
            {hint && <p className="st-hint">{hint}</p>}
          </div>
          <span className="spacer" />
          <button className="btn-mini" onClick={onCancel} title="关闭" data-prompt-cancel>
            ✕
          </button>
        </header>

        <div className="proj-form">
          <label className="proj-field">
            {label && <span>{label}</span>}
            <input
              ref={inputRef}
              data-prompt-input
              value={value}
              placeholder={placeholder}
              onChange={(e) => setValue(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') {
                  e.preventDefault()
                  submit()
                }
              }}
            />
          </label>
        </div>

        <footer className="st-modal-foot">
          <span className="spacer" />
          <button className="btn" onClick={onCancel}>
            取消
          </button>
          <button className="btn primary" data-prompt-submit onClick={submit}>
            {confirmText}
          </button>
        </footer>
      </div>
    </div>
  )
}
