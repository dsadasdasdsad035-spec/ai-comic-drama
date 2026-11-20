import { useEffect, useState } from 'react'
import type { Material3dTransform } from './material3dTypes'

const DEG = 180 / Math.PI

type Props = {
  transform: Material3dTransform
  disabled?: boolean
  onChange: (next: Material3dTransform) => void
}

type VecKey = 'x' | 'y' | 'z'

function FieldRow({
  label,
  values,
  onChange,
  disabled,
  step = 0.1,
}: {
  label: string
  values: { x: number; y: number; z: number }
  onChange: (k: VecKey, v: number) => void
  disabled?: boolean
  step?: number
}) {
  return (
    <div className="m3d-transform-row">
      <span className="m3d-transform-label">{label}</span>
      {(['x', 'y', 'z'] as const).map((k) => (
        <label key={k} className="m3d-transform-field">
          <span>{k.toUpperCase()}</span>
          <input
            type="number"
            step={step}
            disabled={disabled}
            value={Number.isFinite(values[k]) ? values[k] : 0}
            onChange={(e) => onChange(k, Number(e.target.value))}
          />
        </label>
      ))}
    </div>
  )
}

export default function Material3dTransformPanel({ transform, disabled, onChange }: Props) {
  const [rotDeg, setRotDeg] = useState(() => ({
    x: transform.rotation.x * DEG,
    y: transform.rotation.y * DEG,
    z: transform.rotation.z * DEG,
  }))

  useEffect(() => {
    setRotDeg({
      x: transform.rotation.x * DEG,
      y: transform.rotation.y * DEG,
      z: transform.rotation.z * DEG,
    })
  }, [transform.rotation.x, transform.rotation.y, transform.rotation.z])

  const patchPos = (k: VecKey, v: number) => {
    onChange({ ...transform, position: { ...transform.position, [k]: v } })
  }
  const patchScale = (k: VecKey, v: number) => {
    onChange({ ...transform, scale: { ...transform.scale, [k]: v } })
  }
  const patchRotDeg = (k: VecKey, deg: number) => {
    const rad = deg / DEG
    setRotDeg((r) => ({ ...r, [k]: deg }))
    onChange({ ...transform, rotation: { ...transform.rotation, [k]: rad } })
  }

  return (
    <div className="m3d-transform-panel" data-m3d-transform-panel>
      <FieldRow label="位置" values={transform.position} onChange={patchPos} disabled={disabled} />
      <FieldRow label="旋转°" values={rotDeg} onChange={patchRotDeg} disabled={disabled} step={1} />
      <FieldRow label="缩放" values={transform.scale} onChange={patchScale} disabled={disabled} />
    </div>
  )
}