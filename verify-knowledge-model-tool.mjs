/**
 * 真实模型 × 知识库工具：验证「模型会不会主动调 search_knowledge」。
 *
 * 这是最接近 dsh 的验证，但不依赖 dsh 宿主：
 * 用应用自己的 /api/text（同一套原生工具调用协议）把知识库工具声明发给真实模型，
 * 看它收到「项目设定」类问题后是否主动发起工具调用。
 *
 * /api/text 与 dsh 的差别只有传输层，模型看到的工具 JSON Schema 完全同源
 * （都来自 src/agent/knowledgeTools.ts 的 zod → JSON Schema）。
 *
 * 需要会话选库：脚本自己调 `/api/knowledge/session-kb` 把库绑到 `KB_SESSION`，
 * 因为工具作用域只认会话（schema 里没有库字段）。
 *
 * 跑法：KB_APP_BASE=http://127.0.0.1:62946 KB_SESSION=tooltest-sess KB_KB=<库id> \
 *       node verify-knowledge-model-tool.mjs
 */
import { StudioToolBridge } from './server/studio-tool-bridge.mjs'

const BASE = String(process.env.KB_APP_BASE || '').replace(/\/+$/, '')
const PROJECT = String(process.env.KB_PROJECT || 'tooltest')
/** 会话标识：知识库工具的作用域来源，必须先在服务端绑定一个库 */
const SESSION = String(process.env.KB_SESSION || `tooltest-${Date.now().toString().slice(-6)}`)
/** 要绑定的库 id；不传就取列表里第一个 */
let KB_ID = String(process.env.KB_KB || '').trim()
/** 显式模型键：默认模型可能因订阅过期不可用，验证工具调用应指定一个能跑的 */
const MODEL_KEY = String(process.env.KB_MODEL_KEY || '')

if (!BASE) {
  console.error('缺少 KB_APP_BASE')
  process.exit(2)
}

let bad = 0
const check = (n, c, e = '') => {
  console.log(`${c ? '✅' : '❌'} ${n}${e ? ' | ' + e : ''}`)
  if (!c) bad++
}

async function api(p, init = {}) {
  const r = await fetch(BASE + p, init)
  const t = await r.text()
  try {
    return { status: r.status, body: JSON.parse(t) }
  } catch {
    return { status: r.status, body: t }
  }
}

// 1. 从工具桥取真实的工具声明（与 dsh 拿到的是同一份）
const bridge = new StudioToolBridge({
  root: process.cwd(),
  baseUrl: BASE,
  internalToken: '',
  log: () => {},
})
const catalog = await bridge.catalog(PROJECT, 1)
const kbTools = catalog.filter((t) => /knowledge/i.test(t.name))
check('工具表里有三个知识库工具', kbTools.length === 3, kbTools.map((t) => t.name).join(', '))
check(
  '模型可见的库清单工具也在（未选库时模型能列出可选项）',
  kbTools.some((t) => t.name === 'list_knowledge_bases'),
)

// 2. 把工具声明转成 /api/text 要的 function 定义
const toolSchemas = kbTools.map((t) => ({
  type: 'function',
  function: {
    name: t.name,
    description: t.description,
    parameters: t.parameters || { type: 'object', properties: {} },
  },
}))
check(
  '工具声明里没有任何库/项目/会话字段（作用域由服务端钉死）',
  toolSchemas.every((t) =>
    ['project', 'kbId', 'sessionId', 'workspace', 'slug'].every(
      (k) => !Object.keys(t.function.parameters?.properties || {}).includes(k),
    ),
  ),
)

// 2.5 把一个库绑到本脚本的会话上，否则工具会如实回「还没选库」
if (!KB_ID) {
  const list = await api('/api/knowledge/bases')
  KB_ID = String((list.body?.bases || [])[0]?.id || '')
}
if (!KB_ID) {
  console.error('没有可用的知识库：请先在「知识库」页建一个并上传资料（或用 KB_KB 指定）')
  process.exit(2)
}
const bound = await api('/api/knowledge/session-kb', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ sessionId: SESSION, kbId: KB_ID }),
})
check('会话已绑定知识库', bound.body?.ok === true, bound.body?.message || String(bound.status))

// 3. 真实模型对话：问一个必须查资料才知道的问题
const question = '沈砚在哪一场正式登场？如果项目知识库里没有资料就明说不知道。'
console.log(`\n提问：${question}\n`)

const res = await api('/api/text', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({
    system:
      '你是影视创作助手。项目里的资料在知识库中，涉及项目既成事实（角色、地点、时间线）时' +
      '必须先用 search_knowledge 查证，不要凭记忆编造。',
    messages: [{ role: 'user', content: question }],
    tools: toolSchemas,
    ...(MODEL_KEY ? { modelKey: MODEL_KEY } : {}),
    stream: false,
  }),
})

if (res.status !== 200 || !res.body?.ok) {
  console.error('模型调用失败：', res.body?.message || res.status)
  process.exit(1)
}

const calls = res.body.toolCalls || res.body.tool_calls || []
check('模型主动发起了工具调用', calls.length > 0, `${calls.length} 个调用`)
if (calls.length) {
  for (const c of calls) {
    const name = c.name || c.function?.name || ''
    const argsRaw = c.arguments ?? c.function?.arguments ?? '{}'
    console.log(`   调用 ${name}(${String(argsRaw).slice(0, 80)})`)
    check(`  调的是知识库工具`, /knowledge/i.test(name), name)
  }
}

// 4. 用模型给的参数真的执行一次（证明参数能跑通）
if (calls.length) {
  const first = calls[0]
  const name = first.name || first.function?.name || ''
  let args = first.arguments ?? first.function?.arguments ?? {}
  if (typeof args === 'string') {
    try {
      args = JSON.parse(args)
    } catch {
      args = {}
    }
  }
  if (/knowledge/i.test(name)) {
    // 关键：sessionId 走 invoke 的上下文（与 dsh 插件同一条路径），不进模型参数
    const exec = await bridge.invoke(name, args, { projectName: PROJECT, epNo: 1, sessionId: SESSION })
    check(`执行模型给的参数`, exec.ok === true, exec.ok ? 'ok' : String(exec.summary?.error || '').slice(0, 80))
    if (exec.ok) {
      const hits = exec.summary?.hits || []
      console.log(`   命中 ${hits.length} 段，首段：${String(hits[0]?.snippet || '').slice(0, 70).replace(/\s+/g, ' ')}`)
      check('  命中片段无 document_metadata', !/<document_metadata>/i.test(hits[0]?.snippet || ''))
    }
  }
}

// 5. 对照：不带工具时模型应该直接说不知道（证明是工具让它能答）
const noTool = await api('/api/text', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({
    system: '你是影视创作助手，只依据已知信息回答。',
    prompt: question,
    ...(MODEL_KEY ? { modelKey: MODEL_KEY } : {}),
    stream: false,
  }),
})
if (noTool.status === 200 && noTool.body?.ok) {
  const text = String(noTool.body.text || noTool.body.reply || '')
  console.log(`\n对照（不带工具）的回答：${text.slice(0, 100).replace(/\s+/g, ' ')}`)
  check('不带工具时不会凭空给出「雨夜巷口」', !/雨夜巷口/.test(text), text.slice(0, 60))
}

console.log(bad ? `\n${bad} 项失败` : '\n真实模型 × 知识库工具 验收全部通过')
process.exit(bad ? 1 : 0)
