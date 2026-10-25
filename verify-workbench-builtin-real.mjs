/**
 * 真实模型的工作台聊天内置动作 smoke：从聊天运行拆镜/生成提示词，
 * 再与顶部按钮对比；不写用户项目（临时 projects 目录，设置从真实库复制）。
 * 跑法：node verify-workbench-builtin-real.mjs
 */
import { spawn } from 'node:child_process'
import { chromium } from 'playwright-core'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { DatabaseSync } from 'node:sqlite'

const ROOT = process.cwd()
const PORT = 5330
const APP = `http://127.0.0.1:${PORT}`
const NAME = `wb-real-${Date.now()}`
const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'wb-real-'))
const EVIDENCE = path.join(ROOT, 'openspec/changes/workbench-chat-builtin-actions/evidence')
fs.mkdirSync(EVIDENCE, { recursive: true })
let bad = 0
const check = (name, cond, extra = '') => {
  console.log(`${cond ? '✅' : '❌'} ${name}${extra ? ` | ${extra}` : ''}`)
  if (!cond) bad++
}

function readRealSettings() {
  const file = path.join(ROOT, 'projects', 'storyboard.sqlite')
  if (!fs.existsSync(file)) throw new Error('找不到 projects/storyboard.sqlite')
  const db = new DatabaseSync(file, { readOnly: true })
  const row = db.prepare("SELECT value FROM settings WHERE key='app'").get()
  db.close()
  if (!row?.value) throw new Error('设置里没有 app')
  return JSON.parse(row.value)
}

const child = spawn(
  process.execPath,
  [path.join(ROOT, 'node_modules', 'vite', 'bin', 'vite.js'), '--port', String(PORT), '--strictPort'],
  { cwd: ROOT, env: { ...process.env, SB_PROJECTS_DIR: TMP }, stdio: 'ignore' },
)
const api = async (p, init) => (await fetch(`${APP}${p}`, init)).json()
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
  console.error('临时 dev server 启动失败')
  child.kill()
  process.exit(1)
}

const SEED = {
  source: '雨夜，回收人推车穿过夜市，摊主推过一只义体手臂。',
  style: '近未来科幻写实',
  aspect: '16:9',
  logline: '一只义体手臂牵出旧案。',
  episodes: [
    {
      no: 1,
      title: '雨夜',
      hook: '义体',
      scenes: [
        {
          no: 1,
          slug: 'SC01',
          place: '夜市',
          time: '夜',
          beats: '回收人推车穿过夜市，摊主推过义体手臂，回收人低头端详序列号。',
          characters: ['陈默'],
          intensity: 7,
          tone: '压抑',
        },
      ],
    },
  ],
  characters: [
    {
      name: '陈默',
      role: '主角',
      look_cn: '瘦脸，短黑发，深色风衣',
      look_en: 'a lean man with short black hair, dark trench coat, scar over left eyebrow',
      palette: '暗红 + 铁灰',
      keywords: ['左眉疤'],
    },
  ],
  shots: [
    { id: 'E01-S01', episode: 1, no: 'S01', scene_no: 1, scene_slug: 'SC01', seconds: 3, size: '全景', move: '跟', desc: '回收人推车穿过夜市', dialogue: [], cast: ['陈默'], keyframe_prompt: '', video_prompt: '' },
    { id: 'E01-S02', episode: 1, no: 'S02', scene_no: 1, scene_slug: 'SC01', seconds: 2, size: '特写', move: '固定', desc: '义体手臂序列号', dialogue: [], cast: ['陈默'], keyframe_prompt: '', video_prompt: '' },
  ],
}
await api(`/api/project?name=${encodeURIComponent(NAME)}&create=1`, {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ title: NAME, aspect: '16:9' }),
})
await api(`/api/project?name=${encodeURIComponent(NAME)}`, {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify(SEED),
})
const at = await api('/api/settings', {
  method: 'PUT',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify(readRealSettings()),
})
check('真实设置已复制到临时库', at.ok === true)
const health = await api('/api/health')
check('临时库有真实文本/视觉模型', health.hasKey === true, JSON.stringify(health))

const browser = await chromium.launch({ headless: true, channel: 'chrome' })
try {
  const page = await browser.newPage({ viewport: { width: 1500, height: 1000 } })
  const errors = []
  page.on('pageerror', (e) => errors.push(String(e)))

  const openView = async (nav, attr) => {
    await page.goto(APP, { waitUntil: 'domcontentloaded' })
    await page.locator('.topbar-project select').waitFor({ timeout: 15000 })
    await page.locator('.topbar-project select').selectOption(NAME)
    await page.getByRole('button', { name: nav, exact: true }).click()
    await page.locator(`[data-${attr}-chat]`).waitFor({ timeout: 15000 })
    await page.getByLabel(`${attr} 技能聊天输入`).waitFor({ timeout: 15000 })
  }
  const cardTexts = async (attr) =>
    page.locator(`[data-${attr}-chat] [data-chat-tool="builtin_action"]`).allInnerTexts()

  await openView('镜头表', 'shots')
  await page.locator('[data-shots-chat] [data-chat-builtins] button', { hasText: '拆镜' }).first().click()
  await page.locator('[data-shots-chat] [data-chat-builtin-receipt]').waitFor({ timeout: 180000 })
  const shotCards = await cardTexts('shots')
  const shotRows = await page.locator('table.wb-table tbody tr').count()
  check('真实模型：聊天拆镜成功', shotRows > 0, `rows=${shotRows}`)
  check('真实模型：拆镜回执含模型/耗时', shotCards.some((t) => t.includes('模型')), shotCards.join(' / ').slice(0, 240))
  await page.screenshot({ path: path.join(EVIDENCE, 'builtin-actions-real-shots.png') })

  await page.getByRole('button', { name: '拆镜', exact: true }).click()
  await page.waitForTimeout(1500)
  const topShotRows = await page.locator('table.wb-table tbody tr').count()
  check('真实模型：顶部按钮也能出镜头', topShotRows > 0, `rows=${topShotRows}`)
  check('真实模型：顶部按钮不新增聊天回执', (await cardTexts('shots')).length === 1)

  await openView('提示词', 'prompts')
  await page.locator('[data-prompts-chat] [data-chat-builtins] button', { hasText: '生成提示词' }).first().click()
  await page.locator('[data-prompts-chat] [data-chat-builtin-receipt]').waitFor({ timeout: 180000 })
  const promptValues = await page.locator('table textarea').evaluateAll((els) => els.map((e) => e.value))
  const filled = promptValues.filter((v) => String(v).trim().length > 0).length
  const promptCards = await cardTexts('prompts')
  check('真实模型：聊天生成提示词成功', filled > 0, `filled=${filled}`)
  check('真实模型：提示词回执含模型/耗时', promptCards.some((t) => t.includes('模型')), promptCards.join(' / ').slice(0, 240))
  await page.getByRole('button', { name: '生成提示词', exact: true }).click()
  await page.waitForTimeout(1500)
  check('真实模型：顶部按钮不新增提示词回执', (await cardTexts('prompts')).length === 1)
  await page.screenshot({ path: path.join(EVIDENCE, 'builtin-actions-real-prompts.png') })

  check('页面无异常', errors.length === 0, errors.slice(0, 3).join(' / '))
} finally {
  await browser.close()
  child.kill()
}
console.log(bad ? `\n❌ ${bad} 项失败` : '\n✅ 全部通过')
process.exit(bad ? 1 : 0)
