/**
 * 在线素材与音频类型单元测试：媒体类型判定、导入后类型修正、许可与署名展示。
 * 跑法：node verify-skills-unit.mjs（esbuild 打包后逐个运行）
 */
import assert from 'node:assert/strict'
import fs from 'node:fs'
import { assetMediaType, isAudioUrl, isVideoUrl, pickKind, pickTitle } from '../src/mediaPick'
import type { PickItem } from '../src/mediaPick'
import { stockLicenseLabel, stockAttributionText, stockSizeText, stockDurationText } from '../src/stock/stockFormat'
import type { StockItem, StockLicense } from '../src/stock/types'
import {
  detectCjk,
  lookupGlossary,
  sanitizeTranslated,
  translateQuery,
} from '../server/stock-query.mjs'
import {
  mixkitPageShape,
  parseMixkitDetail,
  parseMixkitMaxPage,
  parseMixkitSearch,
  toSlug,
  vjshiSearchTemplate,
  vjshiSearchUrl,
} from '../server/stock-parse.mjs'

let bad = 0
/** 同时接受「断言函数」与「布尔结果 + 附加信息」两种写法 */
function check(name: string, arg: (() => void) | boolean, extra = '') {
  try {
    if (typeof arg === 'function') arg()
    else assert.ok(arg, extra || '断言不成立')
    console.log(`✅ ${name}`)
  } catch (e) {
    bad++
    console.log(`❌ ${name}\n   ${(e as Error).message}${extra ? `\n   ${extra}` : ''}`)
  }
}

check('mp3 判为音频', () => assert.equal(assetMediaType('image', '/project-assets/a/x.mp3'), 'audio'))
check('wav 判为音频', () => assert.equal(assetMediaType('image', 'https://x/y.wav?t=1'), 'audio'))
check('ogg 判为音频', () => assert.equal(assetMediaType('image', 'x.ogg'), 'audio'))
check('flac 判为音频', () => assert.equal(assetMediaType('image', 'x.flac'), 'audio'))
check('audio kind 即使扩展名不认识也是音频', () => assert.equal(assetMediaType('audio', 'x.bin'), 'audio'))
check('mp4 判为视频', () => assert.equal(assetMediaType('image', 'x.mp4'), 'video'))
check('video kind 优先于扩展名', () => assert.equal(assetMediaType('video', 'x.jpg'), 'video'))
check('普通图判为图片', () => assert.equal(assetMediaType('image', '/generated/a.png'), 'image'))
check('场景卡是图片', () => assert.equal(assetMediaType('scene', '/a.png'), 'image'))
check('isAudioUrl/isVideoUrl 互斥', () => {
  assert.equal(isAudioUrl('a.mp3'), true)
  assert.equal(isAudioUrl('a.mp4'), false)
  assert.equal(isVideoUrl('a.mp4'), true)
  assert.equal(isVideoUrl('a.mp3'), false)
})

const item = (over: Partial<PickItem> = {}): PickItem => ({
  key: 'k',
  source: 'stock',
  kind: 'image',
  mediaType: 'image',
  title: '在线图片',
  url: '/project-assets/p/stock-pexels-1.jpg',
  ...over,
})

check('音频导入改为 audio', () => assert.equal(pickKind(item({ mediaType: 'audio' }), 'scene'), 'audio'))
check('视频导入改为 video', () => assert.equal(pickKind(item({ mediaType: 'video' }), 'image'), 'video'))
check('场景卡换普通图保留场景', () => assert.equal(pickKind(item(), 'scene'), 'scene'))
check('道具卡换普通图保留道具', () => assert.equal(pickKind(item(), 'prop'), 'prop'))
check('普通卡换普通图回落 image', () => assert.equal(pickKind(item(), 'image'), 'image'))
check('项目素材沿用自身类型', () =>
  assert.equal(pickKind(item({ source: 'asset', kind: 'prop' }), 'image'), 'prop'))
check('手改标题不被覆盖', () => assert.equal(pickTitle(item(), '我的标题'), '我的标题'))
check('默认标题可被替换', () => assert.equal(pickTitle(item(), '新素材'), '在线图片'))
check('空标题填入素材标题', () => assert.equal(pickTitle(item(), ''), '在线图片'))

const license = (over: Partial<StockLicense> = {}): StockLicense => ({
  name: 'CC BY 4.0',
  url: 'https://creativecommons.org/licenses/by/4.0/',
  attribution: '“Ada” · CC BY 4.0 · Openverse 图片',
  requiresAttribution: true,
  ...over,
})

check('许可标签显示名称', () => assert.equal(stockLicenseLabel(license()), 'CC BY 4.0'))
check('免署名许可标注', () =>
  assert.equal(stockLicenseLabel(license({ name: 'Pexels License', requiresAttribution: false })), 'Pexels License'))
check('缺许可名时回落', () => assert.equal(stockLicenseLabel(null), '未标注许可'))
check('署名文本用于可复制内容', () =>
  assert.equal(stockAttributionText(license()), '“Ada” · CC BY 4.0 · Openverse 图片'))
check('无作者时署名文本仍可用', () =>
  assert.equal(
    stockAttributionText(license({ attribution: '' }), { author: '', source: 'Openverse' }),
    '原作者未署名 · CC BY 4.0 · Openverse',
  ))

check('尺寸格式化', () => assert.equal(stockSizeText({ width: 1920, height: 1080 }), '1920 × 1080'))
check('缺尺寸显示占位', () => assert.equal(stockSizeText({}), '—'))
check('时长格式化', () => assert.equal(stockDurationText(45), '0:45'))
check('时长跨分钟', () => assert.equal(stockDurationText(95.4), '1:35'))
check('缺时长显示占位', () => assert.equal(stockDurationText(undefined), '—'))

const itemShape = (over: Partial<StockItem> = {}): StockItem => ({
  provider: 'pexels',
  itemId: '1',
  mediaType: 'image',
  title: 't',
  author: 'a',
  authorUrl: '',
  sourceUrl: '',
  license: license(),
  thumbnailUrl: '',
  previewUrl: '',
  variants: [],
  token: 'stk_x',
  ...over,
})
check('结果类型可携带三态媒体', () => {
  assert.equal(itemShape({ mediaType: 'audio' }).mediaType, 'audio')
  assert.equal(itemShape({ mediaType: 'video' }).mediaType, 'video')
})

// ---------------------------------------------------------------- 中文关键词翻译

check('CJK 检测：中文为真', () => assert.equal(detectCjk('中国长城'), true))
check('CJK 检测：中英混排为真', () => assert.equal(detectCjk('rain 雨夜'), true))
check('CJK 检测：纯英文为假', () => assert.equal(detectCjk('rainy night street'), false))
check('CJK 检测：空串为假', () => assert.equal(detectCjk(''), false))

check('术语表命中单字词', () => assert.equal(lookupGlossary('雪'), 'snow'))
check('术语表忽略空白与标点', () => assert.equal(lookupGlossary(' 雨 夜 '), 'rainy night'))
check('术语表未命中返回空串', () => assert.equal(lookupGlossary('量子纠缠'), ''))

check('模型输出容忍 JSON', () => assert.equal(sanitizeTranslated('{"en":"neon city"}'), 'neon city'))
check('模型输出去引号与句号', () => assert.equal(sanitizeTranslated('"Neon City."'), 'neon city'))
check('模型输出含中文视为失败', () => assert.equal(sanitizeTranslated('霓虹城市'), ''))

const noNeed = await translateQuery({ text: 'rainy night' })
check('英文关键词不翻译', noNeed.via === 'none' && noNeed.query === 'rainy night' && !noNeed.failed)

const byGlossary = await translateQuery({ text: '长城' })
check(
  '术语表优先于模型',
  byGlossary.via === 'glossary' &&
    byGlossary.query === 'great wall of china' &&
    byGlossary.translated?.from === '长城',
  JSON.stringify(byGlossary),
)

const byModel = await translateQuery({ text: '量子纠缠', chat: async () => 'quantum entanglement' })
check(
  '模型翻译成功',
  byModel.via === 'model' && byModel.query === 'quantum entanglement' && byModel.translated?.via === 'model',
  JSON.stringify(byModel),
)

const modelTimeout = await translateQuery({
  text: '量子纠缠',
  chat: () => new Promise((r) => setTimeout(() => r('too late'), 200)),
  timeoutMs: 30,
})
check(
  '模型超时降级为原词并标记失败',
  modelTimeout.via === 'none' && modelTimeout.query === '量子纠缠' && modelTimeout.failed === true,
  JSON.stringify(modelTimeout),
)

const modelBroken = await translateQuery({ text: '量子纠缠', chat: async () => '量子纠缠' })
check('模型不按要求翻译也降级', modelBroken.failed === true && modelBroken.via === 'none')

// ---------------------------------------------------------------- 外链来源

check(
  '外链地址带编码关键词',
  vjshiSearchUrl('中国 长城', 'https://www.vjshi.com/') ===
    'https://www.vjshi.com/so?wd=%E4%B8%AD%E5%9B%BD%20%E9%95%BF%E5%9F%8E',
  vjshiSearchUrl('中国 长城'),
)
check('外链无词回首页', vjshiSearchUrl('') === 'https://www.vjshi.com/so')
check(
  '外链模板保留占位符原文',
  vjshiSearchTemplate('https://www.vjshi.com') === 'https://www.vjshi.com/so?wd={query}',
  vjshiSearchTemplate('https://www.vjshi.com'),
)

// ---------------------------------------------------------------- Mixkit 解析

check('slug 只留 ASCII', () => assert.equal(toSlug('Great Wall of China'), 'great-wall-of-china'))
check('slug 空输入为空', () => assert.equal(toSlug(' 中国 '), ''))

const searchHtml = fs.readFileSync('tests/fixtures/mixkit-search.html', 'utf8')
const mixkitItems = parseMixkitSearch(searchHtml)
check('fixture 解析出 24 条', mixkitItems.length === 24, `count=${mixkitItems.length}`)
check(
  '首条 id 与标题快照',
  mixkitItems[0]?.id === '25375' && mixkitItems[0]?.title === 'Soft rain and sun shine',
  JSON.stringify(mixkitItems[0]),
)
check(
  '首条带详情页与 360 预览',
  mixkitItems[0]?.detailPath === '/free-stock-video/soft-rain-and-sun-shine-25375/' &&
    mixkitItems[0]?.previewUrl === 'https://assets.mixkit.co/videos/25375/25375-360.mp4' &&
    mixkitItems[0]?.height === 360,
  JSON.stringify(mixkitItems[0]),
)
check('解析出 4K 标记', mixkitItems.some((x) => x.has4k))
check('fixture 分页上限封顶 3', parseMixkitMaxPage(searchHtml) === 3)
check('有条目页形态为 grid', mixkitPageShape(searchHtml) === 'grid')
check('无结果页形态为 empty', mixkitPageShape('<html><body><h2>No results</h2></body></html>') === 'empty')
check('缺容器页形态为 unknown', mixkitPageShape('<html><body><div id="app"></div></body></html>') === 'unknown')

const detailHtml = fs.readFileSync('tests/fixtures/mixkit-detail.html', 'utf8')
const detail = parseMixkitDetail(detailHtml)
check(
  '详情页取 720 直链与时长',
  detail?.contentUrl === 'https://assets.mixkit.co/videos/23662/23662-720.mp4' && detail?.duration === 23,
  JSON.stringify(detail),
)
check('详情页带许可与作者', detail?.license === 'Mixkit Restricted License' && detail?.author === 'FrameStock')
check('详情页无 VideoObject 返回 null', parseMixkitDetail('<html><body>nope</body></html>') === null)

console.log(bad === 0 ? '\n✅ stock 单元测试全部通过' : `\n❌ ${bad} 项失败`)
if (bad) process.exit(1)
