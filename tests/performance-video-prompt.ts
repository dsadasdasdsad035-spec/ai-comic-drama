import assert from 'node:assert/strict'
import {
  performanceDirectionText,
  performanceVideoEntryCount,
  performanceVideoPromptBlock,
} from '../src/performance.ts'
import { buildShotVideoRequest, effectiveVideoPrompt, isVideoPromptHandEdited } from '../src/videoPrompt.ts'

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

check('正文逐字等于 video_prompt，不追加运镜/台词/表演/参考/约束段', () => {
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
    move: '推',
    dialogue: 'A：走。',
    prompt: '画面描述',
    videoPrompt: '雨夜追车，镜头推进',
    motionNote: '缓慢推近',
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
  assert.equal(req.prompt, '雨夜追车，镜头推进', '必须逐字，不做 trim 之外的处理')
  for (const mark of ['【运镜】', '【台词】', '【表演方向】', '声音：', '参考图：', '@视频1', '【约束】']) {
    assert.ok(!req.prompt.includes(mark), `正文不应含 ${mark}：\n${req.prompt}`)
  }
  assert.equal(req.refs.length, 1, '参考图仍按连线提交，只是不再写进正文')
})

check('video_prompt 为空时阻断，不用首帧正文或硬编码顶替', () => {
  const data = {
    no: 'S01',
    seconds: 5,
    size: '中景',
    move: '固定',
    dialogue: '',
    prompt: '首帧画面描述',
    videoPrompt: '',
    marks: [],
    refImage: '/a.jpg',
    refIds: [],
  }
  const req = buildShotVideoRequest({
    data: data as never,
    nodeId: 'n1',
    nodes: [{ id: 'n1', type: 'shot', data, position: { x: 0, y: 0 } } as never],
    characters: [],
  })
  assert.equal(req.prompt, '')
  const empty = req.blocking.find((b) => b.code === 'shot-prompt-empty')
  assert.ok(empty, '空正文必须有阻断项')
  assert.equal(empty.level, 'error')
})

check('存量手改快照只读优先，且不再标记过期', () => {
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
  // 指纹不同也不再产生「旧快照」：正文收敛为单一来源后没有可比较的基线
  const legacy = effectiveVideoPrompt(b, { text: '手改', fingerprint: a.fingerprint, createdAt: '' })
  assert.equal(legacy.text, '手改')
  assert.equal(legacy.source, 'legacy-override')
  assert.equal(legacy.stale, false)
  // 无快照时正文来源是 video_prompt
  const plain = effectiveVideoPrompt(b, undefined)
  assert.equal(plain.source, 'video_prompt')
  assert.equal(plain.text, b.prompt)
})

check('isVideoPromptHandEdited 只认 video_prompt 标记', () => {
  assert.equal(isVideoPromptHandEdited({ handEdited: ['video_prompt'] } as never), true)
  assert.equal(isVideoPromptHandEdited({ handEdited: ['seconds', 'video_prompt'] } as never), true)
  assert.equal(isVideoPromptHandEdited({ handEdited: ['seconds'] } as never), false)
  assert.equal(isVideoPromptHandEdited({} as never), false)
  assert.equal(isVideoPromptHandEdited({ handEdited: undefined } as never), false)
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
