/**
 * 提示词正文完整性：凡是进入请求、落库或工具回执的文本一律原样传递。
 *
 * 背景：转场正文为空时曾用兜底拼装，并把上下镜正文各切到 90 字符再补「…」，
 * 面板里看起来像「没生成完」。九段模板渲染的 scene 字段同样有 120/200/300 的切片。
 * 本测试锁定这些位置不再截断。
 *
 * 跑法：`node verify-skills-unit.mjs`（esbuild 打包后逐个跑）
 */
import assert from 'node:assert/strict'
import type { ShotNodeType } from '../src/data.ts'
import type { ShotData } from '../src/types.ts'
import { createStageToolSet, skillSummaryRow } from '../src/agent/stageTools.ts'
import type { WorkbenchChatAdapter } from '../src/agent/workbenchChat.ts'
import type { Skill } from '../src/skills/types.ts'
import { eventsForDisplay } from '../src/agent/sceneAgentEvents.ts'
import { buildVisionReviewFromRaw } from '../src/agent/agentReview.ts'
import { createBuiltinPlatformTools } from '../src/agent/builtinPlatformTools.ts'
import { digestShots } from '../src/charExtract.ts'
import { digestAllShots } from '../src/designExtract.ts'
import { normalizeVisualBrief } from '../src/visualBrief.ts'
import {
  buildTransitionVideoPreview,
  defaultTransitionPrompt,
  semanticTransitionVideoPrompt,
  transitionContinuityBlock,
} from '../src/transitionGen.ts'
import { buildShotPromptRenderBundle, buildTransitionPromptRenderBundle } from '../src/promptRender.ts'
import type { ShotVideoRequest } from '../src/videoPrompt.ts'

function check(name: string, fn: () => void) {
  try {
    fn()
    console.log(`✅ ${name}`)
  } catch (e) {
    console.error(`❌ ${name}`, e)
    process.exitCode = 1
  }
}

const LONG_A =
  'Extreme close-up inside a dark concrete storm drain at night. A tiny wet white kitten paw hovers above shallow water, then snaps back to the dry ledge; cold cyan low-key light, shallow depth of field, no injury, no crying exaggeration.'
const LONG_B =
  "Extreme close-up of the same tiny white kitten's face in the rainy darkness. One natural blue eye opens slowly; wet white fur clings to its narrow cheek, a rain droplet slides beside the eye, realistic subtle expression."

function shot(no: string, data: Partial<ShotData>): ShotNodeType {
  return {
    id: `node-${no}`,
    type: 'shot',
    position: { x: 0, y: 0 },
    data: {
      no,
      seconds: 5,
      size: '特写',
      move: '固定',
      dialogue: '',
      prompt: '',
      ...data,
    } as ShotData,
  } as ShotNodeType
}

const fakeRequest = {
  seconds: 5,
  prompt: '',
  fingerprint: 'fp',
  textSource: 'video_prompt',
  mode: 'text',
  refs: [],
  omitted: [],
  omittedVideos: [],
  warnings: [],
  blocking: [],
} as unknown as ShotVideoRequest

check('边界值构造有效：两段正文都远超 90 字符', () => {
  assert.ok(LONG_A.length > 90)
  assert.ok(LONG_B.length > 90)
  assert.ok(LONG_A.length > 200)
})

check('兜底正文引用两镜完整正文，不含省略号', () => {
  const a = shot('S01', { videoPrompt: LONG_A })
  const b = shot('S02', { videoPrompt: LONG_B })
  const text = defaultTransitionPrompt(a, b)
  assert.ok(text.includes(LONG_A), '应包含上一镜完整正文')
  assert.ok(text.includes(LONG_B), '应包含下一镜完整正文')
  assert.equal(text.includes('…'), false, '不应出现省略号')
})

check('衔接块引用两镜完整正文，不含省略号', () => {
  const a = shot('S01', { videoPrompt: LONG_A })
  const b = shot('S02', { videoPrompt: LONG_B })
  const block = transitionContinuityBlock(a, b)
  assert.ok(block.includes(LONG_A))
  assert.ok(block.includes(LONG_B))
  assert.equal(block.includes('…'), false)
})

check('单镜九段 bundle 的 scene 字段不再按字符切片', () => {
  const long = '雨'.repeat(400)
  const data = {
    no: 'S01',
    seconds: 5,
    size: '特写',
    move: '固定',
    dialogue: '',
    prompt: long,
  } as ShotData
  const bundle = buildShotPromptRenderBundle({
    data,
    nodeId: 'node-S01',
    nodes: [],
    characters: [],
    style: '现代写实',
    aspect: '16:9',
    request: fakeRequest,
  })
  assert.equal(bundle.scene.environment, long)
  assert.equal(bundle.scene.castStates, long)
})

check('转场九段 bundle 的 environment 保留两镜完整拼接', () => {
  const a = shot('S01', { prompt: '甲'.repeat(400) })
  const b = shot('S02', { prompt: '乙'.repeat(400) })
  const bundle = buildTransitionPromptRenderBundle({
    source: a,
    target: b,
    generated: { prompt: '桥接正文', targetSeconds: 1.2, bridging: 'morph' } as never,
    inputMode: 'text',
    style: '现代写实',
    aspect: '16:9',
    seconds: 1.2,
    requestFingerprint: 'fp',
  })
  const expected = `${'甲'.repeat(400)} | ${'乙'.repeat(400)}`
  assert.equal(bundle.scene.environment, expected)
  assert.equal(bundle.scene.environment.length, expected.length)
})

check('语义层正文逐字返回 Agent 写入的正文', () => {
  const a = shot('S01', { videoPrompt: LONG_A })
  const b = shot('S02', { videoPrompt: LONG_B })
  const own = '镜头沿排水口持续推进，穿过入口进入管道内部，内外光线与色温平滑过渡。'
  assert.equal(semanticTransitionVideoPrompt(a, b, { prompt: own } as never), own)
})

check('正文为空时语义层返回空串，不再静默兜底', () => {
  const a = shot('S01', { videoPrompt: LONG_A })
  const b = shot('S02', { videoPrompt: LONG_B })
  assert.equal(semanticTransitionVideoPrompt(a, b, { prompt: '' } as never), '')
  assert.equal(semanticTransitionVideoPrompt(a, b, { prompt: '   ' } as never), '')
  assert.equal(semanticTransitionVideoPrompt(a, b, undefined), '')
})

check('自动路径正文逐字等于手填正文，手改正文逐字发送', () => {
  const a = shot('S01', { videoPrompt: LONG_A, size: '特写', move: '推进' })
  const b = shot('S02', { videoPrompt: LONG_B, size: '近景', move: '横摇' })
  const continuity = transitionContinuityBlock(a, b)
  assert.ok(continuity.includes(LONG_A) && continuity.includes(LONG_B), '衔接块应含两镜完整正文')

  const auto = buildTransitionVideoPreview({
    source: a,
    target: b,
    generated: { prompt: '桥接正文。', targetSeconds: 1.2, bridging: 'morph' } as never,
    model: { label: 'Seedance 2.5', model: 'seedance-2.5', providerKind: 'apimart' },
  })
  assert.equal(auto.promptSource, 'auto')
  assert.equal(auto.prompt, '桥接正文。', '自动路径正文必须逐字等于手填正文')
  assert.ok(!auto.prompt.includes('衔接：'), '正文不得含自动衔接段')
  assert.ok(!auto.prompt.includes('结构锚点'), '正文不得含结构锚点段')
  // 衔接信息只保留为只读参考
  assert.equal(auto.continuityPreview.trim(), continuity.trim(), '衔接信息仍应作为只读参考提供')

  const overrideText = '手改：镜头缓慢下摇，水面反光平滑过渡到下一镜。'
  const override = buildTransitionVideoPreview({
    source: a,
    target: b,
    generated: {
      prompt: '被忽略的自动正文',
      targetSeconds: 1.2,
      bridging: 'morph',
      videoPromptOverride: { text: overrideText, createdAt: '2026-01-01T00:00:00.000Z' },
    } as never,
    model: { label: 'Seedance 2.5', model: 'seedance-2.5', providerKind: 'apimart' },
  })
  assert.equal(override.promptSource, 'override')
  assert.equal(override.prompt, overrideText, '手改正文必须逐字发送，不掺入衔接段')
})

check('正文为空时出片预览给出 blocking 而非静默拼装', () => {
  const a = shot('S01', { videoPrompt: LONG_A })
  const b = shot('S02', { videoPrompt: LONG_B })
  const empty = buildTransitionVideoPreview({
    source: a,
    target: b,
    generated: { prompt: '', targetSeconds: 1.2, bridging: 'morph' } as never,
    model: { label: 'Seedance 2.5', model: 'seedance-2.5', providerKind: 'apimart' },
  })
  const codes = empty.blocking.map((x) => x.code)
  assert.ok(codes.includes('transition-prompt-empty'), `blocking 应含 transition-prompt-empty，实际 ${codes.join(',')}`)
  assert.ok(empty.blocking.length > 0)

  const filled = buildTransitionVideoPreview({
    source: a,
    target: b,
    generated: { prompt: '镜头沿排水口前推穿过入口。', targetSeconds: 1.2, bridging: 'morph' } as never,
    model: { label: 'Seedance 2.5', model: 'seedance-2.5', providerKind: 'apimart' },
  })
  assert.equal(
    filled.blocking.some((x) => x.code === 'transition-prompt-empty'),
    false,
    '有正文时不应再报空正文',
  )
})

/* ---------------- Agent 读取路径：工具回执不折叠正文 ---------------- */

function stubTools(patch: Partial<WorkbenchChatAdapter>) {
  const adapter = {
    surface: 'workbench',
    skillId: 'test',
    stage: 'creative',
    artifact: 'shots',
    writeTool: 'submit_shots',
    writeContract: 'shots-v1',
    threadKey: { project: 'test' },
    inputs: () => ({}),
    ownDraft: () => [],
    projectSnapshot: async () => ({ name: 'test', shots: [] }) as never,
    applyDraft: () => ({ ok: true }) as never,
    ...patch,
  } as unknown as WorkbenchChatAdapter
  return createStageToolSet(adapter)
}

async function checkAsync(name: string, fn: () => Promise<void>) {
  try {
    await fn()
    console.log(`✅ ${name}`)
  } catch (e) {
    console.error(`❌ ${name}`, e)
    process.exitCode = 1
  }
}

const BIG_BUNDLE = {
  schemaVersion: 1,
  kind: 'shot',
  templateVersion: 'v1',
  creative: { desc: '长'.repeat(9000), keyframePrompt: '长'.repeat(9000) },
} as never

await checkAsync('read_prompt_render_bundle 整份返回超 8000 字 bundle', async () => {
  const set = stubTools({ promptRenderBundle: () => BIG_BUNDLE })
  const tool = set.byName.get('read_prompt_render_bundle')
  assert.ok(tool, '应注册 read_prompt_render_bundle')
  const res = (await tool.invoke({})) as { ok: boolean; bundle: unknown }
  assert.equal(res.ok, true)
  const rec = res.bundle as Record<string, unknown>
  assert.equal(rec.truncated, undefined, '不应返回 truncated 标记')
  assert.equal(rec.preview, undefined, '不应返回切片 preview')
  assert.deepEqual(res.bundle, BIG_BUNDLE, 'bundle 必须与输入深相等')
})

await checkAsync('read_shot_video_prompt 返回模板渲染正文全文', async () => {
  const rendered = '雨夜巷口，幼猫贴着排水口，镜头缓慢前推…'.repeat(400)
  const set = stubTools({
    ownDraft: () => [
      { id: 'E01-S01', no: 'S01', episode: 1, video_prompt_rendered: rendered },
    ],
  })
  const tool = set.byName.get('read_shot_video_prompt')
  assert.ok(tool)
  const res = (await tool.invoke({ shotId: 'E01-S01' })) as Record<string, unknown>
  assert.equal(res.ok, true)
  assert.equal(res.templateRendered, rendered, '应返回模板渲染正文全文')
  assert.equal(res.templateRenderedChars, rendered.length)
})

check('list_installed_skills 不裁剪技能描述', () => {
  const description = '技'.repeat(300)
  const row = skillSummaryRow({
    id: 'x',
    profile: 'workbench',
    source: 'builtin',
    manifest: { name: 'x', description, stage: 'creative', version: '1.0.0' },
  } as unknown as Skill)
  assert.equal(row.description, description)
  assert.equal(row.description.length, 300)
})

/* ---------------- 事件回执 / 验收 / 成本确认文案 ---------------- */

check('事件回执超预算时只标记，不返回半截 JSON', () => {
  const big = { shots: Array.from({ length: 200 }, (_, i) => ({ id: `E01-S${i}`, prompt: '雨'.repeat(60) })) }
  const events = eventsForDisplay([
    { type: 'tool_end', toolCallId: 't1', toolName: 'read_shots', result: big },
  ] as never[])
  const result = (events[0] as { result: Record<string, unknown> }).result
  assert.equal(result.truncated, true)
  assert.equal(result.preview, undefined, '不应再把 JSON 切成半截塞进 preview')
  assert.equal(typeof result.chars, 'number')
  assert.deepEqual(result.value, big, '完整结果必须一起返回')
})

check('事件回执里的长字符串不按字符截断', () => {
  const longText = '旁白：'.repeat(3000)
  const events = eventsForDisplay([
    { type: 'tool_end', toolCallId: 't2', toolName: 'x', result: longText },
  ] as never[])
  const result = (events[0] as { result: Record<string, unknown> }).result
  assert.equal(result.truncated, true)
  assert.equal(result.value, longText, '长文本原样返回')
})

check('视觉验收的长 reason / summary 原样保留', () => {
  const reason = '画面左下角的护栏缺了一段，且第 3 帧开始出现穿模。'.repeat(30)
  const summary = '整体通过但存在 3 处细节问题：'.repeat(40)
  const review = buildVisionReviewFromRaw(
    {
      summary,
      items: [{ key: '护栏连续', label: '护栏连续', ok: false, reason }],
    },
    ['护栏连续'],
    'vision-x',
  )
  assert.equal(review.summary, summary)
  assert.equal(review.items[0]?.reason, reason)
  assert.equal(review.items[0]?.ok, false)
})

await checkAsync('配音成本确认文案包含完整台词', async () => {
  const line = '陈默：这一段的台词很长，需要完整出现在确认框里，不能被切成半句。'.repeat(6)
  const snap = {
    name: 'shape',
    characters: [{ name: '陈默', voice_id: 'male-qn-badao' }],
    shots: [{ id: 'E01-S01', episode: 1, no: 'S01', dialogue: line }],
    episodes: [],
    designs: [],
    assets: [],
  } as never
  const gates: { detail?: string }[] = []
  const prevFetch = globalThis.fetch
  globalThis.fetch = (async () => ({
    ok: true,
    status: 200,
    json: async () => ({ ok: true, url: '/audio/s01.mp3', engine: 'tts-x', seconds: 2.1, elapsed: 1 }),
    text: async () => '{}',
  })) as unknown as typeof fetch
  try {
    const tools = createBuiltinPlatformTools({
      projectName: 'shape',
      epNo: 1,
      getSnapshot: () => snap,
      setSnapshot: () => {},
      askCost: async (req) => {
        gates.push(req as { detail?: string })
        return true
      },
    })
    const r = (await tools.find((t) => t.name === 'generate_voice')?.invoke({ no: 'S01' })) as {
      ok?: boolean
      error?: string
    }
    assert.equal(r?.ok, true, r?.error)
    assert.equal(gates.length, 1)
    assert.ok(gates[0].detail?.includes(line.trim()), '确认文案必须包含完整台词')
  } finally {
    globalThis.fetch = prevFetch
  }
})

/* ---------------- 抽取上下文与视觉解析：字段不按字符切片 ---------------- */

check('角色抽取摘要保留完整台词与画面', () => {
  const dialogue = '陈默：这一段台词要完整进入角色抽取上下文，不能在半句处被切掉。'.repeat(6)
  const prompt = '雨夜巷口，霓虹灯下的积水倒影，低机位缓慢前推。'.repeat(8)
  const text = digestShots([{ no: 'S01', cast: ['陈默'], dialogue, prompt }])
  assert.ok(text.includes(dialogue.trim().replace(/\s+/g, ' ')), '台词必须完整保留')
  assert.ok(text.includes(prompt), '画面描述必须完整保留')
})

check('设计抽取摘要保留完整台词与画面', () => {
  const dialogue = '旁白：设计抽取也要看到完整的一句台词，才能判断道具与场景。'.repeat(6)
  const frame = '废弃仓库，墙面剥落，铁门半开，暖色侧光从门缝切入。'.repeat(8)
  const text = digestAllShots([
    { id: 'E01-S01', episode: 1, no: 'S01', dialogue, keyframe_prompt: frame },
  ] as never)
  assert.ok(text.includes(dialogue), '台词必须完整保留')
  assert.ok(text.includes(frame), '画面描述必须完整保留')
})

check('视觉解析保留长字段，但条数上限仍生效', () => {
  const name = '名'.repeat(80)
  const occludedBy = '遮'.repeat(80)
  const description = '物'.repeat(300)
  const angle = '角'.repeat(200)
  const notes = '注'.repeat(400)
  const composition = '构'.repeat(500)
  const brief = normalizeVisualBrief({
    subjects: Array.from({ length: 12 }, () => ({ name, occludedBy, screen: 'left', depth: 'near' })),
    visible: Array.from({ length: 20 }, () => ({ kind: 'prop', description })),
    shotSize: name,
    cameraHint: { height: 'low', angle, notes },
    composition,
  })
  assert.equal(brief.subjects.length, 8, 'subjects 仍限 8 条')
  assert.equal(brief.visible.length, 12, 'visible 仍限 12 条')
  assert.equal(brief.subjects[0]?.name, name)
  assert.equal(brief.subjects[0]?.occludedBy, occludedBy)
  assert.equal(brief.visible[0]?.description, description)
  assert.equal(brief.shotSize, name)
  assert.equal(brief.cameraHint?.angle, angle)
  assert.equal(brief.cameraHint?.notes, notes)
  assert.equal(brief.composition, composition)
})
