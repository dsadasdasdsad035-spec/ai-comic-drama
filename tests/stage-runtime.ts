import assert from 'node:assert/strict'
import type { Stage } from '../src/api'
import { STAGE_RUNTIME, assertStageOutput, resolveStageMaxTokens, stageOutput, stageRuntime } from '../src/skills/stages'

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

check('未配置输出上限：不带 max_tokens', () => {
  for (const stage of STAGES) {
    const r = resolveStageMaxTokens(stage, {})
    assert.equal(r.maxTokens, undefined, `环节 ${stage} 未配置却带了上限`)
    assert.equal(r.source, 'unset')
  }
  // 传 null / 缺字段也一样
  assert.equal(resolveStageMaxTokens('creative', null).maxTokens, undefined)
  assert.equal(resolveStageMaxTokens('creative').source, 'unset')
})

check('设置页配置输出上限：按配置生效', () => {
  const r = resolveStageMaxTokens('creative', { stageMaxTokens: { creative: 16000 } })
  assert.equal(r.maxTokens, 16000)
  assert.equal(r.source, 'configured')
  // 字符串数字与小数也认，小数向下取整
  assert.equal(resolveStageMaxTokens('shot', { stageMaxTokens: { shot: '8000' } }).maxTokens, 8000)
  assert.equal(resolveStageMaxTokens('shot', { stageMaxTokens: { shot: 8000.9 } }).maxTokens, 8000)
  // 只影响配置过的环节
  assert.equal(resolveStageMaxTokens('asset', { stageMaxTokens: { creative: 16000 } }).maxTokens, undefined)
})

check('非法配置回退且不静默生效', () => {
  for (const bad of [0, -1, 'abc', Number.NaN, Number.POSITIVE_INFINITY, 999999]) {
    const r = resolveStageMaxTokens('creative', { stageMaxTokens: { creative: bad } })
    assert.equal(r.maxTokens, undefined, `非法值 ${String(bad)} 不应生效`)
    assert.equal(r.source, 'unset')
    assert.ok('invalid' in r, `非法值 ${String(bad)} 应保留原值供报错`)
  }
  // 空字符串视为未配置，不算非法
  const blank = resolveStageMaxTokens('creative', { stageMaxTokens: { creative: '' } })
  assert.equal(blank.maxTokens, undefined)
  assert.equal('invalid' in blank, false)
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
