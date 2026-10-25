import assert from 'node:assert/strict'
import { STAGE_RUNTIME, assertStageOutput, stageOutput, stageRuntime } from '../src/skills/stages'

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

check('六个技能环节都有运行参数', () => {
  for (const stage of ['script', 'character', 'asset', 'shot', 'prompt', 'sceneCode'] as const) {
    assert.ok(STAGE_RUNTIME[stage].maxTokens > 0)
    assert.ok(STAGE_RUNTIME[stage].temperature >= 0)
    assert.ok(stageOutput(stage))
  }
})

check('剧本参数与迁移前一致', () => {
  const r = stageRuntime('script')
  assert.equal(r.maxTokens, 8192)
  assert.equal(r.temperature, 0.4)
})

check('视觉环节没有输出契约', () => {
  assert.equal(stageOutput('vision'), null)
  assert.doesNotThrow(() => assertStageOutput('vision', { anything: true }))
})

check('合法剧本输出通过', () => {
  assert.doesNotThrow(() =>
    assertStageOutput('script', {
      logline: 'L',
      episodes: [{ no: 1, scenes: [] }],
    }),
  )
})

check('非法剧本输出被拒绝', () => {
  assert.throws(() => assertStageOutput('script', { logline: 'L' }), /script-v1/)
})

check('3D 代码输出契约生效', () => {
  assert.doesNotThrow(() => assertStageOutput('sceneCode', { code: 'def build(ctx):\n  pass' }))
  assert.throws(() => assertStageOutput('sceneCode', { reply: 'x' }), /scene3d-code-v1/)
})

console.log(bad ? `\n❌ ${bad} 项失败` : '\n✅ 全部通过')
process.exit(bad ? 1 : 0)
