/**
 * 创意会话宿主进程托管冒烟测试。
 *
 * 验证四件事，全部是反代与创意入口的前置条件：
 * 1. 能拉起宿主并等到就绪（含引导令牌）；
 * 2. 就绪后能按上游根地址取到壳页面；
 * 3. 关闭后宿主进程真的退出（端口不再监听，不残留子进程）；
 * 4. 宿主未安装时给出可读失败，而不是崩在 spawn 上。
 *
 * 需要本机已安装宿主依赖（`@deepseek-ai/dsh`）。未安装时跳过并提示，
 * 避免在没有网络的机器上把「没装依赖」误报成「托管逻辑坏了」。
 */
import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import fs from 'node:fs'
import net from 'node:net'
import os from 'node:os'
import path from 'node:path'
import { createCreativeHost, isDshInstalled, pickLoopbackPort } from '../server/creative-host.mjs'

const ROOT = path.resolve(import.meta.dirname, '..')

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

function portIsFree(port) {
  return new Promise((resolve) => {
    const probe = net.createServer()
    probe.once('error', () => resolve(false))
    probe.listen(port, '127.0.0.1', () => probe.close(() => resolve(true)))
  })
}

const dshHome = fs.mkdtempSync(path.join(os.tmpdir(), 'dsh-smoke-'))
const logs = []
const host = createCreativeHost({
  root: ROOT,
  dshHome,
  publicUrl: 'http://127.0.0.1:5273/studio/',
  trustedHosts: ['127.0.0.1:5273'],
  readyTimeoutMs: 90_000,
  log: (line) => logs.push(line),
})

await check('分配到的回环端口可用', async () => {
  const port = await pickLoopbackPort()
  assert.ok(port > 0)
  assert.equal(await portIsFree(port), true)
})

if (!isDshInstalled(ROOT)) {
  console.log('⚠️  跳过宿主托管测试：未安装 @deepseek-ai/dsh')
} else {
  await check('宿主可启动并就绪', async () => {
    const ok = await host.start()
    assert.equal(ok, true, `启动失败：${host.status().error}\n${logs.join('\n')}`)
    const up = host.upstream()
    assert.ok(up, '就绪后应能拿到上游根地址')
    assert.match(up.origin, /^http:\/\/127\.0\.0\.1:\d+$/)
    assert.ok(up.token.length > 8, '应抓到引导令牌')
  })

  await check('上游壳页面可访问', async () => {
    const up = host.upstream()
    const res = await fetch(`${up.origin}/?token=${encodeURIComponent(up.token)}`, { redirect: 'manual' })
    assert.ok(res.status === 200 || res.status === 303, `意外状态 ${res.status}`)
  })

  await check('崩溃后自动重启并回到就绪', async () => {
    assert.equal(await host.start(), true)
    const before = host.status()
    const pids = execFileSync('lsof', ['-ti', `tcp:${before.port}`, '-sTCP:LISTEN'], { encoding: 'utf8' })
      .split('\n')
      .map((s) => s.trim())
      .filter(Boolean)
    assert.ok(pids.length > 0, `找不到监听 ${before.port} 的宿主进程`)
    for (const pid of pids) {
      try {
        process.kill(Number(pid), 'SIGKILL')
      } catch {
        /* 已经退了 */
      }
    }

    // 崩溃后状态必须离开 ready。
    // 旧实现停在 ready，于是自动重启调用的 start() 被 ready 短路直接返回 true，
    // 宿主再也回不来——而 `_host/status` 也报 ready，错误页与自动化都看不出来。
    const until = Date.now() + 10_000
    let left = false
    while (Date.now() < until) {
      if (host.status().state !== 'ready') {
        left = true
        break
      }
      await new Promise((r) => setTimeout(r, 100))
    }
    assert.ok(left, '崩溃后状态仍停在 ready，自动重启会被短路')

    // 再次 start()：若正处于重启中就是等同一 promise，不会拉起第二个进程。
    // 用竞速的定时器撑住事件循环：重启定时器是 unref 的（服务端有 http 服务保活），
    // 测试里没有别的 handle，光 await 会让进程提前退出。
    const result = await Promise.race([
      host.start(),
      new Promise((resolve) => setTimeout(() => resolve('timeout'), 30_000)),
    ])
    assert.notEqual(result, 'timeout', '等重启超时')
    assert.equal(result, true, `重启失败：${host.status().error}`)
    const after = host.status()
    assert.equal(after.state, 'ready')
    assert.ok(after.restarts >= 1, '重启计数没有保留（退避与上限会失效）')
    const up = host.upstream()
    const res = await fetch(`${up.origin}/?token=${encodeURIComponent(up.token)}`, { redirect: 'manual' })
    assert.ok(res.status === 200 || res.status === 303, `重启后壳页面不可用：${res.status}`)
  })

  await check('关闭后进程退出且端口释放', async () => {
    const port = host.status().port
    await host.stop()
    assert.equal(host.status().state, 'stopped')
    assert.equal(host.upstream(), null)
    assert.equal(await portIsFree(port), true, `端口 ${port} 仍在监听`)
  })

  await check('重复启动与停止不报错', async () => {
    assert.equal(await host.start(), true)
    assert.equal(host.status().state, 'ready')
    await host.stop()
  })
}

await check('宿主缺失时给出可读失败', async () => {
  const ghost = createCreativeHost({
    root: path.join(os.tmpdir(), 'no-such-root-for-dsh'),
    dshHome,
    log: () => {},
  })
  assert.equal(await ghost.start(), false)
  const status = ghost.status()
  assert.equal(status.state, 'failed')
  assert.match(status.error, /未安装创意会话宿主/)
})

console.log(bad ? `\n❌ ${bad} 项失败` : '\n✅ 宿主托管冒烟通过')
process.exit(bad ? 1 : 0)
