/**
 * 画布几何存取层的单元测试。
 *
 * 直接跑 TS：`node --test tests/canvas-layout-store.ts`
 * （Node 22 原生剥离类型；因此被测模块不能有运行时 import，
 *  否则解析不到 `./xxx` 这类无扩展名路径。）
 */
import test from 'node:test'
import assert from 'node:assert/strict'

import {
  applyLayout,
  assetKey,
  assetNodeId,
  canvasIdFromNodeId,
  diffLayout,
  layoutSnapshot,
  nodeKeyOf,
  planLegacyCanvasMigration,
  shotKey,
} from '../src/canvasLayoutStore.ts'

const shotNode = (id: string, shotId: string, x = 0, y = 0) => ({
  id,
  type: 'shot',
  position: { x, y },
  data: { shotId },
})

const assetNode = (canvasId: string, x = 0, y = 0) => ({
  id: assetNodeId(canvasId),
  type: 'asset',
  position: { x, y },
  data: { title: '参考图' },
})

test('key 形态只有两种', () => {
  assert.equal(shotKey('E01-S03'), 'shot:E01-S03')
  assert.equal(shotKey('  E01-S03 '), 'shot:E01-S03')
  assert.equal(shotKey(''), '')
  assert.equal(shotKey(undefined), '')
  assert.equal(assetKey('3f6c1f4e-2b0d-4a55-9a1d-1c2b3a4d5e6f'), 'asset:3f6c1f4e-2b0d-4a55-9a1d-1c2b3a4d5e6f')
  assert.equal(assetKey(''), '')
})

test('素材卡节点 id 由 canvasId 派生且可反解', () => {
  const cid = '3f6c1f4e-2b0d-4a55-9a1d-1c2b3a4d5e6f'
  assert.equal(assetNodeId(cid), `asset-${cid}`)
  assert.equal(assetNodeId(''), '')
  assert.equal(canvasIdFromNodeId(`asset-${cid}`), cid)
  assert.equal(canvasIdFromNodeId('asset-'), '')
  assert.equal(canvasIdFromNodeId('shot-E01-S03'), '')
  assert.equal(canvasIdFromNodeId('char-1'), '')
})

test('nodeKeyOf：分镜看 data.shotId，素材卡看 id 前缀，角色卡不落库', () => {
  assert.equal(nodeKeyOf(shotNode('random-uid', 'E01-S03')), 'shot:E01-S03')
  assert.equal(nodeKeyOf(assetNode('cid-1')), 'asset:cid-1')
  assert.equal(nodeKeyOf({ id: 'char-1', type: 'character', position: { x: 0, y: 0 }, data: {} }), '')
  assert.equal(nodeKeyOf({ id: 'S01', position: { x: 0, y: 0 } }), '')
  assert.equal(nodeKeyOf(null), '')
})

test('applyLayout 用存量位置覆盖默认栅格', () => {
  const nodes = [shotNode('n1', 'E01-S01', 0, 0), assetNode('cid-1', 60, -240)]
  const out = applyLayout(nodes, [
    { key: 'shot:E01-S01', x: 320, y: 40 },
    { key: 'asset:cid-1', x: 900, y: -120 },
  ])
  assert.deepEqual(out[0].position, { x: 320, y: 40 })
  assert.deepEqual(out[1].position, { x: 900, y: -120 })
  // 只换位置，不动 data
  assert.deepEqual(out[0].data, { shotId: 'E01-S01' })
})

test('applyLayout 缺位置的节点保留落位规则结果', () => {
  const nodes = [shotNode('n1', 'E01-S01', 12, 34), assetNode('cid-1', 60, -240)]
  const out = applyLayout(nodes, [{ key: 'shot:E01-S01', x: 500, y: 500 }])
  assert.deepEqual(out[0].position, { x: 500, y: 500 })
  assert.deepEqual(out[1].position, { x: 60, y: -240 })
})

test('applyLayout 跳过脏坐标，且坐标未变时保持同一对象', () => {
  const same = shotNode('n1', 'E01-S01', 320, 40)
  assert.equal(applyLayout([same], [{ key: 'shot:E01-S01', x: 320, y: 40 }])[0], same)
  const dirty = [{ key: 'shot:E01-S01', x: Number.NaN, y: 0 }] as unknown as { key: string; x: number; y: number }[]
  assert.deepEqual(applyLayout([shotNode('n1', 'E01-S01', 7, 8)], dirty)[0].position, { x: 7, y: 8 })
  // 空布局不该把节点丢了
  assert.equal(applyLayout([same], []).length, 1)
  assert.equal(applyLayout([same], undefined).length, 1)
})

test('diffLayout 只返回坐标真正变化的 key', () => {
  const moved = shotNode('n1', 'E01-S01', 100, 100)
  const still = assetNode('cid-1', 60, -240)
  const snapshot = layoutSnapshot([shotNode('n1', 'E01-S01', 0, 0), still])
  const out = diffLayout([moved, still], snapshot)
  assert.deepEqual(out, [{ key: 'shot:E01-S01', x: 100, y: 100 }])
  // 全部没动 → 空数组（调用方据此不发请求）
  assert.deepEqual(diffLayout([still], snapshot), [])
})

test('diffLayout 把新出现的节点视为变更，且不删快照里多出来的 key', () => {
  const snapshot = layoutSnapshot([shotNode('n1', 'E01-S01', 0, 0)])
  const grown = [shotNode('n1', 'E01-S01', 0, 0), assetNode('cid-new', 60, -240)]
  assert.deepEqual(diffLayout(grown, snapshot), [{ key: 'asset:cid-new', x: 60, y: -240 }])
  // 节点消失不等于布局要删：返回空，删除由 canvasDelete 显式发起
  assert.deepEqual(diffLayout([], snapshot), [])
})

test('layoutSnapshot 忽略不落库的节点', () => {
  const snap = layoutSnapshot([
    shotNode('n1', 'E01-S01', 1, 2),
    { id: 'char-1', type: 'character', position: { x: 5, y: 6 }, data: {} },
  ])
  assert.deepEqual([...snap.keys()], ['shot:E01-S01'])
  assert.deepEqual(snap.get('shot:E01-S01'), { x: 1, y: 2 })
})

/* ---------------------------------------------------------------- 旧画布迁移 */

test('迁移：按 designId 命中素材卡，位置并入布局', () => {
  const plan = planLegacyCanvasMigration(
    [
      { id: 'asset-old-uid', type: 'asset', position: { x: 200, y: -300 }, data: { kind: 'scene', title: '改名前的街口', designId: 'd-1' } },
      { id: 'random-shot', type: 'shot', position: { x: 40, y: 20 }, data: { shotId: 'E01-S03' } },
    ],
    [{ kind: 'scene', title: '街口（新名）', designId: 'd-1' }],
  )
  assert.deepEqual(plan.canvasIds, [{ index: 0, canvasId: 'old-uid' }])
  assert.equal(plan.matchedCards, 1)
  assert.deepEqual(plan.canvas, [
    { key: 'asset:old-uid', x: 200, y: -300 },
    { key: 'shot:E01-S03', x: 40, y: 20 },
  ])
  assert.deepEqual(plan.unmatchedCards, [])
  assert.deepEqual(plan.droppedNodes, [])
})

test('迁移：没有 designId 时按 kind + title 兜底', () => {
  const plan = planLegacyCanvasMigration(
    [{ id: 'asset-u1', type: 'asset', position: { x: 1, y: 2 }, data: { kind: 'prop', title: '旧伞' } }],
    [{ kind: 'prop', title: '旧伞' }],
  )
  assert.deepEqual(plan.canvasIds, [{ index: 0, canvasId: 'u1' }])
  assert.equal(plan.canvas[0].key, 'asset:u1')
})

test('迁移：匹配不到的素材卡与无业务 id 的节点分别进报告', () => {
  const plan = planLegacyCanvasMigration(
    [
      { id: 'asset-gone', type: 'asset', position: { x: 0, y: 0 }, data: { kind: 'image', title: '已删除的卡' } },
      { id: 'S99', type: 'shot', position: { x: 9, y: 9 }, data: { no: 'S99' } },
      { id: 'char-1', type: 'character', position: { x: 5, y: 5 }, data: {} },
    ],
    [{ kind: 'image', title: '参考图' }],
  )
  assert.deepEqual(plan.canvasIds, [])
  assert.deepEqual(plan.canvas, [])
  assert.deepEqual(plan.unmatchedCards, ['已删除的卡'])
  assert.deepEqual(plan.droppedNodes, ['S99', 'char-1'])
})

test('迁移：同一张卡被两个旧节点命中时只认第一个（重复执行不重复写）', () => {
  const plan = planLegacyCanvasMigration(
    [
      { id: 'asset-first', type: 'asset', position: { x: 10, y: 10 }, data: { kind: 'image', title: '参考图' } },
      { id: 'asset-second', type: 'asset', position: { x: 20, y: 20 }, data: { kind: 'image', title: '参考图' } },
    ],
    [{ kind: 'image', title: '参考图' }],
  )
  assert.deepEqual(plan.canvasIds, [{ index: 0, canvasId: 'first' }])
  assert.deepEqual(plan.canvas, [{ key: 'asset:first', x: 10, y: 10 }])
  assert.deepEqual(plan.unmatchedCards, ['参考图'])
})

test('迁移：非法坐标不进布局行', () => {
  const plan = planLegacyCanvasMigration(
    [{ id: 'asset-u1', type: 'asset', position: { x: Number.NaN, y: 0 }, data: { kind: 'image', title: '参考图' } }],
    [{ kind: 'image', title: '参考图' }],
  )
  assert.deepEqual(plan.canvasIds, [{ index: 0, canvasId: 'u1' }])
  assert.deepEqual(plan.canvas, [])
})
