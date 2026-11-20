import type { RefObject } from 'react'
import type { DebugLayerTab } from '@babylonjs/core/Debug/debugLayer'
import { INSPECTOR_TAB_OPTIONS } from './inspectorPane'

type Props = {
  inspectorOpen: boolean
  inspectorShowExplorer: boolean
  inspectorTab: DebugLayerTab
  onToggleInspector: () => void
  onInspectorShowExplorer: (v: boolean) => void
  onInspectorTab: (tab: DebugLayerTab) => void
  onInspectorPopup: () => void
  inspectorHostRef: RefObject<HTMLDivElement>
}

export default function Material3dDebugPanel({
  inspectorOpen,
  inspectorShowExplorer,
  inspectorTab,
  onToggleInspector,
  onInspectorShowExplorer,
  onInspectorTab,
  onInspectorPopup,
  inspectorHostRef,
}: Props) {
  return (
    <div className="m3d-panel m3d-panel-debug">
      <section className="m3d-panel-block">
        <header className="m3d-panel-block-head">
          <h5>Babylon 调试检视器</h5>
          <p>仅用于排错：材质与网格改动不会写入项目 JSON</p>
        </header>
        <p className="m3d-inspector-warn">会话内有效；刷新或全量同步场景后会丢失。</p>
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
        <button type="button" className="btn primary m3d-field-tight" data-m3d-inspector-toggle onClick={onToggleInspector}>
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