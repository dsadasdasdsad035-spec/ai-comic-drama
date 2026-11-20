import type { Cc0PropEntry } from '../api'

/** Poly Haven 英文标题 → 中文展示（分词 + 常用家具短语） */
const PHRASES: { en: string; zh: string }[] = [
  { en: 'coffee table round', zh: '圆咖啡桌' },
  { en: 'coffee table', zh: '咖啡桌' },
  { en: 'dining table', zh: '餐桌' },
  { en: 'dining chair', zh: '餐椅' },
  { en: 'arm chair', zh: '扶手椅' },
  { en: 'armchair', zh: '扶手椅' },
  { en: 'lounge chair', zh: '休闲椅' },
  { en: 'office chair', zh: '办公椅' },
  { en: 'bar chair round', zh: '圆吧椅' },
  { en: 'bar chair', zh: '吧台椅' },
  { en: 'barber shop chair', zh: '理发椅' },
  { en: 'folding wooden stool', zh: '折叠木凳' },
  { en: 'console table', zh: '玄关桌' },
  { en: 'side table', zh: '边桌' },
  { en: 'end table', zh: '边几' },
  { en: 'tea table', zh: '茶几' },
  { en: 'night stand', zh: '床头柜' },
  { en: 'drawer cabinet', zh: '抽屉柜' },
  { en: 'display cabinet', zh: '展示柜' },
  { en: 'gothic bed', zh: '哥特床' },
  { en: 'gothic cabinet', zh: '哥特柜' },
  { en: 'gothic coffee table', zh: '哥特咖啡桌' },
  { en: 'bookshelf', zh: '书架' },
  { en: 'book shelf', zh: '书架' },
  { en: 'ceiling fan', zh: '吊扇' },
  { en: 'floor lamp', zh: '落地灯' },
  { en: 'table lamp', zh: '台灯' },
  { en: 'wall clock', zh: '挂钟' },
  { en: 'alarm clock', zh: '闹钟' },
  { en: 'mantel clock', zh: '壁炉钟' },
  { en: 'chandelier', zh: '吊灯' },
  { en: 'pendant light', zh: '吊灯' },
  { en: 'street light', zh: '路灯' },
  { en: 'cutting board', zh: '砧板' },
  { en: 'wine bottle', zh: '酒瓶' },
  { en: 'flower pot', zh: '花盆' },
  { en: 'potted plant', zh: '盆栽' },
  { en: 'american football', zh: '美式橄榄球' },
  { en: 'fire extinguisher', zh: '灭火器' },
  { en: 'smoke detector', zh: '烟雾报警器' },
  { en: 'cash register', zh: '收银机' },
  { en: 'pool ball', zh: '台球' },
].sort((a, b) => b.en.length - a.en.length)

const WORDS: Record<string, string> = {
  modern: '现代',
  vintage: '复古',
  antique: '古董',
  classic: '经典',
  industrial: '工业风',
  chinese: '中式',
  gothic: '哥特',
  mid: '中',
  century: '世纪',
  wooden: '木质',
  wood: '木',
  green: '绿色',
  metal: '金属',
  brass: '黄铜',
  ceramic: '陶瓷',
  concrete: '混凝土',
  carved: '雕花',
  fancy: '华丽',
  dirty: '旧',
  small: '小',
  large: '大',
  round: '圆',
  square: '方',
  bed: '床',
  chair: '椅',
  stool: '凳',
  table: '桌',
  desk: '书桌',
  sofa: '沙发',
  bench: '长凳',
  cabinet: '柜',
  shelf: '架',
  shelves: '置物架',
  lamp: '灯',
  light: '灯',
  clock: '钟',
  mirror: '镜',
  vase: '花瓶',
  bowl: '碗',
  plate: '盘',
  cup: '杯',
  mug: '马克杯',
  bottle: '瓶',
  book: '书',
  books: '书',
  basket: '篮',
  barrel: '桶',
  box: '盒',
  fan: '扇',
  plant: '植物',
  plants: '植物',
  flower: '花',
  flowers: '花',
  tree: '树',
  rug: '地毯',
  pillow: '抱枕',
  curtain: '窗帘',
  door: '门',
  window: '窗',
  kitchen: '厨房',
  bathroom: '卫浴',
  toilet: '马桶',
  sink: '水槽',
  fridge: '冰箱',
  refrigerator: '冰箱',
  oven: '烤箱',
  stove: '灶台',
  microwave: '微波炉',
  toaster: '烤面包机',
  kettle: '水壶',
  pot: '锅',
  pan: '平底锅',
  knife: '刀',
  fork: '叉',
  spoon: '勺',
  television: '电视',
  tv: '电视',
  monitor: '显示器',
  computer: '电脑',
  laptop: '笔记本',
  phone: '电话',
  camera: '相机',
  radio: '收音机',
  guitar: '吉他',
  piano: '钢琴',
  chess: '象棋',
  globe: '地球仪',
  typewriter: '打字机',
  extinguisher: '灭火器',
  hammer: '锤',
  axe: '斧',
  wrench: '扳手',
  tools: '工具',
  umbrella: '伞',
  bicycle: '自行车',
  car: '车',
  elephant: '大象',
  cat: '猫',
  horse: '马',
  apple: '苹果',
  avocado: '牛油果',
  carrot: '胡萝卜',
  chocolate: '巧克力',
  croissant: '牛角包',
  cake: '蛋糕',
  coffee: '咖啡',
  food: '食物',
  decorative: '装饰',
  decoration: '装饰',
  prop: '道具',
  props: '道具',
  gallinera: '加利亚内拉', // 保留音译专有款名
}

function translateWords(rest: string): string {
  const tokens = rest.split(/\s+/).filter(Boolean)
  if (tokens.length === 0) return ''
  const out: string[] = []
  for (const raw of tokens) {
    if (/^\d+$/.test(raw)) {
      out.push(raw)
      continue
    }
    const key = raw.toLowerCase().replace(/[^a-z0-9]/g, '')
    const zh = WORDS[key]
    out.push(zh || raw)
  }
  return out.join('')
}

export function localizePolyHavenTitle(title: string): string {
  let s = String(title || '')
    .replace(/_/g, ' ')
    .trim()
  if (!s) return s
  const lower = s.toLowerCase()
  for (const { en, zh } of PHRASES) {
    const i = lower.indexOf(en)
    if (i === -1) continue
    const before = s.slice(0, i).trim()
    const after = s.slice(i + en.length).trim()
    const parts = [before ? translateWords(before) : '', zh, after ? translateWords(after) : ''].filter(Boolean)
    return parts.join('') || zh
  }
  return translateWords(s) || s
}

/** CC0 / Poly Haven 道具列表展示名 */
export function cc0PropDisplayTitle(entry: Pick<Cc0PropEntry, 'title' | 'source'>): string {
  const title = String(entry.title || '').trim()
  if (!title) return title
  if (entry.source === 'grab3d' || /[\u4e00-\u9fff]/.test(title)) return title
  return localizePolyHavenTitle(title)
}

export function cc0PropSearchHaystack(entry: Pick<Cc0PropEntry, 'title' | 'source' | 'id'>): string {
  const zh = cc0PropDisplayTitle(entry)
  return `${entry.id} ${entry.title} ${zh}`.toLowerCase()
}