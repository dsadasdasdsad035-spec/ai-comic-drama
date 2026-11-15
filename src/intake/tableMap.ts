/**
 * 表格表头 → 镜头字段的映射。
 *
 * 别名表按真实资料包校准（github.com/dsadasdasdsad035-spec/cat）：
 * 真实表头是「镜头 / 时间 / 景别/机位 / 画面与动作 / 台词/声音 / 制作方式」，
 * 不是我们内部字段名。所以这里既收内部叫法，也收真实文档里的写法。
 */

/** 内部字段名；order 用于给「未识别列」排错时的展示顺序 */
export type ShotColumn =
  | 'no'
  | 'scene_no'
  | 'seconds'
  | 'size'
  | 'move'
  | 'desc'
  | 'dialogue'
  | 'keyframe_prompt'
  | 'video_prompt'
  | 'cast'
  | 'performance'
  | 'lexicon_ref_key'
  | 'reference'

/** 表头别名：键是归一化后的表头文本 */
const ALIASES: Record<ShotColumn, string[]> = {
  no: ['镜头', '镜号', '镜头号', '编号', '序号', 'no', 'shot', 'shotno', 'shotnumber', 'number'],
  // 场次不是镜头的文字字段，但它是把镜头放回正确场次的唯一线索，必须认出来
  scene_no: ['场次', '场次号', '场景', '场景号', '第几场', 'scene', 'scene no', 'scene number', 'sceneno'],
  seconds: ['秒', '时间', '时长', '秒数', 'duration', 'seconds', 'time', 'length'],
  size: ['景别', '景别机位', '景别与机位', '景别镜头', 'shot size', 'size', 'framing'],
  move: ['运镜', '运动', '镜头运动', 'camera', 'movement', 'move', 'camera move'],
  desc: [
    '描述',
    '画面',
    '画面与动作',
    '画面描述',
    '内容',
    '动作',
    'description',
    'desc',
    'action',
    'visual',
  ],
  dialogue: [
    '台词',
    '台词声音',
    '台词与声音',
    '旁白声音',
    '对白',
    '声音',
    'audio',
    'dialogue',
    'line',
    'sound',
  ],
  keyframe_prompt: ['首帧', '首帧提示词', '画面提示词', '图像提示词', 'keyframe', 'keyframe prompt', 'image prompt', 'prompt'],
  video_prompt: ['视频', '视频提示词', '视频指令', '运动提示词', 'video', 'video prompt', 'motion prompt'],
  // 选角：出场角色名单。不收「人物」这类泛称，避免把角色档案表当成分镜表
  cast: ['选角', '出场角色', '出场人物', '本镜角色', 'cast', 'characters'],
  performance: ['表演', '表演设计', '表演描述', '表演与情绪', 'performance', 'acting'],
  // 运镜参照：只认绑定条目，不从「运镜」列反推
  lexicon_ref_key: ['运镜参照', '镜头语言', '镜头语言参照', '运镜条目', 'lexicon', 'camera lexicon', 'lexicon ref'],
  // 参考：角色与素材的可读名字，导入时再解析成节点 id
  reference: ['参考', '参考素材', '素材参考', '角色参考', '参考资料', '关联素材', 'reference', 'references', 'refs'],
}

/** 归一化表头：去空白、去 `#`/`*`/反引号、转小写、全角斜杠统一 */
export function normalizeHeader(raw: string): string {
  return String(raw ?? '')
    .replace(/[`*#]/g, '')
    .replace(/[／]/g, '/')
    .replace(/\s+/g, ' ')
    .trim()
    .toLowerCase()
}

function aliasMap(): Map<string, ShotColumn> {
  const m = new Map<string, ShotColumn>()
  for (const [col, names] of Object.entries(ALIASES) as [ShotColumn, string[]][]) {
    for (const n of names) m.set(normalizeHeader(n), col)
  }
  return m
}

const LOOKUP = aliasMap()

/** 单个表头能识别成哪个字段；认不出返回 null */
export function columnOf(header: string): ShotColumn | null {
  const n = normalizeHeader(header)
  if (!n) return null
  const direct = LOOKUP.get(n)
  if (direct) return direct
  // 「景别/机位」这类复合表头：按 / 切开任一命中即算
  for (const part of n.split('/').map((s) => s.trim()).filter(Boolean)) {
    const hit = LOOKUP.get(part)
    if (hit) return hit
  }
  return null
}

export type TableHeaderMap = {
  /** 列下标 → 字段 */
  columns: Map<number, ShotColumn>
  /** 有镜号列才能导入 */
  hasShotNo: boolean
  /** 表头里没有对应字段、会被忽略的列名 */
  ignored: string[]
  /** 同一字段被多列命中时，只取第一列，其余进冲突列表 */
  duplicated: { column: ShotColumn; headers: string[] }[]
}

/** 解析表头行，返回列映射与忽略清单 */
export function mapHeaders(headers: string[]): TableHeaderMap {
  const columns = new Map<number, ShotColumn>()
  const seen = new Map<ShotColumn, number[]>()
  const ignored: string[] = []

  headers.forEach((h, i) => {
    const col = columnOf(h)
    if (!col) {
      if (String(h ?? '').trim()) ignored.push(String(h).trim())
      return
    }
    const prev = seen.get(col)
    if (prev) {
      prev.push(i)
      return
    }
    seen.set(col, [i])
    columns.set(i, col)
  })

  const duplicated: { column: ShotColumn; headers: string[] }[] = []
  for (const [col, idxs] of seen) {
    if (idxs.length > 1) duplicated.push({ column: col, headers: idxs.map((i) => headers[i]) })
  }

  return {
    columns,
    hasShotNo: [...columns.values()].includes('no'),
    ignored,
    duplicated,
  }
}
