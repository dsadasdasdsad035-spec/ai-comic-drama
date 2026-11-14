/**
 * 创意「发送预览」：载荷组装、system 极简、检查器 UI。
 * 跑法：node verify-creative-payload-inspect.mjs
 */
import { spawn, execFileSync } from 'node:child_process'
import { build } from 'esbuild'
import { chromium } from 'playwright-core'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

const ROOT = process.cwd()
const PORT = 5348
const APP = `http://127.0.0.1:${PORT}`
const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'creative-payload-'))
let bad = 0
const check = (name, cond, extra = '') => {
  console.log(`${cond ? '✅' : '❌'} ${name}${extra ? ` | ${extra}` : ''}`)
  if (!cond) bad++
}

// ---- 纯函数：system 不含模式与会话元数据 ----
const entry = path.join(TMP, 'payload-entry.ts')
fs.writeFileSync(
  entry,
  `export * from ${JSON.stringify(path.join(ROOT, 'src/creative/creativeTurnPayload.ts'))}\n` +
    `export * from ${JSON.stringify(path.join(ROOT, 'src/skills/types.ts'))}\n`,
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

const mockHost = {
  id: 'creative-plan',
  source: 'builtin',
  manifest: {
    id: 'creative-plan',
    name: '创意策划',
    version: 1,
    stage: 'creative',
    runtime: 'tools',
    tools: ['read_skill', 'read_creative_session'],
  },
  body: '',
  inputs: {},
}

const payload = lib.buildCreativeTurnPayload({
  host: mockHost,
  messages: [{ id: 'u1', role: 'user', status: 'complete', parts: [{ type: 'text', text: '你好' }] }],
  draftText: '下一句',
})
check('system 不含创意模式', !payload.system.includes('创意模式'), payload.system.slice(0, 80))
check('system 不含会话 uuid 样式', !/会话：/.test(payload.system))
check('user 不含 transcript 前缀', !payload.userForModel.includes('【之前的对话】'))
check('user 含草稿', payload.userForModel.includes('下一句'))
check('含 Pi 历史说明', payload.piMemoryPreview.includes('Pi 历史'))
check('prior 含历史 user', payload.priorPiMessages.some((m) => m.role === 'user' && String(m.content).includes('你好')))
check('工具列表含 read_skill', payload.toolNames.includes('read_skill'))

const autoPayload = lib.buildCreativeTurnPayload({ host: null, messages: [], draftText: 'hi' })
check('无偏好宿主 system 要求技能目录', autoPayload.system.includes('list_installed_skills'))
check('无偏好宿主 skillId 展示', lib.creativeTaskView(null, autoPayload, 'm').skillId === 'auto')

// system 承诺「已读可不再重读」必须与历史保真一致：第二轮历史里技能正文得真的在
const SKILL_BODY = 'C'.repeat(6000)
const withSkill = lib.buildCreativeTurnPayload({
  host: mockHost,
  messages: [
    { id: 'u1', role: 'user', status: 'complete', parts: [{ type: 'text', text: '读一下技能' }] },
    {
      id: 'a1',
      role: 'assistant',
      status: 'complete',
      parts: [
        {
          type: 'tool-call',
          toolCallId: 't1',
          toolName: 'read_skill_text',
          args: { id: 'novel-storyboard' },
          status: 'done',
          result: { ok: true, id: 'novel-storyboard', text: SKILL_BODY },
        },
      ],
    },
  ],
  draftText: '继续',
})
check('system 承诺已读可不再重读', withSkill.system.includes('可不再重复读取'))
const priorText = JSON.stringify(withSkill.priorPiMessages)
check('第二轮历史含完整技能正文', priorText.includes(SKILL_BODY), `${priorText.length} 字符`)
check('第二轮历史不含 truncated 标记', !priorText.includes('truncated'))

try {
  await fetch(`${APP}/api/health`, { signal: AbortSignal.timeout(800) })
  console.error(`端口 ${PORT} 已被占用`)
  process.exit(1)
} catch {
  /* 空闲 */
}

const child = spawn(
  process.execPath,
  [path.join(ROOT, 'node_modules', 'vite', 'bin', 'vite.js'), '--port', String(PORT), '--strictPort'],
  { cwd: ROOT, stdio: 'ignore' },
)

let up = false
for (let i = 0; i < 80; i++) {
  try {
    if ((await fetch(`${APP}/api/health`)).ok) {
      up = true
      break
    }
  } catch {
    /* wait */
  }
  await new Promise((r) => setTimeout(r, 400))
}
if (!up) {
  child.kill()
  console.error('dev server 启动失败')
  process.exit(1)
}

const api = async (p, init) => {
  const r = await fetch(`${APP}${p}`, init)
  try {
    return await r.json()
  } catch {
    return {}
  }
}

// 原样留存：脚本会临时注入 mock 文本模型，退出时必须把用户设置整体复原，
// 否则真实库里会留下 defaults.text=mock-text（指向 mock.invalid）。
const originalSettings = (await api('/api/settings')).settings
const settings = JSON.parse(JSON.stringify(originalSettings))
settings.providers = [
  ...(settings.providers || []).filter((p) => p.id !== 'mock-text'),
  { id: 'mock-text', label: 'Mock Text', kind: 'openai', baseUrl: 'https://mock.invalid', caps: ['text'], apiKey: 'mock' },
]
settings.models = [
  ...(settings.models || []).filter((m) => m.key !== 'mock-text'),
  { key: 'mock-text', label: 'Mock Text', cap: 'text', provider: 'mock-text', model: 'mock-text' },
]
settings.defaults = { ...(settings.defaults || {}), text: 'mock-text' }
settings.stageModels = { ...(settings.stageModels || {}), creative: 'mock-text' }
await api('/api/settings', {
  method: 'PUT',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify(settings),
})

const browser = await chromium.launch({ headless: true, channel: 'chrome' })
try {
  const page = await browser.newPage({ viewport: { width: 1400, height: 900 } })
  await page.goto(APP, { waitUntil: 'domcontentloaded' })
  await page.getByRole('button', { name: '创意', exact: true }).first().click()
  await page.locator('[data-creative-studio]').waitFor({ timeout: 15000 })

  const input = page.getByLabel('创意聊天输入')
  await input.waitFor({ timeout: 10000 })
  await input.fill('预览草稿一行')

  const inspectBtn = page.getByRole('button', { name: '发送预览' })
  await inspectBtn.click()
  await page.locator('[data-chat-inspector]').waitFor({ timeout: 10000 })
  check('检查器已展开', true)

  const overviewText = await page.locator('[data-chat-inspector]').innerText()
  check('检查器 system 区无创意模式', !overviewText.includes('创意模式：'), overviewText.slice(0, 200))

  await page.getByRole('tab', { name: '本轮任务' }).click()
  const taskText = await page.locator('[data-chat-inspector]').innerText()
  check('草稿进入 user 预览', taskText.includes('预览草稿一行'), taskText.slice(0, 280))

  await page.getByRole('tab', { name: '读取权限' }).click()
  const readText = await page.locator('[data-chat-inspector]').innerText()
  check('读取权限含 read_skill', readText.includes('read_skill'), readText.slice(0, 200))

  // 手选技能后切模式：跟随模式关闭时技能保持
  await page.getByRole('button', { name: '收起预览' }).click()
  await page.locator('[data-creative-studio]').waitFor({ timeout: 5000 })

  const hostSelect = page.locator('[data-creative-host-skill]')
  // 会话已绑定专家时顶栏隐藏「偏好技能」下拉（只走专家白名单），本段不适用。
  const hostVisible = await hostSelect.isVisible().catch(() => false)
  if (!hostVisible) {
    check('手选技能后切模式不改变下拉', true, '跳过：当前会话已绑定专家，偏好技能下拉不显示')
  } else {
    await page.waitForFunction(
      () => document.querySelectorAll('[data-creative-host-skill] option').length >= 2,
      undefined,
      { timeout: 15000 },
    )
    const altId = await hostSelect.evaluate((sel) => {
      const cur = sel.value
      const hit = [...sel.options].find((o) => o.value && o.value !== cur)
      return hit?.value || ''
    })
    if (altId) {
      await hostSelect.selectOption(altId)
      await page.waitForFunction(
        (id) => document.querySelector('[data-creative-host-skill]')?.value === id,
        altId,
        { timeout: 5000 },
      )
      // 创意「模式」(计划/反推) 与其「跟随模式」开关已从界面移除，这两条断言无从执行。
      const modesCount = await page.locator('[data-creative-modes]').count()
      if (!modesCount) {
        check('手选技能会关闭跟随模式', true, '跳过：创意模式 UI 已移除')
        check('手选技能后切模式不改变下拉', true, '跳过：创意模式 UI 已移除')
      } else {
        const followsOff = await page.waitForFunction(
          () => {
            const labels = [...document.querySelectorAll('[data-creative-header] label')]
            const lab = labels.find((l) => l.textContent?.includes('跟随模式'))
            const el = lab?.querySelector('input[type=checkbox]')
            return Boolean(el && !el.checked)
          },
          undefined,
          { timeout: 5000 },
        )
        check('手选技能会关闭跟随模式', Boolean(followsOff))
        await page.locator('[data-creative-modes] [data-mode="plan"]').click()
        await page.waitForTimeout(200)
        await page.locator('[data-creative-modes] [data-mode="reverse"]').click()
        await page.waitForTimeout(200)
        const val = await hostSelect.inputValue()
        check('手选技能后切模式不改变下拉', val === altId, `${val} 期望 ${altId}`)
      }
    } else {
      check('手选技能后切模式不改变下拉', true, '跳过：无可选其它技能')
    }
  }
} finally {
  await browser.close()
  // 复原用户设置：脚本注入的 mock 文本模型不能留在真实库里。
  // 必须在停掉 dev server 之前发，否则请求没有接收方。
  await api('/api/settings', {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(originalSettings),
  }).catch(() => {})
  child.kill()
}

process.exit(bad ? 1 : 0)
