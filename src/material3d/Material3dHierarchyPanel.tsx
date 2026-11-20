import type { DesignSheet } from '../api'
import type { Material3dBillboardObject, Material3dObject, Material3dTransform } from './material3dTypes'
import { DEFAULT_BILLBOARD_SIZE } from './material3dTypes'
import { material3dObjectKindTag, material3dObjectLabel } from './objectDisplayName'
import Material3dTransformPanel from './Material3dTransformPanel'

type Props = {
  objects: Material3dObject[]
  designs: DesignSheet[]
  selectedId: string | null
  onSelect: (id: string | null) => void
  onRemove: (id: string) => void
  onPatchObject: (id: string, patch: Partial<Material3dObject>) => void
  onTransformChange: (id: string, transform: Material3dTransform) => void
  onOpenLibrary: () => void
  onOpenDebug: () => void
}

export default function Material3dHierarchyPanel({
  objects,
  designs,
  selectedId,
  onSelect,
  onRemove,
  onPatchObject,
  onTransformChange,
  onOpenLibrary,
  onOpenDebug,
}: Props) {
  const selected = selectedId ? objects.find((o) => o.id === selectedId) : null

  return (
    <div className="m3d-panel m3d-panel-hierarchy">
      <section className="m3d-panel-block">
        <header className="m3d-panel-block-head m3d-panel-block-head--row">
          <div>
            <h5>场景对象</h5>
            <p>在视口点选或从下表选中；Gizmo 与数字面板同步</p>
          </div>
          <button type="button" className="btn-mini ghost" onClick={() => onSelect(null)} disabled={!selectedId}>
            取消选中
          </button>
        </header>
        {objects.length === 0 ? (
          <div className="m3d-empty-card">
            <p>还没有摆进场景的内容</p>
            <button type="button" className="btn primary" onClick={onOpenLibrary}>
              去素材库添加
            </button>
          </div>
        ) : (
          <ul className="m3d-catalog" data-m3d-object-list>
            {objects.map((o) => (
              <li
                key={o.id}
                className={`m3d-catalog-row${selectedId === o.id ? ' is-selected' : ''}${o.locked ? ' is-locked' : ''}`}
              >
                <button
                  type="button"
                  className="m3d-object-pick"
                  data-m3d-object-item={o.id}
                  onClick={() => onSelect(o.id)}
                >
                  <span className="m3d-chip-tag">{material3dObjectKindTag(o)}</span>
                  <span className="m3d-object-pick-label">
                    {o.locked ? '🔒 ' : ''}
                    {material3dObjectLabel(o, designs)}
                  </span>
                </button>
                <button type="button" className="btn-mini ghost" onClick={() => onRemove(o.id)} aria-label="删除对象">
                  删
                </button>
              </li>
            ))}
          </ul>
        )}
      </section>

      {selected ? (
        <section className="m3d-panel-block m3d-panel-block--accent" data-m3d-object-props>
          <header className="m3d-panel-block-head">
            <h5>选中对象</h5>
            <p>{material3dObjectLabel(selected, designs)}</p>
          </header>
          <label className="m3d-env-row">
            <span>显示名</span>
            <input
              className="wb-field m3d-field-tight"
              value={selected.label ?? ''}
              placeholder="分镜备注用名称"
              data-m3d-object-label
              onChange={(e) => onPatchObject(selected.id, { label: e.target.value })}
            />
          </label>
          <label className="m3d-env-row m3d-env-check">
            <input
              type="checkbox"
              checked={Boolean(selected.locked)}
              data-m3d-object-locked
              onChange={(e) => onPatchObject(selected.id, { locked: e.target.checked })}
            />
            锁定（禁止 Gizmo）
          </label>
          {selected.kind === 'billboard' ? (
            <div className="m3d-billboard-size">
              <label className="m3d-transform-field">
                <span>宽</span>
                <input
                  type="number"
                  min={0.5}
                  step={0.1}
                  data-m3d-billboard-width
                  value={selected.billboardSize?.width ?? DEFAULT_BILLBOARD_SIZE.width}
                  onChange={(e) =>
                    onPatchObject(selected.id, {
                      billboardSize: {
                        width: Number(e.target.value),
                        height: selected.billboardSize?.height ?? DEFAULT_BILLBOARD_SIZE.height,
                      },
                    } as Partial<Material3dBillboardObject>)
                  }
                />
              </label>
              <label className="m3d-transform-field">
                <span>高</span>
                <input
                  type="number"
                  min={0.5}
                  step={0.1}
                  data-m3d-billboard-height
                  value={selected.billboardSize?.height ?? DEFAULT_BILLBOARD_SIZE.height}
                  onChange={(e) =>
                    onPatchObject(selected.id, {
                      billboardSize: {
                        width: selected.billboardSize?.width ?? DEFAULT_BILLBOARD_SIZE.width,
                        height: Number(e.target.value),
                      },
                    } as Partial<Material3dBillboardObject>)
                  }
                />
              </label>
            </div>
          ) : null}
          <Material3dTransformPanel
            transform={selected.transform}
            disabled={Boolean(selected.locked)}
            onChange={(t) => onTransformChange(selected.id, t)}
          />
        </section>
      ) : (
        <p className="m3d-empty-inline">在视口点击对象，或从上方列表选择以编辑变换。</p>
      )}

      <section className="m3d-panel-block m3d-panel-block--muted">
        <p className="m3d-meta-line">需要改材质网格、看统计或 glTF 工具？</p>
        <button type="button" className="btn-ghost m3d-field-tight" onClick={onOpenDebug}>
          打开调试检视器
        </button>
      </section>
    </div>
  )
}