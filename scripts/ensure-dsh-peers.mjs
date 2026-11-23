#!/usr/bin/env node
/**
 * npm install 后补齐 @deepseek-ai/* 缺失的 peer 包。
 *
 * 为什么需要这个：创意会话宿主（`@deepseek-ai/dsh`）把一大票 `dsh-*` 声明成
 * peerDependencies，由宿主自己按裸包名 import。而本仓库的 `package-lock.json`
 * 是在 `--legacy-peer-deps` 下生成的，这些 peer 从来没被写进锁文件，
 * 于是 `npm ci` 装出来的树缺 20 来个包，表现为宿主启动时报
 * 「startup failed: N required plugins did not activate」——少的是插件，
 * 报的却是启动失败，很难归因到依赖。
 *
 * 这里按「实际装了哪些 @deepseek-ai 包 → 它们声明了哪些 peer → 哪些没装」
 * 动态推导缺口，只补缺的那几个；已经齐全时不做任何事、不联网。
 * 与 `ensure-dsh-blender-bundle.mjs` 同一原则：postinstall 只报告，不阻断安装。
 *
 * 根治办法是重新生成 package-lock.json（不带 --legacy-peer-deps），
 * 但那需要整树重装，先由本脚本兜住。
 *
 * 用法：
 *   node scripts/ensure-dsh-peers.mjs            # 补齐缺口
 *   node scripts/ensure-dsh-peers.mjs --dry-run  # 只报告
 */
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { execFileSync } from 'node:child_process'
import { createRequire } from 'node:module'
import { fileURLToPath } from 'node:url'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const SCOPE = '@deepseek-ai/'
const SCOPE_DIR = path.join(ROOT, 'node_modules', '@deepseek-ai')
const DRY = process.argv.includes('--dry-run')
const require_ = createRequire(import.meta.url)

/** 镜像地址：env → 仓库 .npmrc → 用户 .npmrc，都没有就回落 npm 官方 */
function registry() {
  const fromEnv = String(process.env.npm_config_registry || '').trim()
  if (fromEnv) return fromEnv.replace(/\/+$/, '')
  for (const file of [path.join(ROOT, '.npmrc'), path.join(os.homedir(), '.npmrc')]) {
    try {
      const hit = fs.readFileSync(file, 'utf8').match(/^\s*registry\s*=\s*(\S+)\s*$/m)
      if (hit) return hit[1].replace(/\/+$/, '')
    } catch {
      /* 这个位置没有 .npmrc，继续找下一个 */
    }
  }
  return 'https://registry.npmjs.org'
}

/** 精确版本（`1.2.3` / `1.2.3-rc.1`）直接用；范围交给 semver 从 packument 里挑 */
function isExactVersion(range) {
  return /^\d+\.\d+\.\d+(-[0-9A-Za-z.-]+)?$/.test(range)
}

function pickVersion(packument, range) {
  if (isExactVersion(range)) return range
  let semver = null
  try {
    semver = require_('semver')
  } catch {
    /* 没装 semver 就只用 latest */
  }
  const versions = Object.keys(packument.versions || {})
  if (semver) {
    const hit = versions.filter((v) => semver.satisfies(v, range)).sort(semver.rcompare)[0]
    if (hit) return hit
  }
  return packument['dist-tags']?.latest || null
}

async function fetchMeta(name) {
  const url = `${registry()}/${name.replace('/', '%2f')}`
  const res = await fetch(url, { signal: AbortSignal.timeout(30_000) })
  if (!res.ok) throw new Error(`HTTP ${res.status}`)
  return res.json()
}

function installedNames() {
  try {
    return new Set(fs.readdirSync(SCOPE_DIR))
  } catch {
    return new Set()
  }
}

function readManifest(dir) {
  try {
    return JSON.parse(fs.readFileSync(path.join(dir, 'package.json'), 'utf8'))
  } catch {
    return null
  }
}

/** 扫描已装 @deepseek-ai 包，返回 {包名: Set(版本范围)} 形式的缺口 */
function findMissingPeers() {
  const installed = installedNames()
  const missing = new Map()
  for (const short of installed) {
    const manifest = readManifest(path.join(SCOPE_DIR, short))
    if (!manifest) continue
    for (const [name, range] of Object.entries(manifest.peerDependencies || {})) {
      if (!name.startsWith(SCOPE)) continue
      if (installed.has(name.slice(SCOPE.length))) continue
      if (!missing.has(name)) missing.set(name, new Set())
      missing.get(name).add(range)
    }
  }
  return missing
}

async function main() {
  if (!fs.existsSync(SCOPE_DIR)) {
    console.warn('[dsh-peers] 没有 node_modules/@deepseek-ai，跳过')
    return
  }
  const missing = findMissingPeers()
  if (!missing.size) {
    console.log('[dsh-peers] peer 依赖齐全')
    return
  }
  console.log(`[dsh-peers] 缺 ${missing.size} 个 peer 包${DRY ? '（预演，不写入）' : ''}`)

  const work = fs.mkdtempSync(path.join(os.tmpdir(), 'dsh-peers-'))
  const failed = []
  let filled = 0
  try {
    for (const [name, ranges] of [...missing].sort(([a], [b]) => a.localeCompare(b))) {
      const range = [...ranges][0]
      if (ranges.size > 1) {
        console.warn(`[dsh-peers] ${name} 被多处要求不同范围：${[...ranges].join(' / ')}，取 ${range}`)
      }
      try {
        const meta = await fetchMeta(name)
        const version = pickVersion(meta, range)
        if (!version) throw new Error(`没有满足 ${range} 的版本`)
        const tarball = meta.versions?.[version]?.dist?.tarball
        if (!tarball) throw new Error(`${version} 没有 tarball`)
        const short = name.slice(SCOPE.length)
        if (!DRY) {
          const tgz = path.join(work, `${short}.tgz`)
          const outDir = path.join(work, short)
          fs.mkdirSync(outDir, { recursive: true })
          execFileSync('curl', ['-sSL', '--max-time', '120', '-o', tgz, tarball], { stdio: 'pipe' })
          execFileSync('tar', ['-xzf', tgz, '-C', outDir], { stdio: 'pipe' })
          const inner = path.join(outDir, 'package')
          const manifest = readManifest(inner)
          // 校验包名，避免把同名占位包塞进依赖树
          if (manifest?.name !== name) throw new Error(`包名不符：${manifest?.name}`)
          fs.cpSync(inner, path.join(SCOPE_DIR, short), { recursive: true })
        }
        filled++
        console.log(`[dsh-peers] ✅ ${name}@${version}`)
      } catch (e) {
        failed.push(`${name}: ${e.message}`)
      }
    }
  } finally {
    fs.rmSync(work, { recursive: true, force: true })
  }

  console.log(`[dsh-peers] 完成：补 ${filled} 个，失败 ${failed.length} 个`)
  for (const f of failed) console.warn(`[dsh-peers] ❌ ${f}`)
  if (failed.length) {
    console.warn('[dsh-peers] 缺口未补全时创意会话宿主会启动失败；联网后重跑 `node scripts/ensure-dsh-peers.mjs`')
  }
}

main().catch((e) => {
  // postinstall 不应因为补依赖失败而中断安装
  console.warn(`[dsh-peers] 跳过（${e?.message || e}）`)
})
