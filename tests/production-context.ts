import assert from 'node:assert/strict'
import {
  DEFAULT_EPISODE_TARGET_SECONDS,
  requireProjectStyle,
  resolveEpisodeTarget,
  resolveProjectStyle,
  setEpisodeTargetSeconds,
} from '../src/productionContext'

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

check('空画风返回 null', () => {
  assert.equal(resolveProjectStyle({ style: '' }), null)
  assert.equal(resolveProjectStyle({ style: '  ' }), null)
})

check('requireProjectStyle 空则抛错', () => {
  assert.throws(() => requireProjectStyle({ style: '' }), /画风/)
})

check('缺字段分集用默认 60', () => {
  assert.equal(resolveEpisodeTarget([{ no: 1, scenes: [] }], 1), DEFAULT_EPISODE_TARGET_SECONDS)
})

check('分集 targetSeconds 覆盖', () => {
  assert.equal(resolveEpisodeTarget([{ no: 2, targetSeconds: 88, scenes: [] }], 2), 88)
})

check('setEpisodeTargetSeconds 更新已有集', () => {
  const next = setEpisodeTargetSeconds([{ no: 1, scenes: [] }], 1, 72)
  assert.equal(next[0].targetSeconds, 72)
})

console.log(bad ? `\n❌ ${bad} 项失败` : '\n✅ 全部通过')
process.exit(bad ? 1 : 0)
