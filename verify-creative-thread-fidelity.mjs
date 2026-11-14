/**
 * 创意会话历史保真：历史工具结果不做长度裁剪、不按轮次/总量丢弃。
 * 跑法：node verify-creative-thread-fidelity.mjs
 */
import { build } from 'esbuild'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

const ROOT = process.cwd()
const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'thread-fidelity-'))
let bad = 0
const check = (name, cond, extra = '') => {
  console.log(`${cond ? '✅' : '❌'} ${name}${extra ? ` | ${extra}` : ''}`)
  if (!cond) bad++
}

const entry = path.join(TMP, 'entry.ts')
fs.writeFileSync(
  entry,
  [
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
fs.rmSync(TMP, { recursive: true, force: true })

const SKILL_LEN = 7732
const SKILL = 'A'.repeat(SKILL_LEN)

const skillTurn = (callId, len = SKILL_LEN) => ({
  id: `a-${callId}`,
  role: 'assistant',
  status: 'complete',
  parts: [
    {
      type: 'tool-call',
      toolCallId: callId,
      toolName: 'read_skill_text',
      args: { id: 'novel-storyboard' },
      status: 'done',
      result: { ok: true, id: 'novel-storyboard', profile: 'agent-pack', source: 'upload', text: 'A'.repeat(len) },
    },
  ],
})
const userTurn = (i, len = 8) => ({
  id: `u-${i}`,
  role: 'user',
  status: 'complete',
  parts: [{ type: 'text', text: `第${i}轮 ${'B'.repeat(len)}` }],
})

const toolResultOf = (pi) => pi.find((m) => m.role === 'toolResult')
const textOfResult = (m) => (Array.isArray(m?.content) ? String(m.content[0]?.text ?? '') : String(m?.content ?? ''))

// ---- 1.1 单条超长技能结果不再被折叠 ----
console.log('\n=== 单条 7732 字技能结果 ===')
const one = lib.uiThreadToPiMessages([skillTurn('t1')])
const oneText = textOfResult(toolResultOf(one))
check('工具结果仍含完整正文', oneText.includes(SKILL))
check('不含 truncated 标记', !oneText.includes('truncated'))
check('正文长度未被压缩', oneText.length > SKILL_LEN, `${oneText.length} 字符`)
check('摘要字段未被替换成 id', !/"summary":"novel-storyboard"/.test(oneText))

console.log('\n=== 阈值边界（3000/3970/4000/6000/7732）===')
for (const len of [3000, 3970, 4000, 6000, 7732]) {
  const t = textOfResult(toolResultOf(lib.uiThreadToPiMessages([skillTurn('t', len)])))
  check(`${String(len).padStart(5)} 字原样保留`, t.includes('A'.repeat(Math.min(len, 4000))) && !t.includes('truncated'))
}

// ---- 1.2 多轮之后早期技能正文仍在 ----
console.log('\n=== 30 轮之后（前 24 轮折叠线）===')
const thirty = [skillTurn('t1'), ...Array.from({ length: 30 }, (_, i) => userTurn(i + 1))]
const thirtyPi = lib.uiThreadToPiMessages(thirty)
const thirtyText = textOfResult(toolResultOf(thirtyPi))
check('第 30 轮后技能正文仍完整', thirtyText.includes(SKILL), `${thirtyText.length} 字符`)
check('无「早期工具结果已折叠」', !thirtyText.includes('早期工具结果已折叠'))

console.log('\n=== 总量超 48000 字符（原第 3 层）===')
const long = Array.from({ length: 60 }, (_, i) => userTurn(i + 1, 1000))
const longPi = lib.uiThreadToPiMessages(long)
const longChars = lib.estimateChars(longPi)
check('fixture 总量确实超过 48000', longChars > 48_000, `${longChars} 字符`)
check('60 条 user 全部保留', longPi.length === 60, `${longPi.length} 条`)
check('无「长期记忆」占位', !JSON.stringify(longPi).includes('长期记忆'))
check('无「压枝」表述', !JSON.stringify(longPi).includes('压枝'))
check('首条仍是第 1 轮', String(longPi[0].content).includes('第1轮'))

// ---- 改写入口已移除 ----
console.log('\n=== 改写入口 ===')
check('compactPiThreadMemory 已移除', lib.compactPiThreadMemory === undefined)
check('不再导出 TOOL_RESULT_MAX', lib.TOOL_RESULT_MAX === undefined)

const runnerSrc = fs.readFileSync(path.join(ROOT, 'src/agent/pi/stageRunner.ts'), 'utf8')
check('stageRunner 不再装配 transformContext', !runnerSrc.includes('transformContext'))
check('stageRunner 仍预置 priorMessages', runnerSrc.includes('priorMessages'))
const skillChatSrc = fs.readFileSync(path.join(ROOT, 'src/agent/SkillChat.tsx'), 'utf8')
check('SkillChat 走 history 字符串路径不变', skillChatSrc.includes('history') && !skillChatSrc.includes('priorMessages'))

// ---- 检查器说明与真实行为一致 ----
console.log('\n=== 检查器说明 ===')
const preview = lib.describePiThreadMemory(
  [{ id: 'u1', role: 'user', status: 'complete', parts: [{ type: 'text', text: '你好' }] }, skillTurn('t9')],
  '下一句',
)
check('说明提到原文送出', preview.includes('原文'), preview.split('\n')[1])
check('说明不含「长期记忆」', !preview.includes('长期记忆'))
check('说明含草稿', preview.includes('下一句'))

console.log(bad ? `\n❌ 失败 ${bad} 项` : '\n✅ 全部通过')
process.exit(bad ? 1 : 0)
