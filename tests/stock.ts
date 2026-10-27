/**
 * 在线素材与音频类型单元测试：媒体类型判定、导入后类型修正、许可与署名展示。
 * 跑法：node verify-skills-unit.mjs（esbuild 打包后逐个运行）
 */
import assert from 'node:assert/strict'
import { assetMediaType, isAudioUrl, isVideoUrl, pickKind, pickTitle } from '../src/mediaPick'
import type { PickItem } from '../src/mediaPick'
import { stockLicenseLabel, stockAttributionText, stockSizeText, stockDurationText } from '../src/stock/stockFormat'
import type { StockItem, StockLicense } from '../src/stock/types'

let bad = 0
function check(name: string, fn: () => void) {
  try {
    fn()
    console.log(`✅ ${name}`)
  } catch (e) {
    bad++
    console.log(`❌ ${name}\n   ${(e as Error).message}`)
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

console.log(bad === 0 ? '\n✅ stock 单元测试全部通过' : `\n❌ ${bad} 项失败`)
if (bad) process.exit(1)
