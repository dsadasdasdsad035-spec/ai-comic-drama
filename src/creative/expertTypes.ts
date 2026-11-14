/** 创意专家定义（与 /api/experts 一致） */
export type CreativeExpert = {
  id: string
  name: string
  description: string
  /** 卡片头像 URL；内置无此项时由服务端按 experts/<id>/icon.* 解析 */
  iconUrl?: string
  /** 图标无障碍 / 语义说明（图像描述） */
  imageDescription?: string
  soul: string
  skillIds: string[]
  toolIds: string[]
  source: 'builtin' | 'custom'
}

export const EXPERT_NONE = ''