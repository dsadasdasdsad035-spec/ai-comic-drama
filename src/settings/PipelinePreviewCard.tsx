import { useMemo } from 'react'
import type { Cap, ModelEntry, Stage } from '../api'

type Props = {
  models: ModelEntry[]
  defaults: Partial<Record<Cap, string>>
  stageModels: Partial<Record<Stage, string>>
}

function labelForKey(models: ModelEntry[], key: string | undefined): string {
  if (!key) return '未绑定'
  const m = models.find((x) => x.key === key)
  return m?.label || m?.model || key
}

export default function PipelinePreviewCard({ models, defaults, stageModels }: Props) {
  const rows = useMemo(
  () => [
    { label: '拆镜', hint: 'shot 环节', value: labelForKey(models, stageModels.shot) },
    { label: '出画面', hint: 'image 能力', value: labelForKey(models, defaults.image) },
    { label: '出片', hint: 'video 能力', value: labelForKey(models, defaults.video) },
    { label: '配音', hint: 'audio 能力', value: labelForKey(models, defaults.audio) },
  ],
  [models, defaults.image, defaults.video, defaults.audio, stageModels.shot],
)

  return (
    <div className="st-pipeline-preview" aria-label="管线预览">
      <header className="st-pipeline-preview-head">
        <b>管线预览</b>
        <span className="st-hint">只读摘要；下方仍可细调能力与环节默认</span>
      </header>
      <ul className="st-pipeline-preview-list">
        {rows.map((r) => (
          <li key={r.label}>
            <span className="st-pipeline-preview-label">
              {r.label}
              <em>{r.hint}</em>
            </span>
            <span className="st-pipeline-preview-value">{r.value}</span>
          </li>
        ))}
      </ul>
    </div>
  )
}