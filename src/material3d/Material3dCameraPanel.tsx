import type { Material3dBookmark } from './material3dTypes'

type Props = {
  cameras: Material3dBookmark[]
  bookmarkLabel: string
  onBookmarkLabel: (v: string) => void
  onSave: () => void
  onRestore: (id: string) => void
  onRemove: (id: string) => void
  onCopyMarkdown: () => void
  onExportJson: () => void
}

export default function Material3dCameraPanel({
  cameras,
  bookmarkLabel,
  onBookmarkLabel,
  onSave,
  onRestore,
  onRemove,
  onCopyMarkdown,
  onExportJson,
}: Props) {
  return (
    <div className="m3d-panel m3d-panel-camera">
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