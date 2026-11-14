import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { backfillDesignIds, readProject, writeProject } from '../server/db.mjs'

const root = fs.mkdtempSync(path.join(os.tmpdir(), 'sb-design-writeback-'))

let bad = 0
function check(name, fn) {
  try {
    fn()
    console.log(`✅ ${name}`)
  } catch (e) {
    bad++
    console.log(`❌ ${name}\n   ${e.message}`)
  }
}

/** 与 read_asset_inventory 的准入规则一致：只有拿到非空 key 的行才可见 */
function scenesOf(project) {
  return (project.designs || []).filter((d) => d.kind === 'scene' && String(d.id || '').trim())
}

// 夹具：一张标识为空、但有图的场景卡（复现 project a 的历史状态）
writeProject(root, 'a', { designs: [] })
writeProject(root, 'a', {
  designs: [
    {
      id: '',
      kind: 'scene',
      name: '雨夜空地',
      refs: ['E01-S03'],
      summaryCn: '雨夜街口空地',
      promptEn: 'rainy night empty lot',
      image: '/project-assets/a/design-scene-1.jpg',
      candidates: ['/c1.jpg', '/c2.jpg'],
      activeIdx: 1,
    },
  ],
})

check('标识冲突时整次写入回滚，旧卡逐字段保留', () => {
  const before = readProject(root, 'a')
  assert.throws(
    () =>
      writeProject(root, 'a', {
        designs: [
          { id: 'dup', kind: 'scene', name: '甲', image: '/a.jpg' },
          { id: 'dup', kind: 'prop', name: '乙' },
        ],
      }),
    /UNIQUE|constraint/i,
  )
  const after = readProject(root, 'a')
  assert.deepEqual(after.designs, before.designs)
})

check('回填把不可见的空标识卡补成可见（scenes 0 → 1）', () => {
  const before = readProject(root, 'a')
  assert.equal(scenesOf(before).length, 0)
  assert.equal(backfillDesignIds(), 1)
  const after = readProject(root, 'a')
  assert.equal(scenesOf(after).length, 1)
  const card = scenesOf(after)[0]
  assert.equal(card.name, '雨夜空地')
  assert.equal(card.image, '/project-assets/a/design-scene-1.jpg')
  assert.deepEqual(card.candidates, ['/c1.jpg', '/c2.jpg'])
  assert.equal(card.activeIdx, 1)
  assert.deepEqual(card.refs, ['E01-S03'])
})

check('重复回填不产生改动', () => {
  const first = readProject(root, 'a')
  assert.equal(backfillDesignIds(), 0)
  const second = readProject(root, 'a')
  assert.deepEqual(second.designs, first.designs)
})

check('两张新卡可同时落库，不再撞唯一约束', () => {
  const before = readProject(root, 'a')
  writeProject(root, 'a', {
    designs: [
      ...before.designs,
      { id: 'design-scene-new-1', kind: 'scene', name: '天台' },
      { id: 'design-prop-new-2', kind: 'prop', name: '旧钥匙' },
    ],
  })
  const after = readProject(root, 'a')
  assert.equal(after.designs.length, 3)
  assert.equal(new Set(after.designs.map((d) => d.id)).size, 3)
})

fs.rmSync(root, { recursive: true, force: true })
console.log(bad ? `\n❌ ${bad} 项失败` : '\n✅ 全部通过')
process.exit(bad ? 1 : 0)
