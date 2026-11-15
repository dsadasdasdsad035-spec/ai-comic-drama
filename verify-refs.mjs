/**
 * 角色参考图链路验证：画布上镜头的角色 token，会把角色当前图拼进 /api/seedream 的 refImages。
 *
 * 只拦截请求、用假图返回，不真实出图（不花钱）。
 * 覆盖：角色 token 水合 → Inspector「生成画面」→ refImages 含角色图 → prompt 带参考图说明。
 *
 * 相关验收分工：
 * - 素材卡连线 → 场景图进 refImages：verify-assets.mjs
 * - 手工参考 URL（视频镜「元数据」Tab）→ 视频 refImages：verify-video-asset-ref.mjs
 *
 * 会临时修改 recycle 项目的 characters / 出场名单 / 镜头类型，收尾还原。
 * 跑法：node verify-refs.mjs（需要 dev server 已起在 5273）
 */
import { chromium } from 'playwright-core'

const URL = 'http://localhost:5273'
let bad = 0
const check = (name, cond, extra = '') => {
  console.log(`${cond ? '✅' : '❌'} ${name}${extra ? ' | ' + extra : ''}`)
  if (!cond) bad++
}

const b = await chromium.launch({ headless: true, channel: 'chrome' })
const p = await b.newPage({ viewport: { width: 1600, height: 1000 } })
p.on('dialog', (d) => d.accept())
const errors = []
p.on('pageerror', (e) => errors.push(e.message))

// ---- 打开页面（先 goto，evaluate 里的 fetch 才有页面上下文） ----
await p.goto(URL, { waitUntil: 'networkidle' })
await p.waitForTimeout(800)

// ---- 准备 ----
// 角色图必须用项目里真实存在的文件：缺失的图会被参考解析器拦成
// 「三视图文件缺失」并中止出图，那样断言的就变成缺失提示了。
const media = await p.evaluate(() => fetch('http://localhost:5273/api/media?project=recycle').then((r) => r.json()))
const charImage = media.images?.[0]?.url || '/generated/picker-generated.png'

const pj = await p.evaluate(() => fetch('http://localhost:5273/api/project?name=recycle').then((r) => r.json()))
const proj = pj.project
const origChars = JSON.parse(JSON.stringify(proj.characters))
const heroName = origChars[0].name
const charsWithImg = origChars.map((c, i) => (i === 0 ? { ...c, image: charImage } : c))

// 本脚本验的是「首帧出图」拼角色图，需要一出图镜：视频镜的 Inspector 只有「生成视频」。
// fixture 里可能全是视频镜，这里临时把选中的这一镜改成出图镜（收尾还原）。
const heroShot = (proj.shots || []).find((s) => (s.episode ?? 1) === 1) || (proj.shots || [])[0]
const origShotFields = {
  prod_kind: heroShot?.prod_kind,
  clip: heroShot?.clip,
  video_meta: heroShot?.video_meta,
  refIds: heroShot?.refIds,
  cast: heroShot?.cast,
}
check('recycle 有一个可用镜', !!heroShot, heroShot?.id)

// 参考解析器只在 refIds 为空时才回落到 cast；画布「连线角色」落库的是显式 char token，
// 所以这里直接写 char-<名字>，与界面行为一致。
// 出图镜不能带成片证据：resolveProdKind 见到 clip / video_meta 会把 image 纠正回 video。
await p.evaluate(
  async ({ chars, shotId, name }) => {
    await fetch('http://localhost:5273/api/project?name=recycle', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ characters: chars }),
    })
    const j = await fetch('http://localhost:5273/api/project?name=recycle').then((r) => r.json())
    const shots = (j.project.shots || []).map((s) =>
      s.id === shotId
        ? { ...s, cast: [name], refIds: [`char-${name}`], prod_kind: 'image', clip: '', video_meta: undefined }
        : s,
    )
    await fetch('http://localhost:5273/api/project?name=recycle', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ shots }),
    })
  },
  { chars: charsWithImg, shotId: heroShot?.id, name: heroName },
)

await p.reload()
await p.waitForTimeout(1200)
// 清掉 recycle 的旧画布快照：否则水合时旧快照的镜头类型/参考连线会盖掉 project.json
await p.evaluate(() => {
  localStorage.removeItem('storyboard-canvas-v1:recycle')
  localStorage.removeItem('storyboard-canvas-v1:recycle:legacy-backup')
})
// 画布是分镜的唯一视图：进项目 → 选一集 → 分镜卡直接由 project.json 水合
await p.evaluate(() => {
  window.location.hash = '#/p/recycle/board'
})
await p.locator('.rail').waitFor({ state: 'visible', timeout: 20000 })
const epCard = p.locator('.board-ep-card').first()
await epCard.waitFor({ state: 'visible', timeout: 20000 })
await epCard.click()
await p.locator('.wb-bar-detail').waitFor({ state: 'visible', timeout: 20000 })
await p.waitForTimeout(1500)

const target = await p.evaluate((hero) => {
  const key =
    Object.keys(localStorage)
      .filter((k) => k.startsWith('storyboard-canvas-v1:'))
      .filter((k) => !k.includes('legacy-backup'))
      .pop() || ''
  const s = JSON.parse(localStorage.getItem(key) || '{}')
  const n = (s.nodes || []).find((n) => (n.data?.refIds ?? []).some((r) => r.startsWith('char-')))
  return n ? { id: n.id, refIds: n.data.refIds, shotId: n.data.shotId } : null
}, heroName)
check('角色 token 水合到画布节点', !!target, JSON.stringify(target?.refIds))

// ---- 选中节点：React Flow 的选中挂在 pointerdown 上，必须走真实鼠标按下 ----
const nodeBox = target ? await p.locator(`[data-id="${target.id}"]`).boundingBox() : null
check('目标节点在视口内', !!nodeBox, JSON.stringify(nodeBox))
if (nodeBox) {
  await p.mouse.click(nodeBox.x + Math.min(40, nodeBox.width / 2), nodeBox.y + Math.min(24, nodeBox.height / 2))
}
await p.waitForTimeout(700)
check('Inspector 已打开分镜面板', (await p.locator('.si-foot').count()) > 0)

// ---- 拦截 /api/seedream ----
const captured = []
await p.route('**/api/seedream', async (route) => {
  captured.push(JSON.parse(route.request().postData() || '{}'))
  await route.fulfill({
    contentType: 'application/json',
    body: JSON.stringify({ ok: true, urls: ['/generated/fake1.jpg'], size: '1440x2560', elapsed: 0.1 }),
  })
})

const genBtn = p.locator('.si-foot button', { hasText: /生成画面/ }).first()
check('Inspector 生成按钮存在', (await genBtn.count()) > 0)
if (await genBtn.count()) {
  await genBtn.click()
  for (let i = 0; i < 30; i++) {
    if (captured.length) break
    await p.waitForTimeout(300)
  }
}

check('拦截到出图请求', captured.length === 1, String(captured.length))
if (captured.length) {
  const body = captured[0]
  // 服务端会把角色图规整到项目媒体目录（/generated/x.jpg → /project-assets/<项目>/x.jpg），
  // 所以按文件名比对，而不是比整条路径。
  const nameOf = (u) => String(u).split('/').pop()
  check(
    'refImages 含角色图',
    (body.refImages ?? []).some((u) => nameOf(u) === nameOf(charImage)),
    JSON.stringify(body.refImages),
  )
  check(
    'prompt 带参考图说明',
    /参考图说明/.test(body.prompt || '') && String(body.prompt).includes(`角色「${heroName}」`),
    String(body.prompt || '').slice(-160),
  )
} else {
  const reason = await p.locator('.si-foot').innerText().catch(() => '')
  check('refImages 含角色图', false, reason.replace(/\n/g, ' ').slice(0, 160))
}

// 出图结果写回镜头（假图，只看是否落到当前图/候选）
await p.waitForTimeout(2000)
const wrote = await p.evaluate(async (shotId) => {
  const j = await fetch('http://localhost:5273/api/project?name=recycle').then((r) => r.json())
  const shot = (j.project.shots || []).find((s) => s.id === shotId)
  return { keyframe: shot?.keyframe ?? null, cand: shot?.candidates?.length ?? 0 }
}, target?.shotId)
check('出图结果写回镜头', wrote.keyframe === '/generated/fake1.jpg' || wrote.cand > 0, JSON.stringify(wrote))
check('无 pageerror', errors.length === 0, errors.join(' | '))

// ---- 还原 characters、参考连线与镜头类型 ----
await p.evaluate(async ({ chars, shotId, orig }) => {
  const j = await fetch('http://localhost:5273/api/project?name=recycle').then((r) => r.json())
  const shots = (j.project.shots || []).map((s) => {
    if (s.id !== shotId) return s
    const next = { ...s, cast: orig.cast ?? [], refIds: orig.refIds ?? [] }
    if (orig.prod_kind) next.prod_kind = orig.prod_kind
    if (orig.clip) next.clip = orig.clip
    else delete next.clip
    if (orig.video_meta) next.video_meta = orig.video_meta
    else delete next.video_meta
    return next
  })
  await fetch('http://localhost:5273/api/project?name=recycle', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ characters: chars, shots }),
  })
}, { chars: origChars, shotId: heroShot?.id, orig: origShotFields })

await b.close()
console.log(bad ? `\n❌ ${bad} 项失败` : '\n✅ 角色参考图链路通过')
process.exit(bad ? 1 : 0)
