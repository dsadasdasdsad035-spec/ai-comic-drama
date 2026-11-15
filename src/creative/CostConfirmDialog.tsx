import { useEffect } from 'react'
import type { BuiltinCostRequest } from '../agent/builtinPlatformTools'

export type CostPrompt = BuiltinCostRequest & {
  resolve: (ok: boolean) => void
}

/**
 * 生成类工具（出图 / 出片 / 配音）的成本确认卡。
 *
 * 只有在这里点「确认生成」，工具才会真的发请求；取消、Esc、关掉都按拒绝处理。
 */
export function CostConfirmDialog({
  prompt,
  onResolve,
}: {
  prompt: CostPrompt
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
      data-cost-dialog
      className="creative-dialog-scrim"
      role="dialog"
      aria-modal="true"
      aria-label="确认生成成本"
    >
      <div className="creative-dialog">
        <h3>{prompt.title}</h3>
        <p className="creative-dialog-note" data-cost-detail>
          {prompt.detail}
        </p>
        <p className="creative-dialog-note">这会调用付费生成渠道并产生费用，取消则不发起请求。</p>
        <div className="creative-dialog-actions">
          <button type="button" className="btn" onClick={() => onResolve(false)} data-cost-cancel>
            取消
          </button>
          <button type="button" className="btn primary" onClick={() => onResolve(true)} data-cost-confirm>
            确认生成
          </button>
        </div>
      </div>
    </div>
  )
}
