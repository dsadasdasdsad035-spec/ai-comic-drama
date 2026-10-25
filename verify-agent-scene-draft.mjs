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

// ---------- 2. 草稿工具 + 事件 + commit/trial 边界 ----------
const lib = await load([
  'src/agent/sceneAgentTools.ts',
  'src/agent/agentMessageReducer.ts',
  'src/agent/agentHistory.ts',
  'src/agent/zcodeChatModel.ts',
  '@langchain/core/messages',
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
const client = memoryDraftClient()
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
const { byName } = lib.createSceneAgentTools(deps, session)
const invoke = (name, args = {}) => byName.get(name).invoke(args)

let r = await invoke('begin_scene_draft')
check('begin 工具创建草稿', r.ok === true && session.draft?.lines === 0 && r.draftId)
check('begin 发出 draft_started', events.some((e) => e.type === 'draft_started'))

const parts = BASE.split(/(?<=\n)/)
r = await invoke('append_scene_draft', { chunk: parts.slice(0, 5).join('') })
check('append 第一段', r.ok === true && r.lines > 0)
r = await invoke('append_scene_draft', { chunk: parts.slice(5).join('') })
check('append 第二段行数', r.ok === true && r.lines === BASE.split('\n').length, `${r.lines}`)
r = await invoke('read_scene_draft', { startLine: 1, endLine: 4 })
check('read 工具返回带行号片段', r.ok === true && /^1: import bpy/m.test(r.text), JSON.stringify(r.text))
r = await invoke('patch_scene_draft', { startLine: 1, endLine: 2, text: 'import bpy\n# patched' })
check('patch 工具替换片段', r.ok === true)

r = await invoke('commit_scene_draft')
check('commit 通过准入并设为 session.code', r.ok === true && session.code?.includes('# patched') && session.codeHash)
check('commit 不发 onDraftCode', draftCodeCalls === 0)
check('commit 发出 draft_committed', events.some((e) => e.type === 'draft_committed' && e.ok === true))
check('commit 记录 committedAt', Boolean(session.draft?.committedAt))

// UI 状态：提交后是“已提交，待试运行”
let msg = { id: 'm1', role: 'assistant', parts: [] }
for (const e of events) msg = lib.applyAgentEvent(msg, e)
let draftPart = msg.parts.find((p) => p.type === 'draft')
check('提交后草稿卡状态 committed', draftPart?.status === 'committed', draftPart?.status)

r = await invoke('run_render')
check('run_render 试运行成功', r.ok === true && trialCalls === 1)
check('只有试运行成功才调 onDraftCode', draftCodeCalls === 1)
msg = lib.applyAgentEvent(msg, events.find((e) => e.type === 'draft_trial'))
draftPart = msg.parts.find((p) => p.type === 'draft')
check('试运行后草稿卡状态 trial-passed', draftPart?.status === 'trial-passed', draftPart?.status)

// 提交后再改：旧 session.code 仍有效，但下一次试运行不再算到新草稿上
r = await invoke('append_scene_draft', { chunk: '\n# more' })
check('提交后 append 回到暂存', r.ok === true && !session.draft?.committedAt && session.codeDraftId === undefined)
const trialEventsBefore = events.filter((e) => e.type === 'draft_trial').length
await invoke('run_render')
check('未提交改动不产生新的 trial 状态', events.filter((e) => e.type === 'draft_trial').length === trialEventsBefore)

// 准入失败：session.code 不变
const beforeCode = session.code
r = await invoke('begin_scene_draft')
await invoke('append_scene_draft', { chunk: 'not python at all' })
r = await invoke('commit_scene_draft')
check('准入失败不改变 session.code', r.ok === false && session.code === beforeCode, JSON.stringify(r))
check('准入失败发出 ok=false 的 committed 事件', events.some((e) => e.type === 'draft_committed' && e.ok === false))

r = await invoke('discard_scene_draft')
check('discard 清理会话草稿', r.ok === true && !session.draft)
check('discard 发出 draft_discarded', events.some((e) => e.type === 'draft_discarded'))

// set_scene_code 仍然是短代码快捷方式：内部写入草稿并立即 commit
r = await invoke('set_scene_code', { code: BASE })
check(
  'set_scene_code 兼容（写入草稿并提交）',
  r.ok === true && session.code === BASE && session.draft?.id === session.codeDraftId && Boolean(session.draft?.committedAt),
  JSON.stringify({ ok: r.ok, draft: session.draft, codeDraftId: session.codeDraftId }),
)

// ---------- 3. 历史压缩 ----------
const { AIMessage, HumanMessage, SystemMessage, ToolMessage } = lib
const messages = []
for (let i = 0; i < 6; i++) {
  messages.push(
    new AIMessage({
      content: '',
      tool_calls: [{ name: 'append_scene_draft', args: { chunk: `chunk-${i}` }, id: `append-${i}` }],
    }),
  )
  messages.push(
    new ToolMessage({
      content: JSON.stringify({ ok: true, draftId: 'draft-1', lines: i + 1, chars: 100 }),
      tool_call_id: `append-${i}`,
      name: 'append_scene_draft',
    }),
  )
}
messages.push(
  new AIMessage({ content: '', tool_calls: [{ name: 'commit_scene_draft', args: {}, id: 'commit-1' }] }),
)
messages.push(
  new ToolMessage({
    content: JSON.stringify({ ok: true, draftId: 'draft-1', codeHash: 'abcdef1234', lineCount: 42 }),
    tool_call_id: 'commit-1',
    name: 'commit_scene_draft',
  }),
)
messages.push(new HumanMessage('继续'))
messages.push(
  new AIMessage({ content: '', tool_calls: [{ name: 'append_scene_draft', args: { chunk: 'tail' }, id: 'append-tail' }] }),
)
messages.push(
  new ToolMessage({
    content: JSON.stringify({ ok: true, draftId: 'draft-1', lines: 43, chars: 110 }),
    tool_call_id: 'append-tail',
    name: 'append_scene_draft',
  }),
)
const compacted = lib.compactDraftHistory(messages)
const appendCalls = compacted
  .filter((m) => m instanceof AIMessage)
  .flatMap((m) => m.tool_calls || [])
  .filter((c) => c.name === 'append_scene_draft')
check('历史压缩保留最近 4 次 + 提交后编辑', appendCalls.length === 5, `kept=${appendCalls.length}`)
check('历史压缩保留全部 commit', compacted.some((m) => m instanceof AIMessage && m.tool_calls?.some((c) => c.name === 'commit_scene_draft')))
check('历史压缩保留最近编辑 tail', appendCalls.some((c) => c.id === 'append-tail'))
check('历史压缩插入摘要', compacted.some((m) => m instanceof SystemMessage && String(m.content).includes('场景草稿')))
const summary = compacted.find((m) => m instanceof SystemMessage)
check('摘要包含提交 hash/行数', String(summary?.content).includes('abcdef1234') && String(summary?.content).includes('42'))
const promptAfterCompact = lib.historyPrompt(messages)
check(
  '模型历史包含草稿摘要且不含被折叠分片',
  promptAfterCompact.includes('[场景草稿]') && !promptAfterCompact.includes('chunk-0'),
  promptAfterCompact.slice(0, 300),
)

const compactedNoCommit = lib.compactDraftHistory(messages.slice(0, 12))
const noCommitAppends = compactedNoCommit
  .filter((m) => m instanceof AIMessage)
  .flatMap((m) => m.tool_calls || [])
  .filter((c) => c.name === 'append_scene_draft')
check('无 commit 时也只保留最近 4 次', noCommitAppends.length === 4, `kept=${noCommitAppends.length}`)

// ---------- 4. 提示词 ----------
const skillPrompt = fs.readFileSync(path.join(ROOT, 'skills/scene3d/SKILL.md'), 'utf8')
check(
  '技能提示词包含草稿工具',
  ['begin_scene_draft', 'append_scene_draft', 'read_scene_draft', 'patch_scene_draft', 'commit_scene_draft'].every((n) =>
    skillPrompt.includes(n),
  ),
)

if (bad) {
  console.error(`\n${bad} 项失败`)
  process.exit(1)
}
console.log('\n场景草稿单元验收通过')
