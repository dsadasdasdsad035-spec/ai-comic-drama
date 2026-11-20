import {
  DEFAULT_MATERIAL3D_ENVIRONMENT,
  mergeMaterial3dEnvironment,
  type Material3dEnvironment,
} from './material3dTypes'

type Props = {
  environment?: Material3dEnvironment
  onChange: (next: Material3dEnvironment) => void
}

export default function Material3dEnvironmentPanel({ environment, onChange }: Props) {
  const merged = mergeMaterial3dEnvironment(environment)

  const patch = (patchEnv: Partial<Material3dEnvironment> & { ground?: Partial<Material3dEnvironment['ground']>; light?: Partial<Material3dEnvironment['light']> }) => {
    const next: Material3dEnvironment = {
      ...environment,
      ...patchEnv,
      ground: { ...environment?.ground, ...patchEnv.ground },
      light: { ...environment?.light, ...patchEnv.light },
    }
    onChange(next)
  }

  return (
    <div className="m3d-panel m3d-panel-scene-env">
      <section className="m3d-panel-block">
        <header className="m3d-panel-block-head">
          <h5>预览环境</h5>
          <p>仅影响浏览器内参考预览，与 Blender 成片灯光无关</p>
        </header>
        <label className="m3d-env-row">
          <span>背景色</span>
          <input
            type="color"
            value={merged.background}
            onChange={(e) => patch({ background: e.target.value })}
            data-m3d-env-background
          />
        </label>
        <label className="m3d-env-row">
          <span>地面尺寸</span>
          <input
            type="range"
            min={8}
            max={48}
            step={1}
            value={merged.ground.size}
            onChange={(e) => patch({ ground: { size: Number(e.target.value) } })}
          />
          <small>{merged.ground.size}m</small>
        </label>
        <label className="m3d-env-row">
          <span>地面颜色</span>
          <input
            type="color"
            value={merged.ground.color}
            onChange={(e) => patch({ ground: { color: e.target.value } })}
          />
        </label>
        <label className="m3d-env-row m3d-env-check">
          <input
            type="checkbox"
            checked={merged.ground.visible}
            onChange={(e) => patch({ ground: { visible: e.target.checked } })}
          />
          显示地面
        </label>
        <label className="m3d-env-row">
          <span>环境光</span>
          <input
            type="range"
            min={0}
            max={2}
            step={0.05}
            value={merged.light.ambient}
            onChange={(e) => patch({ light: { ambient: Number(e.target.value) } })}
          />
        </label>
        <label className="m3d-env-row">
          <span>主光</span>
          <input
            type="range"
            min={0}
            max={2}
            step={0.05}
            value={merged.light.directional}
            onChange={(e) => patch({ light: { directional: Number(e.target.value) } })}
          />
        </label>
        <button
          type="button"
          className="btn-mini ghost"
          onClick={() => onChange({ ...DEFAULT_MATERIAL3D_ENVIRONMENT })}
        >
          恢复默认
        </button>
      </section>
    </div>
  )
}