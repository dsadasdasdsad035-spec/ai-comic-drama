export type CharacterSheet = {
  id: string
  name: string
  role: string
  /** 年龄段，project.json 里的 age 原样保留，避免回写时丢字段 */
  age?: string
  /** 该角色的默认音色（TTS voice id）。一镜多说话人时按行取这个 */
  voiceId?: string
  lookCn: string
  /** 生图锚点：英文短语，所有镜头复用同一段，保证长相一致 */
  lookEn: string
  palette: string
  keywords: string[]
  image?: string
  candidates?: string[]
  activeIdx?: number
  state?: 'idle' | 'running' | 'error'
  error?: string
}

/**
 * 三视图提示词尾巴（character-design-sheet 的参考表规范）：
 * 除了「三个角度」，还必须锁定服装/道具/比例 —— 否则三视图彼此不一致，
 * 拿去做参考图反而把错误长相带进每一镜。
 */
export const TURNAROUND_SUFFIX =
  'character turnaround sheet, three views side by side: front view, side view, back view — ' +
  'full body, standing straight, arms relaxed, plain neutral grey seamless studio background, ' +
  'flat even lighting, no dramatic shadows, identical outfit, hairstyle, accessories and body ' +
  'proportions in all views, consistent design across views, no text, no watermark'

export const defaultCharacters: CharacterSheet[] = [
  {
    id: 'chenmo',
    name: '陈默',
    role: '主角 · 义体回收人',
    lookCn: '三十出头，方下颌，寸头，胡碴未刮，精瘦；洗旧的深灰工装外套，去掉指套的手套，左手为黄铜关节外露的机械义肢。',
    lookEn:
      'Chinese man in his early 30s, square jaw, short buzz cut, faint stubble, lean weathered build, ' +
      'worn dark grey work jacket over black shirt, fingerless gloves, mechanical left hand with exposed brass joints, tired eyes',
    palette: '铁灰 + 黄铜',
    keywords: ['左手机械义肢', '寸头', '黄铜关节'],
  },
  {
    id: 'chenxi',
    name: '陈曦',
    role: '妹妹 · 塔内技术员',
    lookCn: '二十七八岁，鹅蛋脸，及肩黑发束起，清瘦；白灰相间的技术员制服，颈侧有金属接口。',
    lookEn:
      'Chinese woman in her late 20s, oval face, shoulder-length black hair tied back, slim build, ' +
      'white and grey technician uniform, metal port implant on the side of her neck, calm but guarded expression',
    palette: '冷白 + 石墨灰',
    keywords: ['颈侧接口', '束发', '技术员制服'],
  },
  {
    id: 'crow',
    name: '鸦',
    role: '引路人 · 黑雨衣女人',
    lookCn: '三十余岁，颧骨锋利，瘦高；黑色连帽雨衣常年滴水，右眼为带刻度环的机械义眼，深红围巾。',
    lookEn:
      'Chinese woman in her 30s, sharp cheekbones, tall and thin, black hooded raincoat dripping wet, ' +
      'mechanical right eye with visible aperture rings, dark red scarf, expression unreadable',
    palette: '墨黑 + 暗红',
    keywords: ['机械义眼', '连帽雨衣', '深红围巾'],
  },
]
