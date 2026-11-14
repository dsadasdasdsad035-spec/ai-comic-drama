/**
 * 项目工作区基础验收（新外壳：大厅 → 项目 → 画布）。
 *
 * 镜头表与提示词表已并入画布：项目镜头在进入画布时自动水合，
 * 编辑与写回走单镜 Inspector，不再有「生成到画布」与独立表格视图。
 */
import { chromium } from 'playwright-core'
import { openBoardEpisode, openCharacterTab } from './verify-lib.mjs'
import { auditKeyframePromptCore } from './src/promptAuditCore.mjs'

// 地址取自 SB_URL（与其它验收脚本一致），末尾保留斜杠给 fetch 拼接用
const URL = `${(process.env.SB_URL || 'http://127.0.0.1:5273').replace(/\/$/, '')}/`
// 真相源已切到 SQLite：数据断言统一走 /api/project；写回断言也一样。
// 快照用于跑完还原，保证可重复且不弄脏数据。
const PROJECT = 'recycle'
// 预置一个已知角色：角色板断言要的是「数据来自项目而非本地默认值」，
// 不能依赖 recycle 历史上恰好存在的角色（那是环境状态，不是代码行为）。
await fetch(`${URL}api/project?name=${PROJECT}`, {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({
    characters: [
      { name: '陈默', look_cn: '28 岁，寸头，旧夹克', look_en: '28-year-old man, buzz cut, worn jacket' },
    ],
  }),
})
const snapFetch = () => fetch(`${URL}api/project?name=${PROJECT}`).then((r) => r.json())
const SNAP = JSON.stringify((await snapFetch()).project)
const read = async () => (await snapFetch()).project
const base = JSON.parse(SNAP)
// 画布按集过滤了，断言要以「第 1 集」为准，不能用全项目镜头数
const ep1 = base.shots.filter((x) => (Number(x.episode) || 1) === 1)
const baseTotal = +ep1.reduce((a, s) => a + Number(s.seconds || 0), 0).toFixed(1)
const baseSec0 = Number(ep1[0].seconds)
// 与画布工作台同口径：缺首帧 / 缺锚点数量由共享纯函数算出来
const audits = ep1.map((s) => auditKeyframePromptCore(s, base.characters || []))
const expEmpty = audits.filter((a) => a.empty).length
const expMiss = audits.filter((a) => !a.empty && a.missing.length > 0).length

let ok = 0
let bad = 0
const check = (cond, label, extra = '') => {
  if (cond) {
    ok++
    console.log(`  ✓ ${label}`)
  } else {
    bad++
    console.log(`  ✗ ${label} ${extra}`)
  }
}

const browser = await chromium.launch({
  executablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  headless: true,
})
const page = await browser.newPage({ viewport: { width: 1560, height: 940 } })
const errs = []
page.on('pageerror', (e) => errs.push(e.message))
page.on('console', (m) => m.type() === 'error' && errs.push(m.text()))

/** 读当前项目画布快照（键带项目后缀） */
const canvasNodes = () =>
  page.evaluate((project) => {
    const s = JSON.parse(localStorage.getItem(`storyboard-canvas-v1:${encodeURIComponent(project)}`) || '{}')
    return s.nodes || []
  }, PROJECT)

try {
  // 预置一张远离原点的占位卡：避免镜头水合后与卡片重叠，导致点击命中错的卡
  await page.addInitScript((name) => {
    localStorage.setItem(
      `storyboard-canvas-v1:${encodeURIComponent(name)}`,
      JSON.stringify({
        nodes: [
          {
            id: 'seed-far',
            type: 'shot',
            position: { x: 0, y: 4000 },
            data: { no: 'X00', seconds: 3, size: '中景', move: '固定', dialogue: '', prompt: '', marks: [] },
          },
        ],
        edges: [],
        characters: [],
      }),
    )
  }, PROJECT)
  await openBoardEpisode(page, PROJECT, { base: URL, waitUntil: 'networkidle' })
  await page.waitForTimeout(1800)

  console.log('\n[1] 画布加载项目镜头')
  const railBoard = page.locator('.viewtabs button[aria-label="画布"]')
  check((await railBoard.getAttribute('aria-current')) === 'page', '左栏画布为当前视图')
  const detail = (await page.locator('.wb-bar-detail').innerText()).replace(/\s+/g, ' ')
  check(detail.includes(`${ep1.length} 镜`), `工作台显示 ${ep1.length} 镜`, detail)
  check(detail.includes(`${baseTotal.toFixed(1)}s`), `总时长 ${baseTotal.toFixed(1)}s`, detail)
  check(/目标 \d+s/.test(detail), '目标时长可读', detail)
  check(new RegExp(`缺首帧 ${expEmpty}`).test(detail), `缺首帧 ${expEmpty}`, detail)
  check(new RegExp(`缺锚点 ${expMiss}`).test(detail), `缺锚点 ${expMiss}`, detail)

  const st = await page.evaluate(({ project, firstId }) => {
    const s = JSON.parse(localStorage.getItem(`storyboard-canvas-v1:${encodeURIComponent(project)}`) || '{}')
    const nodes = s.nodes || []
    const withId = nodes.filter((n) => n.data?.shotId)
    const first = nodes.find((n) => n.data?.shotId === firstId)
    return {
      total: nodes.length,
      withId: withId.length,
      uniq: new Set(withId.map((n) => n.data.shotId)).size,
      first3: withId.map((n) => n.data.shotId).slice(0, 3),
      sec0: first?.data?.seconds,
      size0: first?.data?.size,
      move0: first?.data?.move,
    }
  }, { project: PROJECT, firstId: ep1[0].id })
  check(st.withId === ep1.length, `${ep1.length} 个节点带业务 ID`, JSON.stringify(st))
  check(st.uniq === ep1.length, '水合后节点不重复', JSON.stringify(st))
  check(/^E\d+-S\d+$/.test(String(st.first3[0])), '业务 ID 形如 E01-S01', JSON.stringify(st.first3))
  check(Number(st.sec0) === baseSec0, '秒数沿用项目镜头', String(st.sec0))
  check(st.size0 === ep1[0].size && st.move0 === ep1[0].move, '景别与运镜带入画布', `${st.size0}/${st.move0}`)

  // 适配视图后所有卡片可见，再断言卡片上的摘要信息
  await page.locator('.bm .tm-btn').click()
  await page.waitForTimeout(350)
  await page.locator('.bm-item', { hasText: '适配视图' }).click()
  await page.waitForTimeout(900)
  const cardCount = await page.locator('.react-flow__node .shot').count()
  check(cardCount >= ep1.length, `画布渲染 ${ep1.length} 张分镜卡`, String(cardCount))
  const firstCardMeta = await page
    .locator(`.react-flow__node[data-id] .shot-meta`)
    .first()
    .innerText()
    .catch(() => '')
  check(firstCardMeta.includes(ep1[0].size), `卡片显示景别 ${ep1[0].size}`, firstCardMeta)

  console.log('\n[2] Inspector 改时长 → 自动写回')
  // 「镜头参数」分区只挂在画面型镜头上（视频镜头的时长不在 Inspector 里改），
  // 所以逐个试选，找到第一个能打开时长输入的镜头；一个都没有就跳过这一段。
  const params = page.locator('.si-section[data-section="shotParams"]')
  const nodeIdOf = (shotId) =>
    page.evaluate(
      ({ project, id }) => {
        const s = JSON.parse(localStorage.getItem(`storyboard-canvas-v1:${encodeURIComponent(project)}`) || '{}')
        return (s.nodes || []).find((n) => n.data?.shotId === id)?.id ?? null
      },
      { project: PROJECT, id: shotId },
    )
  let edit = null
  for (const sh of ep1) {
    const nid = await nodeIdOf(sh.id)
    if (!nid) continue
    const loc = page.locator(`.react-flow__node[data-id="${nid}"]`)
    let hit = false
    for (const pos of [undefined, { x: 10, y: 10 }, { x: 30, y: 20 }]) {
      await (pos ? loc.click({ force: true, position: pos }) : loc.click({ force: true }))
      await page.waitForTimeout(320)
      const sid = await page.locator('.panel-sid').innerText().catch(() => '')
      if (sid.trim() === sh.id) {
        hit = true
        break
      }
    }
    if (!hit) continue
    if (!(await params.isVisible().catch(() => false))) continue
    check(true, `选中节点业务 ID = ${sh.id}（不是重叠的占位卡）`)
    edit = sh
    break
  }

  let wroteSeconds = null
  if (!edit) {
    console.log('⚠️ 跳过改时长：本项目镜头都不是画面型，Inspector 不暴露镜头参数')
  } else {
    // 折叠收起时子元素尺寸为 0，先展开
    const head = params.locator('.fold-head')
    if ((await head.count()) && (await params.getAttribute('data-open')) !== 'true') {
      await head.click()
      await page.waitForTimeout(300)
    }
    const secBox = params.locator('input[type=number]').first()
    check((await secBox.count()) > 0, 'Inspector 打开时长输入')
    const beforeSec = Number(await secBox.inputValue())
    check(beforeSec === Number(edit.seconds), 'Inspector 时长与项目一致', `${beforeSec} vs ${edit.seconds}`)
    const wb = (beforeSec + 1).toFixed(1)
    await secBox.fill(wb)
    await secBox.blur()
    await page.waitForTimeout(2600)
    const afterCb = await read()
    const edited = afterCb.shots.find((x) => x.id === edit.id)
    check(Number(edited?.seconds) === Number(wb), `画布改 ${wb}s 已写回`, String(edited?.seconds))
    // 拆镜表格已下线（画布是唯一编辑入口）：改时长不再走「表格手改」那条 handEdited 记录路径，
    // 这里只断言写回没有凭空造出手改痕迹。
    check(
      !(edited?.handEdited || []).includes('seconds'),
      '改时长不写入手改痕迹',
      JSON.stringify(edited?.handEdited),
    )
    check(afterCb.shots.length === base.shots.length, '写回后镜头数不变', String(afterCb.shots.length))
    check(afterCb.episodes.length === base.episodes.length, '写回未破坏 episodes')
    wroteSeconds = wb
  }
  await page.screenshot({ path: '/tmp/sb-shots/71-inspector.png' })

  console.log('\n[3] 重载后幂等水合：不产生重复节点')
  await page.reload({ waitUntil: 'networkidle' })
  await page.waitForTimeout(2400)
  const st2 = await page.evaluate(({ project, firstId }) => {
    const s = JSON.parse(localStorage.getItem(`storyboard-canvas-v1:${encodeURIComponent(project)}`) || '{}')
    const nodes = (s.nodes || []).filter((n) => n.data?.shotId)
    return {
      withId: nodes.length,
      uniq: new Set(nodes.map((n) => n.data.shotId)).size,
      sec0: nodes.find((n) => n.data?.shotId === firstId)?.data?.seconds,
    }
  }, { project: PROJECT, firstId: (edit ?? ep1[0]).id })
  check(st2.withId === ep1.length && st2.uniq === ep1.length, '重载后仍是唯一节点', JSON.stringify(st2))
  if (wroteSeconds != null) {
    check(Number(st2.sec0) === Number(wroteSeconds), '重载后沿用写回值', String(st2.sec0))
  } else {
    console.log('⚠️ 跳过「重载沿用写回值」：本段改时长被跳过')
  }

  console.log('\n[4] 角色来自 project.json（不是 localStorage 默认值）')
  await openCharacterTab(page)
  await page.waitForTimeout(1200)
  const bodyText = await page.locator('body').innerText()
  const pcNames = (base.characters || []).map((c) => c.name)
  check(pcNames.every((n) => bodyText.includes(n)), `显示项目里的 ${pcNames.length} 个角色`, pcNames.join('、'))
  // 项目里陈默 look_cn 含「28」，localStorage 默认值是「三十出头」——用它判定数据来源
  check(/28\s*岁/.test(bodyText), '角色外观取自 project.json（含 28 岁）')
  await page.screenshot({ path: '/tmp/sb-shots/73-chars.png' })
} finally {
  console.log('\n--- 页面错误 ---')
  console.log(errs.length ? errs.slice(0, 5).join('\n') : '(none)')
  // 还原，测试不留痕（真相源是 DB，走 PUT 全量写回）
  await fetch(`${URL}api/project?name=${PROJECT}`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ project: JSON.parse(SNAP) }),
  })
  console.log('（已还原项目到测试前状态）')
  console.log(`\n结果：通过 ${ok} / 失败 ${bad}`)
  await browser.close()
}
process.exit(bad === 0 ? 0 : 1)
