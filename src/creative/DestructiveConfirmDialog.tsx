import { useEffect } from 'react'
import type { BuiltinConfirmRequest } from '../agent/builtinPlatformTools'

export type DestructivePrompt = BuiltinConfirmRequest & {
  resolve: (ok: boolean) => void
}

/**
 * 破坏性平台工具（新建项目 / 改项目设定 / 删分镜）的统一确认卡。
 *
 * 只有用户在这里点「确认执行」，工具才会真的落库；取消或关掉一律按拒绝处理。
 */
export function DestructiveConfirmDialog({
  prompt,
  onResolve,
}: {
  prompt: DestructivePrompt
  onResolve: (ok: boolean) => void
}) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onResolve(false)
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onResolve])

  return (
    <div
      data-destructive-dialog
      className="creative-dialog-scrim"
      role="dialog"
      aria-modal="true"
      aria-label="确认执行"
    >
      <div className="creative-dialog">
        <h3>{prompt.title}</h3>
        <p className="creative-dialog-note" data-destructive-detail>
          {prompt.detail}
        </p>
        <p className="creative-dialog-note">这一步会直接写入项目数据，确认后无法自动撤销。</p>
        <div className="creative-dialog-actions">
          <button type="button" className="btn" onClick={() => onResolve(false)} data-destructive-cancel>
            取消
          </button>
          <button
            type="button"
            className="btn primary"
            onClick={() => onResolve(true)}
            data-destructive-confirm
          >
            确认执行
          </button>
        </div>
      </div>
    </div>
  )
}
