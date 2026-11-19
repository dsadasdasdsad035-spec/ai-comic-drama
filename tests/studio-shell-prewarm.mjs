/**
 * 创意外壳预热裁决（creative-dsh-host）。
 *
 * 预热错一条的表现是「点开还是转圈」——没有报错、没有日志，只有体感。
 * 所以把裁决抽成纯函数并按表断言：任何一条短路被删掉，对应用例先红。
 * 跑法：`node tests/studio-shell-prewarm.mjs`
 */
import assert from 'node:assert/strict'
import { resolveStudioWarmup, shouldRetryOnReveal } from '../src/creative/keepalive.ts'

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

/** 全部条件都满足的基线：改一条就是「只差这一条」的用例 */
const BASE = {
  enabled: true,
  keepAlive: true,
  preload: true,
  mounted: false,
  active: false,
  visited: true,
  intent: false,
  saveData: false,
  effectiveType: '4g',
  deviceMemory: 8,
  hostReady: true,
  idle: true,
}

const verdict = (patch = {}) => resolveStudioWarmup({ ...BASE, ...patch })

check('全部满足时挂载', () => {
  assert.equal(verdict(), 'mount')
})

check('入口关闭不预热', () => {
  assert.equal(verdict({ enabled: false }), 'off')
})

check('常驻关闭不预热', () => {
  // 没有常驻容器，预热无处可挂；否则等于给一份不会显示的文档付 2.6MB
  assert.equal(verdict({ keepAlive: false }), 'off')
})

check('服务端关闭预热', () => {
  assert.equal(verdict({ preload: false }), 'off')
})

check('已挂载不重复预热', () => {
  assert.equal(verdict({ mounted: true }), 'off')
})

check('当前就在创意视图不预热', () => {
  // 已经在创意里，外壳本来就该由正常路径挂载
  assert.equal(verdict({ active: true }), 'off')
})

check('首访且无意图不预热', () => {
  assert.equal(verdict({ visited: false, intent: false }), 'off')
})

check('首访但有指针或焦点意图时预热', () => {
  assert.equal(verdict({ visited: false, intent: true }), 'mount')
})

check('回访无意图也预热', () => {
  assert.equal(verdict({ visited: true, intent: false }), 'mount')
})

check('省流量模式不预热', () => {
  assert.equal(verdict({ saveData: true }), 'off')
})

check('3g 不预热', () => {
  assert.equal(verdict({ effectiveType: '3g' }), 'off')
})

check('2g 与 slow-2g 不预热', () => {
  assert.equal(verdict({ effectiveType: '2g' }), 'off')
  assert.equal(verdict({ effectiveType: 'slow-2g' }), 'off')
})

check('4g 与未知连接放行', () => {
  assert.equal(verdict({ effectiveType: '4g' }), 'mount')
  // Safari/Firefox 没有 connection API：拿不到不等于链路差
  assert.equal(verdict({ effectiveType: '' }), 'mount')
})

check('低内存机型不预热', () => {
  assert.equal(verdict({ deviceMemory: 2 }), 'off')
  assert.equal(verdict({ deviceMemory: 1 }), 'off')
  // 0 表示浏览器不报（Safari 没有 deviceMemory），按允许处理
  assert.equal(verdict({ deviceMemory: 0 }), 'mount')
  assert.equal(verdict({ deviceMemory: 4 }), 'mount')
})

check('宿主未就绪只等待，不催起宿主', () => {
  assert.equal(verdict({ hostReady: false }), 'wait')
})

check('主线程不空闲只等待', () => {
  assert.equal(verdict({ idle: false }), 'wait')
})

check('宿主未就绪同时不空闲仍是等待', () => {
  assert.equal(verdict({ hostReady: false, idle: false }), 'wait')
})

check('短路顺序：关闭类判据优先于等待类判据', () => {
  // 入口关掉时即使宿主没就绪也必须 off，不能停在 wait 上继续轮询
  assert.equal(verdict({ enabled: false, hostReady: false, idle: false }), 'off')
  assert.equal(verdict({ preload: false, hostReady: false }), 'off')
  assert.equal(verdict({ visited: false, intent: false, hostReady: false }), 'off')
})

check('off 优先于 wait，wait 优先于 mount', () => {
  assert.equal(verdict({ saveData: true, hostReady: false }), 'off')
  assert.equal(verdict({ hostReady: false, idle: true }), 'wait')
  assert.equal(verdict({ hostReady: true, idle: true }), 'mount')
})

/** 揭示重试：预热的壳子在后台失败时，用户点进来才第一次看见它 */
const reveal = (patch = {}) => shouldRetryOnReveal({ wasActive: false, active: true, state: 'error', retried: false, ...patch })

check('隐藏期失败、首次揭示时补一次重启', () => {
  assert.equal(reveal(), true)
})

check('一直可见时错误页立刻给，不偷偷重启', () => {
  assert.equal(reveal({ wasActive: true }), false)
})

check('从可见变隐藏不重启', () => {
  assert.equal(reveal({ wasActive: true, active: false }), false)
})

check('加载中与已就绪都不重启', () => {
  assert.equal(reveal({ state: 'loading' }), false)
  assert.equal(reveal({ state: 'ready' }), false)
})

check('同一挂载周期内只补一次', () => {
  // 第二次揭示仍旧失败时，老实显示错误页与「重试」按钮
  assert.equal(reveal({ retried: true }), false)
})

if (bad > 0) {
  console.error(`\n❌ 创意外壳预热裁决失败 ${bad} 项`)
  process.exit(1)
}
console.log('\n✅ 创意外壳预热裁决全部通过')
