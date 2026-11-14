/**
 * verify-state-root.mjs — 运行期状态根与 appRoot 的隔离
 *
 * 为什么需要这个断言：
 * 桌面端打包后 appRoot 落在只读的 Resources/ 里。只要还有一处运行期写入
 * 忘了走状态根，打包版就会在那一处失败，而单测按目录逐个断言很容易漏。
 * 所以这里用「目录快照对比」：整轮跑完后，仓库根不应该多出任何隐藏目录。
 *
 * 跑法：node verify-state-root.mjs
 */
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { spawn } from 'node:child_process'

const ROOT = process.cwd()
const results = []
function check(name, fn) {
  try {
    fn()
    results.push({ name, ok: true })
  } catch (e) {
    results.push({ name, ok: false, message: e.message })
  }
}

/** 仓库根的直接子目录（只看目录，跳过 node_modules 之类的体积噪音） */
function topDirs(dir) {
  try {
    return new Set(
      fs
        .readdirSync(dir, { withFileTypes: true })
        .filter((d) => d.isDirectory())
        .map((d) => d.name),
    )
  } catch {
    return new Set()
  }
}

/** 拉起一个独立服务实例，返回 { port, stop } */
function startServer(env) {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, ['server/index.mjs'], {
      cwd: ROOT,
      env: { ...process.env, ...env, SB_PORT: '0' },
      stdio: ['ignore', 'pipe', 'pipe'],
    })
    let out = ''
    let err = ''
    const timer = setTimeout(() => {
      child.kill('SIGKILL')
      reject(new Error(`启动超时：${err.slice(-500)}`))
    }, 30_000)

    child.stderr.on('data', (b) => {
      err += b.toString()
    })
    child.stdout.on('data', (b) => {
      out += b.toString()
      const m = out.match(/\[server\] listening http:\/\/([^:]+):(\d+)/)
      if (!m) return
      clearTimeout(timer)
      resolve({
        port: Number(m[2]),
        stop: () =>
          new Promise((done) => {
            if (child.exitCode !== null) return done()
            child.once('exit', () => done())
            child.kill('SIGTERM')
            setTimeout(() => child.kill('SIGKILL'), 6000).unref()
          }),
      })
    })
    child.once('error', (e) => {
      clearTimeout(timer)
      reject(e)
    })
    child.once('exit', (code) => {
      if (code !== null && code !== 0) {
        clearTimeout(timer)
        reject(new Error(`服务进程提前退出（${code}）：${err.slice(-500)}`))
      }
    })
  })
}

// ---------------------------------------------------------------- 主流程

const stateRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'sb-state-root-'))
const projectsRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'sb-projects-'))
const before = topDirs(ROOT)

let server = null
try {
  server = await startServer({
    SB_STATE_ROOT: stateRoot,
    SB_PROJECTS_DIR: projectsRoot,
  })
  const base = `http://127.0.0.1:${server.port}`

  // 草稿：会写 .scene-drafts/<project>/<shot>
  const draftRes = await fetch(`${base}/api/scene-draft/begin`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ project: 'state-probe', shotId: 'E01-S01' }),
  })
  const draftJson = await draftRes.json()

  // agent job：会写 .agent-jobs/<uuid>
  const agentRes = await fetch(`${base}/api/agent/ensure`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ project: 'state-probe', shotId: 'E01-S01' }),
  })
  const agentJson = await agentRes.json()

  check('草稿接口成功', () => {
    assert.equal(draftJson.ok, true, JSON.stringify(draftJson))
    assert.ok(draftJson.draft?.id, '应返回草稿 id')
  })

  check('agent job 接口成功', () => {
    assert.equal(agentJson?.ok, true, JSON.stringify(agentJson))
    assert.ok(agentJson?.jobId, '应返回 jobId')
  })

  check('草稿落在状态根内', () => {
    const dir = path.join(stateRoot, '.scene-drafts')
    assert.ok(fs.existsSync(dir), `缺少 ${dir}`)
    assert.ok(fs.readdirSync(dir).includes('state-probe'), '应有 state-probe 草稿目录')
  })

  check('agent job 落在状态根内', () => {
    const dir = path.join(stateRoot, '.agent-jobs')
    assert.ok(fs.existsSync(dir), `缺少 ${dir}`)
    assert.ok(fs.readdirSync(dir).length > 0, '应至少有一个 job 目录')
  })

  // 核心断言：整轮下来仓库根不应新增任何目录
  check('仓库根没有新增目录', () => {
    const after = topDirs(ROOT)
    const added = [...after].filter((d) => !before.has(d))
    assert.deepEqual(added, [], `仓库根多出了目录：${added.join('、')}`)
  })

  // 反向确认这几个目录确实不会出现在仓库根
  check('状态目录没有出现在仓库根', () => {
    for (const name of ['.scene-drafts', '.agent-jobs']) {
      assert.ok(
        !fs.existsSync(path.join(ROOT, name)),
        `${name} 不该出现在仓库根（应落到 SB_STATE_ROOT）`,
      )
    }
  })
} finally {
  if (server) await server.stop()
  fs.rmSync(stateRoot, { recursive: true, force: true })
  fs.rmSync(projectsRoot, { recursive: true, force: true })
}

let failed = 0
for (const r of results) {
  if (r.ok) console.log(`  ok   ${r.name}`)
  else {
    failed++
    console.log(`  FAIL ${r.name}\n       ${r.message}`)
  }
}
console.log(`\n${results.length - failed}/${results.length} passed`)
process.exit(failed ? 1 : 0)
