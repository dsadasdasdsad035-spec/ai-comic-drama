/**
 * 创意视图常驻契约（creative-layout）。
 *
 * 「切回来要重新加载几秒」这个问题在代码里没有报错、也没有日志，
 * 只有一份被销毁重建的 iframe——所以用一个纯函数把挂载决策钉住。
 * 跑法：`node tests/studio-view-keepalive.mjs`
 */
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { resolveStudioMount } from '../src/creative/keepalive.ts'

let bad = 0
function check(name, fn) {
  try {
    fn()
    console.log(`✅ ${name}`)
  } catch (e) {
    bad += 1
    console.error(`❌ ${name}\n   ${(e && e.message) || e}`)
  }
}

check('首次进入前不挂载', () => {
  // 应用启动就停在别的视图：不能加载宿主前端，否则和首屏抢带宽
  const plan = resolveStudioMount({ enabled: true, keepAlive: true, mounted: false, active: false })
  assert.equal(plan.mode, 'none')
  assert.equal(plan.visible, false)

  // 即使当前就是创意视图，也只在首次渲染后由 mounted 置位，
  // 但要保证进入的那一帧立刻挂载（App 里初值直接取 view === 'creative'）
  const entering = resolveStudioMount({ enabled: true, keepAlive: true, mounted: true, active: true })
  assert.equal(entering.mode, 'keepalive')
  assert.equal(entering.visible, true)
})

check('进入后常驻，切走不卸载', () => {
  const leaving = resolveStudioMount({ enabled: true, keepAlive: true, mounted: true, active: false })
  assert.equal(leaving.mode, 'keepalive', '切走时必须保留常驻容器，不能回到 none')
  assert.equal(leaving.visible, false, '切走后容器应隐藏而不是渲染')

  const back = resolveStudioMount({ enabled: true, keepAlive: true, mounted: true, active: true })
  assert.equal(back.mode, 'keepalive')
  assert.equal(back.visible, true)
})

check('开关置位退回条件渲染', () => {
  const active = resolveStudioMount({ enabled: true, keepAlive: false, mounted: true, active: true })
  assert.equal(active.mode, 'inline', '关闭常驻时应回到原来的条件渲染')
  assert.equal(active.visible, false)

  const inactive = resolveStudioMount({ enabled: true, keepAlive: false, mounted: true, active: false })
  assert.equal(inactive.mode, 'none', '关闭常驻后离开创意视图必须卸载')
})

check('入口关闭时不渲染任何宿主前端', () => {
  for (const mounted of [false, true]) {
    for (const active of [false, true]) {
      const plan = resolveStudioMount({ enabled: false, keepAlive: true, mounted, active })
      assert.equal(plan.mode, 'none', `入口关闭时不应挂载（mounted=${mounted}, active=${active}）`)
    }
  }
})

check('进入过一次后关闭常驻仍会卸载（语义一致）', () => {
  const plan = resolveStudioMount({ enabled: true, keepAlive: false, mounted: true, active: false })
  assert.equal(plan.mode, 'none')
})

/**
 * CSS 文本契约：隐藏态必须保留布局。
 *
 * 这条只能查样式表文本——`display: none` 与 `visibility: hidden` 在纯函数里没有区别，
 * 但前者让 iframe 视口变 0×0、宿主一行会话都渲染不出来（揭示时要补 45ms 布局）。
 * 用正则钉住三条：隐藏态不是 `display: none`、隐蔽但仍占位、激活态翻回可见。
 */
check('常驻容器的隐藏态保留布局，不用 display: none', () => {
  const css = readFileSync(new URL('../src/theme.css', import.meta.url), 'utf8')
  const rule = (selector) => {
    const i = css.indexOf(`${selector} {`)
    assert.ok(i >= 0, `theme.css 缺少 ${selector} 规则`)
    const end = css.indexOf('}', i)
    return css.slice(i, end)
  }

  const hidden = rule('.view-keepalive')
  assert.ok(!/display\s*:\s*none/.test(hidden), '隐藏态不能是 display: none：iframe 视口会变 0×0')
  assert.ok(/position\s*:\s*absolute/.test(hidden), '隐藏态应绝对定位铺满内容区')
  assert.ok(/inset\s*:\s*0/.test(hidden), '隐藏态应铺满内容区，让隐藏期视口等于揭示后视口')
  assert.ok(/visibility\s*:\s*hidden/.test(hidden), '隐藏态应只关绘制，不能卸载布局')
  assert.ok(/pointer-events\s*:\s*none/.test(hidden), '隐藏态不应接收指针事件')

  const active = rule(".view-keepalive[data-active='true']")
  assert.ok(/position\s*:\s*relative/.test(active), '激活态应回到文档流')
  assert.ok(/visibility\s*:\s*visible/.test(active), '激活态应恢复可见')
  assert.ok(/pointer-events\s*:\s*auto/.test(active), '激活态应恢复指针事件')
})

if (bad > 0) {
  console.error(`\n❌ 创意视图常驻契约失败 ${bad} 项`)
  process.exit(1)
}
console.log('\n✅ 创意视图常驻契约全部通过')
