/**
 * DeepSeek Flash（Agent Plan）验收：
 * 1) 模型表出现混合推理预设，普通文本开思考、JSON 关思考
 * 2) 真实调用 Ark Agent Plan：文本 / JSON / usage 都正常
 * 3) 设置页能把「3D 代码」绑定到该模型
 * 跑法：APP_URL=http://127.0.0.1:5280 node verify-deepseek-flash.mjs
 * 不打印任何 API Key。
 */
import { chromium } from 'playwright-core'
import fs from 'node:fs'
import path from 'node:path'

const URL = process.env.APP_URL || 'http://127.0.0.1:5280'
const MODEL_KEY = 'ark-plan-text-deepseek-flash'
const VISION_KEY = 'ark-plan-vision-deepseek-flash'
const MODEL_ID = 'deepseek-v4-flash'
let bad = 0
const check = (name, cond, extra = '') => {
  console.log(`${cond ? '✅' : '❌'} ${name}${extra ? ` | ${extra}` : ''}`)
  if (!cond) bad++
}
const api = async (p, init) =>
  fetch(`${URL}${p}`, init).then(async (r) => {
    const text = await r.text()
    try {
      return JSON.parse(text)
    } catch {
      return { ok: false, message: `HTTP ${r.status}: ${text.slice(0, 200)}` }
    }
  })
const post = (p, body) =>
  api(p, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) })
const getSettings = async () => (await api('/api/settings')).settings

const health = await api('/api/health')
if (!health || health.hasKey === undefined) {
  console.error('dev server 未启动：先运行 npm run dev')
  process.exit(1)
}

const original = await getSettings()
let browser
try {
  const entry = (original.models || []).find((m) => m.key === MODEL_KEY)
  check('模型表出现 DeepSeek Flash', entry?.model === MODEL_ID, entry ? `${entry.label} · ${entry.model}` : 'missing')
  check('预设为混合推理 auto', entry?.thinking === 'auto', String(entry?.thinking))
  check('使用现有 Agent Plan 渠道', entry?.provider === 'ark-plan', String(entry?.provider))

  // 普通文本：混合推理默认开思考
  const textRes = await post('/api/text', {
    modelKey: MODEL_KEY,
    prompt: '17 乘以 23 等于多少？只回复数字。',
    maxTokens: 256,
    temperature: 0.1,
  })
  check('普通文本调用成功', textRes.ok === true, String(textRes.message || '').slice(0, 160))
  check('普通文本答案正确', String(textRes.text || '').trim() === '391', String(textRes.text || '').slice(0, 80))
  check('普通文本启用思考', textRes.thinking === 'enabled', String(textRes.thinking))
  check('返回真实模型 ID', textRes.model === MODEL_ID, String(textRes.model))

  // JSON / 工具协议：自动关思考，避免 reasoning 吃掉输出预算
  const jsonRes = await post('/api/text', {
    modelKey: MODEL_KEY,
    system: '只输出 JSON，不要解释。',
    prompt: '输出 {"ok":true}',
    json: true,
    maxTokens: 512,
    temperature: 0,
  })
  check('JSON 调用成功', jsonRes.ok === true, String(jsonRes.message || '').slice(0, 160))
  check('JSON 可解析', jsonRes.json?.ok === true, JSON.stringify(jsonRes.json))
  check('JSON 关闭思考', jsonRes.thinking === 'disabled', String(jsonRes.thinking))
  check(
    'JSON 无 reasoning token',
    Number(jsonRes.usage?.completion_tokens_details?.reasoning_tokens ?? 0) === 0,
    JSON.stringify(jsonRes.usage?.completion_tokens_details || {}),
  )

  // 视觉：参考板 / 关键帧走 /api/vision，JSON 验收自动关思考
  const visionEntry = (original.models || []).find((m) => m.key === VISION_KEY)
  check('视觉预置出现 DeepSeek Flash', visionEntry?.cap === 'vision' && visionEntry?.model === MODEL_ID, visionEntry ? `${visionEntry.label} · ${visionEntry.model}` : 'missing')
  let image = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Y9Zl1sAAAAASUVORK5CYII='
  try {
    const dir = path.join(process.cwd(), 'public/generated')
    const file = fs.readdirSync(dir).find((f) => /\.(png|jpe?g|webp)$/i.test(f))
    if (file) {
      const buf = fs.readFileSync(path.join(dir, file))
      image = `data:${file.toLowerCase().endsWith('.png') ? 'image/png' : 'image/jpeg'};base64,${buf.toString('base64')}`
    }
  } catch {
    /* 使用 1x1 fallback */
  }
  const visionRes = await post('/api/vision', {
    modelKey: VISION_KEY,
    prompt: '只输出 JSON：{"description":"用一句话描述图片里看到的内容"}',
    image,
    json: true,
    maxTokens: 256,
  })
  check('视觉调用成功', visionRes.ok === true, String(visionRes.message || '').slice(0, 160))
  check('视觉 JSON 可解析', typeof visionRes.json?.description === 'string' && visionRes.json.description.trim().length > 0, JSON.stringify(visionRes.json))
  check('视觉返回真实模型 ID', visionRes.model === MODEL_ID, String(visionRes.model))

  // 设置页：模型表可见，3D 代码环节可选
  browser = await chromium.launch({ headless: true, channel: 'chrome' })
  const page = await browser.newPage({ viewport: { width: 1600, height: 1000 } })
  const errors = []
  page.on('pageerror', (e) => errors.push(e.message))
  await page.goto(URL, { waitUntil: 'networkidle' })
  await page.waitForTimeout(800)
  await page.getByRole('button', { name: '设置', exact: true }).click()
  await page.locator('.st-nav button', { hasText: '模型' }).click()
  await page.waitForSelector('.st-model-label')
  await page.waitForTimeout(400)
  const labels = await page.locator('.st-model-label').evaluateAll((els) => els.map((e) => e.value))
  check(
    '设置页模型表显示 DeepSeek Flash',
    labels.some((x) => /DeepSeek Flash/.test(x)),
    JSON.stringify(labels.filter((x) => /DeepSeek/.test(x))),
  )
  await page.locator('.st-nav button', { hasText: '默认路由' }).click()
  await page.waitForSelector('select[data-stage-model-select="sceneCode"]')
  const stageSel = page.locator('select[data-stage-model-select="sceneCode"]')
  const stageCount = await stageSel.count()
  check('3D 代码环节选择器存在', stageCount === 1, String(stageCount))
  const options = stageCount
    ? await stageSel.locator('option').evaluateAll((os) =>
        os.map((o) => ({ value: o.value, text: o.textContent || '' })),
      )
    : []
  check(
    '3D 代码下拉含 DeepSeek Flash',
    options.some((o) => o.value === MODEL_KEY && /DeepSeek Flash/.test(o.text)),
    JSON.stringify(options.filter((o) => o.value === MODEL_KEY)),
  )
  const visionSel = page.locator('select[data-stage-model-select="vision"]')
  const visionOptions = await visionSel.locator('option').evaluateAll((os) =>
    os.map((o) => ({ value: o.value, text: o.textContent || '' })),
  )
  check(
    '视觉下拉含 DeepSeek Flash Vision',
    visionOptions.some((o) => o.value === VISION_KEY && /DeepSeek Flash Vision/.test(o.text)),
    JSON.stringify(visionOptions.filter((o) => o.value === VISION_KEY)),
  )
  if (options.some((o) => o.value === MODEL_KEY)) {
    await stageSel.selectOption(MODEL_KEY)
    if (visionOptions.some((o) => o.value === VISION_KEY)) await visionSel.selectOption(VISION_KEY)
    const saveButton = page.getByRole('button', { name: '保存设置' })
    if (await saveButton.isEnabled()) {
      await saveButton.click()
      await page.waitForTimeout(1200)
    }
    const saved = await getSettings()
    check('保存后 3D 代码绑定 DeepSeek Flash', saved.stageModels?.sceneCode === MODEL_KEY, String(saved.stageModels?.sceneCode))
    check('保存后视觉绑定 DeepSeek Flash Vision', saved.stageModels?.vision === VISION_KEY, String(saved.stageModels?.vision))
  }
  check('设置页无未捕获异常', errors.length === 0, errors[0] || '')
} finally {
  try {
    if (browser) await browser.close()
  } catch {
    /* ignore */
  }
  // 恢复原来的环节绑定，避免测试改变用户配置
  await api('/api/settings', {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ stageModels: original.stageModels || {} }),
  }).catch(() => {})
}

console.log(bad === 0 ? '\n全部通过' : `\n${bad} 项失败`)
process.exit(bad === 0 ? 0 : 1)
