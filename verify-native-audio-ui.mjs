/**
 * 音频槽位 UI 回归：自动带入台词说话人的音色、可换可移除、原生音轨恒开。
 *
 * 语义已从「逐镜打开原生音频开关」改为「音频槽位只承载音色参考，
 * 原生音轨由模型能力决定」。所以这里断言的是槽位内容与写回，而不是 checkbox。
 *
 * 用真实后端（临时项目目录 + seed 落库）而不是 mock 项目接口：
 * 这个脚本要断言「选择后写回 project.json」，mock 掉项目接口就没法验证真正的
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
    shot('E01-S01', 'S01', 5, [{ speaker: '陈默', text: '你来了。' }], { performance: [{ character: '陈默', emotion: 'calm', intensity: 2, speaks: true }], cast: ['陈默'], video_prompt: '固定机位。陈默转头看向镜头，低声说：“你来了。”声音设计：安静的室内。' }),
    shot('E01-S02', 'S02', 2, [{ speaker: '陈默', text: '太短。' }], { performance: [{ character: '陈默', emotion: 'calm', intensity: 2, speaks: true }], cast: ['陈默'] }),
    shot('E01-S03', 'S03', 5, [], { cast: ['陈默'] }),
    // S04 的正文故意不含台词：用来验证「正文没写台词」软提示
    shot('E01-S04', 'S04', 5, [{ speaker: '林岚', text: '我没有样本。' }], { performance: [{ character: '林岚', emotion: 'calm', intensity: 2, speaks: true }], cast: ['林岚'], video_prompt: '固定机位。林岚站在窗边沉默不语。' }),
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

/** 出片镜只有一个页面：选中即出片，槽位直接可见 */
async function openShotSlots(no) {
  await shotNode(no).click()
  await page.locator('[data-slot="audio"]').waitFor({ state: 'visible', timeout: 10000 })
}

const audioSlot = () => page.locator('[data-slot="audio"]')

try {
  await page.goto(`${app}/#/`, { waitUntil: 'domcontentloaded' })
  // 画布页先出分集目录，必须点进第 1 集才渲染分镜
  await openBoardEpisode(page, PROJECT, { base: app, episode: 1 })
  await page.locator('.react-flow__node').first().waitFor({ timeout: 15000 })

  // S01：唯一说话人「陈默」有音色样本 → 槽位自动带入
  await openShotSlots('S01')
  check('出片镜只有出片一页', (await page.locator('.si-tabs [role="tab"]').count()) === 1)
  const s01Text = await audioSlot().innerText()
  check('槽位自动带入说话人音色', s01Text.includes('陈默'), s01Text.replace(/\n/g, ' '))
  check('槽位给出音频播放器', (await audioSlot().locator('audio').count()) === 1)
  check('不再有原生音频开关', (await page.locator('[data-native-audio]').count()) === 0)
  check('不再有音画页', (await page.getByRole('tab', { name: '音画' }).count()) === 0)

  // 2 秒镜头：秒数由模型下限抬到 4，音频槽位照样可用，不做逐镜门禁
  await openShotSlots('S02')
  check('2 秒镜头音频槽位可用', (await audioSlot().innerText()).includes('陈默'))

  // 无台词空镜：沿用已保存/首个可用样本，不再报「没有台词」
  await openShotSlots('S03')
  const s03Text = await audioSlot().innerText()
  check('无台词镜头不提示不能使用', !s03Text.includes('没有台词，不能使用'), s03Text.replace(/\n/g, ' '))
  check('无台词镜头仍有音色参考', s03Text.includes('陈默'), s03Text.replace(/\n/g, ' '))

  // S04：说话人没有样本 → 槽位显示空态，并说明声音由模型决定
  await openShotSlots('S04')
  const s04Text = await audioSlot().innerText()
  check('无样本时槽位为空态', !s04Text.includes('林岚 音色'), s04Text.replace(/\n/g, ' '))
  check('说明声音由模型决定', s04Text.includes('声音由模型决定'), s04Text.replace(/\n/g, ' '))
  check('不出现「降级为静音」', !s04Text.includes('降级为静音'), s04Text.replace(/\n/g, ' '))

  // 手选一条音频：写入 audio_ref 且标来源
  const pickWrite = waitShotWrite()
  const manual = audioSlot().locator('.si-slot-manual')
  await manual.fill('/videos/picked-voice.mp3')
  await manual.press('Enter')
  await pickWrite
  const s04 = await readShot('S04')
  check('手选音频写回 audio_ref', s04?.audio_ref?.url === '/videos/picked-voice.mp3', JSON.stringify(s04?.audio_ref))
  check('手选音频标 source=manual', s04?.audio_ref?.source === 'manual', JSON.stringify(s04?.audio_ref))
  await page.waitForTimeout(400)
  const pickedText = await audioSlot().innerText()
  check(
    '槽位显示手选条目并标为手工地址',
    pickedText.includes('手工地址') && (await audioSlot().locator('audio').count()) === 1,
    pickedText.replace(/\n/g, ' '),
  )

  // 移除：清掉 audio_ref（audioRef 不在 bizSignature 里，靠显式写回）
  await audioSlot().locator('button', { hasText: '移除' }).click()
  const cleared = await (async () => {
    const started = Date.now()
    while (Date.now() - started < 12000) {
      const shot = await readShot('S04')
      if (!shot?.audio_ref?.url) return shot
      await page.waitForTimeout(400)
    }
    return await readShot('S04')
  })()
  check('移除后 audio_ref 被清空', !cleared?.audio_ref?.url, JSON.stringify(cleared?.audio_ref))

  check('页面无异常', errors.length === 0, errors.slice(0, 3).join(' / '))
  await page.screenshot({ path: path.join(EVIDENCE, 'native-audio-ui.png') })
} finally {
  await browser.close()
  stop()
}
console.log(check.bad() ? `\n❌ ${check.bad()} 项失败` : '\n✅ 全部通过')
process.exit(check.bad() ? 1 : 0)
