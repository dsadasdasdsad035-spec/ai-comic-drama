/**
 * 创意会话模型路由测试。
 *
 * 覆盖四件事，都是「设置页选了却没用上」的回归点：
 * - 设置页保存的 `stageModels.creative` 必须真的落库（服务端环节清单曾漏掉 creative，保存即丢）；
 * - 宿主默认模型按 创意环节 → 文本默认 → 首个可用 解析，且只改绑定也会触发 patch 重写；
 * - 应用写回默认模型时不得覆盖宿主已保存的显式选择；
 * - 宿主的「预览版说明」必须预置成已确认，否则首次进入会被引导弹窗挡住。
 */
import assert from 'node:assert/strict'
import { execFileSync, spawn } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { parse as parseYaml, stringify as stringifyYaml } from 'yaml'
import {
  decideDefaultModel,
  planRouteChanges,
  readStudioRoutes,
  routeIdForProvider,
  STUDIO_LEGACY_PROVIDER_ID,
  studioDefaultStatePath,
  studioRoutesStatePath,
  writeStudioRoutes,
  profilePatchPath,
  WELCOME_NOTICE_ENTRY_ID,
  WELCOME_NOTICE_FIELD,
  WELCOME_NOTICE_VERSION,
} from '../server/studio-profile.mjs'

let bad = 0
async function check(name, fn) {
  try {
    await fn()
    console.log(`✅ ${name}`)
  } catch (e) {
    bad += 1
    console.error(`❌ ${name}\n   ${e?.message || e}`)
  }
}

// ---------------------------------------------------------------- 纯函数：路由 id 派生
await check('路由 id 派生：渠道 id → sb-<slug>', () => {
  assert.equal(routeIdForProvider('ark'), 'sb-ark')
  assert.equal(routeIdForProvider('ark-plan'), 'sb-ark-plan')
  assert.equal(routeIdForProvider('custom-Ab3'), 'sb-custom-ab3')
  assert.equal(routeIdForProvider('my_provider'), 'sb-my-provider')
  assert.equal(routeIdForProvider('  Spaced  Id  '), 'sb-spaced-id')
  assert.equal(routeIdForProvider('a__b'), 'sb-a-b')
  assert.equal(routeIdForProvider('---lead---'), 'sb-lead')
  // 纯非 ASCII 渠道 id 无法派生（实际渠道 id 都是 ASCII 预设或 custom-xxxx）
  assert.throws(() => routeIdForProvider('中文渠道'), /无法转成路由 id/)
  assert.throws(() => routeIdForProvider(''), /无法转成路由 id/)
  assert.throws(() => routeIdForProvider('   '), /无法转成路由 id/)
  assert.throws(() => routeIdForProvider('###'), /无法转成路由 id/)
})

// ---------------------------------------------------------------- 纯函数：自有路由清单
await check('路由清单：缺失按空集、损坏按空集、写入后可读回', () => {
  const tmpHome = fs.mkdtempSync(path.join(os.tmpdir(), 'studio-routes-'))
  const file = studioRoutesStatePath(tmpHome)

  // 升级首轮：文件不存在是正常状态，不是错误
  assert.deepEqual(readStudioRoutes(tmpHome), [])

  // 内容损坏只退化，不抛
  fs.mkdirSync(path.dirname(file), { recursive: true })
  fs.writeFileSync(file, '{ not json', 'utf8')
  const logged = []
  assert.deepEqual(readStudioRoutes(tmpHome, (line) => logged.push(line)), [])
  assert.ok(logged.some((line) => line.includes('路由清单不可读')), '损坏时应记一条可读日志')

  // 非数组字段同样退化
  fs.writeFileSync(file, JSON.stringify({ routes: 'nope' }), 'utf8')
  assert.deepEqual(readStudioRoutes(tmpHome), [])

  // 写入后可读回，且空串/空白条目被剔除
  writeStudioRoutes(tmpHome, ['sb-ark', '', 'sb-deepseek'])
  assert.deepEqual(readStudioRoutes(tmpHome), ['sb-ark', 'sb-deepseek'])
  // 写入是原子的：不留 tmp 文件
  assert.ok(!fs.readdirSync(path.dirname(file)).some((name) => name.includes('.tmp-')), '不应残留 tmp 文件')
})

// ---------------------------------------------------------------- 纯函数：路由增删计划
await check('路由增删计划：只删自有且本次不再产出的键', () => {
  // 新增：只写不删
  assert.deepEqual(
    planRouteChanges({ owned: [], next: ['sb-ark', 'sb-deepseek'] }),
    { remove: [], write: ['sb-ark', 'sb-deepseek'] },
  )
  // 删除：只删不写
  assert.deepEqual(
    planRouteChanges({ owned: ['sb-ark', 'sb-gone'], next: ['sb-ark'] }),
    { remove: ['sb-gone'], write: ['sb-ark'] },
  )
  // 顺序变化：仍是同一集合，不删只写（写入顺序由 next 决定）
  assert.deepEqual(
    planRouteChanges({ owned: ['sb-a', 'sb-b'], next: ['sb-b', 'sb-a'] }),
    { remove: [], write: ['sb-b', 'sb-a'] },
  )
  // owned 为空（升级首轮）时绝不删任何键：宿主或用户自建的 provider 必须保住
  assert.deepEqual(
    planRouteChanges({ owned: [], next: ['sb-a'] }),
    { remove: [], write: ['sb-a'] },
  )
  // 去重：next 里重复的 id 只写一次
  assert.deepEqual(
    planRouteChanges({ owned: [], next: ['sb-a', 'sb-a'] }),
    { remove: [], write: ['sb-a'] },
  )
  // 缺省入参按空集处理
  assert.deepEqual(planRouteChanges(), { remove: [], write: [] })
})

// ---------------------------------------------------------------- 纯函数：配对判定
await check('默认模型配对判定：六态', () => {
  const legacy = STUDIO_LEGACY_PROVIDER_ID
  const routes = [
    { id: 'sb-ark', models: [{ id: 'sb/ark-a' }, { id: 'sb/ark-b' }] },
    { id: 'sb-deep', models: [{ id: 'sb/deep-a' }] },
  ]
  const fallback = { provider: 'sb-ark', model: 'sb/ark-a' }
  const decide = (existing, lastWritten, fb = fallback) => decideDefaultModel({ existing, lastWritten, fallback: fb, routes })

  // 1. 没有现值 → 写回退配对
  assert.deepEqual(decide(null, null), { write: true, ...fallback, explicit: false })

  // 2. 旧版 storyboard → 迁移到模型所属渠道，模型不变
  assert.deepEqual(decide({ provider: legacy, model: 'sb/deep-a' }, null), {
    write: true, provider: 'sb-deep', model: 'sb/deep-a', explicit: false,
  })
  // 2b. 旧版且模型已不存在 → 换回回退配对
  assert.deepEqual(decide({ provider: legacy, model: 'sb/gone' }, null), {
    write: true, ...fallback, explicit: false,
  })

  // 3. 非自有 provider（宿主内置/用户自建）→ 保留并封存
  assert.deepEqual(decide({ provider: 'deepseek-official', model: 'deepseek-chat' }, null), {
    write: false, provider: 'deepseek-official', model: 'deepseek-chat', explicit: true,
  })
  assert.deepEqual(decide({ provider: 'user-owned', model: 'x' }, null), {
    write: false, provider: 'user-owned', model: 'x', explicit: true,
  })

  // 4. 配对与模型所属渠道不符 → 只纠正 provider
  assert.deepEqual(decide({ provider: 'sb-ark', model: 'sb/deep-a' }, null), {
    write: true, provider: 'sb-deep', model: 'sb/deep-a', explicit: false,
  })

  // 4b. 模型已不在任何路由 → 换回回退配对
  assert.deepEqual(decide({ provider: 'sb-ark', model: 'sb/gone' }, null), {
    write: true, ...fallback, explicit: false,
  })

  // 4c. 指向上一轮自有、这次已退场的路由 → 模型还在就改配对，不在就回退
  const withOwned = (existing) =>
    decideDefaultModel({ existing, lastWritten: null, fallback, routes, owned: ['sb-retired'] })
  assert.deepEqual(withOwned({ provider: 'sb-retired', model: 'sb/deep-a' }), {
    write: true, provider: 'sb-deep', model: 'sb/deep-a', explicit: false,
  })
  assert.deepEqual(withOwned({ provider: 'sb-retired', model: 'sb/gone' }), {
    write: true, ...fallback, explicit: false,
  })

  // 5. 配对正确且等于上次播种值 → 跟随回退值
  assert.deepEqual(
    decide({ provider: 'sb-ark', model: 'sb/ark-a' }, { provider: 'sb-ark', model: 'sb/ark-a' }, { provider: 'sb-ark', model: 'sb/ark-b' }),
    { write: true, provider: 'sb-ark', model: 'sb/ark-b', explicit: false },
  )
  // 5b. 等于上次播种值且回退值没变 → 不动
  assert.deepEqual(decide({ provider: 'sb-ark', model: 'sb/ark-a' }, { provider: 'sb-ark', model: 'sb/ark-a' }), {
    write: false, ...fallback, explicit: false,
  })

  // 6. 来源未知但现值有效且不等于当前默认 → 保留并封存（来源：记录缺失）
  assert.deepEqual(decide({ provider: 'sb-ark', model: 'sb/ark-b' }, null), {
    write: false, provider: 'sb-ark', model: 'sb/ark-b', explicit: true, source: 'unrecorded',
  })
  // 6b. 来源未知但现值恰好等于当前默认 → 视为我们的播种值，记为可更新
  assert.deepEqual(decide({ provider: 'sb-ark', model: 'sb/ark-a' }, null), {
    write: false, ...fallback, explicit: false,
  })
  // 6c. 与上次记录不同 = 宿主改过 → 保留并封存（来源：宿主）
  assert.deepEqual(
    decide({ provider: 'sb-ark', model: 'sb/ark-b' }, { provider: 'sb-ark', model: 'sb/ark-a' }),
    { write: false, provider: 'sb-ark', model: 'sb/ark-b', explicit: true, source: 'host' },
  )
  // 6d. 上次记录已按宿主封存 → 设置页改默认也不跟随
  assert.deepEqual(
    decide(
      { provider: 'sb-ark', model: 'sb/ark-b' },
      { provider: 'sb-ark', model: 'sb/ark-b', explicit: true, source: 'host' },
    ),
    { write: false, provider: 'sb-ark', model: 'sb/ark-b', explicit: true, source: 'host' },
  )
  // 6e. 上次记录因「文件丢失」封存 → 下一轮跟随新的设置页默认（修掉永久冻结）
  assert.deepEqual(
    decide(
      { provider: 'sb-ark', model: 'sb/ark-b' },
      { provider: 'sb-ark', model: 'sb/ark-b', explicit: true, source: 'unrecorded' },
    ),
    { write: true, ...fallback, explicit: false },
  )

  // 回退值不完整直接报错，不允许写出悬空配对
  assert.throws(() => decideDefaultModel({ existing: null, fallback: { provider: '', model: 'sb/a' }, routes }), /完整配对/)
})

// ---------------------------------------------------------------- 端到端：设置库 → patch
const ROOT = path.resolve(import.meta.dirname, '..')

await check('预览版说明的确认版本与宿主源码一致', () => {
  // 宿主 bump 文案版本却不更新这里，首次进入创意会话就会重新被引导弹窗挡住
  const hostFile = path.join(ROOT, 'node_modules', '@deepseek-ai', 'dsh-client-ui-settings-models', 'src', 'onboarding-copy.ts')
  if (!fs.existsSync(hostFile)) return
  const raw = fs.readFileSync(hostFile, 'utf8')
  const found = raw.match(/WELCOME_NOTICE_VERSION\s*=\s*'([^']+)'/)
  assert.ok(found, `${hostFile} 里没有 WELCOME_NOTICE_VERSION`)
  assert.equal(WELCOME_NOTICE_VERSION, found[1], '宿主引导说明版本已变化，需同步 server/studio-profile.mjs')
})

// 服务跑的是 server-build/app.mjs 产物：先构建，否则测到的是上一版（没有 creative 环节）
execFileSync(
  path.join(ROOT, 'node_modules', '.bin', 'esbuild'),
  ['server/app.ts', '--bundle', '--platform=node', '--format=esm', '--target=node24', '--packages=external', '--outfile=server-build/app.mjs'],
  { cwd: ROOT, stdio: 'inherit' },
)
const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'studio-model-routing-'))
const STATE = path.join(TMP, 'state')
const DSH_HOME = path.join(STATE, 'dsh')
const PATCH = profilePatchPath(DSH_HOME)

const proc = spawn(process.execPath, [path.join(ROOT, 'server', 'index.mjs')], {
  cwd: ROOT,
  env: {
    ...process.env,
    SB_PROJECTS_DIR: TMP,
    SB_STATE_ROOT: STATE,
    SB_MEDIA_ROOT: path.join(TMP, 'media'),
    SB_PORT: '0',
    // 这条用例只验证配置同步，不需要真拉起宿主
    SB_STUDIO_NO_PREWARM: '1',
  },
  stdio: ['ignore', 'pipe', 'pipe'],
})
let log = ''
const port = await new Promise((resolve, reject) => {
  const timer = setTimeout(() => reject(new Error(`启动超时：${log.slice(-800)}`)), 60_000)
  proc.stdout.on('data', (c) => {
    log += c.toString()
    const m = log.match(/\[server\] listening http:\/\/[^:]+:(\d+)/)
    if (m) {
      clearTimeout(timer)
      resolve(Number(m[1]))
    }
  })
  proc.stderr.on('data', (c) => {
    log += c.toString()
  })
  proc.on('exit', (code) => {
    clearTimeout(timer)
    reject(new Error(`服务提前退出（${code}）：${log.slice(-800)}`))
  })
})
const base = `http://127.0.0.1:${port}`

const PROVIDERS = [
  { id: 'openai', label: 'OpenAI 兼容', kind: 'openai', baseUrl: 'http://127.0.0.1:1/v1', apiKey: 'mock' },
  { id: 'agency', label: '代理渠道', kind: 'openai', baseUrl: 'http://127.0.0.1:2/v1', apiKey: 'mock' },
]
const model = (key, label, extra = {}) => ({
  key,
  label,
  cap: 'text',
  provider: 'openai',
  model: key,
  ...extra,
})

async function putSettings(patch) {
  const res = await fetch(`${base}/api/settings`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ providers: PROVIDERS, ...patch }),
  })
  const body = await res.json()
  assert.equal(body.ok, true, `保存设置失败：${body.message || res.status}`)
  return body.settings
}

function readPatchEntries() {
  assert.ok(fs.existsSync(PATCH), `宿主 patch 不存在：${PATCH}`)
  const entries = parseYaml(fs.readFileSync(PATCH, 'utf8'))
  assert.ok(Array.isArray(entries), 'patch 不是数组')
  return entries
}

function readPatchDefault() {
  const entry = readPatchEntries().find((e) => e && e.id === 'agent-default-model')
  return entry?.config?.model
}

function readPatchDefaultPair() {
  const entry = readPatchEntries().find((e) => e && e.id === 'agent-default-model')
  return entry?.config ? { provider: entry.config.provider, model: entry.config.model } : null
}

/** 读宿主 providers 字典（llm-pi-ai 段） */
function readPatchProviders() {
  const entry = readPatchEntries().find((e) => e && e.id === 'llm-pi-ai')
  return entry?.config?.providers || {}
}

function readPatchWelcomeAck() {
  const entry = readPatchEntries().find((e) => e && e.id === WELCOME_NOTICE_ENTRY_ID)
  return entry?.config?.[WELCOME_NOTICE_FIELD]
}

/** 模拟宿主自己写入了默认模型（同一份 patch、同一个条目） */
function writePatchDefault(value, provider = 'sb-openai') {
  const entries = readPatchEntries()
  const index = entries.findIndex((e) => e && e.id === 'agent-default-model')
  const next = { id: 'agent-default-model', config: { provider, model: value } }
  if (index >= 0) entries[index] = { ...entries[index], ...next, config: next.config }
  else entries.push(next)
  fs.writeFileSync(PATCH, stringifyYaml(entries), 'utf8')
}

/** 读应用记下的默认模型来源（studio-default.json） */
function readDefaultState() {
  try {
    return JSON.parse(fs.readFileSync(studioDefaultStatePath(DSH_HOME), 'utf8'))
  } catch {
    return null
  }
}

const BASE_MODELS = [model('base-text', '基础文本'), model('other-text', '备用文本')]

await check('创意环节绑定真的落库（不再被 normalize 丢弃）', async () => {
  const saved = await putSettings({
    models: BASE_MODELS,
    defaults: { text: 'base-text' },
    stageModels: { creative: 'other-text' },
  })
  assert.equal(saved.stageModels?.creative, 'other-text', '保存后 creative 绑定丢失')
  const again = await (await fetch(`${base}/api/settings`)).json()
  assert.equal(again.settings.stageModels?.creative, 'other-text', '重新读取时 creative 绑定丢失')
})

await check('默认模型优先用创意环节绑定', () => {
  assert.equal(readPatchDefault(), 'sb/other-text', `实际默认：${readPatchDefault()}`)
})

await check('按渠道分组写入宿主 provider，并带上显示名', async () => {
  const models = [
    model('base-text', '基础文本'),
    model('vision-text', '看图说话', { caps: ['text', 'vision'] }),
    model('agency-text', '代理文本', { provider: 'agency' }),
  ]
  await putSettings({ models, defaults: { text: 'base-text' }, stageModels: { creative: 'base-text' } })

  const providers = readPatchProviders()
  assert.deepEqual(Object.keys(providers).sort(), ['sb-agency', 'sb-openai'], `实际路由：${Object.keys(providers)}`)
  // 旧版单一 provider 必须退场
  assert.equal(providers.storyboard, undefined, 'storyboard 仍然存在')

  // 分组名取自设置页渠道 label
  assert.equal(providers['sb-openai'].displayName, 'OpenAI 兼容')
  assert.equal(providers['sb-agency'].displayName, '代理渠道')

  // 所有路由都指向应用门面，不出现上游地址
  for (const [id, p] of Object.entries(providers)) {
    assert.equal(p.baseURL, `http://127.0.0.1:${port}/v1`, `${id} 的 baseURL 不是门面：${p.baseURL}`)
    assert.equal(p.api, 'openai-completions')
  }

  // 模型条目带应用侧显示名；视觉模型声明 image 输入
  const openaiModels = providers['sb-openai'].models
  assert.deepEqual(openaiModels.map((m) => m.id).sort(), ['sb/base-text', 'sb/vision-text'])
  assert.equal(openaiModels.find((m) => m.id === 'sb/base-text').name, '基础文本')
  assert.deepEqual(openaiModels.find((m) => m.id === 'sb/vision-text').input, ['text', 'image'])
  assert.equal(openaiModels.find((m) => m.id === 'sb/base-text').input, undefined)

  // 默认模型落在模型所属渠道的路由上
  assert.deepEqual(readPatchDefaultPair(), { provider: 'sb-openai', model: 'sb/base-text' })
})

await check('归属清理：保留用户自建 provider，删除已退场渠道', async () => {
  // 模拟宿主「设置 → 模型」里用户自建的 provider：不在我们的清单里
  const entries = readPatchEntries()
  const llm = entries.find((e) => e && e.id === 'llm-pi-ai')
  llm.config.providers['user-owned'] = {
    displayName: '用户自己加的',
    apiKeyEnv: 'USER_KEY',
    api: 'openai-completions',
    baseURL: 'https://user.example/v1',
    models: [{ id: 'user-model' }],
  }
  fs.writeFileSync(PATCH, stringifyYaml(entries), 'utf8')

  // 触发一次同步：只保留 openai 渠道，agency 渠道不再有模型
  await putSettings({
    models: [model('base-text', '基础文本'), model('other-text', '备用文本')],
    defaults: { text: 'base-text' },
    stageModels: { creative: 'base-text' },
  })

  const providers = readPatchProviders()
  assert.ok(providers['sb-openai'], 'openai 渠道路由应保留')
  assert.ok(providers['user-owned'], '用户自建的 provider 被误删')
  assert.equal(providers['sb-agency'], undefined, '已无模型的渠道路由应被清理')
  assert.deepEqual(Object.keys(providers).sort(), ['sb-openai', 'user-owned'])
  // 清单里也不该再记 agency
  assert.deepEqual(readStudioRoutes(DSH_HOME), ['sb-openai'])
})

await check('签名纳入路由、显示名与配对：改名会触发重写，未变化不重写', async () => {
  const renamedProviders = PROVIDERS.map((p) => (p.id === 'openai' ? { ...p, label: 'OpenAI 改名' } : p))
  const first = { models: BASE_MODELS, defaults: { text: 'base-text' }, stageModels: { creative: 'base-text' } }

  // 只改渠道 label：模型集合不变，patch 仍必须重写
  await putSettings({ providers: renamedProviders, ...first })
  assert.equal(readPatchProviders()['sb-openai'].displayName, 'OpenAI 改名')

  // 只改模型显示名
  const renamedModels = [model('base-text', '基础文本·改名'), model('other-text', '备用文本')]
  await putSettings({ providers: renamedProviders, ...first, models: renamedModels })
  assert.equal(
    readPatchProviders()['sb-openai'].models.find((m) => m.id === 'sb/base-text').name,
    '基础文本·改名',
  )

  // 完全没变化：不重写文件（避免每次保存都触发宿主重载）
  const before = fs.statSync(PATCH).mtimeMs
  await new Promise((resolve) => setTimeout(resolve, 20))
  await putSettings({ providers: renamedProviders, ...first, models: renamedModels })
  assert.equal(fs.statSync(PATCH).mtimeMs, before, '配置未变化时不应重写 patch')
})

await check('explicit 封存：宿主的选择不被设置页覆盖', async () => {
  // 宿主把它改成同渠道的另一个模型：不是我们写的 → 落 explicit
  writePatchDefault('sb/other-text')
  await putSettings({ models: BASE_MODELS, defaults: { text: 'base-text' }, stageModels: { creative: 'base-text' } })

  assert.equal(readPatchDefault(), 'sb/other-text', '宿主的选择被覆盖了')
  const state = readDefaultState()
  assert.deepEqual(
    { provider: state?.provider, model: state?.model, explicit: state?.explicit },
    { provider: 'sb-openai', model: 'sb/other-text', explicit: true },
    `来源记录不对：${JSON.stringify(state)}`,
  )

  // 再改设置页：封存后不再跟随
  await putSettings({ models: BASE_MODELS, defaults: { text: 'base-text' }, stageModels: { creative: 'base-text' } })
  assert.equal(readPatchDefault(), 'sb/other-text', 'explicit 后仍被设置页覆盖')

  // 反例：explicit 为假且现值等于上次写入 → 跟随设置页更新
  fs.writeFileSync(
    studioDefaultStatePath(DSH_HOME),
    JSON.stringify({ provider: 'sb-openai', model: 'sb/base-text', explicit: false }),
    'utf8',
  )
  writePatchDefault('sb/base-text')
  await putSettings({ models: BASE_MODELS, defaults: { text: 'base-text' }, stageModels: { creative: 'other-text' } })
  assert.equal(readPatchDefault(), 'sb/other-text', '我们的播种值应跟随设置页')
})

await check('storyboard 迁移：换路由不换模型', async () => {
  // 还原升级前的形态：单一 provider + 指向它的默认模型
  const entries = readPatchEntries()
  const llm = entries.find((e) => e && e.id === 'llm-pi-ai')
  llm.config.providers[STUDIO_LEGACY_PROVIDER_ID] = {
    apiKeyEnv: 'SB_STUDIO_GATEWAY_KEY',
    api: 'openai-completions',
    baseURL: `http://127.0.0.1:${port}/v1`,
    models: [{ id: 'sb/base-text' }, { id: 'sb/other-text' }],
  }
  const defaultEntry = entries.find((e) => e && e.id === 'agent-default-model')
  defaultEntry.config = { provider: STUDIO_LEGACY_PROVIDER_ID, model: 'sb/other-text' }
  fs.writeFileSync(PATCH, stringifyYaml(entries), 'utf8')
  fs.rmSync(studioDefaultStatePath(DSH_HOME), { force: true })

  await putSettings({ models: BASE_MODELS, defaults: { text: 'base-text' }, stageModels: { creative: 'base-text' } })

  // 模型值不变，只把 provider 换成模型所属渠道
  assert.deepEqual(readPatchDefaultPair(), { provider: 'sb-openai', model: 'sb/other-text' })
  // 旧 provider 键退场
  assert.equal(readPatchProviders()[STUDIO_LEGACY_PROVIDER_ID], undefined, 'storyboard 未被删除')
  // 来源记录写成新配对
  const state = readDefaultState()
  assert.deepEqual(
    { provider: state?.provider, model: state?.model, explicit: state?.explicit },
    { provider: 'sb-openai', model: 'sb/other-text', explicit: false },
    `迁移后的来源记录不对：${JSON.stringify(state)}`,
  )
})

await check('渠道错配纠正：只改 provider，不动模型', async () => {
  const models = [model('base-text', '基础文本'), model('agency-text', '代理文本', { provider: 'agency' })]
  await putSettings({ models, defaults: { text: 'base-text' }, stageModels: { creative: 'base-text' } })
  assert.ok(readPatchProviders()['sb-agency'], 'agency 路由应存在')

  // 宿主把配对写错：agency 的模型挂在 openai 路由下
  writePatchDefault('sb/agency-text', 'sb-openai')
  await putSettings({ models, defaults: { text: 'base-text' }, stageModels: { creative: 'base-text' } })

  assert.deepEqual(readPatchDefaultPair(), { provider: 'sb-agency', model: 'sb/agency-text' })
  // 来源记录同步纠正
  const state = readDefaultState()
  assert.deepEqual({ provider: state?.provider, model: state?.model }, { provider: 'sb-agency', model: 'sb/agency-text' })
})

await check('预览版说明预置为已确认（否则引导弹窗挡住创意会话）', () => {
  assert.equal(readPatchWelcomeAck(), WELCOME_NOTICE_VERSION, `实际确认位：${readPatchWelcomeAck()}`)
})

await check('创意绑定留空时回退到文本默认', async () => {
  await putSettings({ models: BASE_MODELS, defaults: { text: 'base-text' }, stageModels: { creative: '' } })
  assert.equal(readPatchDefault(), 'sb/base-text', `实际默认：${readPatchDefault()}`)
})

await check('只改创意绑定、模型集不变也会重写 patch', async () => {
  await putSettings({ models: BASE_MODELS, defaults: { text: 'base-text' }, stageModels: { creative: 'other-text' } })
  assert.equal(readPatchDefault(), 'sb/other-text', `实际默认：${readPatchDefault()}`)
})

await check('不覆盖宿主已保存的显式选择', async () => {
  // 宿主在创意里把默认换成 base-text；应用上次写的是 other-text
  writePatchDefault('sb/base-text')
  const added = [...BASE_MODELS, model('third-text', '第三文本')]
  await putSettings({ models: added, defaults: { text: 'base-text' }, stageModels: { creative: 'other-text' } })
  assert.equal(readPatchDefault(), 'sb/base-text', `宿主的选择被覆盖成了 ${readPatchDefault()}`)
})

await check('来源记录缺失时保留仍有效的现值', async () => {
  fs.rmSync(studioDefaultStatePath(DSH_HOME), { force: true })
  writePatchDefault('sb/other-text')
  const added = [...BASE_MODELS, model('third-text', '第三文本'), model('fourth-text', '第四文本')]
  await putSettings({ models: added, defaults: { text: 'base-text' }, stageModels: { creative: 'base-text' } })
  assert.equal(readPatchDefault(), 'sb/other-text', `来源未知时现值被覆盖成了 ${readPatchDefault()}`)
})

await check('来源记录丢失后不再永久冻结', async () => {
  const models = [...BASE_MODELS, model('third-text', '第三文本')]
  // 记录丢失 + 现值有效：先保留并落 explicit/source=unrecorded
  fs.rmSync(studioDefaultStatePath(DSH_HOME), { force: true })
  writePatchDefault('sb/other-text')
  await putSettings({ models, defaults: { text: 'base-text' }, stageModels: { creative: 'base-text' } })
  assert.equal(readPatchDefault(), 'sb/other-text', '首次丢失时应保留现值')
  const first = readDefaultState()
  assert.equal(first?.explicit, true, '首次丢失应落 explicit')
  assert.equal(first?.source, 'unrecorded', '封存来源应为记录丢失')

  // 再改设置页默认：来源是「记录丢失」而不是宿主选择 → 必须跟随新值
  await putSettings({ models, defaults: { text: 'base-text' }, stageModels: { creative: 'third-text' } })
  assert.equal(readPatchDefault(), 'sb/third-text', '默认模型仍被永久冻结')
  const second = readDefaultState()
  assert.equal(second?.explicit, false, '跟随之后不该再带封存标记')
  assert.equal(second?.source, undefined)
})

await check('现值指向已删除的模型时回退到创意绑定', async () => {
  writePatchDefault('sb/gone')
  const added = [...BASE_MODELS, model('third-text', '第三文本'), model('fourth-text', '第四文本'), model('fifth-text', '第五文本')]
  await putSettings({ models: added, defaults: { text: 'base-text' }, stageModels: { creative: 'other-text' } })
  assert.equal(readPatchDefault(), 'sb/other-text', `失效键没有回退，实际 ${readPatchDefault()}`)
})

await check('无可用文本模型时写入兜底路由', async () => {
  await putSettings({ models: [], defaults: { text: '' }, stageModels: { creative: '' } })

  const providers = readPatchProviders()
  // 兜底路由上线，但用户自建的 provider 仍然保留
  assert.deepEqual(Object.keys(providers).sort(), ['sb-app', 'user-owned'], `实际路由：${Object.keys(providers)}`)
  assert.equal(providers['sb-app'].displayName, '应用模型')
  assert.equal(providers['sb-app'].baseURL, `http://127.0.0.1:${port}/v1`)
  assert.deepEqual(providers['sb-app'].models.map((m) => m.id), ['sb/default'])
  assert.equal(providers['sb-app'].models[0].name, '（未配置模型）')
  // 默认模型也必须落在兜底路由上，不能悬空
  assert.deepEqual(readPatchDefaultPair(), { provider: 'sb-app', model: 'sb/default' })
  // 清单只记兜底路由
  assert.deepEqual(readStudioRoutes(DSH_HOME), ['sb-app'])
})

proc.kill('SIGTERM')

if (bad) {
  console.error(`\n${bad} 项未通过`)
  process.exit(1)
}
console.log('\n创意会话模型路由测试通过')
process.exit(0)
