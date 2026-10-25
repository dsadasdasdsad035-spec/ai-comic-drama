/**
 * 环节模型选择 UI 验证（Playwright，不调用真实生成）：
 * 1) 剧本/镜头表/提示词/角色板都有真实模型下拉，首项显示默认解析结果
 * 2) 手选后请求体带对应 modelKey；刷新后手选保持
 * 3) 角色板同时有拆角色与三视图两个模型选择
 * 4) 设置页有「生成环节默认模型」区域
 * 5) 无效 stageModels 键显示不可用，生成返回明确错误
 *
 * 建议用独立实例跑，避免改到本地设置：
 *   SB_PROJECTS_DIR=/tmp/stage-ui npm run dev -- --port 5280
 *   APP_URL=http://127.0.0.1:5280 node verify-stage-models-ui.mjs
 */
import { chromium } from 'playwright-core'

const APP_URL = process.env.APP_URL || 'http://127.0.0.1:5273'
let bad = 0
const check = (name, cond, extra = '') => {
  console.log(`${cond ? '✅' : '❌'} ${name}${extra ? ' | ' + extra : ''}`)
  if (!cond) bad++
}

const api = (p, init) => fetch(`${APP_URL}${p}`, init).then((r) => r.json())
const putSettings = (body) =>
  api('/api/settings', {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })

const health = await fetch(`${APP_URL}/api/health`).then((r) => r.json()).catch(() => null)
if (!health) {
  console.error(`dev server 未启动：${APP_URL}`)
  process.exit(1)
}

const original = (await api('/api/settings')).settings
const textModels = (original.models || []).filter((m) => m.cap === 'text' || m.cap === 'textPro')
const proKey = (textModels.find((m) => m.cap === 'textPro') || textModels[1] || textModels[0])?.key
const liteKey = (textModels.find((m) => m.cap === 'text' && m.key !== proKey) || textModels[0])?.key
const viewKey = (original.models || []).find((m) => m.cap === 'view')?.key
if (!proKey || !liteKey || !viewKey) {
  console.error('缺少文本或 view 模型，先准备设置')
  process.exit(1)
}

// 独立的临时项目，避免碰用户项目
const PROJECT = 'ui-stage-models'
await api(`/api/project?name=${PROJECT}&create=1`, {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ title: '环节模型 UI 测试' }),
}).catch(() => {})
await api(`/api/project?name=${PROJECT}`, {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({
    episodes: [
      {
        no: 1,
        title: '测试集',
        hook: '门后有人',
        scenes: [
          {
            no: 1,
            slug: '门口',
            place: '旧公寓',
            time: '夜',
            beats: '陈默站在门口，听见门后有动静。',
            characters: ['陈默'],
          },
        ],
      },
    ],
    shots: [
      {
        id: 'E01-S01',
        episode: 1,
        no: 'S01',
        seconds: 3,
        size: '中景',
        move: '固定',
        desc: '陈默站在门口，手停在门把上。',
        dialogue: [{ speaker: '陈默', text: '谁在里面？' }],
        cast: ['陈默'],
      },
    ],
  }),
})

const textBodies = []
const imageBodies = []
const browser = await chromium.launch({ headless: true, channel: 'chrome' })
const page = await browser.newPage({ viewport: { width: 1600, height: 1000 } })
page.on('pageerror', (e) => console.log('PAGEERROR:', e.message))

await page.route('**/api/text', async (route) => {
  const body = JSON.parse(route.request().postData() || '{}')
  textBodies.push(body)
  const system = String(body.system || '')
  let json
  if (system.includes('编剧与分集策划')) {
    json = {
      logline: '一个关于门后声音的故事',
      episodes: [
        {
          no: 1,
          title: '测试集',
          hook: '门后有人',
          scenes: [{ no: 1, slug: '门口', place: '旧公寓', time: '夜', beats: '陈默听见门后动静', characters: ['陈默'] }],
        },
      ],
    }
  } else if (system.includes('分镜师')) {
    json = {
      shots: [
        {
          no: 'S01',
          seconds: 3,
          size: '中景',
          move: '固定',
          desc: '陈默站在门口',
          dialogue: [{ speaker: '陈默', text: '谁在里面？' }],
          cast: ['陈默'],
        },
      ],
    }
  } else if (system.includes('角色设定师')) {
    json = { characters: [{ name: '陈默', role: '主角', look_cn: '短发男人', look_en: 'short-haired man', keywords: ['寸头'] }] }
  } else if (system.includes('场记兼分镜调度师')) {
    json = {
      w: 10,
      h: 8,
      actors: [{ name: '陈默', x: 0.5, y: 0.45, face: 0 }],
      camera: { x: 0.5, y: 0.9, lookX: 0.5, lookY: 0.45 },
    }
  } else {
    json = { shots: [{ no: 'S01', keyframe_prompt: '陈默站在门口', video_prompt: '缓慢推近' }] }
  }
  await route.fulfill({
    status: 200,
    contentType: 'application/json',
    body: JSON.stringify({ ok: true, json, text: '', model: 'fake-model-id', modelKey: 'fake-key', modelLabel: '测试模型' }),
  })
})

await page.route('**/api/seedream', async (route) => {
  imageBodies.push(JSON.parse(route.request().postData() || '{}'))
  await route.fulfill({
    status: 200,
    contentType: 'application/json',
    body: JSON.stringify({ ok: true, urls: ['/generated/fake.png'], url: '/generated/fake.png', size: '1x1', elapsed: 1 }),
  })
})

const nav = (name) => page.locator('header').getByRole('button', { name, exact: true }).click()
const stageSelect = (stage) => page.locator(`[data-stage-model-select="${stage}"] select`)
const optionValues = (sel) =>
  sel.locator('option').evaluateAll((os) => os.map((o) => ({ value: o.value, text: o.textContent || '' })))

try {
  await page.goto(APP_URL, { waitUntil: 'networkidle' })
  await page.waitForTimeout(900)

  // ---- 剧本 ----
  await nav('剧本')
  await page.waitForSelector('.sb-source')
  const scriptSel = stageSelect('script')
  const scriptOptions = await optionValues(scriptSel)
  check('剧本选择器列出文本族模型', scriptOptions.filter((o) => o.value).length >= textModels.length, String(scriptOptions.length))
  check('剧本默认项显示解析结果', /默认 · /.test(scriptOptions[0]?.text || ''), scriptOptions[0]?.text)
  await scriptSel.selectOption(proKey)
  await page.locator('.sb-source').fill('一个关于门后声音的短故事。')
  await page.getByRole('button', { name: '生成分集' }).click()
  await page.waitForSelector('.toast')
  await page.waitForTimeout(300)
  check('剧本请求带手选 modelKey', textBodies.at(-1)?.modelKey === proKey, JSON.stringify(textBodies.at(-1)?.modelKey))
  check('剧本提示显示实际模型', /模型：测试模型/.test(await page.locator('.toast').innerText()))

  await page.reload({ waitUntil: 'networkidle' })
  await page.waitForTimeout(700)
  await nav('剧本')
  await page.waitForSelector('.sb-source')
  check('刷新后剧本手选保持', (await stageSelect('script').inputValue()) === proKey, await stageSelect('script').inputValue())

  // ---- 镜头表 ----
  await nav('镜头表')
  await page.waitForSelector('.wb-gen textarea')
  const shotSel = stageSelect('shot')
  check('镜头表选择器存在', (await optionValues(shotSel)).length >= textModels.length + 1)
  await shotSel.selectOption(liteKey)
  await page.locator('.wb-gen textarea').fill('测试集：陈默站在门口，听见门后有动静。')
  await page.getByRole('button', { name: '拆镜' }).click()
  await page.waitForSelector('.toast')
  await page.waitForTimeout(300)
  check('拆镜请求带手选 modelKey', textBodies.at(-1)?.modelKey === liteKey, JSON.stringify(textBodies.at(-1)?.modelKey))
  check('拆镜 prompt 命中', String(textBodies.at(-1)?.system || '').includes('分镜师'))

  // ---- 提示词 ----
  await nav('提示词')
  await page.waitForSelector('.pt-table')
  const promptSel = stageSelect('prompt')
  check('提示词选择器存在', (await optionValues(promptSel)).length >= textModels.length + 1)
  await promptSel.selectOption(proKey)
  await page.getByRole('button', { name: '生成提示词' }).click()
  await page.waitForSelector('.toast')
  await page.waitForTimeout(300)
  check('提示词请求带手选 modelKey', textBodies.at(-1)?.modelKey === proKey, JSON.stringify(textBodies.at(-1)?.modelKey))
  check('提示词 prompt 命中', String(textBodies.at(-1)?.system || '').includes('提示词工程师'))

  // ---- 角色板：拆角色 + 三视图 ----
  await nav('角色')
  await page.waitForSelector('[data-cap-model-select="view"] select')
  const charSel = stageSelect('character')
  check('角色板有拆角色模型选择', (await optionValues(charSel)).length >= textModels.length + 1)
  check('角色板有三视图模型选择', (await optionValues(page.locator('[data-cap-model-select="view"] select'))).length >= 2)
  await charSel.selectOption(liteKey)
  await page.getByRole('button', { name: '从本集拆角色' }).click()
  await page.waitForSelector('.toast')
  await page.waitForTimeout(300)
  check('拆角色请求带手选 modelKey', textBodies.at(-1)?.modelKey === liteKey, JSON.stringify(textBodies.at(-1)?.modelKey))
  check('拆角色 prompt 命中', String(textBodies.at(-1)?.system || '').includes('角色设定师'))

  await page.locator('[data-cap-model-select="view"] select').selectOption(viewKey)
  const viewButton = page.getByRole('button', { name: '生成三视图' }).first()
  if (await viewButton.count()) {
    await viewButton.click()
    await page.waitForTimeout(500)
    const img = imageBodies.at(-1)
    check('三视图请求带手选 view modelKey', img?.modelKey === viewKey, JSON.stringify(img?.modelKey))
    check('三视图请求 cap 为 view', img?.cap === 'view', JSON.stringify(img?.cap))
  } else {
    console.log('⚠️ 跳过三视图请求：当前角色板没有生成按钮')
  }

  // ---- Inspector 的能力模型下拉（共享组件回归） ----
  const imageKey = (original.models || []).find((m) => m.cap === 'image')?.key
  if (imageKey) {
    await nav('镜头表')
    await page.waitForTimeout(500)
    await page.getByRole('button', { name: '生成到画布' }).click()
    await page.waitForTimeout(800)
    await nav('画布')
    await page.waitForTimeout(800)
    const shotNodeId = await page.evaluate(() => {
      const s = JSON.parse(localStorage.getItem('storyboard-canvas-v1') || '{}')
      return (s.nodes || []).find((x) => x.type !== 'asset' && x.data?.shotId)?.id
    })
    if (shotNodeId) {
      await page.evaluate((nid) => {
        const el = document.querySelector(`[data-id="${nid}"]`)
        const opt = { bubbles: true, button: 0, view: window }
        for (const t of ['mousedown', 'mouseup', 'click']) el.dispatchEvent(new MouseEvent(t, opt))
      }, shotNodeId)
      await page.waitForTimeout(400)
      check('Inspector 仍有能力模型下拉', (await page.locator('.mp-row').count()) >= 3, String(await page.locator('.mp-row').count()))
      await page.locator('.mp-row', { hasText: '出图模型' }).locator('select').selectOption(imageKey)
      await page.waitForTimeout(250)
      const storedPick = await page.evaluate(() => JSON.parse(localStorage.getItem('storyboard-model-pick') || '{}'))
      check('Inspector 选择仍写本地', storedPick.image === imageKey, JSON.stringify(storedPick))
    } else {
      console.log('⚠️ 跳过 Inspector：当前画布没有可用的镜头节点')
    }
  }

  // ---- 3D 调度跟随镜头表环节 ----
  await page.evaluate(async (key) => {
    const m = await import('/src/layoutGen.ts')
    await m.generateLayout(
      { prompt: '陈默站在门口', cast: ['陈默'], size: '中景', move: '固定' },
      ['陈默'],
      key,
    )
  }, liteKey)
  check('3D 调度请求带镜头表 modelKey', textBodies.at(-1)?.modelKey === liteKey, JSON.stringify(textBodies.at(-1)?.modelKey))
  check('3D 调度 prompt 命中', String(textBodies.at(-1)?.system || '').includes('场记兼分镜调度师'))

  // ---- 设置页区域：改环节默认后工作台标签立即更新 ----
  await page.evaluate(() => localStorage.removeItem('storyboard-stage-model-pick'))
  await nav('设置')
  await page.locator('.st-nav button', { hasText: '默认路由' }).click()
  await page.waitForSelector('.st-subhead', { timeout: 5000 })
  check('设置页有生成环节默认模型', (await page.locator('.st-subhead', { hasText: '生成环节默认' }).count()) >= 1)
  check('设置页说明角色三视图与手选范围', (await page.locator('body').innerText()).includes('角色三视图使用上方'))
  const scriptDefault = page.locator('.st-stage-row', { hasText: '剧本（拆集）' }).locator('select')
  await scriptDefault.selectOption(proKey)
  await page.getByRole('button', { name: '保存设置' }).click()
  await page.waitForTimeout(900)
  await nav('剧本')
  await page.waitForSelector('.sb-source')
  const defaultOption = (await optionValues(stageSelect('script')))[0]?.text || ''
  const proLabel = original.models.find((m) => m.key === proKey)?.label || ''
  check('改环节默认后默认标签更新', defaultOption.includes(proLabel), `${defaultOption} / ${proLabel}`)

  // ---- 无效 stageModels 键 ----
  await putSettings({
    stageModels: { ...(original.stageModels || {}), script: 'missing-stage-model-key' },
  })
  await page.evaluate(() => localStorage.removeItem('storyboard-stage-model-pick'))
  await page.reload({ waitUntil: 'networkidle' })
  await page.waitForTimeout(700)
  await nav('剧本')
  await page.waitForSelector('.sb-source')
  const invalidOptions = await optionValues(stageSelect('script'))
  check(
    '无效环节默认显示不可用',
    /配置的模型不可用（missing-stage-model-key）/.test(invalidOptions[0]?.text || ''),
    invalidOptions[0]?.text,
  )
  await page.unroute('**/api/text')
  await page.locator('.sb-source').fill('一个关于门后声音的短故事。')
  await page.getByRole('button', { name: '生成分集' }).click()
  await page.waitForFunction(
    () => /找不到可用的文本模型/.test(document.querySelector('.toast')?.textContent || ''),
    null,
    { timeout: 5000 },
  )
  check('无效环节默认生成失败提示明确', true)
} finally {
  await browser.close()
  await putSettings({ stageModels: original.stageModels || {} }).catch(() => {})
}

console.log(bad === 0 ? '\n全部通过' : `\n${bad} 项失败`)
process.exit(bad === 0 ? 0 : 1)
