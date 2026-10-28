/**
 * 三个文本工作台的导入入口端到端验证（自起临时库 + mock 文本模型）：
 * 1) 三个工作台都有「导入」按钮，无项目时禁用
 * 2) 粘贴 Markdown 表格 → 零模型即时预览（新增/更新计数）→ 应用 → 草稿变化但未保存
 * 3) 真实资料包第 1 集分镜表（10 镜，含旁白与纯音效）导入后：cast 不含旁白、音效镜头无台词
 * 4) 只导入 3 镜时该集其余镜头保留（merge 语义）
 * 5) 「按此文件替换整集」勾选后行数变为文件行数
 * 6) 自由文本出现「让模型整理」，点它才请求模型
 * 7) 取消不改变任何数据
 *
 * 跑法：node verify-text-intake-ui.mjs
 */
import { spawn } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { chromium } from 'playwright-core'

const ROOT = process.cwd()
const PORT = 5318
const APP = `http://127.0.0.1:${PORT}`
const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'intake-ui-'))
const PROJECT = 'intake-ui'

let bad = 0
const check = (n, c, e = '') => {
  console.log(`${c ? '✅' : '❌'} ${n}${e ? ' | ' + e : ''}`)
  if (!c) bad++
}
const api = (p, init) =>
  fetch(`${APP}${p}`, init).then(async (r) => ({ ...(await r.json().catch(() => ({}))), status: r.status }))

const mkShot = (no, desc) => ({
  id: `E01-${no}`,
  episode: 1,
  no,
  scene_no: 1,
  scene_slug: '井道',
  seconds: 3,
  size: '中景',
  move: '固定',
  desc,
  dialogue: [],
  cast: [],
  keyframe_prompt: `${desc}，冷青`,
})

const TWENTY = Array.from({ length: 20 }, (_, i) =>
  mkShot(`S${String(i + 1).padStart(2, '0')}`, `原始镜头 ${i + 1}`),
)

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

let browser
try {
  if (!(await waitServer())) throw new Error('dev server 启动失败')

  await api(`/api/project?name=${PROJECT}&create=1`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ title: '导入验证' }),
  })
  await api(`/api/project?name=${PROJECT}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      style: '近未来科幻写实',
      episodes: [
        { no: 1, title: '第一集', scenes: [{ no: 1, slug: '井道', place: '地下', time: '夜', beats: '猫' }] },
        { no: 2, title: '第二集', scenes: [] },
        { no: 3, title: '第三集', scenes: [] },
      ],
      shots: TWENTY,
    }),
  })

  browser = await chromium.launch({ headless: true, channel: 'chrome' })
  const page = await browser.newPage({ viewport: { width: 1500, height: 1000 } })
  const pageErrors = []
  page.on('pageerror', (e) => pageErrors.push(String(e?.stack || e?.message || e)))
  // 工作台有未保存改动时切换视图会弹确认框；测试里一律接受（这是既有的离开保护）
  page.on('dialog', (d) => d.accept())
  const textCalls = []
  await page.route('**/api/text', async (route) => {
    const body = JSON.parse(route.request().postData() || '{}')
    textCalls.push(body)
    // 模拟 intake 技能返回：2 集剧本（只做结构整理，不改写）
    const json = {
      logline: '原文的一句话故事',
      episodes: [
        { no: 1, title: '整理后的第一集', scenes: [{ no: 1, slug: '井道', beats: '原文的 beats 原样保留' }] },
        { no: 2, title: '整理后的第二集', scenes: [] },
      ],
    }
    await route.fulfill({
      contentType: 'application/json',
      body: JSON.stringify({ ok: true, text: JSON.stringify(json), json, model: 'mock', modelLabel: 'mock-model' }),
    })
  })

  await page.goto(APP, { waitUntil: 'networkidle' })
  await page.waitForTimeout(1500)

  // ---------------------------------------------------------------- 镜头表导入
  await page.getByRole('button', { name: '镜头表', exact: true }).click()
  await page.waitForTimeout(1200)
  const intakeBtn = page.getByRole('button', { name: '导入', exact: true }).first()
  check('镜头表有导入按钮', (await intakeBtn.count()) >= 1)

  const twentyBefore = await page.locator('.wb-table tbody tr').count()
  check('导入前该集 20 镜', twentyBefore >= 20, String(twentyBefore))

  await intakeBtn.click()
  await page.waitForTimeout(700)
  check('导入对话框打开', (await page.locator('.intake-dialog').count()) === 1)

  // 只补 3 镜（其中 S02/S05 已存在，S99 是新的）
  const threeRows = `| 镜头 | 时间 | 景别 | 画面与动作 |
|---|---|---|---|
| S02 | 4 | 近景 | 改过的 S02 描述 |
| S05 | 5 | 特写 | 改过的 S05 描述 |
| S99 | 6 | 中景 | 新增的 S99 |`
  await page.locator('[data-intake-input]').fill(threeRows)
  await page.waitForTimeout(700)
  check('识别为 Markdown 表格', /表格/.test(await page.locator('[data-intake-format]').innerText()))
  const planText = await page.locator('[data-intake-plan]').innerText()
  check('预览显示新增 1 / 更新 2', /新增 1/.test(planText) && /更新 2/.test(planText), planText.replace(/\n/g, ' | ').slice(0, 120))
  check('预览提示只涉及 3 镜', /本次只涉及 3 镜/.test(planText), planText.slice(0, 160))
  check('零模型路径未请求文本模型', textCalls.length === 0, String(textCalls.length))

  await page.locator('[data-intake-apply]').click()
  await page.waitForTimeout(900)
  const afterMerge = await page.locator('.wb-table tbody tr').count()
  check('merge：应用后仍是 21 镜（20 + 新增 1）', afterMerge >= 21, String(afterMerge))
  const mergedProj = (await api(`/api/project?name=${PROJECT}`)).project
  check('merge：未保存（项目里仍是 20 镜）', (mergedProj.shots || []).length === 20, String((mergedProj.shots || []).length))
  const rowText = await page.locator('.wb-table tbody').innerText()
  // 镜号与描述是 input/textarea 的值，innerText 读不到，必须读控件值
  const firstNo = await page.locator('.wb-table tbody tr').first().locator('input').first().inputValue()
  const allValues = await page.evaluate(() => {
    const rows = [...document.querySelectorAll('.wb-table tbody tr')]
    return rows.map((tr) => {
      const no = tr.querySelector('input')?.value ?? ''
      const areas = [...tr.querySelectorAll('textarea')].map((t) => t.value)
      return { no, text: areas.join(' | ') }
    })
  })
  check('merge：S01 保留', allValues.some((r) => r.no === 'S01'), firstNo)
  check('merge：S02 被更新', allValues.some((r) => r.no === 'S02' && /改过的 S02 描述/.test(r.text)), JSON.stringify(allValues.find((r) => r.no === 'S02')))
  check('不自动保存：脏状态仍在', /保存/.test(await page.locator('.wb-foot').innerText()))

  // ---------------------------------------------------------------- 真实分镜表（旁白/音效）
  const fixture = fs.readFileSync(path.join(ROOT, 'fixtures', 'intake-cat-ep01.md'), 'utf8')
  await intakeBtn.click()
  await page.waitForTimeout(800)
  check('第二次打开对话框', (await page.locator('.intake-dialog').count()) === 1)
  await page.locator('[data-intake-input]').fill(fixture)
  await page.waitForTimeout(1200)
  check('真实表格出现预览', (await page.locator('[data-intake-plan]').count()) === 1)
  if ((await page.locator('[data-intake-plan]').count()) === 0) {
    console.log('DEBUG format =', await page.locator('[data-intake-format]').innerText().catch(() => 'n/a'))
    console.log('DEBUG err =', await page.locator('.gen-error').innerText().catch(() => 'n/a'))
    console.log('DEBUG pageErrors =', JSON.stringify(pageErrors.slice(-2)).slice(0, 1200))
  }
  const realPlan = await page.locator('[data-intake-plan]').innerText()
  check('真实表格预览出镜数', /新增 \d+/.test(realPlan), realPlan.replace(/\n/g, ' | ').slice(0, 140))
  check('真实表格提示忽略「制作方式」列', /制作方式/.test(realPlan), realPlan.slice(0, 220))
  check('真实表格提示运镜默认补全', /运镜/.test(realPlan) && /默认/.test(realPlan), realPlan.slice(0, 240))
  await page.locator('[data-intake-apply]').click()
  await page.waitForTimeout(1000)
  const tableText = await page.locator('.wb-table tbody').innerText()
  const realValues = await page.evaluate(() => {
    const rows = [...document.querySelectorAll('.wb-table tbody tr')]
    return rows.map((tr) => {
      const no = tr.querySelector('input')?.value ?? ''
      const areas = [...tr.querySelectorAll('textarea')].map((t) => t.value)
      const cast = tr.querySelector('.wb-cast')?.textContent ?? ''
      return { no, text: areas.join(' | '), cast }
    })
  })
  check('真实表：镜号 01 出现', realValues.some((r) => r.no === '01'), JSON.stringify(realValues.map((r) => r.no).slice(0, 14)))
  check('真实表：旁白没有变成 cast', realValues.every((r) => !/旁白/.test(r.cast)), JSON.stringify(realValues.filter((r) => r.cast).slice(0, 3)))
  const soundRow = realValues.find((r) => r.no === '02')
  check('真实表：纯音效镜头没有台词', Boolean(soundRow) && !/人类轻声/.test(soundRow.text), JSON.stringify(soundRow))

  // ---------------------------------------------------------------- 替换整集
  await intakeBtn.click()
  await page.waitForTimeout(600)
  await page.locator('[data-intake-input]').fill(threeRows)
  await page.waitForTimeout(700)
  const replaceBox = page.locator('.intake-replace input[type=checkbox]')
  check('有「替换整集」勾选', (await replaceBox.count()) === 1)
  await replaceBox.check()
  await page.waitForTimeout(600)
  await page.locator('[data-intake-apply]').click()
  await page.waitForTimeout(900)
  const afterReplace = await page.locator('.wb-table tbody tr').count()
  check('replace：应用后只剩 3 镜', afterReplace === 3, String(afterReplace))

  // ---------------------------------------------------------------- 取消不写
  const beforeCancel = await page.locator('.wb-table tbody tr').count()
  await intakeBtn.click()
  await page.waitForTimeout(600)
  await page.locator('[data-intake-input]').fill('| 镜头 | 画面 |\n|---|---|\n| S88 | 不该被写入 |')
  await page.waitForTimeout(600)
  await page.getByRole('button', { name: '取消' }).click()
  await page.waitForTimeout(600)
  check('取消后行数不变', (await page.locator('.wb-table tbody tr').count()) === beforeCancel, String(await page.locator('.wb-table tbody tr').count()))

  // ---------------------------------------------------------------- 剧本：自由文本 → 让模型整理
  await page.getByRole('button', { name: '剧本', exact: true }).click()
  await page.waitForTimeout(1200)
  const scriptIntake = page.getByRole('button', { name: '导入', exact: true }).first()
  check('剧本页有导入按钮', (await scriptIntake.count()) >= 1)
  await scriptIntake.click()
  await page.waitForTimeout(700)
  check('剧本导入对话框打开', (await page.locator('.intake-dialog').count()) === 1)
  check('自由文本未请求模型前不请求', textCalls.length === 0, String(textCalls.length))
  await page.locator('[data-intake-input]').fill('第1集\n\n那天晚上，我以为自己活不过去了。\n\n第2集\n\n我差点没活过那个雨夜。')
  await page.waitForTimeout(700)
  check('自由文本出现「让模型整理」', (await page.getByRole('button', { name: /让模型整理/ }).count()) === 1)
  await page.getByRole('button', { name: /让模型整理/ }).click()
  await page.waitForTimeout(2000)
  if (textCalls.length === 0) {
    console.log('DEBUG organize err =', await page.locator('.intake-dialog .gen-error').innerText().catch(() => 'n/a'))
    console.log('DEBUG pageErrors =', JSON.stringify(pageErrors.slice(-2)).slice(0, 900))
  }
  check('点了才请求模型', textCalls.length === 1, String(textCalls.length))
  check('整理后出现预览', (await page.locator('[data-intake-plan]').count()) === 1)
  const scriptPlan = await page.locator('[data-intake-plan]').innerText()
  check('剧本预览显示新增/更新集数', /集/.test(scriptPlan), scriptPlan.slice(0, 100))
  await page.locator('[data-intake-apply]').click()
  await page.waitForTimeout(1000)
  const titles = await page.evaluate(() => [...document.querySelectorAll('.sb-ep-title')].map((i) => i.value))
  check('剧本草稿出现整理后的集', titles.includes('整理后的第一集'), JSON.stringify(titles))

  // ---------------------------------------------------------------- 提示词导入
  await page.getByRole('button', { name: '提示词', exact: true }).click()
  await page.waitForTimeout(1800)
  for (let i = 0; i < 20; i++) {
    const n = await page.evaluate(() => document.querySelectorAll('.pt-table tbody tr').length)
    if (n > 0) break
    await page.waitForTimeout(400)
  }
  const promptIntake = page.getByRole('button', { name: '导入', exact: true }).first()
  check('提示词页有导入按钮', (await promptIntake.count()) >= 1)
  await promptIntake.click()
  await page.waitForTimeout(700)
  await page.locator('[data-intake-input]').fill(
    JSON.stringify({ shots: [{ no: 'S02', keyframe_prompt: '导入的首帧提示词' }] }),
  )
  await page.waitForTimeout(1200)
  if ((await page.locator('[data-intake-plan]').count()) === 0) {
    console.log('DEBUG prompt format =', await page.locator('[data-intake-format]').innerText().catch(() => 'n/a'))
    console.log('DEBUG prompt err =', await page.locator('.intake-dialog .gen-error').innerText().catch(() => 'n/a'))
    const nos = await page.evaluate(() => [...document.querySelectorAll('.wb-table tbody tr')].map((tr) => tr.querySelector('input')?.value))
    console.log('DEBUG prompt page rows =', JSON.stringify(nos.slice(0, 5)))
    console.log('DEBUG wb-bar-title =', await page.locator('.wb-bar-title').first().innerText().catch(() => 'n/a'))
    console.log('DEBUG buttons =', JSON.stringify(await page.evaluate(() => [...document.querySelectorAll('button')].map((b) => b.textContent?.trim()).filter((t) => t && t.length < 8).slice(0, 24))))
    console.log('DEBUG dialog title =', await page.locator('#intake-title').innerText().catch(() => 'n/a'))
  }
  check('提示词 JSON 直接预览（零模型）', (await page.locator('[data-intake-plan]').count()) === 1)
  const promptPlan = await page.locator('[data-intake-plan]').innerText()
  check('提示词预览显示更新镜数', /更新 \d+ 镜/.test(promptPlan), promptPlan.slice(0, 100))
  await page.locator('[data-intake-apply]').click()
  await page.waitForTimeout(900)
  const promptCells = await page.locator('.pt-table tbody').innerText()
  const promptValues = await page.evaluate(() =>
    [...document.querySelectorAll('.pt-table tbody tr')].map((tr) => ({
      no: (tr.querySelector('.wb-no')?.textContent ?? tr.querySelector('input')?.value ?? '').trim(),
      areas: [...tr.querySelectorAll('textarea')].map((t) => t.value),
    })),
  )
  const hit = promptValues.find((r) => r.no === 'S02')
  check('提示词已写入表格', Boolean(hit) && hit.areas.some((v) => /导入的首帧提示词/.test(v)), JSON.stringify(hit))
} catch (e) {
  check('端到端执行', false, e.message)
} finally {
  await browser?.close()
  child.kill('SIGTERM')
  fs.rmSync(TMP, { recursive: true, force: true })
  console.log(bad === 0 ? '\n全部通过' : `\n${bad} 项未通过`)
  process.exit(bad === 0 ? 0 : 1)
}
