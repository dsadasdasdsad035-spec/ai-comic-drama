/**
 * 平台能力注册表（服务端唯一真相）。
 *
 * 为什么是静态表而不是数据库或设置项：
 * - 这些是平台规则（标题上限、封面比例），不是用户偏好；入库只会多一次迁移和一套没人改的 UI。
 * - 前端必须从 /api/publish/platforms 取，不能在组件里再抄一份，否则两边迟早不一致。
 * - 真实页面选择器与上限要登录后人工验证；没有表单证据的平台标 manualOnly，
 *   发布台只给「打开后台」和「导出发布包」，不冒险盲点。
 *
 * 上限值来源是国内创作者后台的常见限制与公开实现，属于保守默认，不是平台合同条款；
 * 真实值以登录后实测为准，验证不了就降级，而不是让用户替我们试错。
 */

export const PUBLISH_MODES = ['draft', 'publish', 'package']

/**
 * @typedef {object} PlatformLimits
 * @property {number} titleMax          标题上限
 * @property {number} [titleMin]        标题下限（缺省表示没有下限）
 * @property {true} [titleOptional]     该平台没有独立标题字段
 * @property {number} descriptionMax    简介上限
 * @property {number} tagsMax           标签数量上限
 */

/**
 * @typedef {object} PlatformCapability
 * @property {string} id
 * @property {string} label
 * @property {string} short                       兼容字段；徽标优先读 badge.text
 * @property {{text:string,color:string}} badge   徽标缩写与品牌色
 * @property {string} backendUrl                  创作者后台地址
 * @property {string[]} contentTypes
 * @property {string[]} modes
 * @property {boolean} manualOnly
 * @property {boolean} verified
 * @property {'server'|'local'|'none'} draftKind  草稿存在哪里
 * @property {string[]} coverAspects
 * @property {PlatformLimits} limits
 * @property {{durationSec?:number, bytes?:number}} max
 * @property {string} notes
 */

/** @type {PlatformCapability[]} */
export const PLATFORMS = [
  {
    id: 'douyin',
    label: '抖音',
    short: '抖',
    badge: { text: '抖', color: '#161823' },
    backendUrl: 'https://creator.douyin.com/creator-micro/content/upload',
    contentTypes: ['video'],
    modes: ['draft', 'publish', 'package'],
    manualOnly: false,
    // 选择器未在真实登录态下验证前，草稿流程仍可提供；适配器自报 verified 决定是否自动执行
    verified: false,
    draftKind: 'server',
    coverAspects: ['9:16'],
    limits: { titleMax: 30, descriptionMax: 1000, tagsMax: 20 },
    max: { durationSec: 15 * 60, bytes: 4 * 1024 * 1024 * 1024 },
    notes: '竖屏优先；需 AI 生成内容声明；最终发布必须人工确认。',
  },
  {
    id: 'bilibili',
    label: 'B 站',
    short: 'B',
    badge: { text: 'B', color: '#00a1d6' },
    backendUrl: 'https://member.bilibili.com/platform/upload/video/frame',
    contentTypes: ['video'],
    modes: ['draft', 'publish', 'package'],
    manualOnly: false,
    verified: false,
    draftKind: 'server',
    coverAspects: ['16:9'],
    limits: { titleMax: 80, descriptionMax: 2000, tagsMax: 12 },
    max: { durationSec: 10 * 60 * 60, bytes: 8 * 1024 * 1024 * 1024 },
    notes: '需要分区与标签；封面 16:9，建议 960×540 以上。',
  },
  {
    id: 'toutiao',
    label: '头条',
    short: '头',
    badge: { text: '头', color: '#f04142' },
    backendUrl: 'https://mp.toutiao.com/profile_v4/xigua/upload-video',
    contentTypes: ['video'],
    modes: ['draft', 'publish', 'package'],
    manualOnly: false,
    verified: false,
    draftKind: 'server',
    coverAspects: ['16:9'],
    limits: { titleMax: 30, descriptionMax: 1000, tagsMax: 10 },
    max: { durationSec: 15 * 60, bytes: 2 * 1024 * 1024 * 1024 },
    notes: '没有通用第三方发布接口；页面结构变动频繁，未验证时按手动处理。',
  },
  {
    id: 'xigua',
    label: '西瓜视频',
    short: '西',
    badge: { text: '西', color: '#f97316' },
    backendUrl: 'https://studio.ixigua.com/upload',
    contentTypes: ['video'],
    modes: ['draft', 'publish', 'package'],
    manualOnly: false,
    verified: false,
    draftKind: 'server',
    coverAspects: ['16:9'],
    limits: { titleMax: 30, descriptionMax: 1000, tagsMax: 10 },
    max: { durationSec: 15 * 60, bytes: 2 * 1024 * 1024 * 1024 },
    notes: '字节系，后台与头条同族；横屏为主。',
  },
  {
    id: 'xiaohongshu',
    label: '小红书',
    short: '红',
    badge: { text: '红', color: '#ff2442' },
    backendUrl: 'https://creator.xiaohongshu.com/publish/publish?from=homepage&target=video',
    contentTypes: ['video'],
    modes: ['draft', 'publish', 'package'],
    manualOnly: false,
    verified: false,
    draftKind: 'local',
    coverAspects: ['3:4'],
    limits: { titleMax: 20, descriptionMax: 1000, tagsMax: 10 },
    max: { durationSec: 15 * 60, bytes: 2 * 1024 * 1024 * 1024 },
    notes: '封面 3:4；草稿存在浏览器本地，清理浏览器数据会丢失。',
  },
  {
    id: 'kuaishou',
    label: '快手',
    short: '快',
    badge: { text: '快', color: '#ff6a00' },
    backendUrl: 'https://cp.kuaishou.com/article/publish/video',
    contentTypes: ['video'],
    // 没有草稿入口：自动流程只把表单填好，留给人工点发布
    modes: ['draft', 'publish', 'package'],
    manualOnly: false,
    verified: false,
    draftKind: 'none',
    coverAspects: ['9:16'],
    limits: { titleMax: 0, titleOptional: true, descriptionMax: 1000, tagsMax: 3 },
    max: { durationSec: 15 * 60, bytes: 2 * 1024 * 1024 * 1024 },
    notes: '没有独立标题，标题并入描述；竖屏为主；未见草稿入口。',
  },
  {
    id: 'wechat-channels',
    label: '视频号',
    short: '视',
    badge: { text: '视', color: '#07c160' },
    backendUrl: 'https://channels.weixin.qq.com/platform/post/create',
    contentTypes: ['video'],
    modes: ['draft', 'publish', 'package'],
    manualOnly: false,
    verified: false,
    draftKind: 'server',
    coverAspects: ['4:3', '3:4'],
    limits: { titleMax: 16, titleMin: 6, descriptionMax: 1000, tagsMax: 10 },
    max: { durationSec: 30 * 60, bytes: 2 * 1024 * 1024 * 1024 },
    notes: '短标题 6–16 字；表单在内嵌框架内；只能微信扫码登录，会话容易失效。',
  },
  {
    id: 'zhihu',
    label: '知乎',
    short: '知',
    badge: { text: '知', color: '#0084ff' },
    backendUrl: 'https://www.zhihu.com/upload-video',
    contentTypes: ['video'],
    // 没有草稿入口：自动流程只把表单填好，留给人工点发布
    modes: ['draft', 'publish', 'package'],
    manualOnly: false,
    verified: false,
    draftKind: 'none',
    coverAspects: ['16:9'],
    limits: { titleMax: 50, titleMin: 5, descriptionMax: 300, tagsMax: 10 },
    max: { durationSec: 60 * 60, bytes: 2 * 1024 * 1024 * 1024 },
    notes: '标题 5–50 字；未见草稿入口。',
  },
  {
    id: 'baijiahao',
    label: '百家号',
    short: '百',
    badge: { text: '百', color: '#2932e1' },
    backendUrl: 'https://baijiahao.baidu.com/builder/rc/edit?type=videoV2',
    contentTypes: ['video'],
    // 没有草稿入口：自动流程只把表单填好，留给人工点发布
    modes: ['draft', 'publish', 'package'],
    manualOnly: false,
    verified: false,
    draftKind: 'none',
    coverAspects: ['16:9'],
    limits: { titleMax: 30, titleMin: 9, descriptionMax: 1000, tagsMax: 10 },
    max: { durationSec: 60 * 60, bytes: 4 * 1024 * 1024 * 1024 },
    notes: '标题 9–30 字；横版封面必填。',
  },
  {
    id: 'dayu',
    label: '大鱼号',
    short: '鱼',
    badge: { text: '鱼', color: '#ff6a00' },
    backendUrl: 'https://mp.dayu.com/dashboard/video/write',
    contentTypes: ['video'],
    // 没有草稿入口：自动流程只把表单填好，留给人工点发布
    modes: ['draft', 'publish', 'package'],
    manualOnly: false,
    verified: false,
    draftKind: 'none',
    coverAspects: ['16:9'],
    limits: { titleMax: 60, titleMin: 5, descriptionMax: 200, tagsMax: 10 },
    max: { durationSec: 60 * 60, bytes: 2 * 1024 * 1024 * 1024 },
    notes: '标题 5–60 字；封面必填。',
  },
  {
    id: 'weibo',
    label: '微博',
    short: '微',
    badge: { text: '微', color: '#e6162d' },
    backendUrl: 'https://weibo.com/upload/channel',
    contentTypes: ['video'],
    modes: ['package'],
    manualOnly: true,
    verified: false,
    draftKind: 'none',
    coverAspects: ['16:9'],
    limits: { titleMax: 30, descriptionMax: 1000, tagsMax: 10 },
    max: { durationSec: 60 * 60, bytes: 2 * 1024 * 1024 * 1024 },
    notes: '表单结构未核实，只提供打开后台与发布包。',
  },
  {
    id: 'qiehao',
    label: '企鹅号',
    short: '企',
    badge: { text: '企', color: '#12b7f5' },
    backendUrl: 'https://om.qq.com/main/production',
    contentTypes: ['video'],
    modes: ['package'],
    manualOnly: true,
    verified: false,
    draftKind: 'none',
    coverAspects: ['16:9'],
    limits: { titleMax: 30, descriptionMax: 1000, tagsMax: 10 },
    max: { durationSec: 60 * 60, bytes: 2 * 1024 * 1024 * 1024 },
    notes: '表单结构未核实，只提供打开后台与发布包。',
  },
  {
    id: 'netease-hao',
    label: '网易号',
    short: '网',
    badge: { text: '网', color: '#d8202c' },
    backendUrl: 'https://mp.163.com/',
    contentTypes: ['video'],
    modes: ['package'],
    manualOnly: true,
    verified: false,
    draftKind: 'none',
    coverAspects: ['16:9'],
    limits: { titleMax: 55, titleMin: 27, descriptionMax: 1000, tagsMax: 10 },
    max: { durationSec: 60 * 60, bytes: 2 * 1024 * 1024 * 1024 },
    notes: '表单结构未核实，只提供打开后台与发布包；标题长度区间为公开资料值。',
  },
  {
    id: 'sohu-hao',
    label: '搜狐号',
    short: '搜',
    badge: { text: '搜', color: '#f5a623' },
    backendUrl: 'https://mp.sohu.com/mpfe/v4/?type=video',
    contentTypes: ['video'],
    modes: ['package'],
    manualOnly: true,
    verified: false,
    draftKind: 'none',
    coverAspects: ['16:9'],
    limits: { titleMax: 30, descriptionMax: 1000, tagsMax: 10 },
    max: { durationSec: 60 * 60, bytes: 2 * 1024 * 1024 * 1024 },
    notes: '表单结构未核实，只提供打开后台与发布包。',
  },
]

const BY_ID = new Map(PLATFORMS.map((p) => [p.id, p]))

export function listPlatforms() {
  return PLATFORMS.map((p) => ({
    ...p,
    limits: { ...p.limits },
    max: { ...p.max },
    ...(p.badge ? { badge: { ...p.badge } } : {}),
  }))
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

/** 草稿存在哪里；未声明时按没有草稿处理，避免误承诺「已存入平台」 */
export function platformDraftKind(platformId) {
  const p = getPlatform(platformId)
  return p.draftKind || 'none'
}

/** 封面比例：先竖版后横版；发布包文件名由 aspectSlug 转换，新增比例无需改这里 */
export const COVER_ASPECT_ORDER = ['9:16', '3:4', '4:3', '16:9']

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
