import assert from 'node:assert/strict'
import type { Stage } from '../src/api'
import { STAGE_RUNTIME, assertStageOutput, stageOutput, stageRuntime } from '../src/skills/stages'

const STAGES: Stage[] = [
  'character',
  'asset',
  'shot',
  'prompt',
  'sceneCode',
  'vision',
  'videoVision',
  'creative',
]

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

check('每个环节都有运行参数', () => {
  for (const stage of STAGES) {
    assert.ok(STAGE_RUNTIME[stage], `缺少环节 ${stage}`)
    assert.ok(STAGE_RUNTIME[stage].temperature >= 0, `环节 ${stage} 温度非法`)
  }
})

check('默认不写死输出上限', () => {
  // 上限交给渠道默认值；写死数字会让「一集分镜」这种长输出必然撞墙。
  for (const stage of STAGES) {
    assert.equal(
      STAGE_RUNTIME[stage].maxTokens,
      undefined,
      `环节 ${stage} 不应固定 maxTokens`,
    )
  }
})

check('创意环节保留反推契约与温度', () => {
  const r = stageRuntime('creative')
  assert.equal(r.temperature, 0.4)
  assert.equal(r.output, 'reverse-v1')
})

check('视觉环节没有输出契约', () => {
  assert.equal(stageOutput('vision'), null)
  assert.doesNotThrow(() => assertStageOutput('vision', { anything: true }))
})

check('分镜输出契约生效', () => {
  assert.throws(() => assertStageOutput('shot', { shots: [] }), /shots-v1/)
  assert.doesNotThrow(() =>
    assertStageOutput('shot', {
      shots: [
        {
          no: 1,
          scene_no: 1,
          scene_slug: 's1',
          seconds: 3,
          size: '近景',
          move: '固定',
          desc: '她抬头',
        },
      ],
    }),
  )
})

check('3D 代码输出契约生效', () => {
  assert.doesNotThrow(() => assertStageOutput('sceneCode', { code: 'def build(ctx):\n  pass' }))
  assert.throws(() => assertStageOutput('sceneCode', { reply: 'x' }), /scene3d-code-v1/)
})

console.log(bad ? `\n❌ ${bad} 项失败` : '\n✅ 全部通过')
process.exit(bad ? 1 : 0)
