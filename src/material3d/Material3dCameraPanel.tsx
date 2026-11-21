import { useMemo } from 'react'
import type { Material3dBookmark } from './material3dTypes'
import type { OrbitPose } from './createEngine'
import {
  AZIMUTH_MAX,
  AZIMUTH_MIN,
  ELEVATION_MAX,
  ELEVATION_MIN,
  RADIUS_MAX,
  RADIUS_MIN,
  TARGET_MAX,
  TARGET_MIN,
  betaToElevation,
  degToRad,
  elevationToBeta,
  meters,
  normalizeDeg,
  poseToAzimuth,
} from './orbitPose'

/** 六条滑杆的键，用于「谁在控制相机」的仲裁 */
export type OrbitSliderKey = 'alpha' | 'beta' | 'radius' | 'tx' | 'ty' | 'tz'

type Props = {
  pose: OrbitPose | null
  /** 滑杆拖动：写入相机 */
  onPoseChange: (next: OrbitPose) => void
  /** 拖动开始/结束：用于 detachControl 与回写仲裁 */
  onSliderActive: (key: OrbitSliderKey | null) => void
  onFitView: () => void
  onTopView: () => void
  onFrontView: () => void
  cameras: Material3dBookmark[]
  bookmarkLabel: string
  onBookmarkLabel: (v: string) => void
  onSave: () => void
  onRestore: (id: string) => void
  onRemove: (id: string) => void
  onCopyMarkdown: () => void
  onExportJson: () => void
}

/**
 * 视角参数：六条滑杆 + 适应视图/俯视/正视。
 * 拖动期间由父组件 detachControl，松手恢复，避免画布输入与滑杆互相干扰。
 */
export default function Material3dCameraPanel({
  pose,
  onPoseChange,
  onSliderActive,
  onFitView,
  onTopView,
  onFrontView,
  cameras,
  bookmarkLabel,
  onBookmarkLabel,
  onSave,
  onRestore,
  onRemove,
  onCopyMarkdown,
  onExportJson,
}: Props) {
  const view = useMemo(() => {
    if (!pose) return null
    return {
      azimuth: poseToAzimuth(pose),
      elevation: betaToElevation(pose.beta),
      radius: pose.radius,
      tx: pose.target.x,
      ty: pose.target.y,
      tz: pose.target.z,
    }
  }, [pose])

  const commit = (patch: Partial<{ azimuth: number; elevation: number; radius: number; tx: number; ty: number; tz: number }>) => {
    if (!pose || !view) return
    const next = { azimuth: view.azimuth, elevation: view.elevation, radius: view.radius, tx: view.tx, ty: view.ty, tz: view.tz, ...patch }
    onPoseChange({
      alpha: degToRad(normalizeDeg(next.azimuth)),
      beta: elevationToBeta(next.elevation),
      radius: next.radius,
      target: { x: next.tx, y: next.ty, z: next.tz },
    })
  }

  /** 滑杆通用属性：拖动开始 detach，任何结束路径都恢复 */
  const dragProps = (key: OrbitSliderKey) => ({
    onPointerDown: () => onSliderActive(key),
    onPointerUp: () => onSliderActive(null),
    onPointerCancel: () => onSliderActive(null),
    onBlur: () => onSliderActive(null),
  })

  return (
    <div className="m3d-panel m3d-panel-camera">
      <section className="m3d-panel-block">
        <header className="m3d-panel-block-head">
          <h5>视角</h5>
          <p>滑杆与鼠标共用同一个相机；拖滑杆时画布输入会临时让位</p>
        </header>

        {view ? (
          <>
            <label className="m3d-env-row">
              <span>方位</span>
              <input
                type="range"
                min={AZIMUTH_MIN}
                max={AZIMUTH_MAX}
                step={1}
                value={Math.round(view.azimuth)}
                onChange={(e) => commit({ azimuth: Number(e.target.value) })}
                data-m3d-orbit="alpha"
                {...dragProps('alpha')}
              />
              <small>{Math.round(view.azimuth)}°</small>
            </label>
            <label className="m3d-env-row">
              <span>仰角</span>
              <input
                type="range"
                min={ELEVATION_MIN}
                max={ELEVATION_MAX}
                step={1}
                value={Math.round(view.elevation)}
                onChange={(e) => commit({ elevation: Number(e.target.value) })}
                data-m3d-orbit="beta"
                {...dragProps('beta')}
              />
              <small>{Math.round(view.elevation)}°</small>
            </label>
            <label className="m3d-env-row">
              <span>距离</span>
              <input
                type="range"
                min={RADIUS_MIN}
                max={RADIUS_MAX}
                step={0.1}
                value={view.radius}
                onChange={(e) => commit({ radius: Number(e.target.value) })}
                data-m3d-orbit="radius"
                {...dragProps('radius')}
              />
              <small>{meters(view.radius)}</small>
            </label>
            <label className="m3d-env-row">
              <span>目标 X</span>
              <input
                type="range"
                min={TARGET_MIN}
                max={TARGET_MAX}
                step={0.1}
                value={view.tx}
                onChange={(e) => commit({ tx: Number(e.target.value) })}
                data-m3d-orbit="tx"
                {...dragProps('tx')}
              />
              <small>{meters(view.tx)}</small>
            </label>
            <label className="m3d-env-row">
              <span>目标 Y</span>
              <input
                type="range"
                min={TARGET_MIN}
                max={TARGET_MAX}
                step={0.1}
                value={view.ty}
                onChange={(e) => commit({ ty: Number(e.target.value) })}
                data-m3d-orbit="ty"
                {...dragProps('ty')}
              />
              <small>{meters(view.ty)}</small>
            </label>
            <label className="m3d-env-row">
              <span>目标 Z</span>
              <input
                type="range"
                min={TARGET_MIN}
                max={TARGET_MAX}
                step={0.1}
                value={view.tz}
                onChange={(e) => commit({ tz: Number(e.target.value) })}
                data-m3d-orbit="tz"
                {...dragProps('tz')}
              />
              <small>{meters(view.tz)}</small>
            </label>
            <div className="m3d-export-actions">
              <button type="button" className="btn-mini" data-m3d-fit-view onClick={onFitView}>
                适应视图
              </button>
              <button type="button" className="btn-mini ghost" data-m3d-top-view onClick={onTopView}>
                俯视
              </button>
              <button type="button" className="btn-mini ghost" data-m3d-front-view onClick={onFrontView}>
                正视
              </button>
            </div>
          </>
        ) : (
          <p className="m3d-empty-inline">视口加载中…</p>
        )}
      </section>

      <section className="m3d-panel-block">
        <header className="m3d-panel-block-head">
          <h5>机位书签</h5>
          <p>保存当前轨道视角，供分镜与 Blender 专家对齐参考</p>
        </header>
        <div className="m3d-bookmark-save">
          <input
            className="wb-field m3d-field-tight"
            value={bookmarkLabel}
            onChange={(e) => onBookmarkLabel(e.target.value)}
            placeholder="机位名称"
            data-m3d-bookmark-label
          />
          <button type="button" className="btn primary m3d-field-tight" data-m3d-save-bookmark onClick={onSave}>
            保存当前视角
          </button>
        </div>
        <div className="m3d-export-actions">
          <button type="button" className="btn-ghost m3d-field-tight" data-m3d-copy-storyboard-md onClick={onCopyMarkdown}>
            复制分镜说明（Markdown）
          </button>
          <button type="button" className="btn-ghost m3d-field-tight" data-m3d-export-storyboard-json onClick={onExportJson}>
            导出 JSON
          </button>
        </div>
        {cameras.length === 0 ? (
          <p className="m3d-empty-inline">还没有书签；摆好视角后点「保存」</p>
        ) : (
          <ul className="m3d-catalog" data-m3d-bookmark-list>
            {cameras.map((c) => (
              <li key={c.id} className="m3d-catalog-row">
                <button type="button" className="m3d-bookmark-restore" onClick={() => onRestore(c.id)}>
                  <strong>{c.label}</strong>
                  <small>
                    距离 {c.radius.toFixed(1)} · 目标 ({c.target.x.toFixed(1)}, {c.target.y.toFixed(1)},{' '}
                    {c.target.z.toFixed(1)})
                  </small>
                </button>
                <button type="button" className="btn-mini ghost" onClick={() => onRemove(c.id)}>
                  删
                </button>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  )
}
