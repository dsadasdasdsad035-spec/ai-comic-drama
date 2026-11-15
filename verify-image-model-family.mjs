/**
 * 生图模型家族：设置页与生成接口都要把 image / view 当成同一个能力。
 *
 * 验证项：
 * 1) 主声明为图像的条目被手选后能用于 view 请求，且不回落 defaults.view
 * 2) 三视图条目被手选后能用于 image 请求，两个默认位各自独立
 * 3) 不支持参考图的模型带参考图直接 400，不带参考图正常出图
 * 4) 下拉去重：同一渠道同一模型只出现一条，且已选键不会被挤掉
 *
 * 用本地 mock 上游代替真实生图接口，全程不联网。
 * 跑法：node verify-image-model-family.mjs
 */
import { build } from 'esbuild'
import fs from 'node:fs'
import http from 'node:http'
import os from 'node:os'
import path from 'node:path'
import { pathToFileURL } from 'node:url'

const ROOT = process.cwd()
const CACHE = path.join(ROOT, 'node_modules/.cache/img-family-verify')
const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'img-family-'))
fs.mkdirSync(CACHE, { recursive: true })

let bad = 0
const check = (name, cond, extra = '') => {
  console.log(`${cond ? '✅' : '❌'} ${name}${extra ? ` | ${extra}` : ''}`)
  if (!cond) bad++
}

const PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=',
  'base64',
)

// ---------------------------------------------------------------- mock 上游

/** 记录上游收到的请求体，断言模型名与参考图字段 */
const upstreamCalls = []
/** mock 上游端口，serve 时用来拼回图地址 */
let UP = 0
const upstream = http.createServer((req, res) => {
  if (req.url?.startsWith('/img.png')) {
    res.writeHead(200, { 'content-type': 'image/png' })
    res.end(PNG)
    return
  }
  let raw = ''
  req.on('data', (c) => (raw += c))
  req.on('end', () => {
    try {
      upstreamCalls.push(JSON.parse(raw || '{}'))
    } catch {
      upstreamCalls.push({ raw })
    }
    res.writeHead(200, { 'content-type': 'application/json' })
    res.end(JSON.stringify({ data: [{ url: `http://127.0.0.1:${UP}/img.png` }] }))
  })
})
await new Promise((r) => upstream.listen(0, '127.0.0.1', r))
UP = upstream.address().port

// ---------------------------------------------------------------- 应用服务端

const serverOut = path.join(CACHE, 'app.mjs')
await build({
  entryPoints: ['server/app.ts'],
  bundle: true,
  platform: 'node',
  format: 'esm',
  target: 'node22',
  packages: 'external',
  outfile: serverOut,
  logLevel: 'error',
})
const { createAppHandler } = await import(pathToFileURL(serverOut).href)

const handler = createAppHandler({ root: TMP })
const app = http.createServer((req, res) =>
  handler(req, res, () => {
    res.statusCode = 404
    res.end(JSON.stringify({ ok: false, message: 'not found' }))
  }),
)
await new Promise((r) => app.listen(0, '127.0.0.1', r))
const BASE = `http://127.0.0.1:${app.address().port}`

const settings = {
  presetsVersion: 9999,
  providers: [
    {
      id: 'mock-ark',
      label: 'Mock Ark',
      kind: 'ark',
      baseUrl: `http://127.0.0.1:${UP}/v1`,
      apiKey: 'test-key',
      caps: ['image', 'view', 'text'],
    },
    {
      id: 'mock-openai',
      label: 'Mock OpenAI',
      kind: 'openai',
      baseUrl: `http://127.0.0.1:${UP}/openai`,
      apiKey: 'test-key',
      caps: ['image'],
    },
  ],
  models: [
    // 与真实默认目录同形：同一模型被拆成 image / view 两行
    { key: 'ark-image', label: 'Ark 图像', cap: 'image', provider: 'mock-ark', model: 'seedream-image' },
    { key: 'ark-view', label: 'Ark 三视图', cap: 'view', provider: 'mock-ark', model: 'seedream-view' },
    // 主声明为图像、且不收参考图
    {
      key: 'oai-image',
      label: 'OpenAI 图像',
      cap: 'image',
      provider: 'mock-openai',
      model: 'gpt-image-1',
      features: { imageRef: 'none' },
    },
  ],
  defaults: { image: 'ark-image', view: 'ark-view' },
  stageModels: {},
  pricing: {},
  agentLimits: {},
  agentToolProtocol: 'auto',
  rules: {},
  lipSync: { provider: 'off' },
}

const put = await fetch(`${BASE}/api/settings`, {
  method: 'PUT',
  headers: { 'content-type': 'application/json' },
  body: JSON.stringify(settings),
})
const putJson = await put.json()
check('设置写入成功', put.ok && putJson.ok, putJson.message || '')

/** 调生图接口，返回 { status, json, upstream } */
async function gen(body) {
  const before = upstreamCalls.length
  const r = await fetch(`${BASE}/api/seedream`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ prompt: '一个测试角色', ratio: '16:9', n: 1, ...body }),
  })
  const json = await r.json().catch(() => ({}))
  return { status: r.status, json, upstream: upstreamCalls.slice(before) }
}

// ---------------------------------------------------------------- 1. 跨能力手选

{
  const r = await gen({ cap: 'view', modelKey: 'ark-image', project: 'demo' })
  check('三视图请求能用手选的图像模型出图', r.status === 200 && r.json.ok, JSON.stringify(r.json).slice(0, 120))
  check(
    '三视图请求实际走手选模型，未回落 defaults.view',
    r.upstream[0]?.model === 'seedream-image',
    String(r.upstream[0]?.model),
  )
  check('三视图产物走 char 前缀', String(r.json.url || '').includes('char-'), String(r.json.url))
}

{
  const r = await gen({ cap: 'image', modelKey: 'ark-view', project: 'demo' })
  check('设定图请求能用手选的三视图模型出图', r.status === 200 && r.json.ok, JSON.stringify(r.json).slice(0, 120))
  check(
    '设定图请求实际走手选模型，未回落 defaults.image',
    r.upstream[0]?.model === 'seedream-view',
    String(r.upstream[0]?.model),
  )
  check('设定图产物走 design 前缀', String(r.json.url || '').includes('design-'), String(r.json.url))
}

// ---------------------------------------------------------------- 2. 默认位独立

{
  const view = await gen({ cap: 'view' })
  const image = await gen({ cap: 'image' })
  check('不手选时三视图走 defaults.view', view.upstream[0]?.model === 'seedream-view', String(view.upstream[0]?.model))
  check('不手选时设定图走 defaults.image', image.upstream[0]?.model === 'seedream-image', String(image.upstream[0]?.model))
}

// ---------------------------------------------------------------- 3. 参考图能力

const REF = `data:image/png;base64,${PNG.toString('base64')}`

{
  const r = await gen({ cap: 'view', modelKey: 'oai-image', refImage: REF })
  check('不收参考图的模型带参考图直接失败', r.status === 400 && r.json.ok === false, `HTTP ${r.status}`)
  check('错误说明模型不接受参考图', /不支持参考图/.test(String(r.json.message)), String(r.json.message))
  check('提示换支持参考图的模型', /换一个/.test(String(r.json.message)), String(r.json.message))
  check('失败时没有向上游提交', r.upstream.length === 0, `上调 ${r.upstream.length} 次`)
}

{
  const r = await gen({ cap: 'view', modelKey: 'oai-image' })
  check('同一模型不带参考图正常出图', r.status === 200 && r.json.ok, JSON.stringify(r.json).slice(0, 120))
  check('不带参考图时未塞参考图字段', r.upstream[0]?.image === undefined, JSON.stringify(r.upstream[0]?.image))
}

{
  const r = await gen({ cap: 'view', modelKey: 'ark-image', refImage: REF })
  check('支持参考图的模型照常带图', r.status === 200 && typeof r.upstream[0]?.image === 'string', String(r.upstream[0]?.image).slice(0, 30))
}

// ---------------------------------------------------------------- 4. 下拉去重

const selectOut = path.join(CACHE, 'model-select.mjs')
await build({
  entryPoints: ['src/ModelSelect.tsx'],
  bundle: true,
  platform: 'node',
  format: 'esm',
  target: 'node22',
  jsx: 'automatic',
  packages: 'external',
  outfile: selectOut,
  logLevel: 'error',
})
const { capModelEntries } = await import(pathToFileURL(selectOut).href)

const models = [
  { key: 'ark-image', label: 'Ark 图像', cap: 'image', provider: 'mock-ark', model: 'seedream-4-5' },
  { key: 'ark-view', label: 'Ark 三视图', cap: 'view', provider: 'mock-ark', model: 'seedream-4-5' },
  { key: 'ark-promo', label: 'Ark 促销', cap: 'image', provider: 'mock-ark', model: 'seedream-5-0' },
  // 只声明三视图、模型 id 也不同的条目，用来验证跨能力可见
  { key: 'ark-turn', label: 'Ark 转盘', cap: 'view', provider: 'mock-ark', model: 'seedream-3-0' },
  { key: 'ark-down', label: '未接入', cap: 'image', provider: 'mock-ark', model: 'seedream-x', runtime: 'catalog-only' },
]
const box = { models }

{
  const list = capModelEntries(box, 'image', undefined, 'ark-image')
  check('图像下拉去重后不含同名第二条', list.filter((m) => m.model === 'seedream-4-5').length === 1, list.map((m) => m.key).join(','))
  check('图像下拉保留能力匹配的行', list.find((m) => m.model === 'seedream-4-5')?.key === 'ark-image', list.find((m) => m.model === 'seedream-4-5')?.key)
  check('图像下拉含同渠道其他图像模型', list.some((m) => m.key === 'ark-promo'))
  check('图像下拉含只声明三视图的模型', list.some((m) => m.key === 'ark-turn'), list.map((m) => m.key).join(','))
  check('不可运行条目不进下拉', !list.some((m) => m.key === 'ark-down'))
}

{
  const list = capModelEntries(box, 'view', undefined, 'ark-view')
  check('三视图下拉保留三视图那一行', list.find((m) => m.model === 'seedream-4-5')?.key === 'ark-view', list.find((m) => m.model === 'seedream-4-5')?.key)
  check('三视图下拉含只声明图像的模型', list.some((m) => m.key === 'ark-promo'), list.map((m) => m.key).join(','))
}

{
  const list = capModelEntries(box, 'image', undefined, 'ark-view')
  check('已选键优先于能力匹配，不会被挤掉', list.find((m) => m.model === 'seedream-4-5')?.key === 'ark-view', list.find((m) => m.model === 'seedream-4-5')?.key)
}

{
  const list = capModelEntries(box, 'image')
  check('不传已选键时按能力匹配', list.find((m) => m.model === 'seedream-4-5')?.key === 'ark-image', list.find((m) => m.model === 'seedream-4-5')?.key)
}

{
  const list = capModelEntries(box, 'text')
  check('生图族不外溢到文本下拉', list.length === 0, list.map((m) => m.key).join(','))
}

// ---------------------------------------------------------------- 收尾

app.close()
upstream.close()
fs.rmSync(TMP, { recursive: true, force: true })
fs.rmSync(CACHE, { recursive: true, force: true })

console.log(bad ? `\n${bad} 项失败` : '\n全部通过')
process.exit(bad ? 1 : 0)
