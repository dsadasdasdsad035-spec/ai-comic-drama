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
  STUDIO_PROVIDER_ID,
  studioDefaultStatePath,
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

// ---------------------------------------------------------------- 纯函数：来源判定
await check('默认模型来源判定：四段规则', () => {
  const provider = STUDIO_PROVIDER_ID
  const ids = ['sb/a', 'sb/b']

  // 1. 文件里没有 → 写回退值
  assert.deepEqual(
    decideDefaultModel({ existing: null, lastWritten: null, fallbackId: 'sb/a', modelIds: ids }),
    { write: true, provider, model: 'sb/a' },
  )

  // 2. 仍是上次我们写的 → 更新
  assert.deepEqual(
    decideDefaultModel({
      existing: { provider, model: 'sb/a' },
      lastWritten: { provider, model: 'sb/a' },
      fallbackId: 'sb/b',
      modelIds: ids,
    }),
    { write: true, provider, model: 'sb/b' },
  )

  // 2b. 仍是我们写的且回退值没变 → 不动
  assert.deepEqual(
    decideDefaultModel({
      existing: { provider, model: 'sb/a' },
      lastWritten: { provider, model: 'sb/a' },
      fallbackId: 'sb/a',
      modelIds: ids,
    }),
    { write: false, provider, model: 'sb/a' },
  )

  // 3. 模型键已失效 → 写回退值
  assert.deepEqual(
    decideDefaultModel({
      existing: { provider, model: 'sb/gone' },
      lastWritten: { provider, model: 'sb/a' },
      fallbackId: 'sb/b',
      modelIds: ids,
    }),
    { write: true, provider, model: 'sb/b' },
  )

  // 4. 来源未知且现值有效 → 保留（不抹掉宿主的选择）
  assert.deepEqual(
    decideDefaultModel({
      existing: { provider, model: 'sb/b' },
      lastWritten: null,
      fallbackId: 'sb/a',
      modelIds: ids,
    }),
    { write: false, provider, model: 'sb/b' },
  )

  // 4b. 值与上次记录不同 = 宿主改过 → 保留
  assert.deepEqual(
    decideDefaultModel({
      existing: { provider, model: 'sb/b' },
      lastWritten: { provider, model: 'sb/a' },
      fallbackId: 'sb/a',
      modelIds: ids,
    }),
    { write: false, provider, model: 'sb/b' },
  )
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

function readPatchWelcomeAck() {
  const entry = readPatchEntries().find((e) => e && e.id === WELCOME_NOTICE_ENTRY_ID)
  return entry?.config?.[WELCOME_NOTICE_FIELD]
}

/** 模拟宿主自己写入了默认模型（同一份 patch、同一个条目） */
function writePatchDefault(value) {
  const entries = readPatchEntries()
  const index = entries.findIndex((e) => e && e.id === 'agent-default-model')
  const next = { id: 'agent-default-model', config: { provider: STUDIO_PROVIDER_ID, model: value } }
  if (index >= 0) entries[index] = { ...entries[index], ...next, config: next.config }
  else entries.push(next)
  fs.writeFileSync(PATCH, stringifyYaml(entries), 'utf8')
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

await check('现值指向已删除的模型时回退到创意绑定', async () => {
  writePatchDefault('sb/gone')
  const added = [...BASE_MODELS, model('third-text', '第三文本'), model('fourth-text', '第四文本'), model('fifth-text', '第五文本')]
  await putSettings({ models: added, defaults: { text: 'base-text' }, stageModels: { creative: 'other-text' } })
  assert.equal(readPatchDefault(), 'sb/other-text', `失效键没有回退，实际 ${readPatchDefault()}`)
})

proc.kill('SIGTERM')

if (bad) {
  console.error(`\n${bad} 项未通过`)
  process.exit(1)
}
console.log('\n创意会话模型路由测试通过')
process.exit(0)
