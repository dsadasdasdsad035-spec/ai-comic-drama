import type { Scene } from '@babylonjs/core'
import { findNodeForObjectId } from './gizmoSelection'

let hostScene: Scene | null = null
let hostEl: HTMLElement | null = null

/** 懒加载嵌入检视器（属性区） */
export async function showEmbeddedInspector(scene: Scene, container: HTMLElement): Promise<void> {
  if (hostScene === scene && hostEl === container) {
    const { Inspector } = await import('@babylonjs/inspector')
    if (Inspector.IsVisible) return
  }
  await hideInspector()
  hostScene = scene
  hostEl = container
  container.replaceChildren()

  try {
    const { Inspector } = await import('@babylonjs/inspector')
    Inspector.Show(scene, {
      embedMode: true,
      showExplorer: false,
      showInspector: true,
      globalRoot: container,
      parentElement: container,
      overlay: false,
      enableClose: false,
      handleResize: true,
    } as Record<string, unknown>)
    container.dataset.m3dInspectorReady = 'true'
  } catch (err) {
    container.dataset.m3dInspectorReady = 'error'
    console.warn('检视器嵌入失败', err)
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