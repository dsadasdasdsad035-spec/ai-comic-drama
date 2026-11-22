/**
 * 原生音频 UI 回归：能力门、4 秒下限、单说话人，以及**无台词镜也能开音色参考**。
 *
 * 用真实后端（临时项目目录 + seed 落库）而不是 mock 项目接口：
 * 这个脚本要断言「勾选后写回 project.json」，mock 掉项目接口就没法验证真正的
 * 落库链路；只有 /api/settings 需要 mock（临时项目里没有模型库）。
 *
 * 跑法：node verify-native-audio-ui.mjs
 */
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { chromium } from 'playwright-core'
import { createCheck, makeProjectsDir, seed, startApp } from './verify-harness.mjs'
import { openBoardEpisode } from './verify-lib.mjs'

const root = path.dirname(fileURLToPath(import.meta.url))
const PORT = 5345
const PROJECTS = makeProjectsDir('native-audio-ui-')
const PROJECT = 'native-e2e'
const EVIDENCE = path.join(root, 'openspec/changes/seedance-voice-reference/evidence')
fs.mkdirSync(EVIDENCE, { recursive: true })
const check = createCheck()

const sample = {
  url: '/project-assets/native-e2e/voice.mp3',
  text: '这是一段试音。',
  seconds: 8,
  engine: 'mock',
  voiceId: 'male-qn-qingse',
  modelKey: 'minimax-tts',
  fingerprint: 'f',
  stale: false,
}

const settings = {
  providers: [
    {
      id: 'apimart',
      label: 'APIMart',
      kind: 'apimart',
      baseUrl: 'https://api.apimart.ai/v1',
      caps: ['text', 'image', 'video', 'audio'],
    },
  ],
  models: [
    {
      key: 'seedance25',
      label: 'Seedance 2.5',
      cap: 'video',
      caps: ['video', 'videoRef'],
      provider: 'apimart',
      model: 'seedance-2.5',
      features: { audioOut: true, firstFrame: true, lastFrame: true, videoRef: true },
    },
  ],
  defaults: { video: 'seedance25' },
  stageModels: {},
  pricing: {},
  agentLimits: {},
  agentToolProtocol: 'auto',
  apiKey: '',
  rules: {},
  lipSync: { provider: 'off' },
}

/** 三镜：正常有声 / 2 秒（请求会抬到 5） / 无台词空镜 */
seed(
  PROJECTS,
  `import { createProject, writeProject } from ${JSON.stringify(path.join(root, 'server', 'db.mjs'))}
const rootDir = ${JSON.stringify(PROJECTS)}
const sample = ${JSON.stringify(sample)}
const shot = (id, no, seconds, dialogue, extra = {}) => ({
  id, episode: 1, no, seconds, size: '中景', move: '固定', desc: no,
  dialogue, performance: [], cast: [], keyframe: '/generated/a.jpg', keyframe_prompt: 'x',
  audio_mode: 'off', prod_kind: 'video', ...extra,
})
createProject(rootDir, ${JSON.stringify(PROJECT)}, { title: 'native-e2e' })
writeProject(rootDir, ${JSON.stringify(PROJECT)}, {
  episodes: [{ no: 1, title: 'E1' }],
  characters: [
    { name: '陈默', role: '主角', voice: 'male-qn-qingse', look_cn: '寸头', look_en: 'buzz cut, grey coat', palette: '灰', keywords: ['寸头'], voice_sample: sample },
    // 没有 voice_sample：用来验证「没样本也能开、出片降级」而不是把按钮灰掉
    { name: '林岚', role: '配角', look_cn: '长发', look_en: 'long hair', palette: '红', keywords: [] },
  ],
  shots: [
    shot('E01-S01', 'S01', 5, [{ speaker: '陈默', text: '你来了。' }], { performance: [{ character: '陈默', emotion: 'calm', intensity: 2, speaks: true }], cast: ['陈默'] }),
    shot('E01-S02', 'S02', 2, [{ speaker: '陈默', text: '太短。' }], { performance: [{ character: '陈默', emotion: 'calm', intensity: 2, speaks: true }], cast: ['陈默'] }),
    shot('E01-S03', 'S03', 5, [], { cast: ['陈默'] }),
    shot('E01-S04', 'S04', 5, [{ speaker: '林岚', text: '我没有样本。' }], { performance: [{ character: '林岚', emotion: 'calm', intensity: 2, speaks: true }], cast: ['林岚'] }),
  ],
})
console.log('{}')
`,
)

const { app, stop } = await startApp({ projectsDir: PROJECTS, port: PORT })
const browser = await chromium.launch({
  executablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  headless: true,
})
const page = await browser.newPage({ viewport: { width: 1560, height: 940 } })
const errors = []
/**
 * 两类既有噪音在这里筛掉，它们与原生音频无关且在干净 HEAD 上同样出现：
 * - /api/studio/canvas-context：dev server 没有 StudioToolBridge，桌面壳才注册；
 * - 首屏一个空 body 的 POST /api/project（400，缺 shots 等字段）。
 * 其余页面异常照常计入。
 */
const KNOWN_NOISE = /canvas-context|Failed to load resource|POST 需要 shots/
page.on('pageerror', (e) => errors.push(e.message))
page.on('console', (m) => {
  if (m.type() !== 'error') return
  if (KNOWN_NOISE.test(m.text())) return
  errors.push(m.text())
})

// 模型库写进临时项目的真实设置库（不做任何 mock）：面板要读视频模型能力，
// mock 掉会让整条链路偏离生产形态——之前的版本就是这样把写回落库掩盖掉的
const putSettings = await fetch(`${app}/api/settings`, {
  method: 'PUT',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify(settings),
})
if (!putSettings.ok) throw new Error(`写入临时设置失败：HTTP ${putSettings.status}`)

/** 读真实落库结果：直接问后端，不看前端 state */
async function readShot(no) {
  const r = await fetch(`${app}/api/project?name=${encodeURIComponent(PROJECT)}`)
  const j = await r.json()
  return (j.project?.shots ?? []).find((s) => s.no === no)
}

/** 画布写回是 1.5s 防抖：等到真的发出写请求再断言，别用固定 sleep */
function waitShotWrite() {
  return page.waitForResponse(
    (r) => r.url().includes('/api/project?name=') && r.request().method() === 'POST',
    { timeout: 12000 },
  )
}

/** 画布节点里还有角色卡，顺序不可靠，一律按镜号定位 */
const shotNode = (no) => page.locator(`.react-flow__node:has(.shot-no:text-is("${no}"))`)

async function openShotAudioTab(no) {
  await shotNode(no).click()
  // Inspector 是四页驾驶舱：原生音频收在「音画」页
  await page.getByRole('tab', { name: '音画' }).click()
  await page.locator('[data-native-audio]').waitFor({ state: 'visible', timeout: 10000 })
}

try {
  await page.goto(`${app}/#/`, { waitUntil: 'domcontentloaded' })
  // 画布页先出分集目录，必须点进第 1 集才渲染分镜
  await openBoardEpisode(page, PROJECT, { base: app, episode: 1 })
  await page.locator('.react-flow__node').first().waitFor({ timeout: 15000 })

  await openShotAudioTab('S01')
  check('5 秒单说话人可开启', !(await page.locator('[data-native-audio] input[type=checkbox]').isDisabled()))
  const firstWrite = waitShotWrite()
  await page.locator('[data-native-audio] input[type=checkbox]').check()
  await firstWrite
  const s01 = await readShot('S01')
  check('写回 audio_mode=native', s01?.audio_mode === 'native', String(s01?.audio_mode))
  check('写回 audio_ref', s01?.audio_ref?.url === sample.url, JSON.stringify(s01?.audio_ref))

  // 2 秒镜头：面板按**请求秒数**判定（会抬到 5），所以仍可开启。
  // 断言仍可开启而不是「禁用」——后者是面板自己抬高秒数之前的旧行为
  await openShotAudioTab('S02')
  check('2 秒镜头按请求秒数仍可开启', !(await page.locator('[data-native-audio] input[type=checkbox]').isDisabled()))

  // 无台词空镜：以前这里报「这一镜没有台词，不能使用音色参考」并置灰
  await openShotAudioTab('S03')
  const silentBox = page.locator('[data-native-audio] input[type=checkbox]')
  check('无台词镜头可开启 native', !(await silentBox.isDisabled()))
  const silentText = await page.locator('[data-native-audio]').innerText()
  check('不再提示没有台词', !silentText.includes('没有台词，不能使用'))
  check('说明取用了谁的音色', silentText.includes('陈默'))
  const silentWrite = waitShotWrite()
  await silentBox.check()
  await silentWrite
  const s03 = await readShot('S03')
  check('无声镜写回 audio_mode=native', s03?.audio_mode === 'native', String(s03?.audio_mode))
  check('无声镜写回 audio_ref', s03?.audio_ref?.character === '陈默', JSON.stringify(s03?.audio_ref))

  // 没有音色样本的角色：开关仍可点，只是出片会降级
  await openShotAudioTab('S04')
  const bareBox = page.locator('[data-native-audio] input[type=checkbox]')
  check('无音色样本仍可开启 native', !(await bareBox.isDisabled()))
  const bareWrite = waitShotWrite()
  await bareBox.check()
  await bareWrite
  const s04 = await readShot('S04')
  check('无音色样本写回 audio_mode=native', s04?.audio_mode === 'native', String(s04?.audio_mode))
  check('无音色样本不写 audio_ref', !s04?.audio_ref?.url, JSON.stringify(s04?.audio_ref))
  const bareText = await page.locator('[data-native-audio]').innerText()
  check('说明本次会降级', bareText.includes('降级'))

  check('页面无异常', errors.length === 0, errors.slice(0, 3).join(' / '))
  await page.screenshot({ path: path.join(EVIDENCE, 'native-audio-ui.png') })
} finally {
  await browser.close()
  stop()
}
console.log(check.bad() ? `\n❌ ${check.bad()} 项失败` : '\n✅ 全部通过')
process.exit(check.bad() ? 1 : 0)
