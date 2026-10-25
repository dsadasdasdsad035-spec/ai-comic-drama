/**
 * 项目级工作区集成验证（隔离临时库，不碰真实项目）：
 * 1) 顶栏项目选择器 + A/B 切换，画布/镜头表按项目隔离
 * 2) 剧本未保存时切项目要确认
 * 3) 全剧拆角色无剧本时在本地拦截；本集拆角色读项目镜头（mock /api/text）
 * 4) 旧全局画布迁移到项目级 key，保留备份和节点位置
 * 跑法：node verify-project-scope.mjs
 */
import { spawn } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { chromium } from 'playwright-core'

const ROOT = process.cwd()
const PORT = 5301
const APP = `http://127.0.0.1:${PORT}`
const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'project-scope-'))

let bad = 0
const check = (name, cond, extra = '') => {
  console.log(`${cond ? '✅' : '❌'} ${name}${extra ? ' | ' + extra : ''}`)
  if (!cond) bad++
}

const api = (p, init) => fetch(`${APP}${p}`, init).then((r) => r.json())
const mkShot = (id, dialogue, cast) => ({
  id,
  episode: 1,
  no: id.split('-').pop(),
  seconds: 3,
  size: '中景',
  move: '固定',
  desc: `${id} 画面`,
  keyframe_prompt: `${id} 画面`,
  dialogue: dialogue ? [{ speaker: cast[0], text: dialogue }] : [],
  cast,
})

const child = spawn(
  process.execPath,
  [path.join(ROOT, 'node_modules', 'vite', 'bin', 'vite.js'), '--port', String(PORT), '--strictPort'],
  { cwd: ROOT, env: { ...process.env, SB_PROJECTS_DIR: TMP }, stdio: 'ignore' },
)

const waitServer = async () => {
  for (let i = 0; i < 80; i++) {
    try {
      const r = await fetch(`${APP}/api/health`)
      if (r.ok) return true
    } catch {
      /* 继续等 */
    }
    await new Promise((r) => setTimeout(r, 500))
  }
  return false
}

let browser
try {
  if (!(await waitServer())) throw new Error('临时 dev server 启动失败')

  for (const [name, title, shots] of [
    ['A', '项目 A', [mkShot('A-E01-S01', 'A 的第一句', ['甲']), mkShot('A-E01-S02', '', ['甲'])]],
    [
      'B',
      '项目 B',
      [
        mkShot('B-E01-S01', 'B 的第一句', ['乙']),
        mkShot('B-E01-S02', '', ['乙']),
        mkShot('B-E01-S03', 'B 的第三句', ['乙', '丙']),
      ],
    ],
  ]) {
    await api(`/api/project?name=${name}&create=1`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ title }),
    })
    await api(`/api/project?name=${name}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ shots }),
    })
  }

  browser = await chromium.launch({ headless: true, channel: 'chrome' })
  const ctx = await browser.newContext({ viewport: { width: 1600, height: 1000 } })
  const page = await ctx.newPage()
  const textCalls = []
  let dialogMode = 'dismiss'
  let dialogText = ''

  page.on('dialog', async (d) => {
    dialogText = d.message()
    if (dialogMode === 'accept') await d.accept()
    else await d.dismiss()
  })
  await page.route('**/api/text', async (route) => {
    const body = JSON.parse(route.request().postData() || '{}')
    textCalls.push(body)
    await route.fulfill({
      contentType: 'application/json',
      body: JSON.stringify({
        ok: true,
        json: {
          characters: [
            {
              name: '测试角色',
              role: '主角',
              age: '30 岁上下',
              look_cn: '男性，短发，深灰风衣',
              look_en: 'a man in a dark grey coat',
              palette: '灰',
              keywords: ['短发'],
            },
          ],
        },
        text: 'mock',
        model: 'mock',
        modelLabel: 'mock',
      }),
    })
  })

  const storage = () =>
    page.evaluate(() => {
      const out = {}
      for (let i = 0; i < localStorage.length; i++) {
        const k = localStorage.key(i)
        if (k?.startsWith('storyboard-canvas-v1')) {
          const v = JSON.parse(localStorage.getItem(k) || '{}')
          out[k] = {
            nodes: v.nodes?.length,
            shotIds: (v.nodes || []).filter((n) => n.data?.shotId).length,
          }
        }
      }
      return out
    })

  await page.goto(APP, { waitUntil: 'networkidle' })
  await page.waitForTimeout(1600)
  const sel = page.locator('.topbar-project select')
  check('顶栏项目选择器存在', (await sel.count()) === 1)
  check('初始项目为 A', (await sel.inputValue()) === 'A', await sel.inputValue())
  check('初始画布 2 镜', (await page.locator('.react-flow__node').count()) === 2)

  await sel.selectOption('B')
  await page.waitForTimeout(1400)
  check('切到 B 后画布 3 镜', (await page.locator('.react-flow__node').count()) === 3)
  const stB = await storage()
  check('A/B 画布 key 分开', Boolean(stB['storyboard-canvas-v1:A'] && stB['storyboard-canvas-v1:B']), JSON.stringify(stB))
  check('A key 2 个 shotId', stB['storyboard-canvas-v1:A']?.shotIds === 2, JSON.stringify(stB['storyboard-canvas-v1:A']))
  check('B key 3 个 shotId', stB['storyboard-canvas-v1:B']?.shotIds === 3, JSON.stringify(stB['storyboard-canvas-v1:B']))

  await page.getByRole('button', { name: '剧本', exact: true }).click()
  await page.waitForTimeout(500)
  await page.locator('textarea').first().fill('未保存测试原文')
  await page.waitForTimeout(200)
  await sel.selectOption('A')
  await page.waitForTimeout(500)
  check('未保存时切项目会确认', /未保存/.test(dialogText), dialogText)
  check('取消后仍在 B', (await sel.inputValue()) === 'B', await sel.inputValue())

  dialogMode = 'accept'
  await sel.selectOption('A')
  await page.waitForTimeout(1200)
  check('确认后切到 A', (await sel.inputValue()) === 'A', await sel.inputValue())

  await page.getByRole('button', { name: '角色', exact: true }).click()
  await page.waitForTimeout(500)
  textCalls.length = 0
  // 上沿改版后按钮文案从「从全剧拆角色」缩短为「从全剧拆」
  await page.getByRole('button', { name: '从全剧拆', exact: true }).click()
  let fullToast = ''
  for (let i = 0; i < 10; i++) {
    await page.waitForTimeout(300)
    fullToast = await page.locator('.toast').innerText().catch(() => '')
    if (fullToast) break
  }
  check('全剧无剧本直接提示', /没有剧本素材/.test(fullToast), fullToast)
  check('全剧无剧本不调用模型', textCalls.length === 0, String(textCalls.length))

  await page.waitForTimeout(4200)
  // 角色为空时该按钮是强调样式（btn primary），有角色才变 btn-ghost；
  // 上沿与板内各有一个同名按钮，取第一个（上沿）。
  await page.getByRole('button', { name: '从本集拆角色', exact: true }).first().click()
  for (let i = 0; i < 20 && textCalls.length === 0; i++) await page.waitForTimeout(300)
  check('本集拆角色调用模型', textCalls.length === 1, String(textCalls.length))
  check(
    '本集素材来自项目镜头',
    /A 的第一句/.test(String(textCalls[0]?.prompt || '')) && /甲/.test(String(textCalls[0]?.prompt || '')),
    String(textCalls[0]?.prompt || '').slice(0, 200),
  )
  await page.waitForTimeout(2600)
  const a = await api('/api/project?name=A')
  const b = await api('/api/project?name=B')
  check('拆出的角色写入当前项目 A', (a.project?.characters || []).some((c) => c.name === '测试角色'))
  check('项目 B 角色未被修改', !(b.project?.characters || []).some((c) => c.name === '测试角色'))

  await page.getByRole('button', { name: '剧本', exact: true }).click()
  await page.waitForTimeout(500)
  await page.locator('textarea').first().fill('保存测试原文')
  await page.waitForTimeout(200)
  await page.getByRole('button', { name: '保存', exact: true }).click()
  await page.waitForTimeout(800)
  const aSaved = await api('/api/project?name=A')
  check('有项目保存写回 source', aSaved.project?.source === '保存测试原文', JSON.stringify(aSaved.project?.source))

  // 旧全局画布迁移：新上下文，legacy 里有一个 A 项目 shotId
  const ctx2 = await browser.newContext({ viewport: { width: 1400, height: 900 } })
  const page2 = await ctx2.newPage()
  await page2.addInitScript(() => {
    localStorage.setItem(
      'storyboard-canvas-v1',
      JSON.stringify({
        nodes: [
          {
            id: 'legacy-shot',
            type: 'shot',
            position: { x: 999, y: 888 },
            data: { shotId: 'A-E01-S01', no: 'S01', seconds: 3, size: '中景', move: '固定', dialogue: '', prompt: 'legacy', marks: [] },
          },
          { id: 'legacy-asset', type: 'asset', position: { x: 1, y: 2 }, data: { title: 'legacy', kind: 'image', url: '' } },
        ],
        edges: [],
        cleared: false,
        epNo: 1,
      }),
    )
  })
  await page2.goto(APP, { waitUntil: 'networkidle' })
  await page2.waitForTimeout(1600)
  const legacy = await page2.evaluate(() => {
    const out = {}
    for (let i = 0; i < localStorage.length; i++) {
      const k = localStorage.key(i)
      if (k?.startsWith('storyboard-canvas-v1')) {
        const v = JSON.parse(localStorage.getItem(k) || '{}')
        out[k] = {
          nodes: v.nodes?.length,
          legacyPos: (v.nodes || []).find((n) => n.id === 'legacy-shot')?.position,
        }
      }
    }
    return out
  })
  check('旧画布有备份', Boolean(legacy['storyboard-canvas-v1:legacy-backup']), JSON.stringify(Object.keys(legacy)))
  check('旧画布迁移到项目 A', Boolean(legacy['storyboard-canvas-v1:A']), JSON.stringify(Object.keys(legacy)))
  check(
    '迁移保留节点位置',
    legacy['storyboard-canvas-v1:A']?.legacyPos?.x === 999 && legacy['storyboard-canvas-v1:A']?.legacyPos?.y === 888,
    JSON.stringify(legacy['storyboard-canvas-v1:A']?.legacyPos),
  )
} catch (e) {
  check('集成测试执行', false, (e && e.message) || String(e))
} finally {
  await browser?.close().catch(() => {})
  child.kill()
  fs.rmSync(TMP, { recursive: true, force: true })
}

console.log(bad === 0 ? '\n全部通过' : `\n${bad} 项失败`)
process.exit(bad === 0 ? 0 : 1)
