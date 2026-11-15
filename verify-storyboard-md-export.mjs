/**
 * 分镜表 Markdown 导出验收（自起临时库 + 无头 Chrome）：
 * 1) 分集目录「导出全部」下载 zip，条目与集号一一对应
 * 2) 画布上下文带「导出」下载当前集，0 镜时禁用
 * 3) 导出的 .md 原样传回导入入口：文字与场次一致、媒体不丢
 * 4) 重复导入同一文件不产生重复镜头
 * 5) 导出的 zip 走「资料包 .zip」导入：集数与镜数不变
 *
 * 跑法：node verify-storyboard-md-export.mjs
 */
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { spawn } from 'node:child_process'
import { chromium } from 'playwright-core'
import { strFromU8, unzipSync } from 'fflate'
import { openBoardEpisode, openProject } from './verify-lib.mjs'

const ROOT = process.cwd()
const PORT = 5397
const APP = `http://127.0.0.1:${PORT}`
const WORK = fs.mkdtempSync(path.join(os.tmpdir(), 'md-export-'))
const NAME = `md-export-${Date.now()}`

let bad = 0
const check = (n, c, e = '') => {
  console.log(`${c ? '✅' : '❌'} ${n}${e ? ' | ' + e : ''}`)
  if (!c) bad++
}

const api = (p, init) =>
  fetch(`${APP}${p}`, init).then(async (r) => ({ ...(await r.json().catch(() => ({}))), status: r.status }))
const readProject = async () => (await api(`/api/project?name=${encodeURIComponent(NAME)}`)).project

const child = spawn(
  process.execPath,
  [path.join(ROOT, 'node_modules', 'vite', 'bin', 'vite.js'), '--port', String(PORT), '--strictPort'],
  { cwd: ROOT, env: { ...process.env, SB_PROJECTS_DIR: WORK }, stdio: 'ignore' },
)

const waitServer = async () => {
  for (let i = 0; i < 80; i++) {
    try {
      if ((await fetch(`${APP}/api/health`)).ok) return true
    } catch {
      /* 继续等 */
    }
    await new Promise((r) => setTimeout(r, 400))
  }
  return false
}

const EPISODES = [
  {
    no: 1,
    title: '雨夜',
    hook: '旧照片里的人突然眨眼。',
    targetSeconds: 60,
    scenes: [
      { no: 1, slug: '天台', place: '天台', time: '夜', characters: ['陈默', '林小雨'], beats: '陈默把照片举到路灯下。' },
      { no: 2, slug: '巷口', place: '巷口', time: '深夜', characters: ['陈默'], beats: '巷口空无一人。' },
    ],
  },
  { no: 2, title: '旧照片', scenes: [{ no: 1, slug: '楼道', place: '楼道', time: '夜' }] },
  { no: 3, title: '归途', scenes: [] },
]

const SHOTS = [
  {
    id: 'E01-S01',
    episode: 1,
    no: 'S01',
    scene_no: 1,
    scene_slug: '天台',
    seconds: 4,
    size: '中景',
    move: '推',
    desc: '雨夜街头，霓虹倒影',
    dialogue: [
      { speaker: '陈默', text: '又是这里。' },
      { speaker: '林小雨', text: '你认得这条路？' },
    ],
    cast: ['陈默', '林小雨'],
    dialogue_delivery: [
      { emotion: 'angry', intensity: 4, pace: 'slow', volume: 'soft', emphasis: '又是这里' },
      { emotion: 'sad', pace: 'fast' },
    ],
    performance: [
      { character: '陈默', emotion: 'angry', intensity: 4, action: '拍桌', gaze: '盯镜头', speaks: true },
      { character: '林小雨', emotion: 'calm', intensity: 2, speaks: false },
    ],
    lexicon_ref_key: '03_pan',
    refIds: ['char-陈默'],
    keyframe_prompt: 'rain-soaked street, neon reflection',
    video_prompt: 'slow push-in',
    keyframe: '/generated/a.jpg',
    clip: '/videos/a.mp4',
    transition_out: { to: 'E01-S02', mode: 'effect', effect: { type: 'dissolve', seconds: 0.6 } },
  },
  {
    id: 'E01-S02',
    episode: 1,
    no: 'S02',
    scene_no: 2,
    scene_slug: '巷口',
    seconds: 3,
    size: '近景',
    move: '固定',
    desc: '巷口空无一人',
    dialogue: [],
    cast: [],
    keyframe_prompt: 'empty alley',
    video_prompt: 'hold',
  },
  {
    id: 'E02-S01',
    episode: 2,
    no: 'S01',
    scene_no: 1,
    scene_slug: '楼道',
    seconds: 5,
    size: '全景',
    move: '拉',
    desc: '楼道灯灭',
    dialogue: [],
    cast: [],
    keyframe_prompt: 'dark corridor',
    video_prompt: 'pull back',
  },
]

/** 点按钮并把下载落到磁盘 */
async function grabDownload(page, action) {
  const [dl] = await Promise.all([page.waitForEvent('download', { timeout: 20000 }), action()])
  const name = dl.suggestedFilename()
  const file = path.join(WORK, `${Date.now()}-${name}`)
  await dl.saveAs(file)
  return { name, file }
}

let browser
let page
try {
  if (!(await waitServer())) throw new Error('dev server 启动失败')
  await api(`/api/project?name=${encodeURIComponent(NAME)}&create=1`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ title: '导出验证', aspect: '16:9' }),
  })
  await api(`/api/project?name=${encodeURIComponent(NAME)}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      style: '近未来写实',
      episodes: EPISODES,
      shots: SHOTS,
      characters: [{ id: '陈默', name: '陈默', role: '主角', image: '/generated/char-chen.png' }],
    }),
  })

  browser = await chromium.launch({ headless: true, channel: 'chrome' })
  page = await browser.newPage({ viewport: { width: 1500, height: 1000 } })
  const pageErrors = []
  page.on('pageerror', (e) => pageErrors.push(String(e?.stack || e?.message || e)))
  page.on('dialog', (d) => d.accept())

  // ------------------------------------------------------------ 分集目录
  await openProject(page, NAME, 'board', { base: APP })
  await page.locator('[data-board-phase="episodes"]').waitFor({ timeout: 20000 })
  const exportAll = page.locator('[data-board-export-all]')
  check('分集目录有「导出全部」', (await exportAll.count()) === 1)
  check('有分集时「导出全部」可用', (await exportAll.isEnabled()) === true)
  check('分集目录 3 张卡', (await page.locator('.board-ep-card').count()) === 3)

  const zipDl = await grabDownload(page, () => exportAll.click())
  check('zip 文件名带项目名', zipDl.name === '导出验证-分镜表.zip', zipDl.name)
  const files = unzipSync(fs.readFileSync(zipDl.file))
  const entries = Object.keys(files).sort()
  check(
    'zip 条目与集号一一对应',
    JSON.stringify(entries) === JSON.stringify(['E01-雨夜.md', 'E02-旧照片.md', 'E03-归途.md']),
    entries.join(' / '),
  )
  const ep1Text = strFromU8(files['E01-雨夜.md'])
  check('zip 内 E01 是单集文档', /^## 第 1 集 雨夜$/m.test(ep1Text) && !/^## 第 2 集/m.test(ep1Text))
  check('zip 内 E01 含分镜表与场次小节', /\| 镜头 \| 场次 \|/.test(ep1Text) && /### 场 2 · 巷口 · 深夜/.test(ep1Text))
  check('zip 内 E01 带转场附注', /S01 → S02：dissolve 0\.6s/.test(ep1Text))
  const headerLine = ep1Text.split('\n').find((l) => l.startsWith('| 镜头 |')) ?? ''
  const headerCells = headerLine.split('|').slice(1, -1).map((x) => x.trim())
  check('分镜表 13 列', headerCells.length === 13, String(headerCells.length))
  check(
    '新四列追加在末尾',
    JSON.stringify(headerCells.slice(9)) === JSON.stringify(['选角', '表演', '运镜参照', '参考']),
    headerCells.join(' / '),
  )
  check('选角列写出角色', headerLine ? /\| 陈默、林小雨 \|/.test(ep1Text) : false)
  check('参考列写出角色名而不写节点 id', /\| 角色:陈默 \|/.test(ep1Text) && !/char-陈默/.test(ep1Text))

  // ------------------------------------------------------------ 当前集导出
  await openBoardEpisode(page, NAME, { base: APP, episode: 1 })
  const exportBtn = page.locator('.wb-bar-actions button', { hasText: '导出' }).first()
  check('画布有「导出」', (await exportBtn.count()) === 1 && (await exportBtn.isEnabled()))
  const mdDl = await grabDownload(page, () => exportBtn.click())
  check('单集文件名是 E01-雨夜.md', mdDl.name === 'E01-雨夜.md', mdDl.name)
  const mdText = fs.readFileSync(mdDl.file, 'utf8')
  check(
    '单集导出含两个说话人（用 br 挤一格）',
    /陈默[^<]*：又是这里。<br>林小雨[^<]*：你认得这条路？/.test(mdText),
    mdText.split('\n').find((l) => l.includes('又是这里'))?.slice(0, 160),
  )
  check('单集导出含画面描述与提示词', /雨夜街头，霓虹倒影/.test(mdText) && /rain-soaked street/.test(mdText))
  check(
    '导出台词带内联表演标注',
    /陈默\[angry\/4\/slow\/soft\]\{又是这里\}：又是这里。/.test(mdText),
    (mdText.match(/陈默[^|]*又是这里。[^|]*/) ?? [''])[0].slice(0, 80),
  )
  check('导出表演列写槽位', /陈默:angry\/4\/拍桌\/盯镜头\/说/.test(mdText))
  check('导出运镜参照写中文名', /\| 横摇 \|/.test(mdText))

  // 0 镜的集：按钮禁用并说明原因
  await page.locator('.board-ep-back').click()
  await page.locator('[data-board-phase="episodes"]').waitFor({ timeout: 15000 })
  await page.locator('.board-ep-card[data-board-ep="3"]').click()
  await page.locator('.wb-bar-detail').waitFor({ timeout: 15000 })
  const emptyExport = page.locator('.wb-bar-actions button', { hasText: '导出' }).first()
  check('0 镜时「导出」禁用', (await emptyExport.isDisabled()) === true)
  check('0 镜禁用有原因说明', /没有镜头/.test(await emptyExport.getAttribute('title') ?? ''))

  // ------------------------------------------------------------ 回灌单文件
  await page.locator('.board-ep-back').click()
  await page.locator('[data-board-phase="episodes"]').waitFor({ timeout: 15000 })
  await page.locator('.board-ep-card[data-board-ep="1"]').click()
  await page.locator('.wb-bar-detail').waitFor({ timeout: 15000 })

  const importOnce = async () => {
    await page.locator('.wb-bar-actions button', { hasText: '导入' }).first().click()
    await page.locator('.intake-dialog').waitFor({ timeout: 15000 })
    await page.getByRole('button', { name: '上传文件', exact: true }).click()
    await page.locator('.intake-file input[type=file]').setInputFiles(mdDl.file)
    await page.locator('[data-intake-plan]').waitFor({ timeout: 15000 })
    const plan = await page.locator('[data-intake-plan]').innerText()
    await page.locator('[data-intake-apply]').click()
    await page.waitForTimeout(1200)
    return plan
  }

  const plan1 = await importOnce()
  check('回灌预览：更新 2 镜、新增 0', /更新 2/.test(plan1) && /新增 0/.test(plan1), plan1.replace(/\n/g, ' | ').slice(0, 120))

  const after1 = await readProject()
  const shots1 = after1.shots || []
  check('回灌后镜数不变', shots1.length === 3, String(shots1.length))
  const s1 = shots1.find((s) => s.id === 'E01-S01')
  check('回灌：画面描述一致', s1?.desc === '雨夜街头，霓虹倒影', String(s1?.desc))
  check('回灌：台词仍是两条', Array.isArray(s1?.dialogue) && s1.dialogue.length === 2, JSON.stringify(s1?.dialogue))
  check('回灌：场次回到第 1 场', Number(s1?.scene_no) === 1, String(s1?.scene_no))
  check('回灌：媒体未被清空', s1?.keyframe === '/generated/a.jpg' && s1?.clip === '/videos/a.mp4')
  check('回灌：第 2 场那镜也在第 2 场', Number(shots1.find((s) => s.id === 'E01-S02')?.scene_no) === 2)
  check('回灌预览不报忽略列', !/忽略列/.test(plan1), plan1.replace(/\n/g, ' | ').slice(0, 200))
  check('回灌：选角一致', JSON.stringify(s1?.cast) === JSON.stringify(['陈默', '林小雨']), JSON.stringify(s1?.cast))
  check(
    '回灌：台词表演一致',
    s1?.dialogue_delivery?.[0]?.emotion === 'angry' &&
      s1?.dialogue_delivery?.[0]?.intensity === 4 &&
      s1?.dialogue_delivery?.[0]?.pace === 'slow' &&
      s1?.dialogue_delivery?.[0]?.volume === 'soft' &&
      s1?.dialogue_delivery?.[0]?.emphasis === '又是这里',
    JSON.stringify(s1?.dialogue_delivery),
  )
  check(
    '回灌：表演一致',
    s1?.performance?.length === 2 &&
      s1.performance[0].action === '拍桌' &&
      s1.performance[0].gaze === '盯镜头' &&
      s1.performance[0].speaks === true &&
      s1.performance[1].speaks === false,
    JSON.stringify(s1?.performance),
  )
  check('回灌：运镜参照一致', s1?.lexicon_ref_key === '03_pan', String(s1?.lexicon_ref_key))

  const plan2 = await importOnce()
  check('重复导入仍是更新 2、新增 0', /更新 2/.test(plan2) && /新增 0/.test(plan2), plan2.replace(/\n/g, ' | ').slice(0, 120))
  const after2 = await readProject()
  check('重复导入不产生重复镜头', (after2.shots || []).length === 3, String((after2.shots || []).length))

  // ------------------------------------------------------------ 回灌 zip
  await page.locator('.wb-bar-actions button', { hasText: '导入' }).first().click()
  await page.locator('.intake-dialog').waitFor({ timeout: 15000 })
  await page.locator('[data-intake-bundle]').click()
  await page.locator('.bundle-dialog').waitFor({ timeout: 15000 })
  await page.locator('.bundle-dialog input[type=file]').setInputFiles(zipDl.file)
  await page.locator('[data-bundle-list]').waitFor({ timeout: 20000 })
  const bundleSummary = await page.locator('.bundle-summary').innerText()
  const bundleBody = await page.locator('.bundle-body').innerText()
  check('资料包识别出 3 个分镜文件', /3 个可导入文件/.test(bundleSummary), bundleSummary.replace(/\n/g, ' | '))
  check('资料包没有多集大纲被跳过', !/多集大纲需手动拆开/.test(bundleBody))
  await page.locator('[data-bundle-apply]').click()
  await page.waitForTimeout(1500)
  const afterZip = await readProject()
  check('zip 回灌后镜数不变', (afterZip.shots || []).length === 3, String((afterZip.shots || []).length))
  check('zip 回灌后集数不变', (afterZip.episodes || []).length === 3, String((afterZip.episodes || []).length))
  check('zip 回灌后媒体仍在', afterZip.shots?.find((s) => s.id === 'E01-S01')?.clip === '/videos/a.mp4')
  const zipS1 = afterZip.shots?.find((s) => s.id === 'E01-S01')
  check('zip 回灌后表演仍在', zipS1?.performance?.[0]?.action === '拍桌', JSON.stringify(zipS1?.performance))
  check('zip 回灌后运镜参照仍在', zipS1?.lexicon_ref_key === '03_pan', String(zipS1?.lexicon_ref_key))
  check('压缩包预览不报忽略列', !/忽略列/.test(bundleBody), bundleBody.replace(/\n/g, ' | ').slice(0, 200))

  // ------------------------------------------------------------ 三类提示可见
  // 故意写一份「运镜参照不存在 + 参考名字不存在 + 说话角色没写表演」的表，
  // 确认预览把三件事分别说出来，而不是笼统地报一句导入成功。
  const probe = path.join(WORK, 'probe.md')
  fs.writeFileSync(
    probe,
    [
      '| 镜头 | 场次 | 时长 | 景别 | 运镜 | 画面与动作 | 台词与声音 | 首帧提示词 | 视频提示词 | 选角 | 表演 | 运镜参照 | 参考 |',
      '| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |',
      '| S01 | 1 | 4 | 中景 | 推 | 雨夜街头 | 陈默：又是这里。 | rain | push in | 陈默 |  | 根本不存在的运镜 | 角色:查无此人 |',
    ].join('\n'),
  )
  await page.locator('.wb-bar-actions button', { hasText: '导入' }).first().click()
  await page.locator('.intake-dialog').waitFor({ timeout: 15000 })
  await page.getByRole('button', { name: '上传文件', exact: true }).click()
  await page.locator('.intake-file input[type=file]').setInputFiles(probe)
  await page.locator('[data-intake-plan]').waitFor({ timeout: 15000 })
  const probeNotes = await page.locator('.intake-notices').innerText()
  check('预览点名运镜参照不存在', /运镜参照「根本不存在的运镜」/.test(probeNotes), probeNotes.replace(/\n/g, ' | ').slice(0, 200))
  check('预览点名参考查不到', /角色「查无此人」/.test(probeNotes), probeNotes.replace(/\n/g, ' | ').slice(0, 200))
  check('预览分开报表演补全', /说话角色没写表演/.test(probeNotes), probeNotes.replace(/\n/g, ' | ').slice(0, 200))
  check('预览不报忽略列', !/忽略列/.test(probeNotes), probeNotes.replace(/\n/g, ' | ').slice(0, 200))
  await page.locator('.intake-dialog .mp-close').click()
  await page.waitForTimeout(400)

  check('页面无未捕获异常', pageErrors.length === 0, pageErrors.slice(-2).join(' | ').slice(0, 400))
} catch (e) {
  bad++
  console.log('❌ 验收中断：', e?.stack || e?.message || String(e))
  if (page) {
    try {
      console.log('DEBUG url =', page.url())
      console.log('DEBUG body =', (await page.locator('body').innerText()).slice(0, 1200))
    } catch {
      /* 页面已关闭 */
    }
  }
} finally {
  await browser?.close().catch(() => {})
  child.kill()
  fs.rmSync(WORK, { recursive: true, force: true })
}

console.log(bad ? `\n❌ ${bad} 项失败` : '\n✅ 分镜表 Markdown 导出闭环通过')
process.exit(bad ? 1 : 0)
