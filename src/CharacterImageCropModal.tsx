import { useEffect } from 'react'
import { formatAspectRatio, materialCropNotice, type MaterialCropPlan } from './imageMaterialCrop'

type Props = {
  open: boolean
  title: string
  plan: MaterialCropPlan | null
  busy?: boolean
  onConfirm: () => void
  onCancel: () => void
}

export function CharacterImageCropModal({ open, title, plan, busy, onConfirm, onCancel }: Props) {
  useEffect(() => {
    if (!open) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onCancel()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [open, onCancel])

  if (!open || !plan) return null

  return (
    <div className="char-crop-backdrop" role="presentation" onClick={onCancel}>
      <div
        className="char-crop-dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby="char-crop-title"
        onClick={(e) => e.stopPropagation()}
      >
        <h3 id="char-crop-title">{title}</h3>
        <p className="char-crop-note">{materialCropNotice(plan)}</p>
        <div className="char-crop-previews">
          <figure>
            <figcaption>裁切后预览</figcaption>
            <img src={plan.previewUrl} alt="裁切后预览" />
          </figure>
        </div>
        <p className="char-crop-meta">
          宽高比 {formatAspectRatio(plan.fromRatio)} → {formatAspectRatio(plan.toRatio)}（视频参考要求{' '}
          {0.4}–{2.5}）
        </p>
        <div className="char-crop-actions">
          <button type="button" className="btn-ghost" disabled={busy} onClick={onCancel}>
            取消
          </button>
          <button type="button" className="btn-primary" disabled={busy} onClick={onConfirm}>
            {busy ? '上传中…' : '使用裁切图上传'}
          </button>
        </div>
      </div>
    </div>
  )
}
