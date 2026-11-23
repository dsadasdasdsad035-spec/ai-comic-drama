/**
 * 提示词分类词表与分面推导的回归。
 *
 * 只跑纯函数：不连库、不起服务、不花额度。数据库与接口的行为在
 * `verify-prompt-cases.mjs --facets` 里验。
 *
 * 跑法：node verify-prompt-cases-taxonomy.mjs
 */
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = path.dirname(fileURLToPath(import.meta.url))
const TAXONOMY_FILE = path.join(ROOT, 'public/presets/prompt-taxonomy/v1.json')

let bad = 0
let pass = 0
const check = (name, cond, extra = '') => {
  console.log(`${cond ? '✅' : '❌'} ${name}${extra ? ` | ${extra}` : ''}`)
  if (cond) pass += 1
  else bad += 1
}

const {
  loadTaxonomy,
  buildTaxonomyFromDoc,
  clearTaxonomyCache,
  normalizeFacetValue,
  validateFacetPairs,
  groupFacetPairs,
  mapSourceCategories,
  mapReverseKind,
  deriveFacets,
  listTaxonomy,
} = await import('./server/prompt-taxonomy.mjs')

const raw = JSON.parse(fs.readFileSync(TAXONOMY_FILE, 'utf8'))
const tax = loadTaxonomy(ROOT)

// ---------------------------------------------------------------- 词表结构

console.log('\n=== 词表结构 ===')
check('轴数为 18', tax.axes.length === 18, String(tax.axes.length))
check(
  '每轴至少 8 个值',
  tax.axes.every((a) => a.values.length >= 8),
  tax.axes.filter((a) => a.values.length < 8).map((a) => a.id).join(','),
)
check(
  '轴 id 无重复',
  new Set(tax.axes.map((a) => a.id)).size === tax.axes.length,
)
check(
  '值 id 轴内唯一',
  tax.axes.every((a) => new Set(a.values.map((v) => v.id)).size === a.values.length),
)
check('词表带版本号', Boolean(tax.version), tax.version)
check(
  'listTaxonomy 返回 18 轴且值带中英标签',
  listTaxonomy(tax).axes.length === 18 &&
    listTaxonomy(tax).axes.every((a) => a.values.every((v) => v.cn && v.en && v.token)),
)

// 词表里内置运镜库的枚举必须都能解析回轴值，否则画布与案例库用词会分叉
console.log('\n=== 与运镜库对齐 ===')
const manifest = JSON.parse(
  fs.readFileSync(path.join(ROOT, 'public/presets/camera-moves-whitebox-132/manifest.json'), 'utf8'),
)
const sizes = [...new Set(manifest.entries.map((e) => e.mapsToSize).filter(Boolean))]
const moves = [...new Set(manifest.entries.map((e) => e.mapsToMove).filter(Boolean))]
check(
  `景别 ${sizes.length} 个别名全部可解析`,
  sizes.every((s) => normalizeFacetValue(tax, 'shot-size', s)),
  sizes.filter((s) => !normalizeFacetValue(tax, 'shot-size', s)).join(','),
)
check(
  `运镜 ${moves.length} 个别名全部可解析`,
  moves.every((m) => normalizeFacetValue(tax, 'camera-move', m)),
  moves.filter((m) => !normalizeFacetValue(tax, 'camera-move', m)).join(','),
)
check('景别别名解析到唯一主值', normalizeFacetValue(tax, 'shot-size', '中景') === 'medium')
check('运镜别名解析到唯一主值', normalizeFacetValue(tax, 'camera-move', '推') === 'push-in')
check('未知值解析为空', normalizeFacetValue(tax, 'shot-size', '不存在的景别') === '')
check('未知轴解析为空', normalizeFacetValue(tax, 'no-such-axis', '中景') === '')

// ---------------------------------------------------------------- 校验

console.log('\n=== 词表校验 ===')
const conflictDoc = JSON.parse(JSON.stringify(raw))
conflictDoc.axes[0].values[1].aliases = [...(conflictDoc.axes[0].values[1].aliases || []), raw.axes[0].values[0].cn]
let conflictMessage = ''
try {
  buildTaxonomyFromDoc(conflictDoc)
} catch (e) {
  conflictMessage = e.message
}
check('重复别名被拒绝并指出冲突项', /别名冲突/.test(conflictMessage), conflictMessage.split('\n')[1] || '未抛错')

const badTargetDoc = JSON.parse(JSON.stringify(raw))
badTargetDoc.kindMappings.live_action = 'style-medium:no-such-value'
let badTargetMessage = ''
try {
  buildTaxonomyFromDoc(badTargetDoc)
} catch (e) {
  badTargetMessage = e.message
}
check('映射目标缺失被拒绝', /不存在的值/.test(badTargetMessage), badTargetMessage.split('\n')[1] || '未抛错')

const missingFile = '/tmp/definitely-no-taxonomy-root'
let fallback = null
let missingMessage = ''
clearTaxonomyCache()
try {
  fallback = loadTaxonomy(missingFile)
} catch (e) {
  missingMessage = e.message
}
check(
  'appRoot 下没有词表时回落到随包词表',
  !missingMessage && fallback?.axes.length === 18,
  missingMessage,
)

// ---------------------------------------------------------------- 分面参数

console.log('\n=== 分面参数 ===')
const pairs = validateFacetPairs(tax, ['genre:cyberpunk', 'lighting:neon', 'genre:赛博朋克', 'genre:没有这个', 'bad:x', ''])
check('合法项被归一', pairs.valid.length === 2 && pairs.valid.some((p) => p.axis === 'lighting' && p.value === 'neon'))
check('同轴同值去重', pairs.valid.filter((p) => p.axis === 'genre').length === 1)
check('非法值进入 invalid 并说明原因', pairs.invalid.length === 2 && pairs.invalid.every((p) => p.reason))
const grouped = groupFacetPairs(validateFacetPairs(tax, ['genre:cyberpunk', 'genre:action', 'lighting:neon']).valid)
check(
  '按轴分组',
  grouped.length === 2 && grouped.find((g) => g.axis === 'genre').values.length === 2,
)

// ---------------------------------------------------------------- 推导

console.log('\n=== 规则推导 ===')
const sample = deriveFacets(tax, {
  source: 'manual',
  title: '雨夜巷口',
  prompt: '中景，女子在雨中的巷口回头，缓慢推镜，霓虹招牌反光',
})
const has = (axis, value) => sample.some((f) => f.axis === axis && f.value === value)
check('景别名推出景别', has('shot-size', 'medium'), JSON.stringify(sample.filter((f) => f.axis === 'shot-size')))
check('运镜词推出运镜', has('camera-move', 'push-in'))
check('环境词推出环境', has('environment', 'alley'))
check('道具词推出天气', has('props-fx', 'rain'))
check('光线词推出霓虹', has('lighting', 'neon'))

const exact = deriveFacets(tax, {
  source: 'manual',
  title: '雨中巷口',
  prompt: '女子中景回头，缓慢推镜',
})
const exactHas = (axis, value) => exact.some((f) => f.axis === axis && f.value === value)
check(
  'fixture「雨中巷口，女子中景回头，缓慢推镜」推导齐全',
  exactHas('environment', 'alley') && exactHas('shot-size', 'medium') && exactHas('camera-move', 'push-in'),
  JSON.stringify(exact.map((f) => `${f.axis}:${f.value}`)),
)

const twice = deriveFacets(tax, {
  source: 'manual',
  title: '雨夜巷口',
  prompt: '中景，女子在雨中的巷口回头，缓慢推镜，霓虹招牌反光',
})
check('同输入推导两次完全一致', JSON.stringify(sample) === JSON.stringify(twice))

// 短别名误命中：这些句子曾经把「走」推进「走廊」、「火」推进「火车」
const fp1 = deriveFacets(tax, { source: 'manual', title: '', prompt: '走廊尽头的空镜，无人物' })
check(
  '构词不触发单字别名 | 走廊 ≠ 走',
  !fp1.some((f) => f.axis === 'action' && f.value === 'walk'),
  JSON.stringify(fp1.map((f) => `${f.axis}:${f.value}`)),
)
const fp2 = deriveFacets(tax, { source: 'manual', title: '', prompt: '火车穿过隧道' })
check(
  '构词不触发单字别名 | 火车 ≠ 火',
  !fp2.some((f) => f.axis === 'props-fx' && f.value === 'fire'),
  JSON.stringify(fp2.map((f) => `${f.axis}:${f.value}`)),
)
const fp3 = deriveFacets(tax, { source: 'manual', title: '', prompt: '书架前的中景' })
check(
  '构词不触发单字别名 | 书架 ≠ 书',
  !fp3.some((f) => f.axis === 'props-fx' && f.value === 'book'),
  JSON.stringify(fp3.map((f) => `${f.axis}:${f.value}`)),
)

// 长别名仍要能命中，否则过滤就是漏推
const stillOk = deriveFacets(tax, { source: 'manual', title: '', prompt: '雨中少女回眸，中景，缓慢推镜' })
const stillHas = (axis, value) => stillOk.some((f) => f.axis === axis && f.value === value)
check(
  '补的构词别名可推导 | 雨中 → rain',
  stillHas('props-fx', 'rain'),
  JSON.stringify(stillOk.map((f) => `${f.axis}:${f.value}`)),
)
check('单字过滤后长别名照常推导', stillHas('shot-size', 'medium') && stillHas('camera-move', 'push-in'))

// 同轴长短词：只留最长，不重复推两个值
const nested = deriveFacets(tax, { source: 'manual', title: '', prompt: '大特写眼睛' })
check(
  '同轴最长别名优先 | 大特写不重复推特写',
  nested.filter((f) => f.axis === 'shot-size').length === 1 &&
    nested.some((f) => f.axis === 'shot-size' && f.value === 'extreme-close-up'),
  JSON.stringify(nested.filter((f) => f.axis === 'shot-size')),
)

// 跨轴同名：两个轴都要有，不能被位置占位抢掉一个
const cross = deriveFacets(tax, { source: 'manual', title: '', prompt: '一镜到底的长镜头' })
const crossAxes = new Set(cross.map((f) => f.axis))
check(
  '跨轴同名两边都生成 | 一镜到底',
  crossAxes.has('narrative') && crossAxes.has('editing'),
  JSON.stringify(cross.map((f) => `${f.axis}:${f.value}`)),
)

const many = deriveFacets(tax, {
  source: 'manual',
  title: '动作 冒险 喜剧 犯罪 黑帮 剧情 恐怖 科幻 战争 西部 奇幻 爱情',
  prompt: '动作片与冒险片，带喜剧与犯罪元素，黑帮剧情，恐怖科幻战争西部奇幻爱情',
})
check(
  '题材轴上限为 8',
  many.filter((f) => f.axis === 'genre').length === 8,
  String(many.filter((f) => f.axis === 'genre').length),
)

const reserved = deriveFacets(
  tax,
  { source: 'manual', title: '中景 推镜' },
  { reservedAxes: new Set(['shot-size']) },
)
check('已锁定的轴不再推导', !reserved.some((f) => f.axis === 'shot-size'))

const fromField = deriveFacets(tax, { source: 'manual', size: '全景', move: '跟' })
check(
  '字段枚举优先于文本',
  fromField.some((f) => f.axis === 'shot-size' && f.value === 'wide') &&
    fromField.some((f) => f.axis === 'camera-move' && f.value === 'follow'),
)

const mapped = deriveFacets(tax, { source: 'vflow', categories: ['cyberpunk', 'sports'] })
check(
  '外部分类映射到分面',
  mapped.some((f) => f.axis === 'genre' && f.value === 'cyberpunk') &&
    mapped.some((f) => f.axis === 'style-medium' && f.value === 'cyberpunk-style'),
)

const unmapped = deriveFacets(tax, { source: 'vflow', categories: ['neon-dreamcore'] })
check(
  '无法映射的分类保留为未映射',
  unmapped.some((f) => f.unmapped && f.raw === 'neon-dreamcore'),
  JSON.stringify(unmapped),
)
check(
  '映射表里没有的来源分类不报错',
  mapSourceCategories(tax, 'vflow', ['unknown-x']).unmapped.length === 1,
)

console.log('\n=== 制作方式映射 ===')
const kinds = Object.keys(raw.kindMappings)
check(
  `${kinds.length} 个制作方式全部可映射`,
  kinds.every((k) => {
    const m = mapReverseKind(tax, k)
    return m && m.axis === 'style-medium'
  }),
  kinds.filter((k) => !mapReverseKind(tax, k)).join(','),
)
const reverseCase = deriveFacets(tax, {
  source: 'reverse-own',
  title: '手作定格',
  shots: [{ kind: 'stop_motion' }, { kind: 'anim_2d' }],
})
check(
  '反推逐镜制作方式写入风格轴',
  reverseCase.some((f) => f.value === 'stop-motion-puppet') &&
    reverseCase.some((f) => f.value === 'anime-2d'),
)

console.log(`\n汇总：通过 ${pass}；失败 ${bad}；跳过 0`)
process.exitCode = bad ? 1 : 0
