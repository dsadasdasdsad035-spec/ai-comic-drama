import type { DesignSheet } from '../api'
import type { Material3dObject } from './material3dTypes'

/** 侧栏与列表用的可读对象名 */
export function material3dObjectLabel(obj: Material3dObject, designs: DesignSheet[]): string {
  if (obj.label?.trim()) return obj.label.trim()
  if (obj.kind === 'billboard') {
    const d = designs.find((x) => x.id === obj.designId)
    return d ? `立板 · ${d.name}` : '立板'
  }
  const tail = decodeURIComponent(String(obj.assetUrl || '').split('/').pop() || '模型')
  return `模型 · ${tail}`
}

export function material3dObjectKindTag(obj: Material3dObject): '立板' | 'GLB' {
  return obj.kind === 'billboard' ? '立板' : 'GLB'
}