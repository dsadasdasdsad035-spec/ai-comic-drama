/**
 * 同一轮连续调用同名工具时，两次调用必须各留一张卡、各自带着结果。
 * 历史组装只收录 status=done 的 tool-call，一旦被误接管就会丢结果。
 * 跑法：node verify-creative-thread-tool-dedup.mjs
 */
import { build } from 'esbuild'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

const ROOT = process.cwd()
const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'tool-dedup-'))
let bad = 0
const check = (name, cond, extra = '') => {
  console.log(`${cond ? '✅' : '❌'} ${name}${extra ? ` | ${extra}` : ''}`)
  if (!cond) bad++
}

const entry = path.join(TMP, 'entry.ts')
fs.writeFileSync(
  entry,
  [
    `export * from ${JSON.stringify(path.join(ROOT, 'src/agent/agentMessageReducer.ts'))}`,
    `export * from ${JSON.stringify(path.join(ROOT, 'src/agent/pi/threadMemory.ts'))}`,
  ].join('\n'),
)
const out = await build({
  entryPoints: [entry],
  bundle: true,
  format: 'esm',
  platform: 'node',
  write: false,
  logLevel: 'error',
})
const lib = await import('data:text/javascript;base64,' + Buffer.from(out.outputFiles[0].text).toString('base64'))
const { applyAgentEvent, uiThreadToPiMessages } = lib

const START = { id: 'a1', role: 'assistant', status: 'running', parts: [] }

// 复现现场：同一轮里连读两个技能，第二次调用没有任何流式参数
let msg = START
msg = applyAgentEvent(msg, { type: 'tool_start', toolCallId: 'call-A', toolName: 'read_skill_text', args: { id: 'novel-storyboard' } })
msg = applyAgentEvent(msg, {
  type: 'tool_end',
  toolCallId: 'call-A',
  toolName: 'read_skill_text',
  result: { ok: true, id: 'novel-storyboard', text: 'A'.repeat(9000) },
  isError: false,
})
msg = applyAgentEvent(msg, { type: 'tool_start', toolCallId: 'call-B', toolName: 'read_skill_text', args: { id: 'character-refs' } })
msg = applyAgentEvent(msg, {
  type: 'tool_end',
  toolCallId: 'call-B',
  toolName: 'read_skill_text',
  result: { ok: true, id: 'character-refs', text: 'B'.repeat(8000) },
  isError: false,
})

const tools = msg.parts.filter((p) => p.type === 'tool-call')
check('两次同名调用各留一张卡', tools.length === 2, `${tools.length} 张`)
check('两张卡都是 done', tools.every((p) => p.status === 'done'), tools.map((p) => p.status).join(','))
check(
  '第一次调用的结果没有被后一次覆盖',
  tools[0]?.result?.id === 'novel-storyboard' && String(tools[0]?.result?.text || '').length === 9000,
  `${tools[0]?.result?.id} / ${String(tools[0]?.result?.text || '').length}`,
)
check(
  '第一次调用的参数没有被后一次覆盖',
  tools[0]?.args?.id === 'novel-storyboard',
  JSON.stringify(tools[0]?.args ?? null),
)
check('第二次调用拿到自己的结果', tools[1]?.result?.id === 'character-refs')

// 转成 Pi 历史后，两份技能正文都得在
const history = uiThreadToPiMessages([{ ...msg, status: 'complete' }])
const dumped = JSON.stringify(history)
check('历史里含第一份技能正文', dumped.includes('A'.repeat(9000)))
check('历史里含第二份技能正文', dumped.includes('B'.repeat(8000)))
check('历史里不出现 truncated', !dumped.includes('truncated'))

// 流式参数先到时建的占位卡仍应被 tool_start 接管（保留原有兜底行为）
let streamed = START
streamed = applyAgentEvent(streamed, {
  type: 'tool_call_args',
  toolCallId: 'stream-1',
  toolName: 'read_skill_text',
  delta: '{"id":"novel',
})
check('流式参数先到会先建占位卡', streamed.parts.length === 1 && streamed.parts[0].status === 'running')
streamed = applyAgentEvent(streamed, {
  type: 'tool_start',
  toolCallId: 'real-1',
  toolName: 'read_skill_text',
  args: { id: 'novel-storyboard' },
})
check(
  'tool_start 接管无结果的占位卡而不是新建',
  streamed.parts.length === 1 && streamed.parts[0].toolCallId === 'stream-1',
  `${streamed.parts.length} 张 / ${streamed.parts[0]?.toolCallId}`,
)

fs.rmSync(TMP, { recursive: true, force: true })
console.log(bad ? `\n❌ 失败 ${bad} 项` : '\n✅ 全部通过')
process.exit(bad ? 1 : 0)
