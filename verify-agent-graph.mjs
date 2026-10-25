/**
 * LangGraph agent 图回归：mock 模型/渲染/视觉，不调用真实模型或 iframe。
 * 跑法：node verify-agent-graph.mjs
 */
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { execFileSync } from 'node:child_process'

const root = path.dirname(fileURLToPath(import.meta.url))
const tmp = fs.mkdtempSync(path.join(root, '.verify-agent-'))
const entry = path.join(tmp, 'entry.ts')
fs.writeFileSync(entry, `export * from ${JSON.stringify(path.join(root, 'src/agent/sceneAgentGraph.ts'))}\nexport * from ${JSON.stringify(path.join(root, 'src/agent/sceneAgentEvents.ts'))}\nexport * from ${JSON.stringify(path.join(root, 'src/agent/zcodeChatModel.ts'))}\nexport * from ${JSON.stringify(path.join(root, 'src/agent/agentReview.ts'))}\nexport * from ${JSON.stringify(path.join(root, 'src/agent/sceneAgentTools.ts'))}\n`)
const bundle = path.join(tmp, 'bundle.mjs')
execFileSync(path.join(root, 'node_modules', '.bin', 'esbuild'), [
  entry, '--bundle', '--platform=node', '--format=esm', '--log-level=error', `--outfile=${bundle}`,
])
const lib = await import(bundle)
let bad = 0
const check = (name, cond, extra = '') => {
  console.log(`${cond ? '✅' : '❌'} ${name}${extra ? ` | ${extra}` : ''}`)
  if (!cond) bad++
}

const CODE = `import bpy
import math
from mathutils import Vector

_state = {}

def build(ctx):
    _state['ctx'] = ctx
    bpy.ops.mesh.primitive_cone_add(vertices=8, radius1=5, depth=6, location=(-6, -6, 3))
    bpy.ops.mesh.primitive_cylinder_add(radius=7, depth=0.4, vertices=24, location=(0, 0, -0.2))
    for x in (-0.7, 0.7):
        bpy.ops.mesh.primitive_cylinder_add(radius=0.22, depth=1.0, vertices=12, location=(x, 0, 0.8))
    bpy.ops.mesh.primitive_cube_add(size=1, location=(-0.7, 0, 1.2))
    ctx.camera.location = (7, -7, 3.2)
    d = Vector((0, 0, 0.8)) - ctx.camera.location
    ctx.camera.rotation_euler = d.to_track_quat('-Z', 'Y').to_euler()

def pose(t, mode):
    ctx = _state.get('ctx')
    if not ctx:
        return
    a = -0.7 + min(1.0, max(0.0, t / 4.0)) * 2.1
    ctx.camera.location = (math.cos(a) * 8, math.sin(a) * 8, 3.2)
    d = Vector((0, 0, 0.8)) - ctx.camera.location
    ctx.camera.rotation_euler = d.to_track_quat('-Z', 'Y').to_euler()

def dispose():
    pass`

const calls = [
  { name: 'get_shot_context', args: {} },
  { name: 'set_scene_code', args: { code: CODE } },
  { name: 'run_render', args: {} },
  { name: 'capture_frames', args: { times: [0, 1, 2, 3, 4] } },
  { name: 'review_frames', args: { requirements: ['山体', '两人', '双剑', '对环'] } },
  { name: 'finish', args: { summary: '山、男女双剑对打与环绕镜头已完成' } },
]
let callIndex = 0
const asks = []
const settings = {
  providers: [],
  models: [{ key: 'agent-model', label: 'Agent', cap: 'text', provider: 'p', model: 'm' }],
  defaults: { text: 'agent-model' },
  stageModels: { sceneCode: 'agent-model' },
  apiKey: '',
  rules: {},
}
const events = []
let draft = ''
const result = await lib.runSceneAgent({
  prompt: '生成山、男女双剑对打、环绕镜头',
  settings,
  ask: async (o) => {
    asks.push(o)
    const c = calls[callIndex++]
    return {
      json: { content: c ? '' : '完成', tool_calls: c ? [c] : [] },
      modelKey: 'agent-model',
    }
  },
  requirements: ['山体', '两名人物', '两把剑', '镜头环绕'],
  deps: {
    getShotContext: () => '当前镜头 S01，4 秒，16:9',
    runTrial: async () => ({ ok: true, firstFrame: 'data:image/jpeg;base64,AA' }),
    captureFrames: async (_code, times) => times.map((t) => ({ t, url: `data:image/jpeg;base64,${t}` })),
    reviewFrames: async (_frames, reqs) => ({
      passed: true,
      usedVision: true,
      items: reqs.map((label) => ({ key: label, label, ok: true })),
    }),
    onDraftCode: (code) => { draft = code },
    onEvent: (e) => events.push(e.type),
  },
})
check('图跑通 finish', result.summary.includes('完成') && !result.error, JSON.stringify({ error: result.error, summary: result.summary }))
check('代码进入草稿', result.code?.includes('primitive_cone_add') && draft === result.code)
check('5 帧结果', result.frames?.length === 5, String(result.frames?.length))
check('验收清单通过', result.review?.passed === true && result.review.items.length === 4)
check('工具事件顺序', events.filter((x) => x === 'tool_start').length === 6 && events.includes('code') && events.includes('frames') && events.includes('review') && events.includes('done'), JSON.stringify(events))
check('模型调用 6 次', asks.length === 6, String(asks.length))
check('工具轨迹不含源码', result.events.find((e) => e.type === 'code')?.codeHash?.length === 64, JSON.stringify(result.events.find((e) => e.type === 'code')))


// 已有代码基线：模型可以 run_render 先行，无需 set_scene_code
let baselineDraft = ''
const baselineCalls = [
  { name: 'run_render', args: {} },
  { name: 'capture_frames', args: { times: [0, 1, 2, 3, 4] } },
  { name: 'review_frames', args: { requirements: ['山体', '两人'] } },
  { name: 'finish', args: { summary: '当前代码运行完成' } },
]
let baselineIndex = 0
const baseline = await lib.runSceneAgent({
  prompt: '运行当前场景',
  settings,
  initialCode: CODE,
  ask: async () => {
    const c = baselineCalls[baselineIndex++]
    return { json: { content: '', tool_calls: c ? [c] : [] } }
  },
  deps: {
    getShotContext: () => 'S01',
    runTrial: async () => ({ ok: true, firstFrame: 'data:image/jpeg;base64,AA' }),
    captureFrames: async (_c, times) => times.map((t) => ({ t, url: `data:image/jpeg;base64,${t}` })),
    reviewFrames: async (_f, reqs) => ({ passed: true, usedVision: true, items: reqs.map((label) => ({ key: label, label, ok: true })) }),
    onDraftCode: () => { baselineDraft = 'should-not-be-written' },
  },
})
check('已有代码可直接 run_render', !baseline.error && baseline.trial?.ok === true && baseline.attempts === 1, JSON.stringify({ error: baseline.error, trial: baseline.trial }))
check('baseline 不重复写草稿', baselineDraft === '', baselineDraft)
check('baseline 后续运行复用', await (async () => {
  let i = 0
  const again = await lib.runSceneAgent({
    prompt: '再运行一次',
    settings,
    initialCode: CODE,
    ask: async () => {
      const c = baselineCalls[i++]
      return { json: { content: '', tool_calls: c ? [c] : [] } }
    },
    deps: {
      getShotContext: () => 'S01',
      runTrial: async () => ({ ok: true, firstFrame: 'data:image/jpeg;base64,AA' }),
      captureFrames: async (_c, times) => times.map((t) => ({ t, url: `data:image/jpeg;base64,${t}` })),
      reviewFrames: async (_f, reqs) => ({ passed: true, usedVision: true, items: reqs.map((label) => ({ key: label, label, ok: true })) }),
    },
  })
  return !again.error && again.trial?.ok === true
})())

// 空镜头 / 无效初始代码：run_render 仍拒绝，随后可提交代码恢复
const emptySeq = [
  { name: 'run_render', args: {} },
  { name: 'set_scene_code', args: { code: CODE } },
  { name: 'run_render', args: {} },
  { name: 'capture_frames', args: { times: [0, 1, 2] } },
  { name: 'review_frames', args: { requirements: ['山体'] } },
  { name: 'finish', args: { summary: '恢复完成' } },
]
let emptyIndex = 0
const emptyRun = await lib.runSceneAgent({
  prompt: '空镜头运行',
  settings,
  ask: async () => {
    const c = emptySeq[emptyIndex++]
    return { json: { content: '', tool_calls: c ? [c] : [] } }
  },
  deps: {
    getShotContext: () => 'S01',
    runTrial: async () => ({ ok: true, firstFrame: 'data:image/jpeg;base64,AA' }),
    captureFrames: async (_c, times) => times.map((t) => ({ t, url: `data:image/jpeg;base64,${t}` })),
    reviewFrames: async (_f, reqs) => ({ passed: true, usedVision: true, items: reqs.map((label) => ({ key: label, label, ok: true })) }),
  },
})
const emptyErrors = emptyRun.events.filter((e) => e.type === 'tool_end' && e.toolName === 'run_render' && e.isError)
check('空镜头仍拒绝运行', emptyErrors.length >= 1 && String(emptyErrors[0].result?.error || '').includes('还没有提交代码'), JSON.stringify(emptyErrors.slice(0, 1)))
check('空镜头提交代码后可恢复', !emptyRun.error && emptyRun.trial?.ok === true, JSON.stringify({ error: emptyRun.error, trial: emptyRun.trial }))

let invalidIndex = 0
const invalidRun = await lib.runSceneAgent({
  prompt: '无效基线',
  settings,
  initialCode: 'function broken(',
  ask: async () => {
    const c = emptySeq[invalidIndex++]
    return { json: { content: '', tool_calls: c ? [c] : [] } }
  },
  deps: {
    getShotContext: () => 'S01',
    runTrial: async () => ({ ok: true, firstFrame: 'data:image/jpeg;base64,AA' }),
    captureFrames: async (_c, times) => times.map((t) => ({ t, url: `data:image/jpeg;base64,${t}` })),
    reviewFrames: async (_f, reqs) => ({ passed: true, usedVision: true, items: reqs.map((label) => ({ key: label, label, ok: true })) }),
  },
})
const invalidErrors = invalidRun.events.filter((e) => e.type === 'tool_end' && e.toolName === 'run_render' && e.isError)
check('无效初始代码不 seed', invalidErrors.length >= 1 && !invalidRun.error, JSON.stringify({ error: invalidRun.error, first: invalidErrors[0] }))

// 原生工具调用：同一套工具序列，provider 直接返回 toolCalls
const nativeSettings = {
  providers: [{ id: 'minimax', label: 'MiniMax', kind: 'minimax', baseUrl: '', apiKey: '', caps: ['text'] }],
  models: [{ key: 'native-model', label: 'M3', cap: 'text', provider: 'minimax', model: 'MiniMax-M3' }],
  defaults: { text: 'native-model' },
  stageModels: { sceneCode: 'native-model' },
  agentToolProtocol: 'auto',
  apiKey: '',
  rules: {},
}
let nativeIndex = 0
const nativeAsks = []
const nativeEvents = []
let nativeDraft = ''
const nativeRun = await lib.runSceneAgent({
  prompt: '生成山、双人对打、环绕镜头',
  settings: nativeSettings,
  ask: async (o) => {
    nativeAsks.push(o)
    const c = calls[nativeIndex++]
    const id = `call_${nativeIndex}`
    if (c) o.onToolCallDelta?.({ index: 0, id, name: c.name, delta: JSON.stringify(c.args) })
    return c
      ? {
          text: '',
          finishReason: 'tool_calls',
          toolCalls: [{ id, name: c.name, arguments: JSON.stringify(c.args) }],
        }
      : { text: '完成', finishReason: 'stop' }
  },
  requirements: ['山体', '两名人物', '两把剑', '镜头环绕'],
  deps: {
    getShotContext: () => 'S01',
    runTrial: async () => ({ ok: true, firstFrame: 'data:image/jpeg;base64,AA' }),
    captureFrames: async (_c, times) => times.map((t) => ({ t, url: `data:image/jpeg;base64,${t}` })),
    reviewFrames: async (_f, reqs) => ({
      passed: true,
      usedVision: true,
      items: reqs.map((label) => ({ key: label, label, ok: true })),
    }),
    onDraftCode: (code) => { nativeDraft = code },
    onEvent: (e) => nativeEvents.push(e),
  },
})
check('原生协议命中', nativeRun.toolProtocol === 'native' && !nativeRun.error, JSON.stringify({ protocol: nativeRun.toolProtocol, error: nativeRun.error }))
check('原生请求带 messages/tools', Array.isArray(nativeAsks[0]?.messages) && nativeAsks[0].messages.some((m) => m.role === 'system') && nativeAsks[0].tools?.length === 12 && nativeAsks[0].toolChoice === 'auto', JSON.stringify({ tools: nativeAsks[0]?.tools?.length, msgs: nativeAsks[0]?.messages?.map((m) => m.role) }))
check('原生工具参数进度事件', nativeEvents.some((e) => e.type === 'tool_call_args' && e.toolName === 'get_shot_context'), JSON.stringify(nativeEvents.filter((e) => e.type === 'tool_call_args').slice(0, 2)))
check('原生跑通 finish', nativeRun.finished === true && nativeRun.trial?.ok === true && nativeDraft === nativeRun.code, JSON.stringify({ finished: nativeRun.finished, error: nativeRun.error }))
check('协议写入轨迹', nativeEvents.some((e) => e.type === 'custom' && e.name === 'tool_protocol' && e.value?.protocol === 'native'))
check(
  '原生模式不加 JSON 协议',
  nativeAsks[0]?.system === undefined &&
    !String(nativeAsks[0]?.messages?.[0]?.content || '').includes('只输出 JSON'),
  JSON.stringify({ hasSystem: Boolean(nativeAsks[0]?.system) }),
)
check(
  'JSON 模式仍带协议',
  String(asks[0]?.system || '').includes('只输出 JSON'),
  JSON.stringify({ hasSystem: Boolean(asks[0]?.system) }),
)

// 显式 native + 未声明支持的模型：可读错误，不静默回退
let nativeUnsupported = ''
try {
  await lib.runSceneAgent({
    prompt: 'x',
    settings: { ...settings, agentToolProtocol: 'native' },
    ask: async () => ({ text: 'x' }),
    deps: {
      getShotContext: () => 'S01',
      runTrial: async () => ({ ok: true }),
      captureFrames: async () => [],
      reviewFrames: async () => ({ passed: true, items: [] }),
    },
  })
} catch (e) {
  nativeUnsupported = e.message
}
check('显式 native 不支持时报错', nativeUnsupported.includes('未声明支持原生工具调用'), nativeUnsupported)

// 事件桥：只映射可观察动作

const ev = lib.mapLangGraphEvent({ event: 'on_tool_start', name: 'run_render', run_id: 'r1', data: { input: { x: 1 } } })
check('tool_start 映射', ev?.type === 'tool_start' && ev.toolCallId === 'r1' && ev.toolName === 'run_render')
const evEnd = lib.mapLangGraphEvent({ event: 'on_tool_end', name: 'run_render', run_id: 'r1', data: { output: { ok: true } } })
check('tool_end 映射', evEnd?.type === 'tool_end' && evEnd.toolCallId === 'r1')
check('未知事件忽略', lib.mapLangGraphEvent({ event: 'on_chain_start' }) === null)
check('事件体积受限', String(JSON.stringify(lib.mapLangGraphEvent({ event: 'on_tool_end', name: 'x', run_id: 'r', data: { output: 'x'.repeat(30000) } }))).length < 20000)

// 有状态事件桥：模型轮次、工具去重、参数裁剪和隐藏推理过滤
const bridge = lib.createAgentEventBridge()
const stepStart = bridge.map({ event: 'on_chain_start', name: 'agent', run_id: 'model-1' })
const stepEnd = bridge.map({
  event: 'on_chain_end',
  name: 'agent',
  run_id: 'model-1',
  data: { output: { messages: [{ id: ['langchain_core', 'messages', 'AIMessage'], kwargs: { content: '先搭山体和地面', additional_kwargs: { reasoning_content: '不该展示的推理' } } }] } },
})
check('模型轮次 start/end', stepStart?.type === 'agent_step' && stepStart.phase === 'start' && stepEnd?.type === 'agent_step' && stepEnd.phase === 'end' && stepEnd.text === '先搭山体和地面', JSON.stringify({ stepStart, stepEnd }))
const emptyStep = lib.createAgentEventBridge().map({ event: 'on_chain_start', name: 'agent', run_id: 'e1' })
check('模型轮次可开始', emptyStep?.type === 'agent_step' && emptyStep.turn === 1)
const toolStart1 = bridge.map({ event: 'on_tool_start', name: 'set_scene_code', run_id: 'tool-1', data: { input: { code: 'const a = 1\nconst b = 2', reasoning: '秘密' } } })
const toolStart2 = bridge.map({ event: 'on_tool_start', name: 'set_scene_code', run_id: 'tool-1', data: { input: { code: 'again' } } })
check('工具开始去重', toolStart1?.type === 'tool_start' && toolStart2 === null && toolStart1.args?.codeLines === 2 && !JSON.stringify(toolStart1).includes('const a'), JSON.stringify(toolStart1))
const toolEnd = bridge.map({ event: 'on_tool_end', name: 'set_scene_code', run_id: 'tool-1', data: { output: { ok: false, error: '坏代码' } } })
check('工具结束标记错误', toolEnd?.type === 'tool_end' && toolEnd.isError === true && toolEnd.toolCallId === 'tool-1', JSON.stringify(toolEnd))
const hidden = lib.createAgentEventBridge().map({ event: 'on_chain_end', name: 'agent', run_id: 'm2', data: { output: { messages: [{ id: ['langchain_core', 'messages', 'AIMessage'], kwargs: { content: '可见说明', additional_kwargs: { reasoning_content: '隐藏推理' } } }] } } })
check('隐藏推理不进入事件', hidden?.type === 'agent_step' && hidden.text === '可见说明' && !JSON.stringify(hidden).includes('隐藏推理'), JSON.stringify(hidden))
const errBridge = lib.createAgentEventBridge()
const err1 = errBridge.map({ event: 'on_chain_error', name: 'agent', error: new Error('网络失败') })
const err2 = errBridge.map({ event: 'on_chain_error', name: 'agent', error: new Error('网络失败') })
check('终止错误去重', err1?.type === 'error' && err2 === null && err1.message.includes('网络失败'), JSON.stringify({ err1, err2 }))
const modelEvents = result.events.filter((e) => e.type === 'agent_step')
check('每轮模型都有 start/end', modelEvents.length === 12 && modelEvents[0]?.phase === 'start' && modelEvents[1]?.phase === 'end', String(modelEvents.length))

// JSON action 修复：代码字符串里的真实换行必须转义后才能解析
const repairedJson = lib.parseZCodeActionJson('{"content":"x","tool_calls":[{"name":"set_scene_code","args":{"code":"const a = 1\nconst b = 2"}}]}')
check('action JSON 控制字符修复', repairedJson?.tool_calls?.[0]?.args?.code === 'const a = 1\nconst b = 2', JSON.stringify(repairedJson))

// 失败修复一次后成功
let repairRuns = 0
const repairSeq = [
  { name: 'get_shot_context', args: {} },
  { name: 'set_scene_code', args: { code: CODE.replace('0x3b6ea5', '0x111111') } },
  { name: 'run_render', args: {} },
  { name: 'set_scene_code', args: { code: CODE } },
  { name: 'run_render', args: {} },
  { name: 'capture_frames', args: { times: [0, 2, 4] } },
  { name: 'review_frames', args: { requirements: ['山体', '两人', '双剑', '环绕'] } },
  { name: 'finish', args: { summary: '修复完成' } },
]
let repairIndex = 0
const repaired = await lib.runSceneAgent({
  prompt: '修复场景',
  settings,
  ask: async () => {
    const c = repairSeq[repairIndex++]
    return { json: { content: '', tool_calls: c ? [c] : [] }, modelKey: 'agent-model' }
  },
  deps: {
    getShotContext: () => 'S01',
    runTrial: async () => (++repairRuns === 1 ? { ok: false, error: '首帧没有绘制对象' } : { ok: true, firstFrame: 'data:image/jpeg;base64,AA' }),
    captureFrames: async (_c, times) => times.map((t) => ({ t, url: `data:image/jpeg;base64,${t}` })),
    reviewFrames: async (_f, reqs) => ({ passed: true, usedVision: true, items: reqs.map((label) => ({ key: label, label, ok: true })) }),
  },
})
check('渲染失败后修复成功', !repaired.error && repaired.attempts === 2 && repaired.trial?.ok, JSON.stringify({ error: repaired.error, attempts: repaired.attempts }))

// 不再按图步骤上限终止：持续工具调用只由总时长/取消约束
const noStepCap = await lib.runSceneAgent({
  prompt: '持续调用工具',
  settings,
  limits: { totalMs: 1000 },
  ask: async () => {
    await new Promise((r) => setTimeout(r, 20))
    return { json: { content: '', tool_calls: [{ name: 'get_shot_context', args: {} }] } }
  },
  deps: {
    getShotContext: () => 'S01',
    runTrial: async () => ({ ok: true }),
    captureFrames: async () => [],
    reviewFrames: async () => ({ passed: false, usedVision: false, needsHumanReview: true, items: [] }),
  },
})
check('不再出现步骤上限错误', Boolean(noStepCap.error) && noStepCap.error.includes('运行超时') && !noStepCap.error.includes('步骤达到上限'), JSON.stringify({ error: noStepCap.error, cancelled: noStepCap.cancelled }))

// 可配置总超时：显示运行超时，不是取消，也不产生草稿
const timedOut = await lib.runSceneAgent({
  prompt: '超时测试',
  settings,
  limits: { totalMs: 1000 },
  ask: (o) => new Promise((resolve, reject) => {
    const timer = setTimeout(() => resolve({ json: { content: '', tool_calls: [] } }), 5000)
    const onAbort = () => {
      clearTimeout(timer)
      reject(new DOMException('已中止', 'AbortError'))
    }
    if (o.signal?.aborted) onAbort()
    else o.signal?.addEventListener('abort', onAbort, { once: true })
  }),
  deps: {
    getShotContext: () => 'S01',
    runTrial: async () => ({ ok: true }),
    captureFrames: async () => [],
    reviewFrames: async () => ({ passed: false, usedVision: false, needsHumanReview: true, items: [] }),
  },
})
check('总超时显示运行超时', Boolean(timedOut.error) && timedOut.error.includes('运行超时') && !timedOut.cancelled && !timedOut.code, JSON.stringify({ error: timedOut.error, cancelled: timedOut.cancelled }))

// 无视觉模型：明确转人工，不伪造通过

const noVision = await lib.reviewFramesWithVision({ frames: [{ t: 0, url: '' }], requirements: ['山体', '两人'], settings: null })
check('无视觉模型转人工', noVision.needsHumanReview === true && noVision.usedVision === false && noVision.items.length === 2, JSON.stringify(noVision))

// 视觉验收上限：连续两次不通过后停止
let reviewRuns = 0
const reviewSeq = [
  { name: 'set_scene_code', args: { code: CODE } },
  { name: 'run_render', args: {} },
  { name: 'capture_frames', args: { times: [0, 1, 2] } },
  { name: 'review_frames', args: { requirements: ['山体'] } },
  { name: 'review_frames', args: { requirements: ['山体'] } },
]
let reviewIndex = 0
const reviewLimited = await lib.runSceneAgent({
  prompt: '验收失败',
  settings,
  ask: async () => {
    const c = reviewSeq[reviewIndex++]
    return { json: { content: '', tool_calls: c ? [c] : [] } }
  },
  deps: {
    getShotContext: () => 'S01',
    runTrial: async () => ({ ok: true, firstFrame: 'data:image/jpeg;base64,AA' }),
    captureFrames: async (_c, times) => times.map((t) => ({ t, url: `data:image/jpeg;base64,${t}` })),
    reviewFrames: async () => {
      reviewRuns++
      return { passed: false, usedVision: true, items: [{ key: 'mountain', label: '山体', ok: false, reason: '看不到山' }] }
    },
  },
})
check('视觉验收上限停止', Boolean(reviewLimited.error) && reviewLimited.reviewAttempts === 2 && reviewRuns === 2, JSON.stringify({ error: reviewLimited.error, attempts: reviewLimited.reviewAttempts, reviewRuns }))

// 工具白名单：当前镜头的 12 个工具，没有 shell/网络/保存
const session = lib.createSceneAgentSession()
const toolSet = lib.createSceneAgentTools({ getShotContext: () => '', runTrial: async () => ({ ok: false }), captureFrames: async () => [], reviewFrames: async () => ({ passed: false, usedVision: false, needsHumanReview: true, items: [] }) }, session)
const names = toolSet.tools.map((t) => t.name).sort()
check(
  '工具白名单固定',
  JSON.stringify(names) ===
    JSON.stringify([
      'append_scene_draft',
      'begin_scene_draft',
      'capture_frames',
      'commit_scene_draft',
      'discard_scene_draft',
      'finish',
      'get_shot_context',
      'patch_scene_draft',
      'read_scene_draft',
      'review_frames',
      'run_render',
      'set_scene_code',
    ]),
  JSON.stringify(names),
)

// 取消：外部 signal 已中止
const ac = new AbortController()
ac.abort()
const cancelled = await lib.runSceneAgent({
  prompt: '取消',
  settings,
  ask: async () => { throw new DOMException('已取消', 'AbortError') },
  deps: {
    getShotContext: () => 'S01',
    runTrial: async () => ({ ok: true }),
    captureFrames: async () => [],
    reviewFrames: async () => ({ passed: false, usedVision: false, needsHumanReview: true, items: [] }),
  },
  signal: ac.signal,
})
check('取消后结束且无代码', cancelled.cancelled === true && !cancelled.code, JSON.stringify({ cancelled: cancelled.cancelled, code: cancelled.code }))

// 达到代码修复上限
let failRuns = 0
const limitSeq = []
for (let i = 0; i < 3; i++) {
  limitSeq.push({ name: 'set_scene_code', args: { code: CODE.replace('0x3b6ea5', `0x${i + 1}11111`) } })
  limitSeq.push({ name: 'run_render', args: {} })
}
let limitIndex = 0
const limited = await lib.runSceneAgent({
  prompt: '持续失败',
  settings,
  ask: async () => {
    const c = limitSeq[limitIndex++]
    return { json: { content: '', tool_calls: c ? [c] : [] } }
  },
  deps: {
    getShotContext: () => 'S01',
    runTrial: async () => { failRuns++; return { ok: false, error: 'run failed' } },
    captureFrames: async () => [],
    reviewFrames: async () => ({ passed: false, usedVision: false, needsHumanReview: true, items: [] }),
  },
})
check('代码修复上限停止', Boolean(limited.error) && limited.attempts === 3, JSON.stringify({ error: limited.error, attempts: limited.attempts, failRuns }))

fs.rmSync(tmp, { recursive: true, force: true })
console.log(bad ? `\n${bad} failed` : '\nall passed')
process.exit(bad ? 1 : 0)
