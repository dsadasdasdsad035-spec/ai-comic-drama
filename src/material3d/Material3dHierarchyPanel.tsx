import type { RefObject } from 'react'
import type { DebugLayerTab } from '@babylonjs/core/Debug/debugLayer'
import type { DesignSheet } from '../api'
import type { Material3dBillboardObject, Material3dObject, Material3dTransform } from './material3dTypes'
import { DEFAULT_BILLBOARD_SIZE } from './material3dTypes'
import { INSPECTOR_TAB_OPTIONS } from './inspectorPane'
import { material3dObjectKindTag, material3dObjectLabel } from './objectDisplayName'
import Material3dTransformPanel from './Material3dTransformPanel'

type Props = {
  objects: Material3dObject[]
  designs: DesignSheet[]
  selectedId: string | null
  inspectorOpen: boolean
  inspectorShowExplorer: boolean
  inspectorTab: DebugLayerTab
  onSelect: (id: string | null) => void
  onRemove: (id: string) => void
  onToggleInspector: () => void
  onInspectorShowExplorer: (v: boolean) => void
  onInspectorTab: (tab: DebugLayerTab) => void
  onInspectorPopup: () => void
  onPatchObject: (id: string, patch: Partial<Material3dObject>) => void
  onTransformChange: (id: string, transform: Material3dTransform) => void
  inspectorHostRef: RefObject<HTMLDivElement>
}

export default function Material3dHierarchyPanel({
  objects,
  designs,
  selectedId,
  inspectorOpen,
  inspectorShowExplorer,
  inspectorTab,
  onSelect,
  onRemove,
  onToggleInspector,
  onInspectorShowExplorer,
  onInspectorTab,
  onInspectorPopup,
  onPatchObject,
  onTransformChange,
  inspectorHostRef,
}: Props) {
  const selected = selectedId ? objects.find((o) => o.id === selectedId) : null

  return (
    <div className="m3d-panel m3d-panel-hierarchy">
      <section className="m3d-panel-block">
        <header className="m3d-panel-block-head m3d-panel-block-head--row">
          <div>
            <h5>场景对象</h5>
            <p>点选后在视口用 Gizmo 移动；变更自动保存</p>
          </div>
          <button type="button" className="btn-mini ghost" onClick={() => onSelect(null)} disabled={!selectedId}>
            取消选中
          </button>
        </header>
        {objects.length === 0 ? (
          <p className="m3d-empty-inline">还没有对象，到「添加」放入立板或模型</p>
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
        <section className="m3d-panel-block" data-m3d-object-props>
          <header className="m3d-panel-block-head">
            <h5>对象属性</h5>
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
            锁定（不可 Gizmo 拖动）
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
      ) : null}

      <section className="m3d-panel-block">
        <header className="m3d-panel-block-head">
          <h5>属性检视</h5>
          <p>Babylon 官方 Explorer + 调试页签；修改不保存到项目</p>
        </header>
        <p className="m3d-inspector-warn">检视器内的材质/网格改动仅当前会话有效，刷新或同步场景后会丢失。</p>
        <div className="m3d-inspector-toolbar">
          <label className="m3d-env-check m3d-inspector-check">
            <input
              type="checkbox"
              checked={inspectorShowExplorer}
              onChange={(e) => onInspectorShowExplorer(e.target.checked)}
              data-m3d-inspector-explorer
            />
            <span>场景浏览器</span>
          </label>
          <button type="button" className="btn-mini ghost" data-m3d-inspector-popup onClick={onInspectorPopup}>
            弹窗打开
          </button>
        </div>
        <div className="m3d-source-tabs m3d-inspector-tabs" role="tablist" aria-label="检视器页签">
          {INSPECTOR_TAB_OPTIONS.map((tab) => (
            <button
              key={tab.id}
              type="button"
              role="tab"
              className={inspectorTab === tab.id ? 'on' : undefined}
              title={tab.hint}
              data-m3d-inspector-tab={tab.id}
              onClick={() => onInspectorTab(tab.id)}
            >
              {tab.label}
            </button>
          ))}
        </div>
        <button type="button" className="btn-ghost m3d-field-tight" data-m3d-inspector-toggle onClick={onToggleInspector}>
          {inspectorOpen ? '收起检视器' : '展开检视器'}
        </button>
        <div
          ref={inspectorHostRef}
          className={inspectorShowExplorer ? 'm3d-inspector-host m3d-inspector-host--tall' : 'm3d-inspector-host'}
          data-m3d-inspector-host
          style={{ display: inspectorOpen ? 'block' : 'none' }}
        />
      </section>
    </div>
  )
}