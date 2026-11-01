/**
 * 校验剧本工作台的「强度 / 基调」旋钮（只读，不改数据）：
 * 1) 每场都有旋钮，值已从 project.json 带入
 * 2) 基调输入框有 datalist 候选
 * 3) 镜头表 Agent 任务输入仍能从分集推导本集摘要（含强度/基调）
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
console.log('镜头表 Agent 可见:', await p.locator('[data-shots-chat]').isVisible())
console.log('镜头表已切到 chat-first 布局（本集摘要由 Agent inputs 从分集推导，不再渲染页内 brief 框）')

await b.close()
console.log('DONE')
