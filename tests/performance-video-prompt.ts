import assert from 'node:assert/strict'
import {
  performanceVideoPromptBlock,
  performanceVideoEntryCount,
} from '../src/performance.ts'
import { buildShotVideoRequest } from '../src/videoPrompt.ts'
import { effectiveVideoPrompt } from '../src/videoPrompt.ts'

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
  assert.equal(performanceVideoPromptBlock([], [{ speaker: 'A', text: 'hi' }], []), '')
  assert.equal(performanceVideoEntryCount([]), 0)
})

check('多角色表演与说话标记', () => {
  const block = performanceVideoPromptBlock(
    [
      { character: '幼猫', emotion: 'fearful', intensity: 3, action: '缩爪', speaks: false },
      { character: '旁白', emotion: 'calm', intensity: 2, speaks: true },
    ],
    [{ speaker: '旁白', text: '测试' }],
    [{ pace: 'slow', volume: 'soft' }],
  )
  assert.ok(block.includes('【表演方向】'))
  assert.ok(block.includes('幼猫'))
  assert.ok(block.includes('旁白'))
  assert.ok(block.includes('本镜说话'))
  assert.ok(block.includes('语速慢'))
})

check('拼装顺序：表演在图注之前', () => {
  const schedule = {
    scene: { w: 10, h: 10 },
    blocking: { keys: [] },
    duration: 5,
    ready: true,
    status: '生效' as const,
    reason: '',
  }
  const data = {
    no: 'S01',
    seconds: 5,
    size: '中景',
    move: '固定',
    dialogue: '',
    prompt: '运动描述',
    marks: [],
    refImage: '/a.jpg',
    performance: [{ character: 'A', emotion: 'neutral', intensity: 3, action: '站立', speaks: false }],
  }
  const req = buildShotVideoRequest({
    data: data as never,
    nodeId: 'n1',
    nodes: [{ id: 'n1', type: 'shot', data, position: { x: 0, y: 0 } } as never],
    characters: [],
    schedule,
  })
  const perfIdx = req.prompt.indexOf('【表演方向】')
  const refIdx = req.prompt.indexOf('参考图：')
  assert.ok(perfIdx >= 0 && refIdx > perfIdx)
})

check('表演变更使手改快照过期', () => {
  const schedule = {
    scene: { w: 10, h: 10 },
    blocking: { keys: [] },
    duration: 5,
    ready: true,
    status: '生效' as const,
    reason: '',
  }
  const base = {
    no: 'S01',
    seconds: 5,
    size: '中景',
    move: '固定',
    dialogue: '',
    prompt: 'x',
    marks: [],
    refImage: '/a.jpg',
    performance: [{ character: 'A', emotion: 'neutral', intensity: 3, speaks: false }],
  }
  const a = buildShotVideoRequest({
    data: base as never,
    nodeId: 'n1',
    nodes: [{ id: 'n1', type: 'shot', data: base, position: { x: 0, y: 0 } } as never],
    characters: [],
    schedule,
  })
  const b = buildShotVideoRequest({
    data: {
      ...base,
      performance: [{ character: 'A', emotion: 'sad', intensity: 4, speaks: false }],
    } as never,
    nodeId: 'n1',
    nodes: [
      {
        id: 'n1',
        type: 'shot',
        data: { ...base, performance: [{ character: 'A', emotion: 'sad', intensity: 4, speaks: false }] },
        position: { x: 0, y: 0 },
      } as never,
    ],
    characters: [],
    schedule,
  })
  const stale = effectiveVideoPrompt(b, { text: '手改', fingerprint: a.fingerprint, createdAt: '' })
  assert.equal(stale.stale, true)
})

if (process.exitCode !== 1) console.log('\n全部通过')
