/**
 * 设置页 + SQLite 存储端到端验证。
 * 会短暂写入设置（models.lite=TEST 后恢复），不动项目数据。
 * 跑法：node verify-settings-db.mjs
 */
import { chromium } from 'playwright-core'
import { openProject } from './verify-lib.mjs'

const b = await chromium.launch({ headless: true, channel: 'chrome' })
const p = await b.newPage({ viewport: { width: 1600, height: 1000 } })
p.on('dialog', (d) => d.accept())
const errors = []
p.on('pageerror', (e) => errors.push(e.message))
// 地址取自 SB_URL（与其它验收脚本一致），默认 dev 服务器
const BASE = (process.env.SB_URL || 'http://127.0.0.1:5273').replace(/\/$/, '')
await p.goto(BASE, { waitUntil: 'networkidle' })
await p.waitForTimeout(1200)

let bad = 0
const check = (name, cond, extra = '') => {
  console.log(`${cond ? '✅' : '❌'} ${name}${extra ? ' | ' + extra : ''}`)
  if (!cond) bad++
}

// ---- 1. 项目数据从 SQLite 读出（迁移正确性） ----
// 这条断言要验证「intensity/tone 能被存进库再读出来」，必须有已知数据。
// 以前依赖库里恰好存在带这两个字段的历史项目，现在回收项目是各测试自建的，
// 所以这里自己种一个专用项目，让断言始终有可验证的目标。
await p.evaluate(async () => {
  await fetch('/api/project?name=settings-db-probe&create=1', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ title: '设置库读写探针' }),
  }).catch(() => ({}))
  await fetch('/api/project?name=settings-db-probe', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      shots: [{ id: 'E01-S01', episode: 1, no: 'S01', seconds: 3, desc: '探针镜头', dialogue: [], cast: [] }],
      episodes: [
        {
          no: 1,
          title: '探针集',
          scenes: [{ no: 1, slug: '探针场', place: '室内', time: '夜', beats: '验证 intensity/tone 往返', intensity: 7, tone: '紧张' }],
        },
      ],
    }),
  })
})
const projectList = await p.evaluate(() => fetch('/api/project').then((r) => r.json()))
const target =
  projectList.projects?.find((x) => x.name === 'settings-db-probe') ||
  projectList.projects?.find((x) => x.name === 'recycle') ||
  projectList.projects?.find((x) => x.shots > 0)
check('项目列表可读', Boolean(target), JSON.stringify(projectList.projects?.slice(0, 3)))
const proj = target
  ? await p.evaluate(
      (name) => fetch(`/api/project?name=${encodeURIComponent(name)}`).then((r) => r.json()),
      target.name,
    )
  : null
const pj = proj?.project
check(
  'SQLite 读项目',
  Boolean(pj) && pj.shots?.length === target?.shots,
  `${target?.name} shots=${pj?.shots?.length} eps=${pj?.episodes?.length}`,
)
const firstScene = pj?.episodes?.[0]?.scenes?.[0]
if (firstScene) {
  check(
    'intensity/tone 在库里',
    typeof firstScene.intensity === 'number' && Boolean(firstScene.tone),
    JSON.stringify(firstScene).slice(0, 80),
  )
} else {
  console.log('⚠️ 跳过 intensity/tone：当前项目没有场次数据')
}
check('角色数组可读', Array.isArray(pj?.characters), `${pj?.characters?.length ?? 0} 个`)

// ---- 2. 设置页 UI ----
// 新外壳把「设置」收进项目工作区左栏，不再有顶部 header 入口
// 直接落到 probe 项目的设置视图（默认没有就退回列表第一个项目）
await openProject(p, target?.name, 'settings')
await p.locator('.rail-nav button[aria-label="设置"]').click()
await p.waitForTimeout(700)
check('设置页打开', (await p.locator('.settings-shell').count()) === 1 && (await p.locator('.st-nav').count()) === 1)
await p.locator('.st-nav button', { hasText: '智能与扩展' }).click()
await p.waitForTimeout(300)
await p.locator('.st-subnav button[data-settings-pane="skills"]').click()
await p.waitForTimeout(600)
// 技能页默认停在 SkillHub 市场，先切到「已安装」目录再看条目
await p.locator('.mcp-scope-switch button', { hasText: '已安装' }).click()
await p.waitForTimeout(600)
const cardCount = await p.locator('.skill-catalog-card').count()
check('技能条目存在', cardCount >= 4, `${cardCount} 个`)
await p.locator('.skill-catalog-card').first().click()
await p.locator('.skill-detail-body, .skill-detail-editor').first().waitFor({ state: 'visible', timeout: 8000 })
// 正文在第二个 Tab（SKILL.md / 编辑 / 正文），概览页没有 textarea
await p.getByRole('tab', { name: /SKILL\.md|编辑|正文/ }).first().click()
await p.locator('.skill-detail-editor').first().waitFor({ state: 'visible', timeout: 8000 })
const skillText = (
  await p.locator('.skill-detail-editor').evaluateAll((els) => els.map((el) => el.value).join('\n'))
).trim()
await p.getByRole('button', { name: '关闭' }).first().click().catch(() => {})
check('规则文本非空', skillText.length > 100 && (skillText.includes('场景要素提取') || skillText.includes('角色')), skillText.slice(0, 60))

await p.screenshot({ path: '/tmp/settings.png' })

// ---- 3. 改默认模型（渠道 + 模型表结构）→ 保存 → 落库 → 恢复 ----
const beforeSettings = await p.evaluate(() =>
  fetch('/api/settings').then((r) => r.json()).then((j) => j.settings),
)
const beforeDefaults = beforeSettings.defaults
const beforeTextModel = beforeSettings.models.find((m) => m.key === beforeDefaults.text)
await p.locator('.st-nav button', { hasText: '制作管线' }).click()
await p.waitForTimeout(300)
await p.locator('.st-subnav button[data-settings-pane="routing"]').click()
await p.waitForTimeout(300)
const textRow = p.locator('[data-routing-cap="text"]')
await textRow.locator('select').nth(0).selectOption('deepseek')
await p.waitForTimeout(200)
await textRow.locator('select').nth(1).selectOption('deepseek-chat')
await p.locator('.st-topbar button', { hasText: '保存设置' }).click()
await p.waitForTimeout(900)
const saved1 = await p.evaluate(() => fetch('/api/settings').then((r) => r.json()))
check('设置落库', saved1.settings?.defaults?.text === 'deepseek-chat', String(saved1.settings?.defaults?.text))

await textRow.locator('select').nth(0).selectOption(beforeTextModel?.provider || '')
await p.waitForTimeout(200)
await textRow.locator('select').nth(1).selectOption(beforeDefaults.text)
await p.locator('.st-topbar button', { hasText: '保存设置' }).click()
await p.waitForTimeout(900)
const saved2 = await p.evaluate(() => fetch('/api/settings').then((r) => r.json()))
check('默认模型可恢复', saved2.settings?.defaults?.text === beforeDefaults.text, String(saved2.settings?.defaults?.text))

// ---- 4. 写路径：POST 合并不丢数据 ----
if (target) {
  const before = await p.evaluate(
    (name) => fetch(`/api/project?name=${encodeURIComponent(name)}`).then((r) => r.json()),
    target.name,
  )
  const oldLogline = before.project.logline || ''
  await p.evaluate(
    async (name) => {
      await fetch(`/api/project?name=${encodeURIComponent(name)}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ logline: '一句话：废土回收人寻找妹妹' }),
      })
    },
    target.name,
  )
  const after = await p.evaluate(
    (name) => fetch(`/api/project?name=${encodeURIComponent(name)}`).then((r) => r.json()),
    target.name,
  )
  check(
    'POST 合并：logline 更新且不丢 shots',
    after.project.logline.includes('废土回收人') && after.project.shots.length === target.shots,
  )
  check('POST 未传 characters 不清空', after.project.characters.length === before.project.characters.length)
  await p.evaluate(
    async ({ name, logline }) => {
      await fetch(`/api/project?name=${encodeURIComponent(name)}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ logline }),
      })
    },
    { name: target.name, logline: oldLogline },
  )
} else {
  console.log('⚠️ 跳过项目写路径：没有可选项目')
}

// ---- 5. 旧设置夹具：缺 caps 渠道 / 单能力模型 / 已保存默认 ----
const liveSettings = await p.evaluate(() => fetch('/api/settings').then((r) => r.json()).then((j) => j.settings))
try {
  await p.evaluate(async () => {
    await fetch('/api/settings', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        providers: [
          { id: 'legacy-openai', label: 'Legacy', kind: 'openai', baseUrl: 'https://mock', apiKey: 'x' },
        ],
        models: [
          { key: 'legacy-text', label: 'Legacy Text', cap: 'text', provider: 'legacy-openai', model: 'm-text' },
          { key: 'legacy-image', label: 'Legacy Image', cap: 'image', provider: 'legacy-openai', model: 'm-image' },
        ],
        defaults: { text: 'legacy-text', image: 'legacy-image' },
      }),
    })
  })
  const legacy = await p.evaluate(() => fetch('/api/settings').then((r) => r.json()).then((j) => j.settings))
  const legacyProvider = legacy.providers.find((x) => x.id === 'legacy-openai')
  const legacyText = legacy.models.find((x) => x.key === 'legacy-text')
  check('旧渠道缺 caps 自动推断', Boolean(legacyProvider?.caps?.includes('text') && legacyProvider?.caps?.includes('image')), JSON.stringify(legacyProvider?.caps))
  check('旧单能力模型保留', legacyText?.cap === 'text' && !legacyText?.caps, JSON.stringify(legacyText))
  check(
    '旧默认不被 APIMart 覆盖',
    legacy.defaults?.text === 'legacy-text' && legacy.defaults?.image === 'legacy-image',
    JSON.stringify(legacy.defaults),
  )
} finally {
  await p.evaluate(async (s) => {
    await fetch('/api/settings', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        providers: s.providers,
        models: s.models,
        defaults: s.defaults,
        stageModels: s.stageModels,
        pricing: s.pricing,
        agentLimits: s.agentLimits,
        agentToolProtocol: s.agentToolProtocol,
        apiKey: s.apiKey,
        rules: s.rules,
      }),
    })
  }, liveSettings)
}

// ---- 6. 页面无报错 ----
check('无 pageerror', errors.length === 0, errors.join('; ').slice(0, 120))

await b.close()
console.log(bad ? `\n❌ ${bad} 项失败` : '\n✅ 全部通过')
process.exit(bad ? 1 : 0)
