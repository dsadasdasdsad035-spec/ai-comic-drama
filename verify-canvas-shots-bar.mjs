/**
 * 画布集摘要、目标时长与补齐锚点回归。
 *
 * 断言点：
 * 1) 目标时长按集读取，缺省回落到默认值；
 * 2) 改目标时长只动当前集，其他集不变；
 * 3) 汇总口径：总时长 = 秒数之和；
 * 4) 补齐锚点把无法展开的角色占位换成外观锚点，并追加 handEdited；
 * 5) 缺失角色没有外观锚点时不改任何镜头。
 *
 * 跑法：node verify-canvas-shots-bar.mjs
 */
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { spawn, execFileSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { chromium } from 'playwright-core'

const root = path.dirname(fileURLToPath(import.meta.url))
const outDir = fs.mkdtempSync(path.join(root, '.verify-canvas-bar-'))
const esbuild = path.join(root, 'node_modules', '.bin', 'esbuild')

function bundle(entry, name) {
  const out = path.join(outDir, `${name}.mjs`)
  execFileSync(esbuild, [
    entry,
    '--bundle',
    '--platform=node',
    '--format=esm',
    '--log-level=error',
    `--outfile=${out}`,
  ])
  return out
}

const ctx = await import(bundle('src/productionContext.ts', 'productionContext'))
const ops = await import(bundle('src/canvasShotOps.ts', 'ops'))

let bad = 0
const check = (name, cond, extra = '') => {
  console.log(`${cond ? '✅' : '❌'} ${name}${extra ? ` | ${extra}` : ''}`)
  if (!cond) bad++
}

const episodes = [
  { no: 1, targetSeconds: 30, scenes: [] },
  { no: 2, scenes: [] },
  { no: 3, targetSeconds: 45, scenes: [] },
]

check('目标时长按集读取', ctx.resolveEpisodeTarget(episodes, 1) === 30)
check('缺省回落到默认值', ctx.resolveEpisodeTarget(episodes, 2) === ctx.DEFAULT_EPISODE_TARGET_SECONDS)

const changed = ctx.setEpisodeTargetSeconds(episodes, 2, 52)
check('改目标时长写入当前集', ctx.resolveEpisodeTarget(changed, 2) === 52)
check('其他集不受影响', ctx.resolveEpisodeTarget(changed, 1) === 30 && ctx.resolveEpisodeTarget(changed, 3) === 45)
check('集顺序保持', changed.map((e) => e.no).join(',') === '1,2,3', changed.map((e) => e.no).join(','))
check('下限夹到 10 秒', ctx.resolveEpisodeTarget(ctx.setEpisodeTargetSeconds(episodes, 1, 1), 1) === 10)

// ---------------------------------------------------------------- 汇总
const shots = [
  { id: 'E01-S01', episode: 1, no: 'S01', seconds: 3, desc: '' },
  { id: 'E01-S02', episode: 1, no: 'S02', seconds: 4.5, desc: '' },
  { id: 'E02-S01', episode: 2, no: 'S01', seconds: 9, desc: '' },
]
const ep1 = shots.filter((s) => (Number(s.episode) || 1) === 1)
const total = ep1.reduce((a, s) => a + (Number(s.seconds) || 0), 0)
check('总时长只算当前集', total === 7.5, String(total))
check('超出目标时长会被算出', total > 5 && (total - 5).toFixed(1) === '2.5', String(total - 5))
check('未超出时不报超时', total < ctx.resolveEpisodeTarget(episodes, 3))

// ---------------------------------------------------------------- 补齐锚点
const chars = [
  { id: 'c1', name: '陈曦', role: '主角', lookEn: 'short black hair, white shirt', lookCn: '', palette: [], keywords: [] },
  { id: 'c2', name: '陈默', role: '配角', lookCn: '', palette: [], keywords: [] },
]
const withAnchors = [
  { id: 'E01-S01', episode: 1, no: 'S01', seconds: 3, desc: '', keyframe_prompt: '雨夜，{{陈曦}}回头', dialogue: [], cast: ['陈曦'] },
  { id: 'E01-S02', episode: 1, no: 'S02', seconds: 3, desc: '', keyframe_prompt: '{{陈默}}站在门口', dialogue: [], cast: ['陈默'] },
  { id: 'E01-S03', episode: 1, no: 'S03', seconds: 3, desc: '', keyframe_prompt: '空镜', dialogue: [], cast: [] },
  { id: 'E02-S01', episode: 2, no: 'S01', seconds: 3, desc: '', keyframe_prompt: '{{陈曦}}在别的集', dialogue: [], cast: ['陈曦'] },
]
const fixed = ops.planFixAnchors(withAnchors, 1, chars)
check('只回报当前集补齐的镜数', fixed.fixed === 1, String(fixed.fixed))
const s1 = fixed.shots.find((s) => s.id === 'E01-S01')
check('提示词追加外观锚点', /short black hair, white shirt/.test(s1.keyframe_prompt), s1.keyframe_prompt)
check('追加手改标记', (s1.handEdited ?? []).includes('keyframe_prompt'))
check('缺外观锚点的镜头不改', fixed.shots.find((s) => s.id === 'E01-S02').keyframe_prompt === '{{陈默}}站在门口')
check('其他集不被修改', fixed.shots.find((s) => s.id === 'E02-S01').keyframe_prompt === '{{陈曦}}在别的集')

fs.rmSync(outDir, { recursive: true, force: true })

// ---------------------------------------------------------------------------
// UI：画布上下文带摘要、切集刷新、目标时长落库、补齐锚点
// ---------------------------------------------------------------------------
const PORT = 5398
const APP = `http://127.0.0.1:${PORT}`
const NAME = `canvas-bar-${Date.now()}`
const WORK = fs.mkdtempSync(path.join(os.tmpdir(), 'canvas-bar-'))
const child = spawn(
  process.execPath,
  [path.join(root, 'node_modules', 'vite', 'bin', 'vite.js'), '--port', String(PORT), '--strictPort'],
  { cwd: root, env: { ...process.env, SB_PROJECTS_DIR: WORK }, stdio: 'ignore' },
)
const api = async (p, init) => (await fetch(`${APP}${p}`, init)).json()

const seedShots = [
  { id: 'E01-S01', episode: 1, no: 'S01', seconds: 3, size: '中景', move: '固定', desc: '雨夜', dialogue: [], cast: ['陈曦'], keyframe_prompt: '雨夜，{{陈曦}}回头', video_prompt: '' },
  { id: 'E01-S02', episode: 1, no: 'S02', seconds: 4.5, size: '近景', move: '推', desc: '空镜', dialogue: [], cast: [], keyframe_prompt: '空镜', video_prompt: '' },
  { id: 'E02-S01', episode: 2, no: 'S01', seconds: 9, size: '全景', move: '拉', desc: '仓库', dialogue: [], cast: [], keyframe_prompt: '仓库空镜', video_prompt: '' },
]

async function boot() {
  for (let i = 0; i < 80; i++) {
    try {
      const r = await fetch(`${APP}/api/health`)
      if (r.ok) break
    } catch {
      /* 等 vite 起来 */
    }
    await new Promise((r) => setTimeout(r, 400))
  }
  await api(`/api/project?name=${encodeURIComponent(NAME)}&create=1`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ title: NAME, aspect: '16:9' }),
  })
  await api(`/api/project?name=${encodeURIComponent(NAME)}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      source: '画布摘要验收',
      style: '写实',
      aspect: '16:9',
      episodes: [
        { no: 1, title: 'EP1', targetSeconds: 30, scenes: [{ no: 1, slug: 'SC01' }] },
        { no: 2, title: 'EP2', targetSeconds: 40, scenes: [{ no: 1, slug: 'SC02' }] },
      ],
      characters: [{ name: '陈曦', look_en: 'short black hair, white shirt', look_cn: '' }],
      shots: seedShots,
      designs: [],
    }),
  })
}

const readProject = async () => (await api(`/api/project?name=${encodeURIComponent(NAME)}`)).project

let browser = null
try {
  await boot()
  browser = await chromium.launch({ headless: true, channel: 'chrome' })
  const page = await browser.newPage({ viewport: { width: 1500, height: 1000 } })
  const errors = []
  page.on('pageerror', (e) => errors.push(String(e)))
  page.on('dialog', (d) => void d.accept())

  await page.goto(APP, { waitUntil: 'domcontentloaded' })
  await page.locator('.topbar-project select').waitFor({ timeout: 15000 })
  await page.locator('.topbar-project select').selectOption(NAME)
  await page.locator('.wb-bar').waitFor({ timeout: 15000 })
  await page.waitForTimeout(1200)

  const barText = () => page.locator('.wb-bar').innerText()
  const switchEpisode = async (no) => {
    await page.locator('.epbar-trigger').click()
    await page.locator('.epbar-panel').waitFor({ timeout: 10000 })
    await page.locator('.epbar-panel button', { hasText: `E${String(no).padStart(2, '0')}` }).first().click()
    await page.waitForTimeout(800)
  }

  const e1 = await barText()
  check('摘要：显示当前集镜数', /2 镜/.test(e1), e1.replace(/\n/g, ' | ').slice(0, 160))
  check('摘要：显示总时长与目标', /7\.5s/.test(e1) && /目标 30s/.test(e1), e1.replace(/\n/g, ' | ').slice(0, 160))
  check('摘要：缺首帧与缺锚点计数', /缺首帧/.test(e1) && /缺锚点/.test(e1), e1.replace(/\n/g, ' | ').slice(0, 160))
  check('摘要：缺锚点计数为 1', /缺锚点\s*1/.test(e1), e1.replace(/\n/g, ' | ').slice(0, 200))

  // 切集：摘要与画布都换成新集
  await switchEpisode(2)
  const e2 = await barText()
  check('切集：镜数更新', /1 镜/.test(e2), e2.replace(/\n/g, ' | ').slice(0, 160))
  check('切集：总时长与目标更新', /9\.0s/.test(e2) && /目标 40s/.test(e2), e2.replace(/\n/g, ' | ').slice(0, 160))
  check(
    '切集：画布只剩该集镜头',
    (await page.locator('.react-flow__node-shot').count()) === 1,
    String(await page.locator('.react-flow__node-shot').count()),
  )

  // 目标时长：只写当前集
  const target = page.locator('input[aria-label="当前集目标时长（秒）"]')
  await target.fill('60')
  await target.press('Enter')
  await page.waitForTimeout(900)
  const afterTarget = await readProject()
  const ep2Target = (afterTarget.episodes ?? []).find((e) => Number(e.no) === 2)?.targetSeconds
  const ep1Target = (afterTarget.episodes ?? []).find((e) => Number(e.no) === 1)?.targetSeconds
  check('目标时长：写进当前集', Number(ep2Target) === 60, String(ep2Target))
  check('目标时长：其他集不变', Number(ep1Target) === 30, String(ep1Target))

  // 补齐锚点：只作用于当前集
  await switchEpisode(1)
  await page.getByRole('button', { name: '补齐锚点', exact: true }).click()
  await page.waitForTimeout(1200)
  const afterFix = await readProject()
  const s1 = (afterFix.shots ?? []).find((s) => s.id === 'E01-S01')
  const s3 = (afterFix.shots ?? []).find((s) => s.id === 'E02-S01')
  check('补齐锚点：提示词追加外观锚点', /short black hair/.test(String(s1?.keyframe_prompt ?? '')), String(s1?.keyframe_prompt ?? ''))
  check('补齐锚点：追加手改标记', Array.isArray(s1?.handEdited) && s1.handEdited.includes('keyframe_prompt'), JSON.stringify(s1?.handEdited))
  check('补齐锚点：其他集不被修改', s3?.keyframe_prompt === '仓库空镜', String(s3?.keyframe_prompt ?? ''))

  check('画布摘要：页面无脚本错误', errors.length === 0, errors.slice(0, 3).join(' / '))
} finally {
  await browser?.close()
  child.kill('SIGTERM')
  fs.rmSync(WORK, { recursive: true, force: true })
}

console.log(bad === 0 ? '\n全部通过' : `\n${bad} 项失败`)
process.exit(bad === 0 ? 0 : 1)
