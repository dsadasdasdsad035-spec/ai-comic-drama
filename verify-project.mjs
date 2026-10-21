import { chromium } from 'playwright-core'

// 「适配视图」收在画布右上「操作」下拉里：先开菜单，点完菜单自动收起
async function p_openBoardMenu(page) {
  await page.locator('.bm .tm-btn').click()
  await page.waitForTimeout(350)
}
import fs from 'node:fs'

const URL = 'http://127.0.0.1:5273/'
// 真相源已切到 SQLite：数据断言统一走 /api/project；写回断言也一样。
// 快照用于跑完还原，保证可重复且不弄脏数据。
const PROJECT = 'recycle'
const snapFetch = () => fetch(`${URL}api/project?name=${PROJECT}`).then((r) => r.json())
const SNAP = JSON.stringify((await snapFetch()).project)
const read = async () => (await snapFetch()).project
const base = JSON.parse(SNAP)
// 表格/画布都按集过滤了，断言要以「第 1 集」为准，不能用全项目镜头数
const ep1 = base.shots.filter((x) => (Number(x.episode) || 1) === 1)
const baseTotal = +ep1.reduce((a, s) => a + Number(s.seconds || 0), 0).toFixed(1)
const baseSec0 = Number(ep1[0].seconds)

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

try {
  // 预置一张远离原点的占位卡：避免初始示例卡与推送出来的节点重叠，导致点击命中错的卡
  await page.addInitScript(() => {
    localStorage.setItem(
      'storyboard-canvas-v1',
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
  })
  await page.goto(URL, { waitUntil: 'networkidle' })
  await page.waitForTimeout(800)

  console.log('\n[1] 拆镜工作台加载')
  await page.getByRole('button', { name: '镜头表', exact: true }).click()
  await page.waitForTimeout(1600)
  const rows = await page.locator('.wb-table tbody tr').count()
  check(rows === ep1.length, `表格 ${ep1.length} 行`, `实际 ${rows}`)
  const foot = (await page.locator('.wb-foot').innerText()).replace(/\s+/g, ' ')
  check(foot.includes(`${ep1.length} 镜`), '页脚镜数正确')
  check(foot.includes(`${baseTotal.toFixed(1)}s`), `总时长 ${baseTotal.toFixed(1)}s`, foot)
  check(/目标 \d+s/.test(foot), '目标时长可调')
  const firstDesc = await page
    .locator('.wb-table tbody tr').first().locator('td').nth(4).locator('textarea').inputValue()
  check(firstDesc.length > 10, '首行描述已带入')
  // 镜头在文件里的顺序会随写回变化，不能按固定行号取；找第一条真带台词的
  const dlg = await page.evaluate(() => {
    for (const tr of document.querySelectorAll('.wb-table tbody tr')) {
      const ta = tr.querySelectorAll('td')[5]?.querySelector('textarea')
      const v = ta?.value?.trim()
      if (v) return v
    }
    return ''
  })
  check(dlg.includes('：'), '台词按「角色：台词」渲染', dlg.slice(0, 40))
  console.log(`  · 描述：${firstDesc.slice(0, 28)}…  台词：${dlg.replace(/\n/g, ' / ').slice(0, 30)}`)
  await page.screenshot({ path: '/tmp/sb-shots/70-table.png' })

  console.log('\n[2] 行内编辑 + 保存回文件')
  const row0 = page.locator('.wb-table tbody tr').first()
  const rowNo = (await row0.locator('td').first().locator('input').inputValue()).trim()
  const editId = `E01-${rowNo}`
  const rowSec = Number(await row0.locator('td').nth(1).locator('input').inputValue())
  const target = (rowSec + 2).toFixed(1)
  console.log(`  · 本次编辑镜头: ${editId}  ${rowSec}s → ${target}s`)
  const secInput = row0.locator('td').nth(1).locator('input')
  await secInput.fill(target)
  await secInput.blur()
  await page.waitForTimeout(250)
  check(await secInput.evaluate((el) => el.classList.contains('hand')), '改动字段标黄（手改标记）')
  check(
    /手改字段受保护/.test((await page.locator('.wb-foot').innerText()).replace(/\s+/g, ' ')),
    '页脚提示受保护字段',
  )
  await page.getByRole('button', { name: '保存到 project.json' }).click()
  await page.waitForTimeout(1800)
  const afterSave = await read()
  const savedEdit = afterSave.shots.find((x) => x.id === editId)
  check(Number(savedEdit?.seconds) === Number(target), `文件里 ${editId} seconds = ${target}`, String(savedEdit?.seconds))
  check((savedEdit?.handEdited || []).includes('seconds'), 'handEdited 记录 seconds')
  check(afterSave.episodes.length === base.episodes.length, 'episodes 未被清空', String(afterSave.episodes.length))
  check(afterSave.characters.length === base.characters.length, 'characters 未被清空', String(afterSave.characters.length))
  // 旧版这里检查 project.json.bak；真相源切 SQLite 后写路径由 WAL 保护，不再生成 .bak

  console.log('\n[3] 生成到画布（按 shot.id 幂等）')
  await page.getByRole('button', { name: '生成到画布' }).click()
  await page.waitForTimeout(1300)
  // editId 在浏览器上下文里不存在，必须作为参数传进去
  const st = await page.evaluate((id) => {
    const s = JSON.parse(localStorage.getItem('storyboard-canvas-v1') || '{}')
    const nodes = s.nodes || []
    const withId = nodes.filter((n) => n.data?.shotId)
    return {
      total: nodes.length,
      withId: withId.length,
      first3: withId.map((n) => n.data.shotId).slice(0, 3),
      sec0: nodes.find((n) => n.data?.shotId === id)?.data?.seconds,
      size0: nodes.find((n) => n.data?.shotId === id)?.data?.size,
    }
  }, editId)
  check(st.withId === ep1.length, `${ep1.length} 个节点带业务 ID`, JSON.stringify(st))
  check(/^E\d+-S\d+$/.test(String(st.first3[0])), '业务 ID 形如 E01-S01', JSON.stringify(st.first3))
  check(Number(st.sec0) === Number(target), `${editId} 秒数沿用表格值`, String(st.sec0))
  check(st.size0 === ep1[0].size, 'S01 景别带入画布', String(st.size0))
  console.log(`  · 节点总数 ${st.total}（含 1 张无业务 ID 的占位卡；不自动删）`)
  await page.getByRole('button', { name: '画布', exact: true }).click()
  await page.waitForTimeout(900)
  await page.screenshot({ path: '/tmp/sb-shots/71-pushed.png' })

  console.log('\n[4] 画布侧改动 → 自动写回 project.json')
  await p_openBoardMenu(page)
  await page.getByRole('button', { name: /适配视图/ }).click()
  await page.waitForTimeout(900)
  await page.evaluate((v) => { window.__editId = v }, editId)
  const s01NodeId = await page.evaluate(() => {
    const s = JSON.parse(localStorage.getItem('storyboard-canvas-v1') || '{}')
    return (s.nodes || []).find((n) => n.data?.shotId === window.__editId)?.id ?? null
  })
  check(Boolean(s01NodeId), `定位到 ${editId} 节点`)
  // 适配后节点会重叠，点到别的卡上就会拿到错的 Inspector —— 点完校验镜号，不对就换位置重试
  const nodeLoc = page.locator(`.react-flow__node[data-id="${s01NodeId}"]`)
  let hit = false
  for (const pos of [undefined, { x: 10, y: 10 }, { x: 30, y: 20 }]) {
    await (pos ? nodeLoc.click({ force: true, position: pos }) : nodeLoc.click({ force: true }))
    await page.waitForTimeout(350)
    const sid = await page.locator('.panel-sid').innerText().catch(() => '')
    if (sid.trim() === editId) {
      hit = true
      break
    }
  }
  check(hit, `选中节点业务 ID = ${editId}（不是重叠的示例卡）`)
  const secBox = page.locator('.inspector input[type=number]').first()
  check((await secBox.count()) > 0, 'Inspector 打开时长输入')
  check((await secBox.inputValue()) === String(target), 'Inspector 时长与表格一致', await secBox.inputValue())
  const wb = (Number(target) + 1).toFixed(1)
  await secBox.fill(wb)
  await secBox.blur()
  await page.waitForTimeout(2600)
  const afterCb = await read()
  const s01 = afterCb.shots.find((x) => x.id === editId)
  check(Number(s01?.seconds) === Number(wb), `画布改 ${wb}s 已写回文件`, String(s01?.seconds))
  check(afterCb.shots.length === base.shots.length, '写回后镜头数不变', String(afterCb.shots.length))
  check(afterCb.episodes.length === base.episodes.length, '写回未破坏 episodes')

  console.log('\n[5] 幂等重推：不产生重复节点')
  await page.getByRole('button', { name: '镜头表', exact: true }).click()
  await page.waitForTimeout(1300)
  await page.getByRole('button', { name: '生成到画布' }).click()
  await page.waitForTimeout(1300)
  const st2 = await page.evaluate(() => {
    const s = JSON.parse(localStorage.getItem('storyboard-canvas-v1') || '{}')
    const ids = (s.nodes || []).filter((n) => n.data?.shotId).map((n) => n.data.shotId)
    return { withId: ids.length, uniq: new Set(ids).size }
  })
  check(st2.withId === ep1.length && st2.uniq === ep1.length, '重推后仍是唯一节点', JSON.stringify(st2))
  console.log('\n[6] 提示词工作台 + 锚点校验')
  await page.getByRole('button', { name: '提示词', exact: true }).click()
  await page.waitForTimeout(1600)
  const prow = await page.locator('.pt-table tbody tr').count()
  check(prow === ep1.length, `提示词表 ${ep1.length} 行`, `实际 ${prow}`)
  const badCount = await page.locator('.pt-table .tag.bad').count()
  check(badCount === 0, '无「缺锚点」行（有台词的角色都嵌了锚点）', String(badCount))
  const unkCount = await page.locator('.pt-table .tag.unknown').count()
  console.log(`  · 「未知角色」行 ${unkCount}（说话人不在角色表里，长相不会被锚定）`)
  const okCount = await page.locator('.pt-table .tag.ok').count()
  check(okCount > 0, '有校验通过的镜头', String(okCount))
  const kf1 = await page.locator('.pt-table tbody tr').first().locator('td').nth(2).locator('textarea').inputValue()
  check(kf1.length > 40, '首帧提示词已带入', String(kf1.length))
  check(kf1.includes('画风锁'), '提示词含画风锁')
  const cast1 = await page.locator('.pt-table tbody tr').nth(1).locator('.wb-cast').innerText()
  check(cast1.trim().length > 0 && cast1.trim() !== '—', '出场角色列有值', cast1)
  await page.screenshot({ path: '/tmp/sb-shots/72-prompts.png' })

  console.log('\n[7] 角色来自 project.json（不是 localStorage 默认值）')
  await page.getByRole('button', { name: '角色', exact: true }).click()
  await page.waitForTimeout(1200)
  const bodyText = await page.locator('body').innerText()
  const pcNames = (base.characters || []).map((c) => c.name)
  check(pcNames.every((n) => bodyText.includes(n)), `显示项目里的 ${pcNames.length} 个角色`, pcNames.join('、'))
  // 项目里陈默 look_cn 含「28」，localStorage 默认值是「三十出头」——用它判定数据来源
  const fromProject = /28\s*岁/.test(bodyText)
  check(fromProject, '角色外观取自 project.json（含 28 岁）', fromProject ? '' : '仍是 localStorage 默认值')
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
  console.log('（已还原 project.json 到测试前状态）')
  console.log(`\n结果：通过 ${ok} / 失败 ${bad}`)
  await browser.close()
}
process.exit(bad === 0 ? 0 : 1)
