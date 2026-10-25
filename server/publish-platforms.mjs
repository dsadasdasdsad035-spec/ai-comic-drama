/**
 * 平台能力注册表（服务端唯一真相）。
 *
 * 为什么是静态表而不是数据库或设置项：
 * - 这些是平台规则（标题上限、封面比例），不是用户偏好；入库只会多一次迁移和一套没人改的 UI。
 * - 前端必须从 /api/publish/platforms 取，不能在组件里再抄一份，否则两边迟早不一致。
 * - 真实页面选择器与上限要登录后人工验证；未验证的平台在这里标 manualOnly，
 *   发布台只给「打开后台」和「导出发布包」，不冒险盲点。
 *
 * 上限值来源是国内创作者后台的常见限制，属于保守默认，不是平台合同条款；
 * 真实值以登录后实测为准，验证不了就降级，而不是让用户替我们试错。
 */

export const PUBLISH_MODES = ['draft', 'publish', 'package']

/**
 * @typedef {object} PlatformCapability
 * @property {string} id
 * @property {string} label
 * @property {string} short      顶部徽标用的两字缩写
 * @property {string} backendUrl 创作者后台地址
 * @property {string[]} contentTypes
 * @property {string[]} modes
 * @property {boolean} manualOnly
 * @property {boolean} verified
 * @property {string[]} coverAspects
 * @property {{title:number, description:number, tags:number}} limits
 * @property {{durationSec?:number, bytes?:number}} max
 * @property {string} notes
 */

/** @type {PlatformCapability[]} */
export const PLATFORMS = [
  {
    id: 'douyin',
    label: '抖音',
    short: '抖',
    backendUrl: 'https://creator.douyin.com/creator-micro/content/upload',
    contentTypes: ['video'],
    modes: ['draft', 'publish', 'package'],
    manualOnly: false,
    // 选择器未在真实登录态下验证前，草稿流程仍可提供；适配器自报 verified 决定是否自动执行
    verified: false,
    coverAspects: ['9:16'],
    limits: { title: 30, description: 1000, tags: 20 },
    max: { durationSec: 15 * 60, bytes: 4 * 1024 * 1024 * 1024 },
    notes: '竖屏优先；需 AI 生成内容声明；最终发布必须人工确认。',
  },
  {
    id: 'bilibili',
    label: 'B 站',
    short: 'B',
    backendUrl: 'https://member.bilibili.com/platform/upload/video/frame',
    contentTypes: ['video'],
    modes: ['draft', 'publish', 'package'],
    manualOnly: false,
    verified: false,
    coverAspects: ['16:9'],
    limits: { title: 80, description: 2000, tags: 12 },
    max: { durationSec: 10 * 60 * 60, bytes: 8 * 1024 * 1024 * 1024 },
    notes: '需要分区与标签；封面 16:9，建议 960×540 以上。',
  },
  {
    id: 'toutiao',
    label: '头条',
    short: '头',
    backendUrl: 'https://mp.toutiao.com/profile_v4/xigua/upload-video',
    contentTypes: ['video'],
    modes: ['draft', 'publish', 'package'],
    manualOnly: false,
    verified: false,
    coverAspects: ['16:9'],
    limits: { title: 30, description: 1000, tags: 10 },
    max: { durationSec: 15 * 60, bytes: 2 * 1024 * 1024 * 1024 },
    notes: '没有通用第三方发布接口；页面结构变动频繁，未验证时按手动处理。',
  },
]

const BY_ID = new Map(PLATFORMS.map((p) => [p.id, p]))

export function listPlatforms() {
  return PLATFORMS.map((p) => ({ ...p, limits: { ...p.limits }, max: { ...p.max } }))
}

/** 未声明的平台一律拒绝，避免拼错 id 后静默跑错适配器 */
export function getPlatform(id) {
  const key = String(id || '').trim()
  const p = BY_ID.get(key)
  if (!p) throw new Error(`未知平台：${key || '(空)'}`)
  return p
}

export function platformSupports(platformId, mode) {
  const p = getPlatform(platformId)
  return p.modes.includes(mode)
}

/** 该平台是否能进入自动/半自动执行；manualOnly 只保留人工与发布包 */
export function platformCanExecute(platformId) {
  const p = getPlatform(platformId)
  return !p.manualOnly
}

export const COVER_ASPECT_ORDER = ['9:16', '16:9']

/** 多平台需要的封面比例并集，用于发布台提示与发布包打包 */
export function requiredCoverAspects(platformIds = []) {
  const set = new Set()
  for (const id of platformIds) {
    let p
    try {
      p = getPlatform(id)
    } catch {
      continue
    }
    for (const aspect of p.coverAspects) set.add(aspect)
  }
  return COVER_ASPECT_ORDER.filter((a) => set.has(a))
}
