import assert from 'node:assert/strict'
import { mergeScriptDraft } from '../src/agent/drafts'
import { mergePromptDraft } from '../src/agent/promptDraft'
import { buildShotsFromModel } from '../src/agent/shotDraft'

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

const cur = [
  { no: 1, title: 'A', scenes: [] },
  { no: 2, title: 'B', scenes: [] },
]

check('按集号更新并保留未返回的集', () => {
  const r = mergeScriptDraft(cur, [
    { no: 2, title: 'B2', scenes: [] },
    { no: 3, title: 'C', scenes: [] },
  ])
  assert.deepEqual(r.episodes.map((e) => e.no), [1, 2, 3])
  assert.equal(r.episodes[1].title, 'B2')
  assert.deepEqual({ added: r.added, updated: r.updated, kept: r.kept }, { added: 1, updated: 1, kept: 1 })
})

check('不修改输入数组', () => {
  const before = JSON.stringify(cur)
  mergeScriptDraft(cur, [{ no: 9, title: 'X', scenes: [] }])
  assert.equal(JSON.stringify(cur), before)
})

check('非法集号被忽略', () => {
  const r = mergeScriptDraft(cur, [{ no: Number.NaN, title: 'X', scenes: [] } as never])
  assert.deepEqual(r.episodes.map((e) => e.no), [1, 2])
  assert.equal(r.added, 0)
})

check('空增量保持原样', () => {
  const r = mergeScriptDraft(cur, [])
  assert.deepEqual(r.episodes.map((e) => e.no), [1, 2])
  assert.equal(r.kept, 2)
})

check('同一批次重复集号后者生效', () => {
  const r = mergeScriptDraft(cur, [
    { no: 2, title: 'first', scenes: [] },
    { no: 2, title: 'second', scenes: [] },
  ])
  assert.equal(r.episodes.find((e) => e.no === 2)?.title, 'second')
  assert.equal(r.updated, 2)
})

check('镜头映射使用场次简称和稳定 id', () => {
  const r = buildShotsFromModel(
    [{ no: 'S01', scene_no: 1, seconds: 3, size: '中景', move: '固定', desc: '雨夜', cast: ['陈默'] }],
    [{ no: 1, scenes: [{ no: 1, slug: '街口' }] }],
    1,
  )
  assert.equal(r.shots[0].id, 'E01-S01')
  assert.equal(r.shots[0].scene_slug, '街口')
  assert.deepEqual(r.shots[0].cast, ['陈默'])
  assert.equal(r.sceneFallback, 0)
})

check('场次缺失回退当前集第一场', () => {
  const r = buildShotsFromModel(
    [{ no: 'S02', seconds: 2 }],
    [{ no: 1, scenes: [{ no: 1, slug: '街口' }] }],
    1,
  )
  assert.equal(r.shots[0].scene_no, 1)
  assert.equal(r.shots[0].scene_slug, '街口')
  assert.equal(r.sceneFallback, 1)
})

check('提示词按 shot.id 写回，不串到别集同 no', () => {
  const shots = [
    { id: 'E01-S01', episode: 1, no: 'S01', keyframe_prompt: 'old1', video_prompt: 'oldv1' },
    { id: 'E02-S01', episode: 2, no: 'S01', keyframe_prompt: 'old2', video_prompt: 'oldv2' },
  ] as never[]
  const r = mergePromptDraft(
    shots,
    [{ no: 'S01', keyframe_prompt: '{{陈默}} new', video_prompt: 'v' }],
    1,
    [{ name: '陈默', lookEn: 'LOOK' }],
  )
  assert.equal(r.patched, 1)
  assert.equal(r.shots[0].keyframe_prompt, 'LOOK new')
  assert.equal(r.shots[1].keyframe_prompt, 'old2')
  assert.equal(r.shots[1].video_prompt, 'oldv2')
})

check('提示词未匹配镜号被计数且不写', () => {
  const shots = [{ id: 'E01-S01', episode: 1, no: 'S01', keyframe_prompt: 'old' }] as never[]
  const r = mergePromptDraft(shots, [{ no: 'S99', keyframe_prompt: 'x' }], 1, [])
  assert.equal(r.patched, 0)
  assert.equal(r.missing, 1)
  assert.equal(r.shots[0].keyframe_prompt, 'old')
})

check('残留占位符被计数', () => {
  const shots = [{ id: 'E01-S01', episode: 1, no: 'S01', keyframe_prompt: 'old' }] as never[]
  const r = mergePromptDraft(shots, [{ no: 'S01', keyframe_prompt: '{{未知}} shot' }], 1, [])
  assert.equal(r.unresolved, 1)
  assert.ok(r.shots[0].keyframe_prompt.includes('{{未知}}'))
})

console.log(bad ? `\n❌ ${bad} 项失败` : '\n✅ 全部通过')
process.exit(bad ? 1 : 0)
