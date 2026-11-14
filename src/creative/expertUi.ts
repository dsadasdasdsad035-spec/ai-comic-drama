import type { CreativeExpert } from './expertTypes'

/** 卡片 / 详情展示用图标地址（无则回退首字头像） */
export function expertCardIconUrl(expert: CreativeExpert): string {
  return String(expert.iconUrl || '').trim()
}

/** 图标无障碍与语义说明；无图像描述时回退名称 */
export function expertCardIconAlt(expert: CreativeExpert): string {
  const alt = String(expert.imageDescription || '').trim()
  return alt || expert.name || expert.id
}