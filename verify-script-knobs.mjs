/**
 * 校验剧本工作台的「强度 / 基调」旋钮（只读，不改数据）：
 * 1) 每场都有旋钮，值已从 project.json 带入
 * 2) 基调输入框有 datalist 候选
 * 3) 镜头表的拆镜输入框 brief 里带出「强度 N/10｜基调 X」
 *
 * 写回链路单独验证：改值 → 点保存 → GET /api/project 看落库。
 */
import { chromium } from 'playwright-core'

const b = await chromium.launch({ headless: true, channel: 'chrome' })
const p = await b.newPage({ viewport: { width: 1600, height: 1000 } })
p.on('dialog', (d) => d.accept())
p.on('pageerror', (e) => console.log('PAGEERROR:', e.message))
await p.goto('http://localhost:5273', { waitUntil: 'networkidle' })
await p.waitForTimeout(900)

await p.locator('header').locator('button', { hasText: /^剧本/ }).first().click()
await p.waitForTimeout(900)

const knobs = await p.locator('.sb-knob').count()
const ints = await p.locator('.sb-knob-in.sb-int').evaluateAll((es) => es.map((e) => e.value))
const tones = await p.locator('.sb-knob-in.sb-tone').evaluateAll((es) => es.map((e) => e.value))
console.log(`旋钮 ${knobs} 个 | 强度值 ${JSON.stringify(ints)} | 基调值 ${JSON.stringify(tones)}`)
console.log('空值场景数:', ints.filter((v) => !v).length)
console.log('datalist:', JSON.stringify(await p.locator('#sb-tone-options option').evaluateAll((os) => os.map((o) => o.value))))

await p.screenshot({ path: '/tmp/script-knobs.png' })

await p.locator('header').locator('button', { hasText: /^镜头表/ }).first().click()
await p.waitForTimeout(1200)
const brief = await p.locator('.wb-gen textarea').first().inputValue().catch(() => '')
const lines = brief.split('\n').filter((l) => l.startsWith('场景'))
const withItn = lines.filter((l) => /｜强度\s*\d+\/10｜基调\s*\S/.test(l))
console.log(`brief 场景行 ${lines.length} 条，带强度+基调 ${withItn.length} 条`)
console.log('样例:', (withItn[0] || lines[0] || '').slice(0, 90))

await b.close()
console.log('DONE')
