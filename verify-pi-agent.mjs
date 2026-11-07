/**
 * pi 引擎行为验收：工具 schema / content-details 分离 / 结束门禁 / 顺序 / 催促 / 取消 / 超时 / 上限。
 * 全部 mock，不调用真实模型或 Blender。
 * 跑法：node verify-pi-agent.mjs
 */
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { execFileSync } from 'node:child_process'

const root = path.dirname(fileURLToPath(import.meta.url))
const tmp = fs.mkdtempSync(path.join(root, '.verify-pi-agent-'))
const entry = path.join(tmp, 'entry.ts')
fs.writeFileSync(
  entry,
  [
    `export * from ${JSON.stringify(path.join(root, 'src/agent/sceneAgentGraph.ts'))}`,
    `export * from ${JSON.stringify(path.join(root, 'src/agent/pi/events.ts'))}`,
    `export * from ${JSON.stringify(path.join(root, 'src/agent/pi/toolAdapter.ts'))}`,
    `export * from ${JSON.stringify(path.join(root, 'src/agent/tool.ts'))}`,
    `export * from ${JSON.stringify(path.join(root, 'src/agent/pi/streamFn.ts'))}`,
    `export * from ${JSON.stringify(path.join(root, 'src/agent/pi/compact.ts'))}`,
    `export * from ${JSON.stringify(path.join(root, 'src/agent/sceneAgentTools.ts'))}`,
    `export * from ${JSON.stringify(path.join(root, 'src/agent/sceneAgentTypes.ts'))}`,
    '',
  ].join('\n'),
)
const bundle = path.join(tmp, 'bundle.mjs')
execFileSync(path.join(root, 'node_modules', '.bin', 'esbuild'), [
  entry,
  '--bundle',
  '--platform=node',
  '--format=esm',
  '--log-level=error',
  `--outfile=${bundle}`,
])
const lib = await import(bundle)

let bad = 0
const watchdog = setTimeout(() => {
  console.error('❌ 测试超时（60s）：可能有引擎循环未终止')
  process.exit(2)
}, 60000)
const check = (name, cond, extra = '') => {
  console.log(`${cond ? '✅' : '❌'} ${name}${extra ? ` | ${extra}` : ''}`)
  if (!cond) bad++
}

const CODE = `import bpy
from mathutils import Vector
_state = {}

def build(ctx):
    _state['ctx'] = ctx
    bpy.ops.mesh.primitive_cone_add(vertices=8, radius1=5, depth=6, location=(-6, -6, 3))
    for x in (-0.7, 0.7):
        bpy.ops.mesh.primitive_cylinder_add(radius=0.22, depth=1.0, vertices=12, location=(x, 0, 0.8))
    ctx.camera.location = (7, -7, 3.2)

def pose(t, mode):
    pass

def dispose():
    pass`

// minimax / MiniMax-M3 在原生工具能力表内，pi 引擎才会启用
const settings = {
  providers: [{ id: 'minimax', label: 'MiniMax', kind: 'minimax', baseUrl: '', apiKey: '', caps: ['text'] }],
  models: [{ key: 'native-model', label: 'M3', cap: 'text', provider: 'minimax', model: 'MiniMax-M3' }],
  defaults: { text: 'native-model' },
  stageModels: { sceneCode: 'native-model' },
  agentToolProtocol: 'auto',
  agentEngine: 'pi',
  apiKey: '',
  rules: {},
}

function scriptedAsk(sequence, onCall) {
  let index = 0
  const ask = async (o) => {
    onCall?.(o, index)
    const step = sequence[Math.min(index, sequence.length - 1)]
    index += 1
    if (typeof step === 'function') return step(o, index)
    if (step.error) throw step.error
    const calls = step.calls || []
    return {
      text: step.text || '',
      finishReason: calls.length ? 'tool_calls' : step.finishReason || 'stop',
      toolCalls: calls.map((c, i) => ({
        id: c.id || `call_${index}_${i}`,
        name: c.name,
        arguments: JSON.stringify(c.args || {}),
      })),
    }
  }
  ask.calls = () => index
  return ask
}

function deps(overrides = {}) {
  return {
    getShotContext: () => '当前镜头 S01，4 秒，16:9',
    runTrial: async () => ({ ok: true, firstFrame: 'data:image/jpeg;base64,AA' }),
    captureFrames: async (_code, times) => times.map((t) => ({ t, url: `data:image/jpeg;base64,${t}` })),
    reviewFrames: async (_frames, reqs) => ({
      passed: true,
      usedVision: true,
      items: reqs.map((label) => ({ key: label, label, ok: true })),
    }),
    onDraftCode: () => {},
    ...overrides,
  }
}

// ---------------------------------------------------------------- 4.x 正常链路
{
  const sequence = [
    { calls: [{ name: 'get_shot_context', args: {} }] },
    { calls: [{ name: 'set_scene_code', args: { code: CODE } }] },
    { calls: [{ name: 'run_render', args: {} }] },
    { calls: [{ name: 'capture_frames', args: { times: [0, 1, 2, 3, 4] } }] },
    { calls: [{ name: 'review_frames', args: { requirements: ['山体', '两人'] } }] },
    { calls: [{ name: 'finish', args: { summary: '完成' } }] },
  ]
  const asks = []
  let draftCode = ''
  const result = await lib.runSceneAgent({
    prompt: '生成场景',
    settings,
    ask: scriptedAsk(sequence, (o) => asks.push(o)),
    requirements: ['山体', '两人'],
    deps: deps({ onDraftCode: (code) => { draftCode = code } }),
  })
  const toolStarts = result.events.filter((e) => e.type === 'tool_start').map((e) => e.toolName)
  check('pi 正常链路完成', result.finished === true && !result.error, JSON.stringify({ error: result.error }))
  check('工具顺序与模型一致', JSON.stringify(toolStarts) === JSON.stringify(['get_shot_context', 'set_scene_code', 'run_render', 'capture_frames', 'review_frames', 'finish']), JSON.stringify(toolStarts))
  check('代码进入草稿', result.code?.includes('primitive_cone_add') && draftCode === result.code)
  check('抓帧 5 张 + 验收通过', result.frames?.length === 5 && result.review?.passed === true, JSON.stringify({ frames: result.frames?.length, passed: result.review?.passed }))
  check('finish 后不再请求模型', asks.length === 6, String(asks.length))
  check('轨迹带工具协议事件', result.events.some((e) => e.type === 'custom' && e.name === 'tool_protocol' && e.value?.protocol === 'native'))
  check('模型请求带工具声明', asks[0]?.tools?.length === 6 && asks[0]?.toolChoice === 'auto', String(asks[0]?.tools?.length))
}

// ---------------------------------------------------------------- 4.5 顺序：抓帧不早于试运行
{
  const sequence = [
    {
      calls: [
        { name: 'set_scene_code', args: { code: CODE } },
        { name: 'run_render', args: {} },
        { name: 'capture_frames', args: { times: [0, 1] } },
        { name: 'review_frames', args: { requirements: ['a'] } },
        { name: 'finish', args: { summary: 'ok' } },
      ],
    },
  ]
  const order = []
  const result = await lib.runSceneAgent({
    prompt: '一次给全部工具',
    settings,
    ask: scriptedAsk(sequence),
    deps: deps({
      runTrial: async () => {
        order.push('trial')
        return { ok: true }
      },
      captureFrames: async () => {
        order.push('frames')
        return [{ t: 0, url: 'data:image/jpeg;base64,AA' }]
      },
    }),
  })
  check('同一批工具串行执行', JSON.stringify(order) === JSON.stringify(['trial', 'frames']), JSON.stringify(order))
  check('批量调用也能完成', result.finished === true && !result.error, JSON.stringify(result.error))
}

// ---------------------------------------------------------------- 4.1 schema 校验
{
  // 用真实工具 spec，但把 execute 换成探针：参数非法时 pi 必须在校验阶段拒绝，探针不应被调用。
  const session = lib.createSceneAgentSession()
  const built = lib.toPiTools(lib.createSceneAgentTools(deps(), session).tools)
  const finishTool = built.find((t) => t.name === 'finish')
  let executed = 0
  const probe = {
    ...finishTool,
    execute: async () => {
      executed += 1
      return { content: [{ type: 'text', text: 'should-not-run' }], details: {} }
    },
  }
  const { Agent } = await import('@earendil-works/pi-agent-core')
  const agent = new Agent({
    initialState: {
      systemPrompt: 'x',
      model: {
        id: 'm', name: 'm', api: 'openai-completions', provider: 'p', baseUrl: '', input: [],
        cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
        contextWindow: 1000, maxTokens: 1000, reasoning: false,
      },
      tools: [probe],
    },
    streamFn: lib.createPiStreamFn({
      ask: async () => ({ text: '', finishReason: 'tool_calls', toolCalls: [{ id: 'c1', name: 'finish', arguments: JSON.stringify({ summary: '' }) }] }),
    }),
    finishTurn: () => ({ action: 'end' }),
  })
  const seen = []
  agent.subscribe((e) => seen.push(e.type))
  await agent.prompt('非法参数')
  check('空 summary 在 schema 阶段被拒', executed === 0, String(executed))
  check('非法参数产生错误工具结果', seen.includes('tool_execution_end'), JSON.stringify(seen))
}

// ---------------------------------------------------------------- 4.15 full_host 工具注册
{
  const session = lib.createSceneAgentSession()
  const hostDeps = () => ({
    ...deps(),
    agentHost: {
      jobId: 'mock',
      runBash: async () => ({ exitCode: 0, stdout: '', stderr: '' }),
      readFile: async () => '',
      writeFile: async () => undefined,
      listDir: async () => [],
    },
  })
  const restricted = lib.createSceneAgentTools(hostDeps(), session, [], { agentHostMode: 'restricted' }).tools
  const full = lib.createSceneAgentTools(hostDeps(), session, [], { agentHostMode: 'full_host' }).tools
  const draftNames = [
    'begin_scene_draft',
    'append_scene_draft',
    'read_scene_draft',
    'patch_scene_draft',
    'commit_scene_draft',
    'discard_scene_draft',
  ]
  check('restricted 无 run_bash', !restricted.some((t) => t.name === 'run_bash'))
  check('restricted 无 adopt', !restricted.some((t) => t.name === 'adopt_scene_from_job'))
  check('restricted 无 scene-draft', !restricted.some((t) => draftNames.includes(t.name)))
  check('full_host 含 run_bash', full.some((t) => t.name === 'run_bash'))
  check('full_host 含 adopt_scene_from_job', full.some((t) => t.name === 'adopt_scene_from_job'))
  check('full_host 无 scene-draft', !full.some((t) => draftNames.includes(t.name)))
  check('full_host 工具数 +5', full.length === restricted.length + 5, `${restricted.length} -> ${full.length}`)
}

// ---------------------------------------------------------------- 4.2 content 与 details 分离
{
  const session = lib.createSceneAgentSession()
  session.code = CODE
  session.trial = { ok: true }
  const tools = lib.toPiTools(lib.createSceneAgentTools(deps(), session, ['山体']).tools)
  const capture = tools.find((t) => t.name === 'capture_frames')
  const out = await capture.execute('c1', { times: [0, 1] })
  const contentText = out.content.map((c) => c.text || '').join('')
  check('content 不含帧 data URL', !contentText.includes('data:image'), contentText.slice(0, 120))
  check('content 只保留时间点', JSON.parse(contentText).frames.every((f) => f.url === undefined), contentText)
  check('details 保留完整帧', Array.isArray(out.details?.frames) && out.details.frames[0].url.startsWith('data:image'), JSON.stringify(out.details).slice(0, 120))
  check('成功结果不是错误', !out.isError)
  const finish = tools.find((t) => t.name === 'finish')
  const failedFinish = await finish.execute('c2', { summary: 'x' })
  check('finish 未通过门禁时不终止', failedFinish.terminate !== true && failedFinish.isError === true, JSON.stringify(failedFinish.details))
}

// ---------------------------------------------------------------- 4.4 finish 成功后终止
{
  const sequence = [
    { calls: [{ name: 'set_scene_code', args: { code: CODE } }, { name: 'run_render', args: {} }, { name: 'capture_frames', args: { times: [0] } }, { name: 'review_frames', args: {} }, { name: 'finish', args: { summary: 'done' } }] },
    { text: '不应到达' },
  ]
  const result = await lib.runSceneAgent({ prompt: 'x', settings, ask: scriptedAsk(sequence), deps: deps() })
  check('finish 成功后结束', result.finished === true && result.summary === 'done', JSON.stringify({ finished: result.finished, summary: result.summary }))
}

// ---------------------------------------------------------------- 5.1/5.2 事件映射
{
  const bridge = lib.createPiEventBridge()
  const turnStart = bridge.map({ type: 'turn_start' })
  check('turn_start 映射为步骤开始', turnStart[0]?.type === 'agent_step' && turnStart[0].phase === 'start' && turnStart[0].turn === 1, JSON.stringify(turnStart))
  const textStart = bridge.map({ type: 'message_update', message: { role: 'assistant', content: [] }, assistantMessageEvent: { type: 'text_start' } })
  const textDelta = bridge.map({ type: 'message_update', message: { role: 'assistant', content: [] }, assistantMessageEvent: { type: 'text_delta', delta: '你好' } })
  check('text_start/delta 映射', textStart[0]?.type === 'text_message_start' && textDelta[0]?.type === 'text_message_content' && textDelta[0].delta === '你好', JSON.stringify({ textStart, textDelta }))
  const thinking = bridge.map({ type: 'message_update', message: { role: 'assistant', content: [] }, assistantMessageEvent: { type: 'thinking_delta', delta: '秘密' } })
  check('thinking 不进入事件', thinking.length === 0, JSON.stringify(thinking))
  const toolStart = bridge.map({ type: 'tool_execution_start', toolCallId: 't1', toolName: 'run_render', args: { code: 'line1\nline2' } })
  check('工具开始事件裁剪参数', toolStart[0]?.type === 'tool_start' && toolStart[0].args?.codeLines === 2 && !JSON.stringify(toolStart[0]).includes('line1'), JSON.stringify(toolStart[0]))
  const toolEnd = bridge.map({ type: 'tool_execution_end', toolCallId: 't1', toolName: 'run_render', result: { content: [], details: { ok: true }, isError: false }, isError: false })
  check('工具结束取 details', toolEnd[0]?.type === 'tool_end' && toolEnd[0].result?.ok === true, JSON.stringify(toolEnd[0]))
  const dup = bridge.map({ type: 'tool_execution_end', toolCallId: 't1', toolName: 'run_render', result: {}, isError: false })
  check('工具事件去重', dup.length === 0, JSON.stringify(dup))
}

// ---------------------------------------------------------------- 5.4 催促
{
  const asks = []
  const result = await lib.runSceneAgent({
    prompt: '只说一句话',
    settings,
    ask: scriptedAsk(
      [
        { text: '我先看看' },
        { calls: [{ name: 'set_scene_code', args: { code: CODE } }, { name: 'run_render', args: {} }, { name: 'capture_frames', args: { times: [0] } }, { name: 'review_frames', args: {} }, { name: 'finish', args: { summary: 'ok' } }] },
      ],
      (o, i) => asks.push(o),
    ),
    deps: deps(),
  })
  const second = asks[1]?.messages || []
  const nudge = second.filter((m) => m.role === 'user').map((m) => m.content).join('\n')
  check('无工具调用时注入催促', asks.length >= 2 && nudge.includes('请继续使用工具'), JSON.stringify({ calls: asks.length, nudge: nudge.slice(-80) }))
  check('催促后仍能完成', result.finished === true, JSON.stringify(result.error))
}

// ---------------------------------------------------------------- 5.5 取消
{
  let sawAbort = false
  let draftWrites = 0
  const liveEvents = []
  const controller = new AbortController()
  const run = lib.runSceneAgent({
    prompt: '渲染中取消',
    settings,
    signal: controller.signal,
    ask: scriptedAsk([{ calls: [{ name: 'set_scene_code', args: { code: CODE } }, { name: 'run_render', args: {} }] }]),
    deps: deps({
      onDraftCode: () => { draftWrites += 1 },
      onEvent: (e) => liveEvents.push(e),
      runTrial: async () => {
        await new Promise((resolve) => {
          const timer = setTimeout(resolve, 3000)
          controller.signal.addEventListener('abort', () => {
            sawAbort = true
            clearTimeout(timer)
            resolve()
          }, { once: true })
        })
        return { ok: false, error: '已取消' }
      },
    }),
  })
  setTimeout(() => controller.abort(), 120)
  const result = await run
  check('取消时工具收到 signal', sawAbort === true, String(sawAbort))
  check('取消结局不报失败', result.cancelled === true && !result.error, JSON.stringify({ cancelled: result.cancelled, error: result.error }))
  check('取消后不把代码交给工作台', draftWrites === 0, String(draftWrites))
  const afterCancel = liveEvents.slice(liveEvents.findIndex((e) => e.type === 'cancelled'))
  check('取消后不再推新事件', afterCancel.every((e) => e.type === 'cancelled'), afterCancel.map((e) => e.type).join(','))
  check('取消后没有运行完成事件', !liveEvents.some((e) => e.type === 'done'), liveEvents.map((e) => e.type).join(','))
}

// ---------------------------------------------------------------- 5.5 超时
{
  const started = Date.now()
  const result = await lib.runSceneAgent({
    prompt: '超时',
    settings,
    limits: { totalMs: 1100 },
    ask: scriptedAsk([{ calls: [{ name: 'set_scene_code', args: { code: CODE } }, { name: 'run_render', args: {} }] }]),
    deps: deps({
      runTrial: async () => {
        await new Promise((resolve) => setTimeout(resolve, 5000))
        return { ok: true }
      },
    }),
  })
  check('超时返回运行超时', String(result.error || '').includes('运行超时'), JSON.stringify(result.error))
  check('超时后循环结束', Date.now() - started < 4000, String(Date.now() - started))
}

// ---------------------------------------------------------------- 5.6 试跑失败不因次数提前停止
{
  let tries = 0
  const result = await lib.runSceneAgent({
    prompt: '一直失败',
    settings,
    limits: { totalMs: 2500 },
    ask: scriptedAsk([{ calls: [{ name: 'set_scene_code', args: { code: CODE } }, { name: 'run_render', args: {} }] }]),
    deps: deps({
      runTrial: async () => {
        tries += 1
        return { ok: false, error: '场景里没有对象' }
      },
    }),
  })
  check('试跑失败不因 3 次停止', !String(result.error || '').includes('代码修复达到 3 次上限'), JSON.stringify({ error: result.error, tries }))
  check('多次试跑仍被总时长收口', tries > 3, String(tries))
}


// ---------------------------------------------------------------- 6.2 环节模型前提（不再按能力表拦截）
{
  const nonNative = {
    ...settings,
    providers: [{ id: 'openai', label: 'O', kind: 'openai', baseUrl: '', apiKey: '', caps: ['text'] }],
    models: [{ key: 'plain', label: 'Plain', cap: 'text', provider: 'openai', model: 'gpt-x' }],
    stageModels: { sceneCode: 'plain' },
  }
  const supported = lib.sceneAgentCapability({ settings })
  check('已绑定环节模型 → 可用', supported.available === true, JSON.stringify(supported))
  const unlisted = lib.sceneAgentCapability({ settings: nonNative })
  check('能力表外模型仍可运行', unlisted.available === true, JSON.stringify(unlisted))

  let asked = 0
  const resultUnlisted = await lib.runSceneAgent({
    prompt: '非表内模型',
    settings: nonNative,
    ask: async () => {
      asked += 1
      return { text: '完成', finishReason: 'stop' }
    },
    deps: deps(),
  })
  check('能力表外模型可发起模型请求', asked >= 1, String(asked))
  check('能力表外模型协议仍为 native', resultUnlisted.toolProtocol === 'native', JSON.stringify(resultUnlisted.toolProtocol))

  const result = await lib.runSceneAgent({
    prompt: '原生模型',
    settings,
    ask: scriptedAsk([{ text: '完成' }]),
    deps: deps(),
  })
  check('单一引擎结果协议恒为 native', result.toolProtocol === 'native', JSON.stringify(result.toolProtocol))
  check('结果不再带引擎字段', !('engine' in result) && !('engineFallbackReason' in result), JSON.stringify(Object.keys(result)))
}


// ---------------------------------------------------------------- 6.3 试运行失败后修复（单引擎回归）
{
  const sequence = [
    {
      calls: [
        { name: 'set_scene_code', args: { code: CODE } },
        { name: 'run_render', args: {} },
      ],
    },
    {
      calls: [
        { name: 'set_scene_code', args: { code: CODE } },
        { name: 'run_render', args: {} },
      ],
    },
    {
      calls: [
        { name: 'capture_frames', args: { times: [0] } },
        { name: 'review_frames', args: {} },
        { name: 'finish', args: { summary: '修复完成' } },
      ],
    },
  ]
  let tries = 0
  const result = await lib.runSceneAgent({
    prompt: '修复场景',
    settings,
    ask: scriptedAsk(sequence),
    deps: deps({
      runTrial: async () => {
        tries += 1
        return tries === 1 ? { ok: false, error: '场景里没有对象' } : { ok: true, firstFrame: 'data:image/jpeg;base64,AA' }
      },
    }),
  })
  const toolStarts = result.events.filter((e) => e.type === 'tool_start').map((e) => e.toolName)
  check('试运行失败后继续修复', tries === 2 && result.finished === true && !result.error, JSON.stringify({ tries, error: result.error }))
  check('修复后仍完整走完验收', toolStarts.filter((n) => n === 'run_render').length === 2 && result.review?.passed === true, JSON.stringify(toolStarts))
}

// ---------------------------------------------------------------- 6.4 镜头隔离（单引擎回归）
{
  // 记录型草稿客户端：断言所有草稿操作都落在当前镜头。
  const scopes = []
  let draftSeq = 0
  const recordingClient = {
    async begin(scope) {
      scopes.push(scope.shotId)
      draftSeq += 1
      return { id: `d${draftSeq}`, project: scope.project, shotId: scope.shotId, lines: 0, chars: 0 }
    },
    async append(id) {
      return { id, project: 'p', shotId: 'S01', lines: 1, chars: 1 }
    },
    async read(id) {
      return { id, project: 'p', shotId: 'S01', lines: 1, chars: 1, text: '', totalLines: 1, startLine: 1, endLine: 2 }
    },
    async patch(id) {
      return { id, project: 'p', shotId: 'S01', lines: 1, chars: 1 }
    },
    async commit(id) {
      return { id, project: 'p', shotId: 'S01', lines: 1, chars: 1, code: CODE }
    },
    async discard() {},
    async text() {
      return CODE
    },
  }
  const result = await lib.runSceneAgent({
    prompt: '隔离验收',
    settings: { ...settings, agentHostMode: 'restricted' },
    ask: scriptedAsk([
      {
        calls: [
          { name: 'set_scene_code', args: { code: CODE } },
          { name: 'run_render', args: {} },
          { name: 'capture_frames', args: { times: [0] } },
          { name: 'review_frames', args: {} },
          { name: 'finish', args: { summary: 'ok' } },
        ],
      },
    ]),
    deps: deps({ draftScope: { project: 'p', shotId: 'S01' }, draftClient: recordingClient }),
  })
  check('镜头隔离：草稿作用域只有当前镜头', scopes.length > 0 && scopes.every((id) => id === 'S01'), JSON.stringify(scopes))
  check('镜头隔离：代码写入当前草稿', Boolean(result.code?.includes('primitive_cone_add')) && !result.error, JSON.stringify(result.error))
}

clearTimeout(watchdog)
fs.rmSync(tmp, { recursive: true, force: true })
console.log(bad ? `\n${bad} 项失败` : '\npi 引擎验收通过')
process.exitCode = bad ? 1 : 0
