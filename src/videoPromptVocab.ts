/**
 * 视频提示词审计的词汇表。
 *
 * 景别与运镜**不硬编码**：从内置相机库 manifest 的 `mapsToSize` / `mapsToMove`
 * 去重派生，与项目实际用词保持一致（模型写「中近景」时必须能命中「中景」）。
 * 其余类别（天气、音效、口型、终点语义等）在规则文档里没有枚举，只能在此维护。
 *
 * 供 `promptAuditCore.mjs` 的 `auditVideoPromptCore` 通过 `vocab` 入参接收，
 * 核心本身保持纯函数、不 import 任何 JSON。
 */
import catalogJson from '../public/presets/camera-moves-whitebox-132/manifest.json'

type Catalog = {
  entries?: Array<{ mapsToMove?: string; mapsToSize?: string }>
}

function uniqueFrom(pick: (e: { mapsToMove?: string; mapsToSize?: string }) => string | undefined): string[] {
  const catalog = catalogJson as Catalog
  const out = new Set<string>()
  for (const e of catalog.entries ?? []) {
    const v = String(pick(e) ?? '').trim()
    if (v) out.add(v)
  }
  return [...out]
}

/** 景别：相机库 `mapsToSize` 枚举（大特写/远景/全景/中景/特写） */
export const SIZE_TERMS: string[] = uniqueFrom((e) => e.mapsToSize)

/** 运镜：相机库 `mapsToMove` 枚举（推/拉/摇/移/升降/跟/手持） */
export const MOVE_TERMS: string[] = uniqueFrom((e) => e.mapsToMove)

/**
 * 景别别名：模型常写复合词（中近景、中全景、大远景），
 * 命中任一枚举词即可，因此这些别名只用于「正文是否提到景别」的兜底。
 */
export const SIZE_ALIASES = ['中近景', '中全景', '大远景', '近景', '中特写', '全景镜头', '特写镜头']

/** 固定机位：`move=固定` 时正文允许的说法 */
export const STATIC_MOVE_TERMS = ['固定', '不动', '机位保持', '机位稳定', '构图不变', '静态机位', '不移动']

/** 天气与环境音事实（用于推导「本镜该不该有环境声」） */
export const WEATHER_TERMS = [
  '暴雨', '大雨', '小雨', '雨', '雷', '闪电', '雷鸣', '打雷',
  '雪', '起雾', '大雾', '雾', '风', '大风', '沙尘', '冰雹',
  '晴', '烈日', '闷热', '潮湿', '积水', '波浪', '海浪', '水声',
]

/** 环境音效（用于判定正文是否写了对应声音） */
export const SFX_TERMS = [
  '雨声', '雷声', '风声', '水声', '浪声', '蝉鸣', '鸟叫', '虫鸣',
  '汽笛', '喇叭', '车流', '引擎', '刹车', '脚步声', '敲门声', '推门声',
  '关门声', '钟声', '更鼓', '铃声', '电话铃', '杯碟', '碗筷', '翻页',
  '底噪', '嗡鸣', '空调声', '电流声', '回声', '回响', '嘈杂', '人声',
]

/** 口型与发声（有台词时必须出现） */
export const LIP_TERMS = [
  '口型', '嘴型', '唇', '张嘴', '开口', '说话', '出声', '发声', '台词',
  '细语', '低语', '喃喃', '喊', '叫', '念', '语气', '声线', '吐字', '嗫嚅',
]

/** 终点语义（结尾衔接检查的锚点） */
export const ENDING_TERMS = [
  '定格', '停在', '最终', '最后', '落定', '收在', '保持',
  '停住', '顿住', '僵住', '静止', '结束在', '定格在', '末了', '收束',
]

/** 打戏事实（用于判定是否该分回合） */
export const FIGHT_TERMS = [
  '打', '拳', '踢', '劈', '抡', '刺', '刀', '剑', '棍', '掌',
  '擒拿', '格挡', '出招', '交手', '厮打', '扭打', '搏斗', '疾冲', '撞击',
]

/** 画面文字风险物（用于判定是否需要防乱码说明） */
export const TEXT_RISK_TERMS = [
  '招牌', '牌子', '路牌', '横幅', '标语', '字幕', '屏幕', '手机屏',
  '电脑屏', '电视', '纸页', '信纸', '文件', '书页', '账本', '合同',
  '报纸', '海报', '菜单', '标签', '便签', '名片',
]

/** AI 高损耗动作（提示改写或构图化解） */
export const RISKY_ACTION_TERMS = [
  '手指', '指尖', '穿针', '拧', '旋开', '镜面', '镜像', '倒影',
  '争抢', '抢夺', '夺', '半空', '心里', '暗自', '没有去', '差点',
]

/** 占位套话：出现在正文里说明这一句等于没写 */
export const PLACEHOLDER_TERMS = [
  '与动作结束状态一致', '待补充', '待完善', '待定', 'TBD', 'TODO',
  '同上', '略', '此处省略', '自行补充', '按需填写', 'xxx', 'XXX',
]

/** 参考说明类词：挂了参考图时正文应有这类指向 */
export const REF_DESCRIBE_TERMS = [
  '参考', '依照', '沿用', '保持一致', '参照', '承接',
  '延续', '继承', '沿用前', '与图', '如图', '同前', '维持',
]

/** 供审计核心一次性取用的词汇包 */
export type AuditVocab = {
  size: string[]
  sizeAlias: string[]
  move: string[]
  staticMove: string[]
  weather: string[]
  sfx: string[]
  lip: string[]
  ending: string[]
  fight: string[]
  textRisk: string[]
  riskyAction: string[]
  placeholder: string[]
  refDescribe: string[]
}

export const AUDIT_VOCAB: AuditVocab = {
  size: SIZE_TERMS,
  sizeAlias: SIZE_ALIASES,
  move: MOVE_TERMS,
  staticMove: STATIC_MOVE_TERMS,
  weather: WEATHER_TERMS,
  sfx: SFX_TERMS,
  lip: LIP_TERMS,
  ending: ENDING_TERMS,
  fight: FIGHT_TERMS,
  textRisk: TEXT_RISK_TERMS,
  riskyAction: RISKY_ACTION_TERMS,
  placeholder: PLACEHOLDER_TERMS,
  refDescribe: REF_DESCRIBE_TERMS,
}
