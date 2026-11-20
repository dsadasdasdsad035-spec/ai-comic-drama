import type { Scene } from '@babylonjs/core'
import { DebugLayerTab } from '@babylonjs/core/Debug/debugLayer'
import { findNodeForObjectId } from './gizmoSelection'

export type EmbeddedInspectorOptions = {
  showExplorer: boolean
  initialTab: DebugLayerTab
}

export const INSPECTOR_TAB_OPTIONS: { id: DebugLayerTab; label: string; hint: string }[] = [
  { id: DebugLayerTab.Properties, label: '属性', hint: '材质、网格、灯光等属性网格' },
  { id: DebugLayerTab.Debug, label: '调试', hint: '网格、骨骼/物理查看器等' },
  { id: DebugLayerTab.Statistics, label: '统计', hint: 'FPS、Draw calls 等' },
  { id: DebugLayerTab.Tools, label: '工具', hint: '截屏、录制、glTF 等' },
  { id: DebugLayerTab.Settings, label: '设置', hint: '检视器偏好' },
]

let hostScene: Scene | null = null
let hostEl: HTMLElement | null = null
let lastEmbeddedKey = ''

function embeddedKey(scene: Scene, container: HTMLElement, options: EmbeddedInspectorOptions): string {
  return `${scene.uniqueId}:${container === hostEl}:${options.showExplorer}:${options.initialTab}`
}

function inspectorShowOptions(
  container: HTMLElement | undefined,
  options: EmbeddedInspectorOptions,
  partial?: { enableClose?: boolean },
): Record<string, unknown> {
  return {
    embedMode: true,
    showExplorer: options.showExplorer,
    showInspector: true,
    initialTab: options.initialTab,
    globalRoot: container,
    parentElement: container,
    overlay: false,
    enableClose: partial?.enableClose ?? false,
    enablePopup: true,
    handleResize: true,
  }
}

/** 懒加载嵌入检视器（场景浏览器 + Action Tabs） */
export async function showEmbeddedInspector(
  scene: Scene,
  container: HTMLElement,
  options: EmbeddedInspectorOptions,
): Promise<void> {
  const key = embeddedKey(scene, container, options)
  if (hostScene === scene && hostEl === container && container.dataset.m3dInspectorReady === 'true' && lastEmbeddedKey === key) {
    const { Inspector } = await import('@babylonjs/inspector')
    if (Inspector.IsVisible) return
  }
  lastEmbeddedKey = key
  await hideInspector()
  hostScene = scene
  hostEl = container
  container.replaceChildren()

  try {
    const { Inspector } = await import('@babylonjs/inspector')
    Inspector.Show(scene, inspectorShowOptions(container, options))
    container.dataset.m3dInspectorReady = 'true'
  } catch (err) {
    container.dataset.m3dInspectorReady = 'error'
    console.warn('检视器嵌入失败', err)
  }
}

/** 在独立窗口打开完整 embed（Explorer + Inspector） */
export async function popupFullInspector(scene: Scene, options: EmbeddedInspectorOptions): Promise<void> {
  const { Inspector } = await import('@babylonjs/inspector')
  if (Inspector.IsVisible && hostEl) {
    Inspector.PopupEmbed()
    return
  }

  const canvas = scene.getEngine().getRenderingCanvas()
  const mount = canvas?.parentElement ?? document.body

  await hideInspector()
  hostScene = scene
  hostEl = null
  lastEmbeddedKey = embeddedKey(scene, mount, options)

  try {
    Inspector.Show(scene, inspectorShowOptions(mount, options, { enableClose: true }))
    Inspector.PopupEmbed()
  } catch (err) {
    console.warn('检视器弹窗失败', err)
  }
}

export async function hideInspector(): Promise<void> {
  try {
    const { Inspector } = await import('@babylonjs/inspector')
    if (Inspector.IsVisible) Inspector.Hide()
  } catch {
    /* 未加载过 inspector */
  }
  hostEl?.replaceChildren()
  delete hostEl?.dataset.m3dInspectorReady
  hostScene = null
  hostEl = null
  lastEmbeddedKey = ''
}

/** 检视器已打开时，让属性面板跟随当前选中节点 */
export async function syncInspectorSelection(scene: Scene, objectId: string | null): Promise<void> {
  if (!objectId || !hostScene || hostScene !== scene) return
  const node = findNodeForObjectId(scene, objectId)
  if (!node) return
  try {
    const { Inspector } = await import('@babylonjs/inspector')
    if (!Inspector.IsVisible) return
    Inspector.OnSelectionChangeObservable.notifyObservers(node)
  } catch {
    /* 旧版 inspector 无此 observable 时忽略 */
  }
}