/**
 * APIMart 与其它渠道：聊天 tools 的 parameters 必须为顶层 object JSON Schema。
 * 跑法：node verify-apimart-tool-schemas.mjs
 */
import { buildSync } from 'esbuild'
import path from 'node:path'
import { pathToFileURL } from 'node:url'
import { assertChatToolsObjectParameters } from './server/text-tools.mjs'
import { buildApimartResponsesBody, toApimartResponseTools } from './server/apimart.mjs'

const tmp = path.join(process.cwd(), '.verify-apimart-tool-schemas')
const out = path.join(tmp, 'bundle.mjs')

buildSync({
  entryPoints: ['src/skills/contracts.ts'],
  bundle: true,
  format: 'esm',
  platform: 'node',
  outfile: out,
  logLevel: 'silent',
  external: [],
})

const contracts = await import(pathToFileURL(out).href + `?t=${Date.now()}`)

buildSync({
  entryPoints: ['src/agent/pi/toolAdapter.ts'],
  bundle: true,
  format: 'esm',
  platform: 'node',
  outfile: path.join(tmp, 'toolAdapter.mjs'),
  logLevel: 'silent',
})

const { toolParameters } = await import(
  pathToFileURL(path.join(tmp, 'toolAdapter.mjs')).href + `?t=${Date.now()}`,
)

let bad = 0
const check = (name, cond, extra = '') => {
  console.log(`${cond ? '✅' : '❌'} ${name}${extra ? ` | ${extra}` : ''}`)
  if (!cond) bad++
}

const CONTRACT_IDS = [
  'script-v1',
  'characters-v1',
  'designs-v1',
  'shots-v1',
  'prompts-v1',
  'reverse-v1',
  'creative-plan-v1',
  'publish-plan-v1',
  'scene3d-code-v1',
]

for (const id of CONTRACT_IDS) {
  const schema = contracts.getContractToolSchema(id)
  if (!schema) {
    check(`契约 ${id} 存在`, false)
    continue
  }
  const params = toolParameters(schema)
  check(`${id} tool parameters 为 object`, params.type === 'object', String(params.type || params.anyOf ? 'anyOf' : ''))
}

const charDecl = toolParameters(contracts.getContractToolSchema('characters-v1'))
const charValidate = toolParameters(contracts.getContractSchema('characters-v1'))
check('characters 声明 schema 无 anyOf', !charDecl.anyOf && !charDecl.oneOf)
check('characters 校验 schema 仍保留 anyOf', Boolean(charValidate.anyOf || charValidate.oneOf))

const arrPayload = [{ name: '测试', look_en: 'x' }]
const wrapped = contracts.normalizeCharactersContractPayload(arrPayload)
const v1 = contracts.validateContract('characters-v1', wrapped)
const v2 = contracts.validateContract('characters-v1', arrPayload)
check('裸数组归一化后校验通过', v1.ok === true)
check('裸数组直接校验仍通过', v2.ok === true)

const openAiTools = [
  {
    type: 'function',
    function: {
      name: 'submit_characters',
      description: 'd',
      parameters: charDecl,
    },
  },
]
check('APIMart assert 通过 submit_characters', (() => {
  try {
    assertChatToolsObjectParameters(openAiTools, { providerKind: 'apimart' })
    return true
  } catch {
    return false
  }
})())

const badTools = [
  {
    type: 'function',
    function: { name: 'bad', parameters: { anyOf: [{ type: 'object' }] } },
  },
]
check(
  'APIMart assert 拒绝 anyOf',
  (() => {
    try {
      assertChatToolsObjectParameters(badTools, { providerKind: 'apimart' })
      return false
    } catch (e) {
      return String(e.message).includes('submit') || String(e.message).includes('bad')
    }
  })(),
)

const respBody = buildApimartResponsesBody({
  model: 'gpt-6.1-sol',
  messages: [{ role: 'user', content: 'hi' }],
  tools: openAiTools,
  maxTokens: 64,
})
const respTools = respBody.tools
check(
  'Responses body tools parameters 为 object',
  respTools?.[0]?.parameters?.type === 'object',
  JSON.stringify(respTools?.[0]?.parameters?.type),
)
check(
  'toApimartResponseTools 不含 anyOf',
  !toApimartResponseTools(openAiTools)[0]?.parameters?.anyOf,
)

// 可选：真实 APIMart Key 冒烟（带 submit_characters 形状，不应 invalid_function_parameters）
try {
  const { DatabaseSync } = await import('node:sqlite')
  const fs = await import('node:fs')
  const dbFile = path.join(process.cwd(), 'projects/storyboard.sqlite')
  if (fs.existsSync(dbFile)) {
    const db = new DatabaseSync(dbFile, { readOnly: true })
    const row = db.prepare("SELECT value FROM settings WHERE key='app'").get()
    db.close()
    const settings = row?.value ? JSON.parse(row.value) : {}
    const provider = (settings.providers || []).find((p) => p.id === 'apimart')
    const apiKey = String(provider?.apiKey || process.env.APIMART_API_KEY || '').trim()
    if (apiKey) {
      const base = String(provider?.baseUrl || 'https://api.apimart.ai/v1').replace(/\/+$/, '')
      const body = buildApimartResponsesBody({
        model: 'gpt-6.1-sol',
        messages: [{ role: 'user', content: '列出角色并准备 submit' }],
        tools: openAiTools,
        maxTokens: 128,
      })
      const r = await fetch(`${base}/responses`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      })
      const text = await r.text()
      check(
        'live APIMart submit_characters schema 非 400',
        r.ok || !/invalid_function_parameters|type: "None"/.test(text),
        `HTTP ${r.status} ${text.slice(0, 120)}`,
      )
    }
  }
} catch {
  /* 无 sqlite / 无 Key 时跳过 */
}

console.log(bad ? `\n❌ ${bad} 项失败` : '\n✅ APIMart 工具 schema 验收通过')
process.exit(bad ? 1 : 0)
