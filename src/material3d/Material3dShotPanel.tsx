import Material3dCameraPanel, { type OrbitSliderKey } from './Material3dCameraPanel'
import Material3dEnvironmentPanel from './Material3dEnvironmentPanel'
import type { OrbitPose } from './createEngine'
import type { Material3dBookmark, Material3dEnvironment } from './material3dTypes'

type Props = {
  environment?: Material3dEnvironment
  cameras: Material3dBookmark[]
  bookmarkLabel: string
  pose: OrbitPose | null
  onEnvironmentChange: (next: Material3dEnvironment) => void
  onBookmarkLabel: (v: string) => void
  onPoseChange: (next: OrbitPose) => void
  onSliderActive: (key: OrbitSliderKey | null) => void
  onFitView: () => void
  onTopView: () => void
  onFrontView: () => void
  onSave: () => void
  onRestore: (id: string) => void
  onRemove: (id: string) => void
  onCopyMarkdown: () => void
  onExportJson: () => void
}

export default function Material3dShotPanel({
  environment,
  cameras,
  bookmarkLabel,
  pose,
  onEnvironmentChange,
  onBookmarkLabel,
  onPoseChange,
  onSliderActive,
  onFitView,
  onTopView,
  onFrontView,
  onSave,
  onRestore,
  onRemove,
  onCopyMarkdown,
  onExportJson,
}: Props) {
  return (
    <div className="m3d-panel m3d-panel-shot">
      <p className="m3d-shot-lede">先摆好对象与视角，再保存机位并导出给 Blender 专家。</p>
      <Material3dEnvironmentPanel environment={environment} onChange={onEnvironmentChange} />
      <Material3dCameraPanel
        pose={pose}
        onPoseChange={onPoseChange}
        onSliderActive={onSliderActive}
        onFitView={onFitView}
        onTopView={onTopView}
        onFrontView={onFrontView}
        cameras={cameras}
        bookmarkLabel={bookmarkLabel}
        onBookmarkLabel={onBookmarkLabel}
        onSave={onSave}
        onRestore={onRestore}
        onRemove={onRemove}
        onCopyMarkdown={onCopyMarkdown}
        onExportJson={onExportJson}
      />
    </div>
  )
}
