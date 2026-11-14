/**
 * 4.3 端到端：真模型 + 真项目 + 真技能全文。
 *
 * 复现路径：连续读两个 >4000 字的技能全文后追问「只有正文深处才有的细节」。
 * 关键证据取第二轮的 /api/text 请求体——它就是由 uiThreadToPiMessages 组装的历史，
 * 若历史被截断，正文深处的词根本不会出现在请求里。
 *
 * 跑法：node verify-creative-thread-e2e-real.mjs
 *       E2E_TEXT_MODEL=ark-plan-text-deepseek node verify-creative-thread-e2e-real.mjs
 *
 * 注意：会消耗真实 token；结束后复原 settings 并删除本次产生的创意会话。
 */
import { spawn } from 'node:child_process'
import { chromium } from 'playwright-core'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

const ROOT = process.cwd()
const PORT = 5354
const APP = `http://127.0.0.1:${PORT}`
const MODEL = process.env.E2E_TEXT_MODEL || 'ark-plan-text-deepseek'
const PROJECT = process.env.E2E_PROJECT || 'a'
const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'thread-e2e-real-'))
let bad = 0
const check = (name, cond, extra = '') => {
  console.log(`${cond ? '✅' : '❌'} ${name}${extra ? ` | ${String(extra).replace(/\s+/g, ' ').slice(0, 160)}` : ''}`)
  if (!cond) bad++
}

/** 只出现在技能正文 4000 字之后的词：旧逻辑在这一段就被折叠掉了 */
const TAIL_TOKENS = {
  'novel-storyboard': ['must_phrases'],
  'character-refs': ['front-full', '锚点没确认'],
}

try {
  await fetch(`${APP}/api/health`, { signal: AbortSignal.timeout(800) })
  console.error(`端口 ${PORT} 已被占用`)
  process.exit(1)
} catch {
  /* 空闲 */
}

// 真项目目录（不设 SB_PROJECTS_DIR），技能安装记录也来自真实库
const child = spawn(
  process.execPath,
  [path.join(ROOT, 'node_modules', 'vite', 'bin', 'vite.js'), '--port', String(PORT), '--strictPort'],
  { cwd: ROOT, stdio: 'ignore' },
)

const api = async (p, init) => {
  const r = await fetch(`${APP}${p}`, init)
  try {
    return await r.json()
  } catch {
    return {}
  }
}

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

// 技能与模型都要就位；settings 原样留存以便复原
const original = (await api('/api/settings')).settings
const hasModel = (original.models || []).some((m) => m.key === MODEL)
if (!hasModel) {
  child.kill()
  console.error(`设置里没有文本模型 ${MODEL}，用 E2E_TEXT_MODEL 指定一个`)
  process.exit(1)
}
const skillList = await api('/api/skills')
const ids = (skillList.skills || []).map((s) => s.id)
for (const id of Object.keys(TAIL_TOKENS)) {
  if (!ids.includes(id)) {
    child.kill()
    console.error(`缺少技能 ${id}（需要真实安装记录）`)
    process.exit(1)
  }
}

// 注意：服务端 STAGES 目前不含 'creative'，stageModels.creative 会被 normalizeStageModels 丢弃，
// 所以这里改 defaults.text 来指定文本模型（这也是没有环节绑定时创意会话实际回落的那个）。
await api('/api/settings', {
  method: 'PUT',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ ...original, defaults: { ...(original.defaults || {}), text: MODEL } }),
})
console.log(`模型 ${MODEL} · 项目 ${PROJECT} · 技能 ${Object.keys(TAIL_TOKENS).join(' + ')}`)

const browser = await chromium.launch({ headless: true, channel: 'chrome' })
let sessionId = ''
const textBodies = []
try {
  const page = await browser.newPage({ viewport: { width: 1500, height: 950 } })
  page.on('request', (req) => {
    if (!req.url().includes('/api/text') || req.method() !== 'POST') return
    try {
      textBodies.push(String(req.postData() || ''))
    } catch {
      /* 忽略 */
    }
  })
  let threadDumps = 0
  page.on('request', (req) => {
    if (!/\/thread$/.test(req.url()) || req.method() !== 'PUT') return
    try {
      threadDumps++
      fs.writeFileSync(`/tmp/e2e-thread-${String(threadDumps).padStart(2, '0')}.json`, String(req.postData() || ''))
    } catch {
      /* 忽略 */
    }
  })
  page.on('response', async (res) => {
    if (!/\/api\/creative\/sessions$/.test(res.url()) || res.request().method() !== 'POST') return
    try {
      const j = await res.json()
      if (j?.session?.id) sessionId = j.session.id
    } catch {
      /* 忽略 */
    }
  })

  await page.goto(`${APP}/#/p/${encodeURIComponent(PROJECT)}/creative`, { waitUntil: 'domcontentloaded' })
  await page.locator('[data-creative-studio]').waitFor({ timeout: 20000 })
  let input = page.getByLabel('创意聊天输入')
  await input.waitFor({ timeout: 20000 })

  // 新建会话：否则会复用侧栏里已有的历史，污染「本轮请求体」证据
  const newBtn = page.getByRole('button', { name: '新建会话' })
  if (await newBtn.isVisible().catch(() => false)) {
    await newBtn.click()
  } else {
    await page.locator('[data-creative-action="toggle-list"]').click()
    await newBtn.click()
  }
  await page.waitForFunction(() => document.querySelectorAll('[data-chat-message]').length === 0, null, {
    timeout: 20000,
  })
  input = page.getByLabel('创意聊天输入')
  await input.waitFor({ timeout: 20000 })
  console.log('   （已新建空会话）')

  const assistantText = async () => {
    const nodes = page.locator('[data-chat-message="assistant"]')
    const n = await nodes.count()
    return n ? nodes.nth(n - 1).innerText() : ''
  }
  // 用顶栏状态点判断本轮是否结束：tool 步骤里也会出现「完成」字样，
  // 靠文本匹配会提前返回（会污染请求体证据）。
  const waitDone = async (label) => {
    await page
      .waitForFunction(() => Boolean(document.querySelector('.creative-status-dot.is-running')), null, {
        timeout: 60000,
      })
      .catch(() => console.log(`   （${label} 未见运行态，可能已结束）`))
    await page.waitForFunction(
      () => {
        const dot = document.querySelector('.creative-status-dot')
        return Boolean(dot && !dot.classList.contains('is-running'))
      },
      null,
      { timeout: 300000 },
    ).catch(() => console.log(`   （${label} 等待超时）`))
    return assistantText()
  }
  const say = async (text) => {
    const before = textBodies.length
    await input.fill(text)
    await page.getByRole('button', { name: '发送', exact: true }).click()
    // 等这一轮的请求真正发出
    for (let i = 0; i < 300; i++) {
      if (textBodies.length > before) break
      await page.waitForTimeout(200)
    }
    return waitDone('本轮')
  }

  console.log('\n=== 第 1 轮：读两个技能全文 ===')
  const round1 = await say(
    '请严格按顺序调用工具：先 read_skill_text 读取技能 novel-storyboard 的全文，再 read_skill_text 读取技能 character-refs 的全文。' +
      '必须读全文，不要读摘要，也不要跳过。读完后只回复两行：每行写出技能 id 和你读到的正文字符数。',
  )
  const sawTool = await page.locator('[data-chat-message]').allInnerTexts()
  check('第 1 轮确实调用了读技能工具', sawTool.join('\n').includes('read_skill_text'), sawTool.join(' '))
  check('第 1 轮有回复', Boolean(round1.trim()), round1)

  console.log('\n=== 第 2 轮：追问只有正文深处才有的细节 ===')
  const beforeRound2 = textBodies.length
  const round2 = await say(
    '只根据你刚才读到的两个技能全文回答，不要重读、不要猜：\n' +
      '1) novel-storyboard 里那道可选挂载的质量门，检查分镜 frame 里必须出现的短语字段叫什么名字？把该字段名原样写出来。\n' +
      '2) character-refs 里如果不先确认锚点就想出后续的图，会得到什么结果？另外，正文里举例过的具体视图参数值有哪些？请原样列出你读到的那些。',

  )

  const body2 = textBodies[beforeRound2] || textBodies[textBodies.length - 1] || ''
  let usedModel = ''
  try {
    usedModel = JSON.parse(textBodies[0] || '{}').modelKey || ''
  } catch {
    /* 忽略 */
  }
  console.log(`   实际使用的模型键：${usedModel || '（未带 modelKey）'}`)
  console.log(`   第 2 轮请求体 ${body2.length} 字符`)
  fs.writeFileSync('/tmp/e2e-round1-body.json', textBodies[0] || '')
  fs.writeFileSync('/tmp/e2e-round2-body.json', body2)

  console.log('\n=== 历史保真（请求体里必须含着正文深处的词）===')
  for (const [id, tokens] of Object.entries(TAIL_TOKENS)) {
    for (const tok of tokens) {
      check(`请求体含 ${id} 尾部特征「${tok}」`, body2.includes(tok))
    }
  }
  check('第 2 轮请求体规模确实远超 4000 字', body2.length > 20_000, `${body2.length} 字符`)

  console.log('\n=== 回答引用了正文细节，且没有「请重读」 ===')
  check('回答提到 must_phrases', round2.includes('must_phrases'), round2)
  check('回答提到锚点未确认会被拒', /锚点/.test(round2) && /拒|不允许|不行|不能/.test(round2), round2)
  // 正文 4000 字之后才出现的视图参数值：答出任一个就说明读到了深处内容
  const tailViews = ['front-full', 'detail-hair', 'detail-neck']
  check(`回答提到正文深处的视图参数（${tailViews.join('/')}）`, tailViews.some((v) => round2.includes(v)), round2)
  check('没有出现「已折叠」', !/已折叠|折叠了/.test(round2), round2)
  check('没有出现「请重读」', !/请重读|重新读取|再读一遍/.test(round2), round2)
  check('没有出现 truncated 标记', !round2.includes('truncated'), round2)

  console.log('\n--- 第 2 轮回答 ---')
  console.log(round2.trim().slice(0, 1200))
} finally {
  await browser.close()
  // 先复原设置（必须在停服前，否则请求没有接收方）
  await api('/api/settings', {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(original),
  }).catch(() => {})
  // 删掉本次产生的创意会话，别在真项目里留测试垃圾
  if (sessionId) {
    await api(`/api/creative/sessions/${encodeURIComponent(sessionId)}`, { method: 'DELETE' }).catch(() => {})
    console.log(`已删除测试会话 ${sessionId}`)
  }
  child.kill()
  fs.rmSync(TMP, { recursive: true, force: true })
}

console.log(bad ? `\n❌ 失败 ${bad} 项` : '\n✅ 全部通过')
process.exit(bad ? 1 : 0)
