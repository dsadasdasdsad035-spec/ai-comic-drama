import type { Mesh, Scene } from '@babylonjs/core'
import { mergeMaterial3dEnvironment, type Material3dEnvironment } from './material3dTypes'

export type SceneEnvironmentHandles = {
  ground: Mesh
  hemiName: string
  dirName: string
  baseHemiIntensity: number
  baseDirIntensity: number
}

/** #rrggbb -> {r,g,b} 0-1 */
export function hexToColor3(hex: string): { r: number; g: number; b: number } {
  const h = hex.replace('#', '').trim()
  if (h.length !== 6) return { r: 0.07, g: 0.09, b: 0.11 }
  const r = parseInt(h.slice(0, 2), 16) / 255
  const g = parseInt(h.slice(2, 4), 16) / 255
  const b = parseInt(h.slice(4, 6), 16) / 255
  return { r, g, b }
}

/** 将 environment 应用到宿主场景（不重建 Engine） */
export async function applyMaterial3dEnvironment(
  scene: Scene,
  handles: SceneEnvironmentHandles,
  env?: Material3dEnvironment,
): Promise<void> {
  const BABYLON = await import('@babylonjs/core')
  const merged = mergeMaterial3dEnvironment(env)

  const bg = hexToColor3(merged.background)
  scene.clearColor = new BABYLON.Color4(bg.r, bg.g, bg.b, 1)

  handles.ground.setEnabled(merged.ground.visible)
  if (merged.ground.visible) {
    const size = Math.max(4, Math.min(80, merged.ground.size))
    handles.ground.scaling.x = size / 24
    handles.ground.scaling.z = size / 24
    const g = hexToColor3(merged.ground.color)
    const mat = handles.ground.material as import('@babylonjs/core').StandardMaterial | null
    if (mat) mat.diffuseColor = new BABYLON.Color3(g.r, g.g, g.b)
  }

  const hemi = scene.getLightByName(handles.hemiName) as import('@babylonjs/core').HemisphericLight | null
  if (hemi) hemi.intensity = handles.baseHemiIntensity * merged.light.ambient

  const dir = scene.getLightByName(handles.dirName) as import('@babylonjs/core').DirectionalLight | null
  if (dir) dir.intensity = handles.baseDirIntensity * merged.light.directional
}