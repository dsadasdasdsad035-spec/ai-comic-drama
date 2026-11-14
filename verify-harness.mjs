/**
 * 新验收脚本的共用脚手架：临时项目目录 + 种子数据 + 独立 dev server。
 *
 * 为什么每个脚本自己起 server：外壳相关断言要控制「有几个项目、项目长什么样」，
 * 复用 5273 上的真实库既不稳定也会写脏用户数据。
 *
 * 约定：
 * - 端口占用直接抛错，避免连到上次崩溃留下的孤儿进程；
 * - seed 代码在子进程里跑，`SB_PROJECTS_DIR` 指向临时目录，与 server/*.mjs 的
 *   resolveRoot 读同一份环境变量。
 */
import { spawn, execFileSync } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

export const ROOT = process.cwd()

/** 临时项目根：SB_PROJECTS_DIR 指向它 */
export function makeProjectsDir(prefix) {
  return fs.mkdtempSync(path.join(os.tmpdir(), prefix))
}

/**
 * 在临时项目根里执行一段种子脚本。
 * 脚本里可以直接 import server/*.mjs；最后一行 console.log 的内容会被 JSON.parse 返回。
 */
export function seed(projectsDir, code) {
  const file = path.join(projectsDir, '..', `seed-${Date.now()}-${Math.random().toString(36).slice(2, 6)}.mjs`)
  fs.writeFileSync(file, code)
  const out = execFileSync(process.execPath, [file], {
    cwd: ROOT,
    env: { ...process.env, SB_PROJECTS_DIR: projectsDir },
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'inherit'],
  })
  const last = out.trim().split('\n').pop() || '{}'
  try {
    return JSON.parse(last)
  } catch {
    return {}
  }
}

/** 起一个临时 dev server；返回 { app, stop } */
export async function startApp({ projectsDir, port, extraEnv = {} }) {
  const app = `http://127.0.0.1:${port}`
  try {
    await fetch(`${app}/api/health`, { signal: AbortSignal.timeout(800) })
    throw new Error(`端口 ${port} 已被占用，请先结束占用进程`)
  } catch (e) {
    if (String(e?.message || e).includes('已被占用')) throw e
    /* 空闲 */
  }

  const child = spawn(
    process.execPath,
    [path.join(ROOT, 'node_modules', 'vite', 'bin', 'vite.js'), '--port', String(port), '--strictPort'],
    { cwd: ROOT, env: { ...process.env, SB_PROJECTS_DIR: projectsDir, ...extraEnv }, stdio: 'ignore' },
  )

  let up = false
  for (let i = 0; i < 80; i++) {
    try {
      const r = await fetch(`${app}/api/health`)
      if (r.ok) {
        up = true
        break
      }
    } catch {
      /* wait */
    }
    await new Promise((r) => setTimeout(r, 400))
  }
  if (!up) {
    child.kill()
    throw new Error('临时 dev server 启动失败')
  }
  return {
    app,
    stop() {
      try {
        child.kill()
      } catch {
        /* ignore */
      }
    },
  }
}

/** 计数器：脚本末尾统一打印并通过退出码报告 */
export function createCheck() {
  let bad = 0
  const check = (name, cond, extra = '') => {
    console.log(`${cond ? '✅' : '❌'} ${name}${extra ? ` | ${extra}` : ''}`)
    if (!cond) bad++
  }
  check.bad = () => bad
  return check
}
