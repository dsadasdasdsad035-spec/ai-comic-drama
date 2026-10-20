import { chromium } from 'playwright-core'
import fs from 'node:fs'

const URL = 'http://127.0.0.1:5273/'
const PJ = '/Users/mjy/WorkBuddy/2026-10-19-21-40-01/manga-pipeline/projects/recycle/project.json'
const SNAP = fs.readFileSync(PJ) // 跑完还原，保证可重复且不弄脏数据
const read = () => JSON.parse(fs.readFileSync(PJ, 'utf8'))
const base = JSON.parse(SNAP.toString('utf8'))
const baseTotal = +base.shots.reduce((a, s) => a + Number(s.seconds || 0), 0).toFixed(1)
const baseSec0 = Number(base.shots[0].seconds)

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
  await page.getByRole('button', { name: '拆镜' }).click()
  await page.waitForTimeout(1600)
  const rows = await page.locator('.wb-table tbody tr').count()
  check(rows === base.shots.length, `表格 ${base.shots.length} 行`, `实际 ${rows}`)
  const foot = (await page.locator('.wb-foot').innerText()).replace(/\s+/g, ' ')
  check(foot.includes(`${base.shots.length} 镜`), '页脚镜数正确')
  check(foot.includes(`${baseTotal.toFixed(1)}s`), `总时长 ${baseTotal.toFixed(1)}s`, foot)
  check(/目标 \d+s/.test(foot), '目标时长可调')
  const firstDesc = await page
    .locator('.wb-table tbody tr').first().locator('td').nth(4).locator('textarea').inputValue()
  check(firstDesc.length > 10, '首行描述已带入')
  const dlg = await page
    .locator('.wb-table tbody tr').nth(2).locator('td').nth(5).locator('textarea').inputValue()
  check(dlg.includes('：'), '台词按「角色：台词」渲染', dlg)
  console.log(`  · 描述：${firstDesc.slice(0, 28)}…  台词：${dlg.replace(/\n/g, ' / ').slice(0, 30)}`)
  await page.screenshot({ path: '/tmp/sb-shots/70-table.png' })

  console.log('\n[2] 行内编辑 + 保存回文件')
  const target = (baseSec0 + 2).toFixed(1)
  const secInput = page.locator('.wb-table tbody tr').first().locator('td').nth(1).locator('input')
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
  const afterSave = read()
  check(Number(afterSave.shots[0].seconds) === Number(target), `文件里 seconds = ${target}`, String(afterSave.shots[0].seconds))
  check((afterSave.shots[0].handEdited || []).includes('seconds'), 'handEdited 记录 seconds')
  check(afterSave.episodes.length === base.episodes.length, 'episodes 未被清空', String(afterSave.episodes.length))
  check(afterSave.characters.length === base.characters.length, 'characters 未被清空', String(afterSave.characters.length))
  check(fs.existsSync(PJ + '.bak'), '.bak 备份已生成')

  console.log('\n[3] 生成到画布（按 shot.id 幂等）')
  await page.getByRole('button', { name: '生成到画布' }).click()
  await page.waitForTimeout(1300)
  const st = await page.evaluate(() => {
    const s = JSON.parse(localStorage.getItem('storyboard-canvas-v1') || '{}')
    const nodes = s.nodes || []
    const withId = nodes.filter((n) => n.data?.shotId)
    return {
      total: nodes.length,
      withId: withId.length,
      first3: withId.map((n) => n.data.shotId).slice(0, 3),
      sec0: nodes.find((n) => n.data?.shotId === 'E01-S01')?.data?.seconds,
      size0: nodes.find((n) => n.data?.shotId === 'E01-S01')?.data?.size,
    }
  })
  check(st.withId === base.shots.length, `${base.shots.length} 个节点带业务 ID`, JSON.stringify(st))
  check(st.first3[0] === 'E01-S01', '业务 ID 形如 E01-S01', JSON.stringify(st.first3))
  check(Number(st.sec0) === Number(target), 'S01 秒数沿用表格值', String(st.sec0))
  check(st.size0 === base.shots[0].size, 'S01 景别带入画布', String(st.size0))
  console.log(`  · 节点总数 ${st.total}（含 1 张无业务 ID 的占位卡；不自动删）`)
  await page.getByRole('button', { name: '分镜' }).click()
  await page.waitForTimeout(900)
  await page.screenshot({ path: '/tmp/sb-shots/71-pushed.png' })

  console.log('\n[4] 画布侧改动 → 自动写回 project.json')
  await page.getByRole('button', { name: '适配' }).click()
  await page.waitForTimeout(900)
  const s01NodeId = await page.evaluate(() => {
    const s = JSON.parse(localStorage.getItem('storyboard-canvas-v1') || '{}')
    return (s.nodes || []).find((n) => n.data?.shotId === 'E01-S01')?.id ?? null
  })
  check(Boolean(s01NodeId), '定位到 E01-S01 节点')
  // 适配后节点会重叠，点到别的卡上就会拿到错的 Inspector —— 点完校验镜号，不对就换位置重试
  const nodeLoc = page.locator(`.react-flow__node[data-id="${s01NodeId}"]`)
  let hit = false
  for (const pos of [undefined, { x: 10, y: 10 }, { x: 30, y: 20 }]) {
    await (pos ? nodeLoc.click({ force: true, position: pos }) : nodeLoc.click({ force: true }))
    await page.waitForTimeout(350)
    const sid = await page.locator('.panel-sid').innerText().catch(() => '')
    if (sid.trim() === 'E01-S01') {
      hit = true
      break
    }
  }
  check(hit, '选中节点业务 ID = E01-S01（不是重叠的示例卡）')
  const secBox = page.locator('.inspector input[type=number]').first()
  check((await secBox.count()) > 0, 'Inspector 打开时长输入')
  check((await secBox.inputValue()) === String(target), 'Inspector 时长与表格一致', await secBox.inputValue())
  const wb = (Number(target) + 1).toFixed(1)
  await secBox.fill(wb)
  await secBox.blur()
  await page.waitForTimeout(2600)
  const afterCb = read()
  const s01 = afterCb.shots.find((x) => x.id === 'E01-S01')
  check(Number(s01?.seconds) === Number(wb), `画布改 ${wb}s 已写回文件`, String(s01?.seconds))
  check(afterCb.shots.length === base.shots.length, '写回后镜头数不变', String(afterCb.shots.length))
  check(afterCb.episodes.length === base.episodes.length, '写回未破坏 episodes')

  console.log('\n[5] 幂等重推：不产生重复节点')
  await page.getByRole('button', { name: '拆镜' }).click()
  await page.waitForTimeout(1300)
  await page.getByRole('button', { name: '生成到画布' }).click()
  await page.waitForTimeout(1300)
  const st2 = await page.evaluate(() => {
    const s = JSON.parse(localStorage.getItem('storyboard-canvas-v1') || '{}')
    const ids = (s.nodes || []).filter((n) => n.data?.shotId).map((n) => n.data.shotId)
    return { withId: ids.length, uniq: new Set(ids).size }
  })
  check(st2.withId === base.shots.length && st2.uniq === base.shots.length, '重推后仍是唯一节点', JSON.stringify(st2))
} finally {
  console.log('\n--- 页面错误 ---')
  console.log(errs.length ? errs.slice(0, 5).join('\n') : '(none)')
  fs.writeFileSync(PJ, SNAP) // 还原，测试不留痕
  console.log('（已还原 project.json 到测试前状态）')
  console.log(`\n结果：通过 ${ok} / 失败 ${bad}`)
  await browser.close()
}
process.exit(bad === 0 ? 0 : 1)
