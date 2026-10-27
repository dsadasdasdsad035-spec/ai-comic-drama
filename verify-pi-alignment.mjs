/**
 * 双引擎对齐验收：同一组 mock 输入分别跑 langgraph 与 pi，比较可观察行为。
 * 不调用真实模型或 Blender。
 * 跑法：node verify-pi-alignment.mjs
 */
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { execFileSync } from 'node:child_process'

const root = path.dirname(fileURLToPath(import.meta.url))
const tmp = fs.mkdtempSync(path.join(root, '.verify-pi-align-'))
const entry = path.join(tmp, 'entry.ts')
fs.writeFileSync(entry, `export * from ${JSON.stringify(path.join(root, 'src/agent/sceneAgentGraph.ts'))}\n`)
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

const watchdog = setTimeout(() => {
  console.error('❌ 对齐测试超时（120s）')
  process.exit(2)
}, 120000)

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

// 两个引擎都走原生工具协议，才能共用同一份 mock ask。
const settings = {
  providers: [{ id: 'minimax', label: 'MiniMax', kind: 'minimax', baseUrl: '', apiKey: '', caps: ['text'] }],
  models: [{ key: 'native-model', label: 'M3', cap: 'text', provider: 'minimax', model: 'MiniMax-M3' }],
  defaults: { text: 'native-model' },
  stageModels: { sceneCode: 'native-model' },
  agentToolProtocol: 'auto',
  apiKey: '',
  rules: {},
}

function scriptedAsk(sequence) {
  let index = 0
  return async () => {
    const step = sequence[Math.min(index, sequence.length - 1)]
    index += 1
    const calls = step.calls || []
    return {
      text: step.text || '',
      finishReason: calls.length ? 'tool_calls' : 'stop',
      toolCalls: calls.map((c, i) => ({
        id: c.id || `call_${index}_${i}`,
        name: c.name,
        arguments: JSON.stringify(c.args || {}),
      })),
    }
  }
}

function baseDeps(overrides = {}) {
  return {
    getShotContext: () => '当前镜头 S01，4 秒，16:9',
    runTrial: async () => ({ ok: true }),
    captureFrames: async (_code, times) => times.map((t) => ({ t, url: `data:image/jpeg;base64,${t}` })),
    reviewFrames: async (_frames, reqs) => ({
      passed: true,
      usedVision: true,
      items: reqs.map((label) => ({ key: label, label, ok: true })),
    }),
    ...overrides,
  }
}

async function run(engine, { sequence, deps, initialCode, limits, controller, withTimeoutMs = 30000 }) {
  const promise = lib.runSceneAgent({
    prompt: '对齐验收',
    engine,
    settings,
    ask: scriptedAsk(sequence),
    deps: deps(),
    ...(initialCode ? { initialCode } : {}),
    ...(limits ? { limits } : {}),
    ...(controller ? { signal: controller.signal } : {}),
  })
  const timeout = new Promise((_, reject) => setTimeout(() => reject(new Error('scenario timeout')), withTimeoutMs))
  return Promise.race([promise, timeout])
}

function shape(result) {
  return {
    tools: result.events.filter((e) => e.type === 'tool_start').map((e) => e.toolName),
    errorFlags: result.events.filter((e) => e.type === 'tool_end').map((e) => Boolean(e.isError)),
    codeHash: result.codeHash || '',
    frames: result.frames?.length ?? 0,
    reviewPassed: result.review?.passed ?? null,
    finished: Boolean(result.finished),
    cancelled: Boolean(result.cancelled),
    error: result.error || '',
  }
}

async function compare(name, scenario, pick) {
  const a = shape(await run('langgraph', scenario))
  const b = shape(await run('pi', scenario))
  const fields = pick || ['tools', 'errorFlags', 'codeHash', 'frames', 'reviewPassed', 'finished', 'cancelled', 'error']
  for (const field of fields) {
    const same = JSON.stringify(a[field]) === JSON.stringify(b[field])
    check(`${name} · ${field} 一致`, same, same ? '' : `langgraph=${JSON.stringify(a[field])} pi=${JSON.stringify(b[field])}`)
  }
  return { a, b }
}

// ---------------------------------------------------------------- 1 正常生成
await compare('正常生成', {
  sequence: [
    { calls: [{ name: 'get_shot_context', args: {} }] },
    { calls: [{ name: 'set_scene_code', args: { code: CODE } }] },
    { calls: [{ name: 'run_render', args: {} }] },
    { calls: [{ name: 'capture_frames', args: { times: [0, 1, 2, 3, 4] } }] },
    { calls: [{ name: 'review_frames', args: { requirements: ['山体', '两人'] } }] },
    { calls: [{ name: 'finish', args: { summary: '完成' } }] },
  ],
  deps: () => baseDeps(),
})

// ---------------------------------------------------------------- 2 试运行失败后修复
await compare('试运行失败后修复', {
  sequence: [
    { calls: [{ name: 'set_scene_code', args: { code: CODE } }, { name: 'run_render', args: {} }] },
    { calls: [{ name: 'set_scene_code', args: { code: CODE } }, { name: 'run_render', args: {} }] },
    { calls: [{ name: 'capture_frames', args: { times: [0] } }, { name: 'review_frames', args: {} }, { name: 'finish', args: { summary: '修复完成' } }] },
  ],
  deps: () => {
    let tries = 0
    return baseDeps({
      runTrial: async () => {
        tries += 1
        return tries === 1 ? { ok: false, error: '场景里没有对象' } : { ok: true }
      },
    })
  },
})

// ---------------------------------------------------------------- 3 视觉验收未通过到达上限
await compare('视觉验收上限', {
  sequence: [
    { calls: [{ name: 'set_scene_code', args: { code: CODE } }, { name: 'run_render', args: {} }, { name: 'capture_frames', args: { times: [0] } }, { name: 'review_frames', args: {} }] },
  ],
  deps: () => baseDeps({
    reviewFrames: async (_frames, reqs) => ({
      passed: false,
      usedVision: true,
      items: reqs.map((label) => ({ key: label, label, ok: false, reason: '缺失' })),
    }),
  }),
}, ['tools', 'errorFlags', 'finished', 'cancelled', 'error'])

// ---------------------------------------------------------------- 4 空镜头先跑渲染
await compare('空镜头先跑渲染', {
  sequence: [
    { calls: [{ name: 'run_render', args: {} }] },
    { calls: [{ name: 'set_scene_code', args: { code: CODE } }, { name: 'run_render', args: {} }, { name: 'capture_frames', args: { times: [0] } }, { name: 'review_frames', args: {} }, { name: 'finish', args: { summary: '恢复完成' } }] },
  ],
  deps: () => baseDeps(),
})

// ---------------------------------------------------------------- 5 已有代码基线
await compare('已有代码基线', {
  initialCode: CODE,
  sequence: [
    { calls: [{ name: 'run_render', args: {} }] },
    { calls: [{ name: 'capture_frames', args: { times: [0] } }, { name: 'review_frames', args: {} }, { name: 'finish', args: { summary: '基线完成' } }] },
  ],
  deps: () => baseDeps(),
})

// ---------------------------------------------------------------- 6 取消
{
  for (const engine of ['langgraph', 'pi']) {
    const controller = new AbortController()
    setTimeout(() => controller.abort(), 150)
    const result = await run(engine, {
      sequence: [{ calls: [{ name: 'set_scene_code', args: { code: CODE } }, { name: 'run_render', args: {} }] }],
      controller,
      deps: () => baseDeps({
        runTrial: async () => {
          await new Promise((resolve) => {
            const timer = setTimeout(resolve, 3000)
            controller.signal.addEventListener('abort', () => { clearTimeout(timer); resolve() }, { once: true })
          })
          return { ok: false, error: '已取消' }
        },
      }),
    })
    check(`取消 · ${engine} 标记取消`, result.cancelled === true && !result.error, JSON.stringify({ cancelled: result.cancelled, error: result.error }))
  }
}

// ---------------------------------------------------------------- 7 超时
{
  const results = {}
  for (const engine of ['langgraph', 'pi']) {
    const started = Date.now()
    const result = await run(engine, {
      sequence: [{ calls: [{ name: 'set_scene_code', args: { code: CODE } }, { name: 'run_render', args: {} }] }],
      limits: { totalMs: 1100 },
      withTimeoutMs: 20000,
      deps: () => baseDeps({ runTrial: async () => { await new Promise((r) => setTimeout(r, 5000)); return { ok: true } } }),
    })
    results[engine] = { error: result.error || '', elapsed: Date.now() - started }
  }
  check('超时 · 两个引擎都报运行超时', results.langgraph.error.includes('运行超时') && results.pi.error.includes('运行超时'), JSON.stringify(results))
  check('超时 · 都在时限附近结束', results.langgraph.elapsed < 5000 && results.pi.elapsed < 5000, JSON.stringify(results))
}

// ---------------------------------------------------------------- 8 镜头隔离
{
  const isolated = { touched: [], scopes: [] }
  // 记录型草稿客户端：断言所有草稿操作都落在当前镜头。
  let draftSeq = 0
  const recordingClient = {
    async begin(scope) {
      isolated.scopes.push(scope.shotId)
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
  for (const engine of ['langgraph', 'pi']) {
    isolated.scopes.length = 0
    const result = await run(engine, {
      sequence: [
        { calls: [{ name: 'set_scene_code', args: { code: CODE } }, { name: 'run_render', args: {} }, { name: 'capture_frames', args: { times: [0] } }, { name: 'review_frames', args: {} }, { name: 'finish', args: { summary: 'ok' } }] },
      ],
      deps: () => baseDeps({
        onDraftCode: () => isolated.touched.push(engine),
        draftScope: { project: 'p', shotId: 'S01' },
        draftClient: recordingClient,
      }),
    })
    check(`镜头隔离 · ${engine} 只写当前草稿`, !result.error && result.code?.includes('primitive_cone_add'), JSON.stringify(result.error))
    check(`镜头隔离 · ${engine} 草稿作用域只有当前镜头`, isolated.scopes.every((shotId) => shotId === 'S01'), JSON.stringify(isolated.scopes))
  }
  check('镜头隔离 · 两个引擎都未触及其他镜头', isolated.touched.length === 2, JSON.stringify(isolated.touched))
}


// ---------------------------------------------------------------- 9 事件分组一致
{
  const scenario = {
    sequence: [
      { calls: [{ name: 'get_shot_context', args: {} }] },
      { calls: [{ name: 'set_scene_code', args: { code: CODE } }] },
      { calls: [{ name: 'run_render', args: {} }] },
      { calls: [{ name: 'capture_frames', args: { times: [0, 1] } }] },
      { calls: [{ name: 'review_frames', args: { requirements: ['a'] } }] },
      { calls: [{ name: 'finish', args: { summary: '完成' } }] },
    ],
    deps: () => baseDeps(),
  }
  const counts = async (engine) => {
    const result = await run(engine, scenario)
    const count = (type) => result.events.filter((e) => e.type === type).length
    return {
      steps: count('agent_step'),
      textStart: count('text_message_start'),
      textEnd: count('text_message_end'),
      toolStart: count('tool_start'),
      toolEnd: count('tool_end'),
      toolStartsUnique: new Set(result.events.filter((e) => e.type === 'tool_start').map((e) => e.toolCallId)).size,
    }
  }
  const a = await counts('langgraph')
  const b = await counts('pi')
  check('事件分组 · 工具起止数量一致', a.toolStart === b.toolStart && a.toolEnd === b.toolEnd, JSON.stringify({ a, b }))
  check('事件分组 · 工具 id 去重一致', a.toolStartsUnique === a.toolStart && b.toolStartsUnique === b.toolStart, JSON.stringify({ a, b }))
  check('事件分组 · 步骤数量一致', a.steps === b.steps, JSON.stringify({ a, b }))
  check('事件分组 · 文本生命周期成对', a.textStart === a.textEnd && b.textStart === b.textEnd, JSON.stringify({ a, b }))
}

clearTimeout(watchdog)
fs.rmSync(tmp, { recursive: true, force: true })
console.log(bad ? `\n${bad} 项不一致` : '\n双引擎对齐通过')
process.exitCode = bad ? 1 : 0
