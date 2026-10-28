/**
 * 手动增删行的回归：
 * 1) 服务端 deleteShots / pruneDanglingTransitions / findDuplicateShotNos 纯函数
 * 2) POST /api/project 的 deleteShotIds：显式删除生效，缺席仍只标 orphan（保护不回退）
 * 3) 悬空转场被兜底清理
 * 4) 集内镜号重复被拒且不写盘
 * 5) 前端行操作纯函数：新镜号取最大+1、不复用空洞、插入位置、集内重复检测
 *
 * 跑法：node verify-manual-rows.mjs
 */
import { spawn } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { execFileSync } from 'node:child_process'

const ROOT = path.dirname(fileURLToPath(import.meta.url))
const PORT = 5316
const APP = `http://127.0.0.1:${PORT}`
const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'manual-rows-'))
const PROJECT = 'rows'

let bad = 0
const check = (n, c, e = '') => {
  console.log(`${c ? '✅' : '❌'} ${n}${e ? ' | ' + e : ''}`)
  if (!c) bad++
}
const api = (p, init) =>
  fetch(`${APP}${p}`, init).then(async (r) => ({ ...(await r.json().catch(() => ({}))), status: r.status }))

// ---------------------------------------------------------------- 纯函数
const DATA = await import(path.join(ROOT, 'server', 'data.mjs'))
const cur = [
  { id: 'E01-S01', no: 'S01', episode: 1 },
  { id: 'E01-S02', no: 'S02', episode: 1 },
  { id: 'E01-S03', no: 'S03', episode: 1, transition_out: { to: 'E01-S04', effect: 'dissolve' } },
]
const del = DATA.deleteShots(cur, ['E01-S02'])
check('deleteShots 只删命中的 id', JSON.stringify(del.shots.map((s) => s.id)) === JSON.stringify(['E01-S01', 'E01-S03']))
check('deleteShots 报被删数量', del.removed === 1)
check('deleteShots 忽略未知 id', DATA.deleteShots(cur, ['nope']).removed === 0)
check('deleteShots 空 ids 原样返回', DATA.deleteShots(cur, []).shots.length === 3)

const pruned = DATA.pruneDanglingTransitions(del.shots)
check('悬空转场被清除', pruned.cleared === 1 && pruned.shots.find((s) => s.id === 'E01-S03')?.transition_out === null)
const kept = DATA.pruneDanglingTransitions([{ id: 'E01-S01', no: 'S01', transition_out: { to: 'E01-S02' } }, { id: 'E01-S02', no: 'S02' }])
check('指向存在镜头的转场保留', kept.cleared === 0 && kept.shots[0].transition_out?.to === 'E01-S02')

const dupSame = DATA.findDuplicateShotNos([
  { id: 'a', no: 'S01', episode: 1 },
  { id: 'b', no: 'S01', episode: 1 },
])
check('同集同镜号被判重复', dupSame.length === 1 && dupSame[0].no === 'S01', JSON.stringify(dupSame))
const dupCross = DATA.findDuplicateShotNos([
  { id: 'a', no: 'S01', episode: 1 },
  { id: 'b', no: 'S01', episode: 2 },
])
check('不同集同镜号不算重复', dupCross.length === 0, JSON.stringify(dupCross))

// ---------------------------------------------------------------- 前端行操作
const outDir = fs.mkdtempSync(path.join(ROOT, '.verify-rows-'))
const esbuild = path.join(ROOT, 'node_modules', '.bin', 'esbuild')
const bundle = (entry, name) => {
  const out = path.join(outDir, `${name}.mjs`)
  execFileSync(esbuild, [entry, '--bundle', '--platform=node', '--format=esm', '--log-level=error', `--outfile=${out}`])
  return out
}
const SR = await import(bundle('src/shotRows.ts', 'shotRows'))

const shots = [
  { id: 'E01-S01', episode: 1, no: 'S01' },
  { id: 'E01-S03', episode: 1, no: 'S03' },
]
check('nextShotNo 取集内最大+1（不填 S02 空洞）', SR.nextShotNo(shots, 1) === 'S04', SR.nextShotNo(shots, 1))
check('空集从 S01 开始', SR.nextShotNo([], 1) === 'S01', SR.nextShotNo([], 1))
check('只算本集', SR.nextShotNo([{ id: 'E02-S09', episode: 2, no: 'S09' }], 1) === 'S01')

const inserted = SR.insertAfter(shots, 'E01-S01', { id: 'E01-S02', episode: 1, no: 'S02' })
check('insertAfter 插到指定镜之后', inserted.map((s) => s.no).join(',') === 'S01,S02,S03', inserted.map((s) => s.no).join(','))
check('insertAfter 找不到目标时追加末尾', SR.insertAfter(shots, 'nope', { id: 'x', no: 'S09' }).at(-1).no === 'S09')

const removed = SR.removeRow(shots, 'E01-S01')
check('removeRow 删掉指定行', removed.length === 1 && removed[0].no === 'S03')

const dups = SR.findDuplicateNos(
  [
    { id: 'a', no: 'S01', episode: 1 },
    { id: 'b', no: 'S01', episode: 1 },
    { id: 'c', no: 'S01', episode: 2 },
  ],
  1,
)
check('前端重复检测只看本集', dups.length === 1 && dups[0].no === 'S01', JSON.stringify(dups))

// ---------------------------------------------------------------- 服务端往返
let browser
const child = spawn(
  process.execPath,
  [path.join(ROOT, 'node_modules', 'vite', 'bin', 'vite.js'), '--port', String(PORT), '--strictPort'],
  { cwd: ROOT, env: { ...process.env, SB_PROJECTS_DIR: TMP }, stdio: 'ignore' },
)
const waitServer = async () => {
  for (let i = 0; i < 80; i++) {
    try {
      if ((await fetch(`${APP}/api/health`)).ok) return true
    } catch {
      /* 继续等 */
    }
    await new Promise((r) => setTimeout(r, 500))
  }
  return false
}
try {
  if (!(await waitServer())) throw new Error('dev server 启动失败')
  await api(`/api/project?name=${PROJECT}&create=1`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ title: '行操作' }),
  })
  const seed = [
    { id: 'E01-S01', episode: 1, no: 'S01', desc: 'a' },
    { id: 'E01-S02', episode: 1, no: 'S02', desc: 'b' },
    { id: 'E01-S03', episode: 1, no: 'S03', desc: 'c', transition_out: { to: 'E01-S09' } },
    { id: 'E02-S01', episode: 2, no: 'S01', desc: 'other ep' },
  ]
  await api(`/api/project?name=${PROJECT}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ shots: seed }),
  })

  // 1) 缺席只标 orphan
  await api(`/api/project?name=${PROJECT}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ shots: [{ id: 'E01-S01', desc: 'a2' }, { id: 'E01-S03' }] }),
  })
  let j = await api(`/api/project?name=${PROJECT}`)
  const s2 = (j.project.shots || []).find((s) => s.id === 'E01-S02')
  check('缺席镜头仍保留并标 orphan（保护未回退）', Boolean(s2) && s2.orphan === true, JSON.stringify(s2))

  // 2) 显式删除
  const r2 = await api(`/api/project?name=${PROJECT}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ shots: [{ id: 'E01-S01' }, { id: 'E01-S03' }], deleteShotIds: ['E01-S02'] }),
  })
  check('响应报告删除数量', r2.removedShots === 1, JSON.stringify({ removed: r2.removedShots, status: r2.status }))
  j = await api(`/api/project?name=${PROJECT}`)
  check('显式删除后镜头真的消失', !(j.project.shots || []).some((s) => s.id === 'E01-S02'), JSON.stringify((j.project.shots || []).map((s) => s.id)))
  check('其他集不受影响', (j.project.shots || []).some((s) => s.id === 'E02-S01'))
  const s3 = (j.project.shots || []).find((s) => s.id === 'E01-S03')
  check('删完后悬空转场被兜底清除', s3?.transition_out === null || s3?.transition_out === undefined, JSON.stringify(s3?.transition_out))

  // 3) 镜号重复被拒
  const dupRes = await api(`/api/project?name=${PROJECT}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      shots: [
        { id: 'E01-S01', no: 'S01', episode: 1 },
        { id: 'E01-S02', no: 'S01', episode: 1 },
      ],
    }),
  })
  check('同集重复镜号被拒', dupRes.ok === false && /重复/.test(dupRes.message || ''), JSON.stringify(dupRes).slice(0, 160))
  j = await api(`/api/project?name=${PROJECT}`)
  check('被拒后项目未被改写', !(j.project.shots || []).some((s) => s.id === 'E01-S02'))

  // 4) deleteShotIds 类型校验
  const badType = await api(`/api/project?name=${PROJECT}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ deleteShotIds: 'nope' }),
  })
  check('deleteShotIds 非数组被拒', badType.ok === false && /数组/.test(badType.message || ''), JSON.stringify(badType).slice(0, 140))
  // ---------------------------------------------------------------- UI 行操作
  const { chromium } = await import('playwright-core')
  browser = await chromium.launch({ headless: true, channel: 'chrome' })
  const page = await browser.newPage({ viewport: { width: 1500, height: 1000 } })
  page.on('dialog', (d) => d.accept())
  // 重置成干净的第 1 集 3 镜
  await api(`/api/project?name=${PROJECT}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      shots: [
        { id: 'E01-S01', episode: 1, no: 'S01', desc: 'a' },
        { id: 'E01-S02', episode: 1, no: 'S02', desc: 'b' },
        { id: 'E01-S03', episode: 1, no: 'S03', desc: 'c' },
      ],
      episodes: [{ no: 1, title: '第一集', scenes: [{ no: 1, slug: '场一' }, { no: 2, slug: '场二' }] }],
      designs: [],
    }),
  })
  await page.goto(APP, { waitUntil: 'networkidle' })
  await page.waitForTimeout(1500)

  await page.getByRole('button', { name: '镜头表', exact: true }).click()
  await page.waitForTimeout(1200)
  const rowCount = () => page.evaluate(() => document.querySelectorAll('.wb-table tbody tr:not(.perf-expanded)').length)
  const nos = () =>
    page.evaluate(() => [...document.querySelectorAll('.wb-table tbody tr')].map((tr) => tr.querySelector('input')?.value).filter(Boolean))

  check('初始 3 镜', (await rowCount()) === 3, String(await rowCount()))
  await page.locator('[data-add-shot]').click()
  await page.waitForTimeout(500)
  check('新增一镜后 4 镜', (await rowCount()) === 4, String(await rowCount()))
  check('新镜号是 S04（不复用空洞）', (await nos()).includes('S04'), JSON.stringify(await nos()))

  await page.locator('[data-insert-after="E01-S01"]').click()
  await page.waitForTimeout(500)
  const afterInsert = await nos()
  check('插入后 5 镜', (await rowCount()) === 5, String(await rowCount()))
  check('插入位置紧跟 S01', afterInsert[1] === 'S05', JSON.stringify(afterInsert))

  await page.locator('[data-delete-shot="E01-S02"]').click()
  await page.waitForTimeout(600)
  check('删除后 4 镜', (await rowCount()) === 4, String(await rowCount()))
  check('被删的 S02 不在表里', !(await nos()).includes('S02'), JSON.stringify(await nos()))
  check('待删除提示出现', /待删除 1 镜/.test(await page.locator('.wb-row-tools').innerText()), await page.locator('.wb-row-tools').innerText())

  await page.getByRole('button', { name: '保存到 project.json' }).click()
  await page.waitForTimeout(1200)
  const saved = (await api(`/api/project?name=${PROJECT}`)).project
  const ep1 = (saved.shots || []).filter((s) => (Number(s.episode) || 1) === 1)
  check('保存后 S02 真的从项目消失', !ep1.some((s) => s.id === 'E01-S02'), JSON.stringify(ep1.map((s) => s.no)))
  check('保存后第 1 集共 4 镜（含新增与插入）', ep1.length === 4, JSON.stringify(ep1.map((s) => s.no)))

  // 镜号重复阻止保存
  const firstNoInput = page.locator('.wb-table tbody tr').first().locator('input').first()
  const secondNoInput = page.locator('.wb-table tbody tr').nth(1).locator('input').first()
  const secondVal = await secondNoInput.inputValue()
  await firstNoInput.fill(secondVal)
  await page.waitForTimeout(400)
  // 工作台的提示走父级回调而非全局 .toast，所以用「项目未被改写 + 仍是未保存态」来断言阻止生效
  const beforeDup = (await api(`/api/project?name=${PROJECT}`)).project
  const ep1Before = (beforeDup.shots || []).filter((s) => (Number(s.episode) || 1) === 1)
  const saveBtn = page.locator('.wb-foot').getByRole('button', { name: /保存/ })
  await saveBtn.first().click()
  await page.waitForTimeout(1400)
  const afterDup = (await api(`/api/project?name=${PROJECT}`)).project
  const ep1After = (afterDup.shots || []).filter((s) => (Number(s.episode) || 1) === 1)
  check('重复镜号阻止保存：项目未被改写', JSON.stringify(ep1After.map((s) => s.no)) === JSON.stringify(ep1Before.map((s) => s.no)), JSON.stringify(ep1After.map((s) => s.no)))
  check('重复镜号时保存按钮仍可用（未误标已保存）', !(await saveBtn.first().isDisabled()))
  // 改回唯一镜号后能正常保存
  await page.locator('.wb-table tbody tr').nth(1).locator('input').first().fill('S99')
  await page.waitForTimeout(400)
  await saveBtn.first().click()
  await page.waitForTimeout(1400)
  const fixed = (await api(`/api/project?name=${PROJECT}`)).project
  const ep1Fixed = (fixed.shots || []).filter((s) => (Number(s.episode) || 1) === 1)
  check('改回唯一镜号后可保存', ep1Fixed.some((s) => s.no === 'S99'), JSON.stringify(ep1Fixed.map((s) => s.no)))

  // ---------------------------------------------------------------- 场次增删
  await page.getByRole('button', { name: '剧本', exact: true }).click()
  await page.waitForTimeout(1200)
  const sceneRows = () => page.evaluate(() => document.querySelectorAll('.sb-scenes > li').length)
  check('初始 2 场', (await sceneRows()) === 2, String(await sceneRows()))
  await page.locator('[data-add-scene="0"]').click()
  await page.waitForTimeout(500)
  check('新增后 3 场', (await sceneRows()) === 3, String(await sceneRows()))
  await page.locator('[data-remove-scene="0-2"]').click()
  await page.waitForTimeout(800)
  check('删除后 2 场', (await sceneRows()) === 2, String(await sceneRows()))

  // ---------------------------------------------------------------- 素材手工建卡
  await page.getByRole('button', { name: '素材', exact: true }).click()
  await page.waitForTimeout(1200)
  const cards = () => page.locator('.design-card').count()
  const before0 = await cards()
  await page.locator('[data-add-design="scene"]').click()
  await page.waitForTimeout(600)
  check('新建场景卡后多一张', (await cards()) === before0 + 1, `${before0} -> ${await cards()}`)
  await page.locator('[data-add-design="prop"]').click()
  await page.waitForTimeout(600)
  const propTab = page.getByRole('button', { name: /^道具/ }).first()
  await propTab.click()
  await page.waitForTimeout(500)
  check('新建道具卡出现在道具页签', (await page.locator('.design-card').count()) >= 1, String(await page.locator('.design-card').count()))
  const newCard = page.locator('.design-card').first()
  check('新卡无图时不能加入画布', await newCard.getByRole('button', { name: /加入画布/ }).isDisabled())
} catch (e) {
  check('服务端往返', false, e.message)
} finally {
  await browser?.close()
  child.kill('SIGTERM')
  fs.rmSync(outDir, { recursive: true, force: true })
  fs.rmSync(TMP, { recursive: true, force: true })
}

console.log(bad === 0 ? '\n全部通过' : `\n${bad} 项未通过`)
process.exit(bad === 0 ? 0 : 1)
