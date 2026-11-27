/**
 * 知识库选择器插件验收（零成本，不动真实宿主）。
 *
 * 验三件事 —— 都是「插件挂不上会静默坏掉」的地方：
 * 1. **客户端契约**：`client.js` 按 `window.__ModuleLoader__.load` 格式登记、
 *    `factory` 只 require 平台 seed 词、导出 `apply` / `inject`；
 * 2. **插槽注册**：`apply(ctx)` 往 `conversation.session.header.actions` 注册，
 *    插槽服务缺失或注册抛错时只 warn、不抛（宿主仍要能起来）；
 * 3. **bundle 装载**：`installCreativeToolsBundle` 把四件套复制进 profile 并登记
 *    `dsh.profile.bundles`，重复调用幂等。
 *
 * 跑法：node verify-knowledge-ui-plugin.mjs
 */
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)))
const SOURCE = path.join(ROOT, 'server', 'dsh-plugins', 'knowledge-ui')

let bad = 0
async function check(name, fn) {
  try {
    await fn()
    console.log(`✅ ${name}`)
  } catch (e) {
    bad += 1
    console.error(`❌ ${name}\n   ${e?.message || e}`)
  }
}

/** 把 client.js 在受控沙箱里跑一遍，返回登记的 bundle 与工厂产物 */
function loadClientBundle() {
  const src = fs.readFileSync(path.join(SOURCE, 'client.js'), 'utf8')
  const queue = []
  const sandboxWindow = { __ModuleLoader__: { load: (reg) => queue.push(reg) } }
  // document 未定义 → 跳过 <style> 注入分支（浏览器里才需要）
  const run = new Function('window', 'fetch', 'document', src)
  run(sandboxWindow, async () => ({ ok: false, status: 0, json: async () => null }), undefined)
  return queue
}

function materialize(reg, seed) {
  return reg.factory((spec) => {
    if (seed[spec]) return seed[spec]
    throw new Error(`未预期的 require(${JSON.stringify(spec)})：只允许平台 seed 词`)
  })
}

/** 极简 React 替身：只要组件能被调用一次、拿到 props 就行 */
function fakeReact(calls) {
  const createElement = (type, props, ...children) => ({ type, props, children })
  return {
    createElement,
    useState: (init) => {
      const v = typeof init === 'function' ? init() : init
      return [v, () => {}]
    },
    useEffect: () => {},
    useCallback: (fn) => fn,
    Fragment: 'Fragment',
    __calls: calls,
  }
}

// ---------------------------------------------------------------- 客户端契约

await check('client.js 按 __ModuleLoader__.load 格式登记，id 正确', () => {
  const queue = loadClientBundle()
  assert.equal(queue.length, 1, `应登记 1 个 bundle，实际 ${queue.length}`)
  assert.equal(queue[0].id, 'dsh-plugin-knowledge-ui')
  assert.equal(typeof queue[0].factory, 'function')
})

await check('factory 只 require 平台 seed 词（react）', () => {
  const queue = loadClientBundle()
  const react = fakeReact()
  assert.doesNotThrow(() => materialize(queue[0], { react }))
})

await check('导出 apply / inject，inject 含 slots', () => {
  const mod = materialize(loadClientBundle()[0], { react: fakeReact() })
  assert.equal(typeof mod.apply, 'function')
  assert.ok(Array.isArray(mod.inject) && mod.inject.includes('slots'), JSON.stringify(mod.inject))
})

await check('package.json 声明 dsh.client 与 exports["./client"]，缺一项宿主就不加载浏览器半边', () => {
  const pkg = JSON.parse(fs.readFileSync(path.join(SOURCE, 'package.json'), 'utf8'))
  assert.equal(typeof pkg.exports?.['./client'], 'string', '必须有 exports["./client"]')
  assert.equal(pkg.dsh?.client?.platform, 'web', 'dsh.client.platform 必须是 web')
  assert.ok(fs.existsSync(path.join(SOURCE, pkg.exports['./client'])), '声明的 client 文件必须存在')
  assert.equal(pkg.dsh?.bundle?.patch, './cordis.patch.yml', '本地 bundle 需要 patch 层才能新增插件行')
})

await check('cordis.patch.yml 用 insert 挂一行 knowledge-ui', () => {
  const yml = fs.readFileSync(path.join(SOURCE, 'cordis.patch.yml'), 'utf8')
  assert.match(yml, /-\s*insert:/)
  assert.match(yml, /id:\s*knowledge-ui/)
  assert.match(yml, /name:\s*dsh-plugin-knowledge-ui/)
})

// ---------------------------------------------------------------- 插槽注册

/** 假插槽服务：inject 立刻执行回调，register 记录注册项 */
function fakeSlots(registered, shouldThrow = () => false) {
  return {
    inject: (name, cb) => {
      if (shouldThrow(name)) throw new Error(`slot ${name} gone`)
      cb()
      return () => {}
    },
    register: (spec, comp) => {
      registered.push({ spec, comp })
      return () => {}
    },
  }
}

await check('注册到头部动作区与 hero 选项区（空白会话也要能看到）', () => {
  const mod = materialize(loadClientBundle()[0], { react: fakeReact() })
  const registered = []
  const ctx = { slots: fakeSlots(registered), logger: { warn: () => {} } }
  mod.apply(ctx)
  const names = registered.map((r) => r.spec.name).sort()
  /*
   * 两个插槽都要有：`session.blank` 时头部动作区整块不渲染（上游传
   * hideChrome: true），只挂头部的话新会话里看不到选择器。
   */
  assert.deepEqual(names, ['conversation.hero.options', 'conversation.session.header.actions'])
  for (const r of registered) {
    assert.ok(Number.isFinite(r.spec.order), '需要显式 order')
    assert.equal(typeof r.comp, 'function')
  }
})

await check('插槽服务缺失时只 warn，不抛（宿主仍能启动）', () => {
  const mod = materialize(loadClientBundle()[0], { react: fakeReact() })
  const warns = []
  assert.doesNotThrow(() => mod.apply({ logger: { warn: (m) => warns.push(m) } }))
  assert.ok(warns.length > 0 && /slots/.test(warns[0]), JSON.stringify(warns))
})

await check('插槽不存在时也只 warn（上游改名不弄挂宿主）', () => {
  const mod = materialize(loadClientBundle()[0], { react: fakeReact() })
  const warns = []
  const ctx = { slots: fakeSlots([], () => true), logger: { warn: (m) => warns.push(m) } }
  assert.doesNotThrow(() => mod.apply(ctx))
  assert.ok(warns.some((m) => /注册插槽/.test(m)), JSON.stringify(warns))
  assert.ok(warns.some((m) => /降级/.test(m)), '两个都失败时要明说降级')
})

await check('一个插槽不存在不影响另一个（部分降级）', () => {
  const mod = materialize(loadClientBundle()[0], { react: fakeReact() })
  const registered = []
  const ctx = {
    slots: fakeSlots(registered, (name) => name === 'conversation.hero.options'),
    logger: { warn: () => {} },
  }
  assert.doesNotThrow(() => mod.apply(ctx))
  assert.deepEqual(
    registered.map((r) => r.spec.name),
    ['conversation.session.header.actions'],
  )
})

await check('没有 sessionId 时组件不渲染（不往头部塞死控件）', () => {
  const mod = materialize(loadClientBundle()[0], { react: fakeReact() })
  const out = mod.KnowledgePicker({ sessionId: '' })
  assert.equal(out, null)
})

// ---------------------------------------------------------------- bundle 装载

await check('installCreativeToolsBundle 复制四件套并登记 bundles（幂等）', async () => {
  const { installCreativeToolsBundle } = await import(
    new URL('./server/dsh-bundle.mjs', import.meta.url).href
  )
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'kb-ui-home-'))
  try {
    installCreativeToolsBundle({ dshHome: home, root: ROOT, log: () => {} })
    const dest = path.join(home, 'profiles', 'web', 'node_modules', 'dsh-plugin-knowledge-ui')
    for (const file of ['index.js', 'client.js', 'package.json', 'cordis.patch.yml']) {
      assert.ok(fs.existsSync(path.join(dest, file)), `profile 缺 ${file}`)
    }
    const manifest = JSON.parse(
      fs.readFileSync(path.join(home, 'profiles', 'web', 'package.json'), 'utf8'),
    )
    assert.ok(
      manifest.dsh?.profile?.bundles?.includes('dsh-plugin-knowledge-ui'),
      '应在 dsh.profile.bundles 里',
    )
    assert.ok(
      manifest.dependencies?.['dsh-plugin-knowledge-ui']?.startsWith('file:'),
      '应登记 file: 依赖',
    )
    // 基础层不能被挤掉：挤掉就表现为插件永远 waiting for service: tools
    assert.ok(manifest.dsh.profile.bundles.includes('@deepseek-ai/dsh-base'))
    assert.ok(manifest.dsh.profile.bundles.includes('@deepseek-ai/dsh-web-app'))

    const again = installCreativeToolsBundle({ dshHome: home, root: ROOT, log: () => {} })
    assert.equal(again.installed, false, '第二次调用应无变化')
    const after = fs.readFileSync(path.join(dest, 'client.js'), 'utf8')
    assert.equal(after, fs.readFileSync(path.join(SOURCE, 'client.js'), 'utf8'), '内容应一致')
  } finally {
    fs.rmSync(home, { recursive: true, force: true })
  }
})

console.log(bad ? `\n${bad} 项失败` : '\n知识库选择器插件验收全部通过')
process.exit(bad ? 1 : 0)
