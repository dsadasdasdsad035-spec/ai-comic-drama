import assert from 'node:assert/strict'
import {
  performanceDirectionText,
  performanceVideoEntryCount,
  performanceVideoPromptBlock,
} from '../src/performance.ts'
import { buildShotVideoRequest, effectiveVideoPrompt } from '../src/videoPrompt.ts'

function check(name: string, fn: () => void) {
  try {
    fn()
    console.log(`✅ ${name}`)
  } catch (e) {
    console.error(`❌ ${name}`, e)
    process.exitCode = 1
  }
}

check('空表演不输出段落', () => {
  assert.equal(performanceDirectionText([], [{ speaker: 'A', text: 'hi' }], []), '')
  assert.equal(performanceVideoPromptBlock([], [{ speaker: 'A', text: 'hi' }], []), '')
  assert.equal(performanceVideoEntryCount([]), 0)
})

check('多角色表演含强度/视线/说话与台词表演', () => {
  const text = performanceDirectionText(
    [
      { character: '幼猫', emotion: 'fearful', intensity: 4, action: '缩爪', gaze: '门缝', speaks: false },
      { character: '旁白', emotion: 'calm', intensity: 2, speaks: true },
    ],
    [{ speaker: '旁白', text: '测试' }],
    [{ pace: 'slow', volume: 'soft', emphasis: '测试' }],
  )
  assert.ok(text.includes('幼猫'))
  assert.ok(text.includes('强度 4'))
  assert.ok(text.includes('视线门缝'))
  assert.ok(text.includes('本镜说话'))
  assert.ok(text.includes('语速慢'))
  assert.ok(text.includes('压低'))
  assert.ok(text.includes('重音「测试」'))
})

check('拼装顺序：表演在参考图之前', () => {
  const char = {
    id: 'A',
    name: 'A',
    role: '',
    lookCn: '',
    lookEn: '',
    palette: '',
    keywords: [],
    image: '/char.jpg',
  }
  const data = {
    no: 'S01',
    seconds: 5,
    size: '中景',
    move: '固定',
    dialogue: 'A：走。',
    prompt: '运动描述',
    marks: [],
    refImage: '/a.jpg',
    refIds: ['char-A'],
    performance: [{ character: 'A', emotion: 'neutral', intensity: 3, action: '站立', speaks: true }],
  }
  const req = buildShotVideoRequest({
    data: data as never,
    nodeId: 'n1',
    nodes: [{ id: 'n1', type: 'shot', data, position: { x: 0, y: 0 } } as never],
    characters: [char as never],
  })
  const perfIdx = req.prompt.indexOf('【表演方向】')
  const refIdx = req.prompt.indexOf('参考图：')
  assert.ok(perfIdx >= 0 && refIdx > perfIdx, req.prompt)
})

check('表演变更使手改快照过期', () => {
  const base = {
    no: 'S01',
    seconds: 5,
    size: '中景',
    move: '固定',
    dialogue: '',
    prompt: 'x',
    marks: [],
    performance: [{ character: 'A', emotion: 'neutral', intensity: 3, speaks: false }],
  }
  const a = buildShotVideoRequest({
    data: base as never,
    nodeId: 'n1',
    nodes: [{ id: 'n1', type: 'shot', data: base, position: { x: 0, y: 0 } } as never],
    characters: [],
  })
  const changed = {
    ...base,
    performance: [{ character: 'A', emotion: 'sad', intensity: 4, speaks: false }],
  }
  const b = buildShotVideoRequest({
    data: changed as never,
    nodeId: 'n1',
    nodes: [{ id: 'n1', type: 'shot', data: changed, position: { x: 0, y: 0 } } as never],
    characters: [],
  })
  const stale = effectiveVideoPrompt(b, { text: '手改', fingerprint: a.fingerprint, createdAt: '' })
  assert.equal(stale.stale, true)
})

check('refIds 指向不存在的素材卡只报警告不抛错', () => {
  const data = {
    no: 'S01',
    seconds: 5,
    size: '中景',
    move: '固定',
    dialogue: '',
    prompt: 'x',
    marks: [],
    refImage: '/a.jpg',
    refIds: ['asset-ghost', 'asset-live'],
    performance: [{ character: 'A', emotion: 'neutral', intensity: 3, speaks: false }],
  }
  const req = buildShotVideoRequest({
    data: data as never,
    nodeId: 'n1',
    nodes: [
      { id: 'n1', type: 'shot', data, position: { x: 0, y: 0 } } as never,
      { id: 'asset-live', type: 'asset', data: {}, position: { x: 0, y: 0 } } as never,
    ],
    characters: [],
  })
  const issue = req.warnings.find((i) => i.code === 'ref-orphan-asset')
  assert.ok(issue, '应报 ref-orphan-asset')
  assert.equal(issue?.level, 'warn')
  assert.ok(issue?.message.includes('1 条'))
})

if (process.exitCode !== 1) console.log('\n全部通过')
