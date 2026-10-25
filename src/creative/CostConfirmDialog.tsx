import { useEffect, useState } from 'react'
import type { CostPrompt } from './CreativeMessageParts'

const CAP_LABEL: Record<string, string> = {
  image: '生图',
  video: '生视频',
  audio: '配音',
  vision: '视觉理解',
  videoVision: '视频理解',
}

/**
 * 成本确认：模型只能「请求」，花钱由人决定。
 * 不屏蔽 Esc 与取消，两个按钮都返回明确结果给工具层。
 */
export function CostConfirmDialog({ prompt, onResolve }: { prompt: CostPrompt; onResolve: (ok: boolean, remember?: boolean) => void }) {
  const [remember, setRemember] = useState(false)
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onResolve(false)
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onResolve])

  return (
    <div data-cost-dialog className="creative-dialog-scrim" role="dialog" aria-modal="true" aria-label="确认费用">
      <div className="creative-dialog">
        <h3>确认{CAP_LABEL[prompt.capability] || prompt.capability}调用</h3>
        <dl className="creative-dialog-rows">
          <div>
            <dt>模型</dt>
            <dd>{prompt.modelLabel}</dd>
          </div>
          <div>
            <dt>调用次数</dt>
            <dd>{prompt.calls}</dd>
          </div>
          {prompt.note ? (
            <div>
              <dt>说明</dt>
              <dd>{prompt.note}</dd>
            </div>
          ) : null}
        </dl>
        <label className="creative-dialog-check">
          <input
            type="checkbox"
            data-cost-remember
            checked={remember && !prompt.alwaysConfirm}
            disabled={prompt.alwaysConfirm}
            onChange={(e) => setRemember(e.target.checked)}
          />
          {prompt.alwaysConfirm ? '真实视频生成每次都必须确认' : '本会话内不再询问同类调用'}
        </label>
        <p className="creative-dialog-note">
          费用以渠道实际计费为准；真实视频生成不适用「不再询问」。
        </p>
        <div className="creative-dialog-actions">
          <button type="button" className="btn" onClick={() => onResolve(false)}>
            取消
          </button>
          <button
            type="button"
            data-cost-confirm
            className="btn primary"
            onClick={() => onResolve(true, remember && !prompt.alwaysConfirm)}
          >
            确认调用
          </button>
        </div>
      </div>
    </div>
  )
}
