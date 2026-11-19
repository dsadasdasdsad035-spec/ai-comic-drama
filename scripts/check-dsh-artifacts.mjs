#!/usr/bin/env node
/**
 * 只读校验：宿主 CLI 声明的依赖是否都有可解析的构建产物。
 *
 * 为什么需要这个：宿主启动时从 `apps/cli/package.json` 出发按依赖图定位插件包，
 * 而 `collectInstallationScopePackages` 对「声明了但解析不到」的依赖是**跳过而不是报错**。
 * 少一个包的表现只是某个插件凭空消失，很难归因。所以在构建后显式核一遍。
 *
 * 用法：
 *   node scripts/check-dsh-artifacts.mjs
 *   node scripts/check-dsh-artifacts.mjs --verbose
 */
import { createRequire } from 'node:module'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const CLI_DIR = path.join(ROOT, 'deepseek-harness', 'apps', 'cli')
const CLI_MANIFEST = path.join(CLI_DIR, 'package.json')
const verbose = process.argv.includes('--verbose')

if (!fs.existsSync(CLI_MANIFEST)) {
  console.error(`[check-dsh] 缺少宿主 CLI 清单：${CLI_MANIFEST}（先初始化 submodule）`)
  process.exit(1)
}

const manifest = JSON.parse(fs.readFileSync(CLI_MANIFEST, 'utf8'))
const names = Object.keys({
  ...(manifest.dependencies || {}),
  ...(manifest.optionalDependencies || {}),
})
const requireFromCli = createRequire(CLI_MANIFEST)

const missing = []
for (const name of names) {
  try {
    requireFromCli.resolve(name)
    if (verbose) console.log(`✅ ${name}`)
  } catch (error) {
    missing.push({ name, reason: error?.code || String(error) })
  }
}

if (missing.length) {
  console.error(`[check-dsh] ${missing.length}/${names.length} 个依赖解析失败：`)
  for (const item of missing) console.error(`  ❌ ${item.name}（${item.reason}）`)
  console.error('[check-dsh] 执行 npm run build:dsh 重新安装与编译；仍失败时检查该包是否声明了 lib 产物')
  process.exit(1)
}

console.log(`[check-dsh] 通过：${names.length} 个依赖全部可解析`)
