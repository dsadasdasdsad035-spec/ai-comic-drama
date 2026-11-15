import assert from 'node:assert/strict'
import {
  packFields,
  packRecords,
  recordSize,
  truncationNote,
} from '../src/agent/readBudget'

let bad = 0
function check(name: string, fn: () => void | Promise<void>) {
  return Promise.resolve()
    .then(fn)
    .then(() => console.log(`✅ ${name}`))
    .catch((e) => {
      bad++
      console.log(`❌ ${name}\n   ${(e as Error).message}`)
    })
}

/** 造一条长度可预期的记录：JSON.stringify 后的长度约为 40+pad */
function rec(no: string, pad = 0) {
  return { no, video_prompt: 'x'.repeat(pad) }
}

async function main() {
  // ---- 1.1 只装整条 ----
  await check('只装整条：超预算的条目不进去，已装的条目字段完整', () => {
    const items = [rec('S01', 100), rec('S02', 100), rec('S03', 4000)]
    const budget = 1000
    const packed = packRecords(items, budget)
    assert.deepEqual(packed.items.map((x) => x.no), ['S01', 'S02'])
    assert.equal(packed.returned, 2)
    assert.equal(packed.total, 3)
    // 装进来的每个条目都是完整对象，不是被切过的字符串
    for (const item of packed.items) {
      assert.equal(typeof item, 'object')
      assert.ok(item.video_prompt.length === 100)
    }
  })

  await check('装填顺序与输入一致，不重排', () => {
    const items = [rec('S03'), rec('S01'), rec('S02')]
    const packed = packRecords(items, 10000)
    assert.deepEqual(packed.items.map((x) => x.no), ['S03', 'S01', 'S02'])
  })

  // ---- 1.1 截断标记 ----
  await check('超限时标 truncated 并给出总数', () => {
    const items = Array.from({ length: 10 }, (_, i) => rec(`S${i + 1}`, 200))
    const packed = packRecords(items, 800)
    assert.equal(packed.truncated, true)
    assert.equal(packed.total, 10)
    assert.ok(packed.returned < 10)
    assert.equal(packed.returned, packed.items.length)
    const fields = packFields(packed)
    assert.equal(fields.truncated, true)
    assert.equal(fields.total, 10)
    assert.equal(fields.returned, packed.returned)
  })

  await check('全部装下时不标 truncated', () => {
    const packed = packRecords([rec('S01'), rec('S02')], 10000)
    assert.equal(packed.truncated, false)
    assert.equal(packed.oversized, false)
    assert.equal(packFields(packed).truncated, undefined)
  })

  // ---- 1.1 单条超预算 ----
  await check('单条自身超预算时整条返回并标 oversized', () => {
    const items = [rec('S01', 5000), rec('S02', 10)]
    const packed = packRecords(items, 1000)
    assert.equal(packed.returned, 1, '至少装一条，不能返回空列表')
    assert.deepEqual(packed.items.map((x) => x.no), ['S01'])
    assert.equal(packed.items[0].video_prompt.length, 5000, '超预算的条目也不能切字段')
    assert.equal(packed.oversized, true)
    assert.equal(packed.truncated, true)
  })

  await check('预算为 0 时仍返回第一条', () => {
    const packed = packRecords([rec('S01')], 0)
    assert.equal(packed.returned, 1)
    assert.equal(packed.oversized, true)
  })

  await check('空输入返回空列表且不标截断', () => {
    const packed = packRecords([], 1000)
    assert.equal(packed.returned, 0)
    assert.equal(packed.total, 0)
    assert.equal(packed.truncated, false)
    assert.equal(packed.oversized, false)
  })

  // ---- 辅助函数 ----
  await check('recordSize 与 JSON 长度一致，循环引用不抛错', () => {
    const value = { a: 1 }
    assert.equal(recordSize(value), JSON.stringify(value).length)
    const loop: Record<string, unknown> = {}
    loop.self = loop
    assert.ok(recordSize(loop) > 0)
  })

  await check('truncationNote 在未截断时为 undefined', () => {
    const full = packRecords([rec('S01')], 10000)
    assert.equal(truncationNote(full), undefined)
    const cut = packRecords([rec('S01', 500), rec('S02', 500)], 600)
    const note = truncationNote(cut, 'S01')
    assert.ok(note && note.includes('S01'), '截断说明要带上续读用的 cursor')
  })

  console.log(bad ? `\n❌ ${bad} 项失败` : '\n✅ 全部通过')
  process.exit(bad ? 1 : 0)
}

void main()
