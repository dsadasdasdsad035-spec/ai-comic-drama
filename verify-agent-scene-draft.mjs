/**
 * 场景草稿：服务端存储 + 草稿工具 + 历史压缩。
 * 跑法：node verify-agent-scene-draft.mjs
 */
import { build } from 'esbuild'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import {
  appendDraft,
  beginDraft,
  commitDraft,
  discardDraft,
  draftText,
  patchDraft,
  readDraft,
  sweepStaleDrafts,
} from './server/scene-draft.mjs'

const ROOT = process.cwd()
let bad = 0
const check = (name, cond, extra = '') => {
  console.log(`${cond ? '✅' : '❌'} ${name}${extra ? ` | ${extra}` : ''}`)
  if (!cond) bad++
}

async function load(entries) {
  const out = await build({
    stdin: {
      contents: entries
        .map((e) => `export * from ${JSON.stringify(e.startsWith('@') ? e : path.join(ROOT, e))}`)
        .join('\n'),
      resolveDir: ROOT,
      loader: 'ts',
    },
    bundle: true,
    format: 'esm',
    platform: 'node',
    write: false,
    logLevel: 'silent',
  })
  return import(`data:text/javascript;base64,${Buffer.from(out.outputFiles[0].text).toString('base64')}`)
}

// ---------- 1. 服务端草稿存储 ----------
const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'scene-draft-server-'))
try {
  const d = beginDraft({ project: 'demo', shotId: 'shot 1' }, tmpRoot)
  check('begin 创建固定路径', fs.existsSync(path.join(tmpRoot, '.scene-drafts', 'demo', 'shot-1', 'draft.py')))
  check('begin 空草稿 0 行', d.lines === 0 && d.chars === 0)

  appendDraft(d.id, 'line1\nline2\nline3\nline4')
  const read = readDraft(d.id, 2, 4)
  check('read 1-based 且 end 不含', read.text === '2: line2\n3: line3' && read.totalLines === 4, JSON.stringify(read.text))
  check('read 范围夹取', read.startLine === 2 && read.endLine === 4)

  const patched = patchDraft(d.id, 2, 3, 'LINE2\nLINE2b')
  check('patch 行数', patched.lines === 5, `lines=${patched.lines}`)
  const afterPatch = commitDraft(d.id).code
  check(
    'patch start 含 / end 不含',
    afterPatch === 'line1\nLINE2\nLINE2b\nline3\nline4',
    JSON.stringify(afterPatch),
  )

  let bigWriteRejected = false
  try {
    appendDraft(d.id, 'x'.repeat(32 * 1024 + 1))
  } catch {
    bigWriteRejected = true
  }
  check('单次写入 32KB 上限', bigWriteRejected)

  const total = beginDraft({ project: 'demo', shotId: 'cap' }, tmpRoot)
  for (let i = 0; i < 6; i++) appendDraft(total.id, 'x'.repeat(32 * 1024))
  let totalRejected = false
  try {
    appendDraft(total.id, 'y'.repeat(32 * 1024))
  } catch {
    totalRejected = true
  }
  check('草稿总量 200KB 上限', totalRejected)

  const many = beginDraft({ project: 'demo', shotId: 'many' }, tmpRoot)
  appendDraft(many.id, Array.from({ length: 300 }, (_, i) => `line-${i + 1}`).join('\n'))
  const readMany = readDraft(many.id, 1, 301)
  check('单次读取最多 200 行', readMany.endLine - readMany.startLine <= 200, `${readMany.startLine}-${readMany.endLine}`)
  check('单次读取 8KB 上限', Buffer.byteLength(readMany.text, 'utf8') <= 8 * 1024, `${Buffer.byteLength(readMany.text)}B`)

  const long = beginDraft({ project: 'demo', shotId: 'long' }, tmpRoot)
  appendDraft(long.id, Array.from({ length: 200 }, () => 'x'.repeat(100)).join('\n'))
  const readLong = readDraft(long.id, 1, 200)
  check('长行也受 8KB 限制', Buffer.byteLength(readLong.text, 'utf8') <= 8 * 1024)

  const oneLine = beginDraft({ project: 'demo', shotId: 'one-line' }, tmpRoot)
  appendDraft(oneLine.id, 'y'.repeat(32 * 1024))
  const readOneLine = readDraft(oneLine.id, 1, 2)
  check(
    '单行超长也按 8KB 截断',
    Buffer.byteLength(readOneLine.text, 'utf8') <= 8 * 1024 && readOneLine.text.includes('已截断'),
    `${Buffer.byteLength(readOneLine.text, 'utf8')}B`,
  )

  let traversalRejected = false
  try {
    beginDraft({ project: 'demo', shotId: '../../etc' }, tmpRoot)
  } catch {
    traversalRejected = true
  }
  check('拒绝 ../ 镜头标识', traversalRejected)
  let absoluteRejected = false
  try {
    beginDraft({ project: 'demo', shotId: '/tmp/abs' }, tmpRoot)
  } catch {
    absoluteRejected = true
  }
  check('拒绝绝对路径镜头标识', absoluteRejected)
  let dotRejected = false
  try {
    beginDraft({ project: 'demo', shotId: '..' }, tmpRoot)
  } catch {
    dotRejected = true
  }
  check('拒绝 .. 镜头标识', dotRejected)
  let projectRejected = false
  try {
    beginDraft({ project: '../demo', shotId: 'shot' }, tmpRoot)
  } catch {
    projectRejected = true
  }
  check('拒绝路径穿越项目名', projectRejected)

  // 符号链接：目录链和草稿文件都不能跟随到草稿目录外。
  const outsideDir = path.join(tmpRoot, 'outside-dir')
  const outside = path.join(outsideDir, 'outside.txt')
  fs.mkdirSync(outsideDir, { recursive: true })
  fs.writeFileSync(outside, 'SECRET')
  const symlinkProject = path.join(tmpRoot, '.scene-drafts', 'symlink-project')
  fs.symlinkSync(outsideDir, symlinkProject)
  let dirSymlinkRejected = false
  try {
    beginDraft({ project: 'symlink-project', shotId: 'shot' }, tmpRoot)
  } catch {
    dirSymlinkRejected = true
  }
  check('拒绝符号链接项目目录', dirSymlinkRejected)
  fs.rmSync(symlinkProject, { force: true })

  fs.rmSync(path.join(tmpRoot, '.scene-drafts', 'demo', 'shot-1', 'draft.py'))
  fs.symlinkSync(outside, path.join(tmpRoot, '.scene-drafts', 'demo', 'shot-1', 'draft.py'))
  let symlinkRejected = false
  try {
    appendDraft(d.id, 'hack')
  } catch {
    symlinkRejected = true
  }
  check('拒绝符号链接草稿文件', symlinkRejected)
  check('符号链接目标未被写入', fs.readFileSync(outside, 'utf8') === 'SECRET')

  discardDraft(many.id)
  let gone = false
  try {
    readDraft(many.id)
  } catch (e) {
    gone = e.code === 'not-found'
  }
  check('discard 后 404/not-found', gone)
  check('discard 删除目录', !fs.existsSync(path.join(tmpRoot, '.scene-drafts', 'demo', 'many')))

  const sweepRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'scene-draft-sweep-'))
  fs.mkdirSync(path.join(sweepRoot, '.scene-drafts', 'old', 's'), { recursive: true })
  fs.writeFileSync(path.join(sweepRoot, '.scene-drafts', 'old', 's', 'draft.py'), 'x')
  const removed = sweepStaleDrafts(sweepRoot, -1)
  check('启动 sweep 清理残留目录', removed >= 1)
  fs.rmSync(sweepRoot, { recursive: true, force: true })
} finally {
  fs.rmSync(tmpRoot, { recursive: true, force: true })
}

// ---------- 2. set_scene_code 的草稿路径（restricted 档） ----------
// 六个 scene-draft 工具已按 scene-agent-runtime 规范下线，对模型只剩「整段提交」：
// restricted 档下 set_scene_code 仍走服务端草稿（begin → 32KB 分片 append → commit 准入），
// 这里覆盖分片、准入与「试运行成功才算落地」的门禁。
const SETTINGS = { agentHostMode: 'restricted' }
const lib = await load([
  'src/agent/sceneAgentTools.ts',
  'src/agent/agentMessageReducer.ts',
  'src/agent/pi/compact.ts',
  'src/agent/tool.ts',
])

const BASE = `import bpy

_state = {}

def build(ctx):
    _state['ctx'] = ctx
    bpy.ops.mesh.primitive_cube_add()

def pose(t, mode):
    pass

def dispose():
    pass`

function memoryDraftClient(initial = '') {
  let text = initial
  let seq = 0
  let id = 'draft-0'
  const state = () => ({
    id,
    project: 'demo',
    shotId: 'S01',
    lines: text ? text.split('\n').length : 0,
    chars: text.length,
  })
  return {
    async begin() {
      id = `draft-${++seq}`
      text = ''
      return state()
    },
    async append(_id, chunk) {
      text += chunk
      return state()
    },
    async read(_id, startLine = 1, endLine) {
      const lines = text ? text.split('\n') : []
      const start = Math.max(1, Math.min(startLine, lines.length || 1))
      const end = Math.min(endLine ?? start + 199, lines.length)
      return {
        ...state(),
        text: lines.slice(start - 1, end).map((line, i) => `${start + i}: ${line}`).join('\n'),
        totalLines: lines.length,
        startLine: start,
        endLine: end,
      }
    },
    async patch(_id, startLine, endLine, replacement) {
      const lines = text ? text.split('\n') : []
      const insert = replacement ? replacement.split('\n') : []
      text = [...lines.slice(0, startLine - 1), ...insert, ...lines.slice(endLine - 1)].join('\n')
      return state()
    },
    async commit() {
      return { ...state(), code: text }
    },
    async discard() {
      text = ''
    },
    async text() {
      return text
    },
  }
}

const events = []
let draftCodeCalls = 0
let trialCalls = 0
let beginCalls = 0
let appendCalls = 0
let maxChunk = 0
const inner = memoryDraftClient()
const client = {
  begin: (scope) => {
    beginCalls++
    return inner.begin(scope)
  },
  append: (id, chunk) => {
    appendCalls++
    maxChunk = Math.max(maxChunk, String(chunk).length)
    return inner.append(id, chunk)
  },
  read: (...a) => inner.read(...a),
  patch: (...a) => inner.patch(...a),
  commit: (id) => inner.commit(id),
  discard: (id) => inner.discard(id),
  text: (id) => inner.text(id),
}
const session = lib.createSceneAgentSession()
const deps = {
  getShotContext: () => '【镜头】S01｜3.0s｜16:9',
  runTrial: async () => {
    trialCalls++
    return { ok: true }
  },
  captureFrames: async () => [],
  reviewFrames: async () => ({ passed: true, usedVision: true, items: [] }),
  onDraftCode: () => {
    draftCodeCalls++
  },
  draftScope: { project: 'demo', shotId: 'S01' },
  draftClient: client,
  onEvent: (e) => events.push(e),
}
const { byName } = lib.createSceneAgentTools(deps, session, undefined, SETTINGS)
const invoke = (name, args = {}) => {
  const tool = byName.get(name)
  if (!tool) throw new Error(`工具未注册：${name}`)
  return tool.invoke(args)
}

let r = await invoke('set_scene_code', { code: BASE })
check(
  'set_scene_code 写草稿后设为当前代码',
  r.ok === true && session.code === BASE && Boolean(session.codeHash),
  JSON.stringify({ ok: r.ok, error: r.error }),
)
check(
  '提交后记录草稿 id、行数与 committedAt',
  session.draft?.id === session.codeDraftId &&
    session.draft?.lines === BASE.split('\n').length &&
    Boolean(session.draft?.committedAt),
  JSON.stringify({ id: session.draft?.id, codeDraftId: session.codeDraftId }),
)
check('短代码只追加一次', beginCalls === 1 && appendCalls === 1, `begin=${beginCalls} append=${appendCalls}`)
check('发出 draft_started', events.some((e) => e.type === 'draft_started'))
check('发出成功的 draft_committed', events.some((e) => e.type === 'draft_committed' && e.ok === true))
check('提交草稿不触发 onDraftCode', draftCodeCalls === 0)

// 长代码：单次 append 不得超过 32KB，超出必须分片
const LONG = BASE.replace('def pose(t, mode):', '# ' + 'x'.repeat(40000) + '\ndef pose(t, mode):')
appendCalls = 0
maxChunk = 0
const progressBefore = events.filter((e) => e.type === 'draft_progress').length
r = await invoke('set_scene_code', { code: LONG })
check('长代码提交成功', r.ok === true, String(r.error || ''))
check('长代码按 32KB 分片追加', appendCalls >= 2, `chunks=${appendCalls}`)
check('单次分片不超过 32KB', maxChunk <= 32 * 1024, `max=${maxChunk}`)
check('分片写满整份代码', session.draft?.chars === LONG.length, `${session.draft?.chars}/${LONG.length}`)
check(
  '分片进度事件数与分片数一致',
  events.filter((e) => e.type === 'draft_progress').length - progressBefore === appendCalls,
  `events=${events.filter((e) => e.type === 'draft_progress').length - progressBefore} chunks=${appendCalls}`,
)

// UI 状态：提交后草稿卡是「已提交，待试运行」
const draftPartOf = (m, id) => m.parts.find((p) => p.type === 'draft' && p.draftId === id)
let msg = { id: 'm1', role: 'assistant', parts: [] }
for (const e of events) msg = lib.applyAgentEvent(msg, e)
const committedDraftId = session.codeDraftId
let draftPart = draftPartOf(msg, committedDraftId)
check('提交后草稿卡状态 committed', draftPart?.status === 'committed', draftPart?.status)
check('两次提交各有一张草稿卡', msg.parts.filter((p) => p.type === 'draft').length === 2)
r = await invoke('run_render')
check('run_render 试运行成功', r.ok === true && trialCalls === 1)
check('只有试运行成功才调 onDraftCode', draftCodeCalls === 1)
check(
  '试运行事件绑定到已提交草稿',
  events.some((e) => e.type === 'draft_trial' && e.draftId === committedDraftId && e.ok === true),
)
msg = lib.applyAgentEvent(msg, events.find((e) => e.type === 'draft_trial'))
draftPart = draftPartOf(msg, committedDraftId)
check('试运行后草稿卡状态 trial-passed', draftPart?.status === 'trial-passed', draftPart?.status)

// 准入失败：草稿照常写入，但当前代码必须保持不变
const beforeCode = session.code
const beforeHash = session.codeHash
r = await invoke('set_scene_code', { code: 'not python at all' })
check('准入失败返回可读错误', r.ok === false && /代码不可用/.test(String(r.error || '')), String(r.error || ''))
check('准入失败不改变当前代码', session.code === beforeCode && session.codeHash === beforeHash)
check('准入失败发出 ok=false 的 committed 事件', events.some((e) => e.type === 'draft_committed' && e.ok === false))

// ---------- 3. 工具暴露面：草稿工具族已下线 ----------
// scene-agent-runtime 规范要求两档都 MUST NOT 暴露这六个工具。
const DRAFT_TOOL_NAMES = [
  'begin_scene_draft',
  'append_scene_draft',
  'read_scene_draft',
  'patch_scene_draft',
  'commit_scene_draft',
  'discard_scene_draft',
]
const hostDeps = {
  ...deps,
  agentHost: {
    runBash: async () => ({ stdout: '' }),
    readFile: async () => 'pass',
    writeFile: async () => {},
    listDir: async () => [],
  },
}
{
  const restricted = lib.createSceneAgentTools(deps, lib.createSceneAgentSession(), undefined, {
    agentHostMode: 'restricted',
  })
  const names = [...restricted.byName.keys()]
  check('restricted 档不暴露草稿工具族', DRAFT_TOOL_NAMES.every((n) => !names.includes(n)), names.join(','))
  check('restricted 档保留 set_scene_code', names.includes('set_scene_code'), names.join(','))
  check('restricted 档不暴露 shell 与 adopt', !names.includes('run_bash') && !names.includes('adopt_scene_from_job'))

  const full = lib.createSceneAgentTools(hostDeps, lib.createSceneAgentSession(), undefined, {
    agentHostMode: 'full_host',
  })
  const fullNames = [...full.byName.keys()]
  check('full_host 档暴露 shell 与 adopt', fullNames.includes('run_bash') && fullNames.includes('adopt_scene_from_job'), fullNames.join(','))
  check('full_host 档同样不暴露草稿工具族', DRAFT_TOOL_NAMES.every((n) => !fullNames.includes(n)))
}

// ---------- 4. 历史压缩（旧会话记录里残留的草稿工具调用） ----------
// 这些工具已经下线，但既有 transcript 里仍有它们的调用；compactPiHistory 必须仍能把
// 连续分片折叠成摘要，否则老会话一续聊就爆上下文。夹具里的名字是历史数据，不是可调用工具。
const messages = []
for (let i = 0; i < 6; i++) {
  messages.push({
    role: 'assistant',
    content: [{ type: 'toolCall', id: `append-${i}`, name: 'append_scene_draft', arguments: { chunk: `chunk-${i}` } }],
    timestamp: i * 2 + 1,
  })
  messages.push({
    role: 'toolResult',
    toolCallId: `append-${i}`,
    toolName: 'append_scene_draft',
    content: [{ type: 'text', text: JSON.stringify({ ok: true, draftId: 'draft-1', lines: i + 1, chars: 100 }) }],
    isError: false,
    timestamp: i * 2 + 2,
  })
}
messages.push({
  role: 'assistant',
  content: [{ type: 'toolCall', id: 'commit-1', name: 'commit_scene_draft', arguments: {} }],
  timestamp: 20,
})
messages.push({
  role: 'toolResult',
  toolCallId: 'commit-1',
  toolName: 'commit_scene_draft',
  content: [{ type: 'text', text: JSON.stringify({ ok: true, draftId: 'draft-1', codeHash: 'abcdef1234', lineCount: 42 }) }],
  isError: false,
  timestamp: 21,
})
messages.push({ role: 'user', content: '继续', timestamp: 22 })
messages.push({
  role: 'assistant',
  content: [{ type: 'toolCall', id: 'append-tail', name: 'append_scene_draft', arguments: { chunk: 'tail' } }],
  timestamp: 23,
})
messages.push({
  role: 'toolResult',
  toolCallId: 'append-tail',
  toolName: 'append_scene_draft',
  content: [{ type: 'text', text: JSON.stringify({ ok: true, draftId: 'draft-1', lines: 43, chars: 110 }) }],
  isError: false,
  timestamp: 24,
})

const callsOf = (list) =>
  list
    .filter((m) => m.role === 'assistant')
    .flatMap((m) => m.content.filter((c) => c.type === 'toolCall'))

const compacted = lib.compactPiHistory(messages)
const appendCallsKept = callsOf(compacted).filter((c) => c.name === 'append_scene_draft')
check('历史压缩保留最近 4 次 + 提交后编辑', appendCallsKept.length === 5, `kept=${appendCallsKept.length}`)
check('历史压缩保留全部 commit', callsOf(compacted).some((c) => c.name === 'commit_scene_draft'))
check('历史压缩保留最近编辑 tail', appendCallsKept.some((c) => c.id === 'append-tail'))
check('历史压缩插入摘要', compacted.some((m) => m.role === 'system' && String(m.content).includes('场景草稿')))
const summary = compacted.find((m) => m.role === 'system')
check('摘要包含提交 hash/行数', String(summary?.content).includes('abcdef1234') && String(summary?.content).includes('42'))
check('被折叠的 toolResult 不再残留', !compacted.some((m) => m.role === 'toolResult' && m.toolCallId === 'append-0'))

const compactedNoCommit = lib.compactPiHistory(messages.slice(0, 12))
const noCommitAppends = callsOf(compactedNoCommit).filter((c) => c.name === 'append_scene_draft')
check('无 commit 时也只保留最近 4 次', noCommitAppends.length === 4, `kept=${noCommitAppends.length}`)

if (bad) {
  console.error(`\n${bad} 项失败`)
  process.exit(1)
}
console.log('\n场景草稿验收通过（服务端存储 + set_scene_code 草稿路径 + 工具暴露面 + 历史压缩）')
