import assert from 'node:assert/strict'
import { contractIds, validateContract } from '../src/skills/contracts'

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

const shot = (over: Record<string, unknown> = {}) => ({
  index: 1,
  start: 0,
  end: 1.8,
  size: 'close-up',
  keyframe_prompt: 'a cup on a wet table, close-up, neon rim light',
  video_prompt: 'the cup slides forward, dolly in 20cm',
  evidence_frames: ['/creative/demo/frames/f001.jpg'],
  confidence: 0.8,
  ...over,
})

const pack = (over: Record<string, unknown> = {}) => ({
  source: { platform: 'douyin', url: 'https://v.douyin.com/x', duration: 12.4, width: 1080, height: 1920 },
  global_style: 'neon rainy night, teal and orange grade',
  shots: [shot()],
  negative_prompt: 'text, watermark',
  notes: '',
  ...over,
})

check('reverse-v1 注册在契约表里', () => {
  assert.ok(contractIds().includes('reverse-v1'))
})

check('合法提示词包通过校验', () => {
  const r = validateContract('reverse-v1', pack())
  assert.equal(r.ok, true, r.ok ? '' : r.errors.join('；'))
})

check('缺少两段提示词被拒绝', () => {
  const broken = pack({ shots: [{ start: 0, end: 1, size: 'close-up' }] })
  const r = validateContract('reverse-v1', broken)
  assert.equal(r.ok, false)
  if (!r.ok) {
    const text = r.errors.join('；')
    assert.ok(/keyframe_prompt|video_prompt/.test(text), text)
  }
})

check('时间倒置被拒绝', () => {
  const r = validateContract('reverse-v1', pack({ shots: [shot({ start: 2, end: 1 })] }))
  assert.equal(r.ok, false)
  if (!r.ok) assert.ok(r.errors.join('；').includes('end 必须大于 start'))
})

check('起始时间重复被拒绝', () => {
  const r = validateContract(
    'reverse-v1',
    pack({ shots: [shot({ index: 1 }), shot({ index: 2, end: 3 })] }),
  )
  assert.equal(r.ok, false)
  if (!r.ok) assert.ok(r.errors.join('；').includes('起始时间与前面的镜头重复'))
})

check('空镜头列表被拒绝', () => {
  const r = validateContract('reverse-v1', pack({ shots: [] }))
  assert.equal(r.ok, false)
})

check('creative-plan-v1 接受纯回复', () => {
  const r = validateContract('creative-plan-v1', { reply: '三个方向如下：…' })
  assert.equal(r.ok, true, r.ok ? '' : r.errors.join('；'))
})

console.log(bad ? `\n❌ ${bad} 项失败` : '\n✅ 全部通过')
process.exit(bad ? 1 : 0)
