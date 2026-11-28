/**
 * 素材卡合并的单元测试（画布身份部分）。
 *
 * 跑法：`node --test tests/asset-cards.ts`
 * 只依赖 `src/assetCards.ts`，它的唯一 import 是 `import type`，运行时被剥离。
 */
import test from 'node:test'
import assert from 'node:assert/strict'

import { assetCardKey, mergeAssetCards } from '../src/assetCards.ts'
import type { ProjectAsset } from '../src/api'

const card = (over: Partial<ProjectAsset> = {}): ProjectAsset => ({
  kind: 'image',
  title: '雨夜巷口',
  url: '/project-assets/demo/a.png',
  ...over,
})

test('不带 canvasId 的更新不会清掉已有值', () => {
  const existing = [card({ canvasId: 'cid-1' })]
  const { next, updated } = mergeAssetCards(existing, [card({ url: '/project-assets/demo/b.png' })])
  assert.equal(next.length, 1)
  assert.equal(next[0].canvasId, 'cid-1')
  assert.equal(next[0].url, '/project-assets/demo/b.png')
  assert.equal(updated.length, 1)
})

test('显式传 undefined 也不会清掉已有值', () => {
  const existing = [card({ canvasId: 'cid-1' })]
  const { next } = mergeAssetCards(existing, [card({ canvasId: undefined })])
  assert.equal(next[0].canvasId, 'cid-1')
})

test('新增卡可携带 canvasId，且会去掉首尾空白', () => {
  const { next, added } = mergeAssetCards([], [card({ title: '新卡', canvasId: '  cid-new  ' })])
  assert.equal(next.length, 1)
  assert.equal(next[0].canvasId, 'cid-new')
  assert.equal(added.length, 1)
  assert.equal(added[0].canvasId, 'cid-new')
})

test('新增卡没有 canvasId 时不留空字符串字段', () => {
  const { next } = mergeAssetCards([], [card({ title: '裸卡' })])
  assert.equal('canvasId' in next[0], false)
})

test('音乐卡 kind 与附属字段合并保留', () => {
  const existing = [
    card({
      kind: 'music',
      title: '配乐',
      url: '/generated/p/a.mp3',
      musicLength: 30,
      musicLyrics: '副歌',
      sourceShotIds: ['shot-1'],
      promptSource: 'dialogue',
    }),
  ]
  const { next } = mergeAssetCards(existing, [
    card({ kind: 'music', title: '配乐', url: '/generated/p/a.mp3', prompt: '紧张弦乐' }),
  ])
  assert.equal(next[0].kind, 'music')
  assert.equal(next[0].musicLength, 30)
  assert.equal(next[0].musicLyrics, '副歌')
  assert.deepEqual(next[0].sourceShotIds, ['shot-1'])
  assert.equal(next[0].prompt, '紧张弦乐')
})

test('更新载荷带了新 canvasId 时以载荷为准', () => {
  const existing = [card({ canvasId: 'cid-old' })]
  const { next } = mergeAssetCards(existing, [card({ canvasId: 'cid-migrated' })])
  assert.equal(next[0].canvasId, 'cid-migrated')
})

test('按 designId 命中的两张卡各自保住 canvasId', () => {
  const existing = [
    card({ kind: 'scene', title: '街口', designId: 'd-1', canvasId: 'cid-d1' }),
    card({ kind: 'prop', title: '旧伞', designId: 'd-2', canvasId: 'cid-d2' }),
  ]
  const { next } = mergeAssetCards(existing, [
    card({ kind: 'scene', title: '街口（改名）', designId: 'd-1' }),
    card({ kind: 'prop', title: '旧伞', designId: 'd-2' }),
  ])
  assert.deepEqual(
    next.map((a) => a.canvasId),
    ['cid-d1', 'cid-d2'],
  )
  // 判定键不受标题改名影响
  assert.equal(assetCardKey(next[0]), 'design:d-1')
})

test('其余字段仍按既有语义合并：没提到的保持原样', () => {
  const existing = [card({ canvasId: 'cid-1', note: '保留我', tags: ['雨'] })]
  const { next } = mergeAssetCards(existing, [card({ url: '/project-assets/demo/b.png' })])
  assert.equal(next[0].note, '保留我')
  assert.deepEqual(next[0].tags, ['雨'])
  assert.equal(next[0].url, '/project-assets/demo/b.png')
  assert.equal(next[0].canvasId, 'cid-1')
})
