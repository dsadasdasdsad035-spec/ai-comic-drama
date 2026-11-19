#!/usr/bin/env node
/**
 * 构建创意会话宿主（dsh）源码。
 *
 * 宿主是本仓库的 submodule（`deepseek-harness/`），不是 npm 依赖：应用只认它的
 * 构建产物 `apps/cli/lib/bin.js`。本脚本负责「安装 + 编译 + 验收产物」三件事，
 * 并且**故意不挂进 `npm run build`**——host 编译要 8 GB 堆，日常前端构建不该被它拖住。
 *
 * 用法：
 *   npm run build:dsh
 *   DSH_SKIP_INSTALL=1 npm run build:dsh     # 依赖已装好，只重新编译
 */
import { spawnSync } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const SUBMODULE_DIR = path.join(ROOT, 'deepseek-harness')
const ENTRY = path.join(SUBMODULE_DIR, 'apps', 'cli', 'lib', 'bin.js')
/** host 编译（tsc）的堆需求；低于这个值时提前告警，而不是让它跑到一半 OOM */
const RECOMMENDED_FREE_BYTES = 8 * 1024 ** 3

function fail(message) {
  console.error(`[build-dsh] ${message}`)
  process.exit(1)
}

function run(command, args, label) {
  console.log(`[build-dsh] ${label}`)
  // CI=true 让宿主的 postinstall 跳过 lefthook 安装：submodule 的 core.worktree
  // 布局会让它拒绝启用 extensions.worktreeConfig，而这个脚本只装 git 钩子，与构建无关。
  const result = spawnSync(command, args, {
    cwd: SUBMODULE_DIR,
    stdio: 'inherit',
    env: { ...process.env, CI: 'true' },
  })
  if (result.error) fail(`${label} 无法执行：${result.error.message}`)
  if (result.status !== 0) fail(`${label} 失败（退出码 ${result.status ?? 'null'}）`)
}

if (!fs.existsSync(SUBMODULE_DIR) || fs.readdirSync(SUBMODULE_DIR).length === 0) {
  fail(`宿主源码未初始化：${SUBMODULE_DIR} 为空。先执行 git submodule update --init --recursive`)
}

const freeBytes = (() => {
  try {
    const stat = fs.statfsSync(ROOT)
    return Number(stat.bavail) * Number(stat.bsize)
  } catch {
    return null
  }
})()
if (freeBytes !== null && freeBytes < RECOMMENDED_FREE_BYTES) {
  const gib = (freeBytes / 1024 ** 3).toFixed(1)
  console.warn(
    `[build-dsh] 可用磁盘只剩 ${gib} GiB，建议至少 8 GiB：依赖树约 2 GiB，编译产物还要再占一份。`,
  )
}

if (process.env.DSH_SKIP_INSTALL !== '1') {
  run('corepack', ['pnpm', 'install', '--frozen-lockfile'], '安装宿主依赖（pnpm + corepack）')
}
run('corepack', ['pnpm', 'run', 'build:lib'], '编译宿主 host 与 client')
// 宿主的会话锁走 native/system 的 flock Node-API 模块，源码树里没有预编译产物：
// 少了它 `build:lib` 一切正常，但开一轮会话就报 `Cannot find module .../bin/system.node`。
run(
  'corepack',
  ['pnpm', '--filter', '@deepseek-ai/node-addon-system-workspace', 'run', 'build:native'],
  '编译宿主原生模块（flock / landlock）',
)
// 壳页面不是 lib 产物：web-app 从 `@deepseek-ai/dsh-web-frontend` 的 dist/index.html 取页面，
// 少了这一步宿主能起来但 `/` 是 404。
run('corepack', ['pnpm', 'run', 'build:web'], '构建 Web 壳页面（vite）')

const SHELL_INDEX = path.join(SUBMODULE_DIR, 'apps', 'web', 'dist', 'index.html')
if (!fs.existsSync(ENTRY)) fail(`构建结束但产物缺失：${ENTRY}`)
if (!fs.existsSync(SHELL_INDEX)) fail(`构建结束但壳页面缺失：${SHELL_INDEX}`)
// 原生模块按平台分目录：有 prebuilds.json 且平台对得上就必须有产物
const addonDir = path.join(SUBMODULE_DIR, 'native', 'system', 'packages', `${process.platform}-${process.arch}`)
if (fs.existsSync(path.join(addonDir, 'prebuilds.json'))) {
  const addon = path.join(addonDir, 'bin', 'system.node')
  if (!fs.existsSync(addon)) fail(`构建结束但原生模块缺失：${addon}（开一轮会话就会报 Cannot find module）`)
}
console.log(`[build-dsh] 完成：${ENTRY}`)
