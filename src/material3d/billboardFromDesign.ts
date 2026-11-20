import type { DesignSheet } from '../api'
import {
  DEFAULT_TRANSFORM,
  newMaterial3dObjectId,
  type Material3dBillboardObject,
  type Material3dTransform,
} from './material3dTypes'

/** 校验设定卡能否做立板；失败抛带中文说明的错误 */
export function resolveDesignBillboardUrl(design: DesignSheet, missing: Set<string>): string {
  const url = String(design.image || '').split('?')[0].trim()
  if (!url) throw new Error(`设定卡「${design.name || design.id}」没有当前图，无法创建立板`)
  if (!url.startsWith('/')) throw new Error('立板仅支持项目内 /project-assets 路径')
  if (missing.has(url)) throw new Error(`设定卡「${design.name}」的图片缺失或无法加载`)
  return url
}

export function createBillboardObject(
  design: DesignSheet,
  missing: Set<string>,
  transform: Material3dTransform = DEFAULT_TRANSFORM,
): Material3dBillboardObject {
  resolveDesignBillboardUrl(design, missing)
  return {
    id: newMaterial3dObjectId(),
    kind: 'billboard',
    designId: design.id,
    transform: { ...transform },
  }
}