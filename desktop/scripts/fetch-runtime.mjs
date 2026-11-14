#!/usr/bin/env node
/**
 * fetch-runtime.mjs — 下载并校验桌面端随包运行时
 *
 * 为什么要自己下载而不是依赖开发机已装的东西（见 design.md 决策 3）：
 * 目标机器是「干净 macOS」，没装 Node、没装 ffmpeg、没装 Blender。随包是唯一能
 * 保证「装上就能用」的方式；同时把版本写死，避免用户在别处升级 ffmpeg 后行为漂移。
 *
 * 所有产物都落在 desktop/bin/（已进 .gitignore）：
 *   node                官方 Node 可执行文件
 *   ffmpeg / ffprobe    静态 arm64 二进制
 *   blender/Blender.app 从 dmg 里拷出的应用包
 *
 * 用法：
 *   node desktop/scripts/fetch-runtime.mjs            # 全部
 *   node desktop/scripts/fetch-runtime.mjs --only node
 *   node desktop/scripts/fetch-runtime.mjs --force    # 忽略已存在
 */
import { execFileSync } from 'node:child_process'
import crypto from 'node:crypto'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { Readable } from 'node:stream'
import { pipeline } from 'node:stream/promises'

const ROOT = path.resolve(import.meta.dirname, '..', '..')
const BIN = path.join(ROOT, 'desktop', 'bin')
const CACHE = path.join(os.tmpdir(), 'sb-desktop-runtime-cache')
const MANIFEST = path.join(BIN, '.runtime-manifest.json')

/**
 * 版本与校验和都写死。校验和来源：
 * - node：nodejs.org 的 SHASUMS256.txt
 * - ffmpeg/ffprobe：osxexperts.net 未提供校验文件，取首次下载时记录的 sha256
 * - blender：download.blender.org 只发布 md5（Blender4.5/*.md5）
 */
const RUNTIMES = {
  node: {
    version: '22.23.5',
    url: 'https://nodejs.org/dist/v22.23.5/node-v22.23.5-darwin-arm64.tar.gz',
    sha256: 'e7131995759b61a0170b646010d2ad35a5d37b4cb0d471f3e8317eac6f742f3d',
    // 官方包里有 npm / include 等，桌面端只需要可执行文件
    files: ['node'],
  },
  ffmpeg: {
    version: '9.0.2',
    sha256: '4597f0f3a397cc0027bfd03dc4dd9c3066be15943cc788370846b4305d178bcb',
    url: 'https://www.osxexperts.net/ffmpeg902arm.zip',
    files: ['ffmpeg'],
  },
  ffprobe: {
    version: '9.0.2',
    sha256: 'c765d316eb210f3c98de6f9688df784552f3f8f586090e2a8cb871be9003164e',
    url: 'https://www.osxexperts.net/ffprobe902arm.zip',
    files: ['ffprobe'],
  },
  blender: {
    version: '4.5.9',
    url: 'https://download.blender.org/release/Blender4.5/blender-4.5.9-macos-arm64.dmg',
    md5: '997e64732581ea7862c1425f11fd821c',
    dmgApp: 'Blender.app',
  },
}

// ---------------------------------------------------------------- 工具

function log(msg) {
  console.log(`[runtime] ${msg}`)
}

function ensureDir(dir) {
  fs.mkdirSync(dir, { recursive: true })
}

function fileHash(file, algo = 'sha256') {
  return new Promise((resolve, reject) => {
    const hash = crypto.createHash(algo)
    const stream = fs.createReadStream(file)
    stream.on('error', reject)
    stream.on('data', (chunk) => hash.update(chunk))
    stream.on('end', () => resolve(hash.digest('hex')))
  })
}

async function download(url, dest) {
  ensureDir(path.dirname(dest))
  log(`下载 ${url}`)
  const res = await fetch(url, { redirect: 'follow' })
  if (!res.ok) throw new Error(`下载失败 ${res.status} ${res.statusText}：${url}`)
  if (!res.body) throw new Error(`响应没有内容：${url}`)
  await pipeline(Readable.fromWeb(res.body), fs.createWriteStream(dest))
  const size = fs.statSync(dest).size
  if (size < 1024) throw new Error(`下载内容过小（${size} 字节）：${url}`)
  return dest
}

async function fetchCached(url, filename) {
  const cached = path.join(CACHE, filename)
  if (fs.existsSync(cached)) {
    log(`使用缓存 ${cached}`)
    return cached
  }
  return download(url, cached)
}

async function verify(file, spec) {
  if (spec.sha256) {
    const got = await fileHash(file, 'sha256')
    if (got !== spec.sha256) {
      throw new Error(`sha256 不匹配（${path.basename(file)}）\n  期望 ${spec.sha256}\n  实际 ${got}`)
    }
    log(`sha256 通过（${path.basename(file)}）`)
    return
  }
  if (spec.md5) {
    const got = await fileHash(file, 'md5')
    if (got !== spec.md5) {
      throw new Error(`md5 不匹配（${path.basename(file)}）\n  期望 ${spec.md5}\n  实际 ${got}`)
    }
    log(`md5 通过（${path.basename(file)}）`)
    return
  }
  throw new Error(`未配置校验和：${path.basename(file)}`)
}

/** 让 macOS 不再把下载来的二进制标成隔离文件 */
function clearQuarantine(target) {
  try {
    execFileSync('xattr', ['-dr', 'com.apple.quarantine', target], { stdio: 'ignore' })
  } catch {
    /* 没有该属性时会报错，忽略 */
  }
}

function run(cmd, args, opts = {}) {
  return execFileSync(cmd, args, { encoding: 'utf8', ...opts })
}

// ---------------------------------------------------------------- 各运行时

async function installNode({ force }) {
  const target = path.join(BIN, 'node')
  const spec = RUNTIMES.node
  if (!force && fs.existsSync(target)) {
    const v = run(target, ['-v']).trim()
    if (v === `v${spec.version}`) {
      log(`node 已是 v${spec.version}，跳过`)
      return
    }
  }
  const archive = await fetchCached(spec.url, `node-v${spec.version}.tar.gz`)
  await verify(archive, spec)
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'sb-node-'))
  run('tar', ['-xzf', archive, '-C', tmp])
  const extracted = path.join(tmp, `node-v${spec.version}-darwin-arm64`, 'bin', 'node')
  if (!fs.existsSync(extracted)) throw new Error(`压缩包结构不符合预期：${extracted}`)
  ensureDir(BIN)
  fs.copyFileSync(extracted, target)
  fs.chmodSync(target, 0o755)
  clearQuarantine(target)
  fs.rmSync(tmp, { recursive: true, force: true })
  const got = run(target, ['-v']).trim()
  if (got !== `v${spec.version}`) throw new Error(`随包 node 版本异常：${got}`)
  log(`node 就绪：${target}（${got}）`)
}

async function installFlat({ name, force }) {
  const spec = RUNTIMES[name]
  const target = path.join(BIN, name)
  if (!force && fs.existsSync(target)) {
    log(`${name} 已存在，跳过`)
    return
  }
  const archive = await fetchCached(spec.url, `${name}-${spec.version}.zip`)
  await verify(archive, spec)
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), `sb-${name}-`))
  run('unzip', ['-o', '-q', archive, '-d', tmp])
  const extracted = path.join(tmp, name)
  if (!fs.existsSync(extracted)) throw new Error(`压缩包内缺少 ${name}：${tmp}`)
  ensureDir(BIN)
  fs.copyFileSync(extracted, target)
  fs.chmodSync(target, 0o755)
  clearQuarantine(target)
  fs.rmSync(tmp, { recursive: true, force: true })
  log(`${name} 就绪：${target}`)
}

async function installBlender({ force }) {
  const spec = RUNTIMES.blender
  const target = path.join(BIN, 'blender', 'Blender.app')
  const binPath = path.join(target, 'Contents', 'MacOS', 'Blender')
  if (!force && fs.existsSync(binPath)) {
    log('blender 已存在，跳过')
    return
  }
  const dmg = await fetchCached(spec.url, `blender-${spec.version}.dmg`)
  await verify(dmg, spec)

  // dmg 必须挂载才能取内容；挂载点用临时目录，结束后一定卸载
  const mnt = fs.mkdtempSync(path.join(os.tmpdir(), 'sb-blender-mnt-'))
  let mounted = false
  try {
    run('hdiutil', ['attach', dmg, '-nobrowse', '-readonly', '-mountpoint', mnt], { stdio: 'pipe' })
    mounted = true
    const src = path.join(mnt, spec.dmgApp)
    if (!fs.existsSync(src)) throw new Error(`dmg 内缺少 ${spec.dmgApp}`)
    ensureDir(path.dirname(target))
    // ditto 能保留资源分支、符号链接与可执行位；rsync/cp -R 会破坏 Blender 包结构
    run('ditto', [src, target])
  } finally {
    if (mounted) {
      try {
        run('hdiutil', ['detach', mnt, '-force'], { stdio: 'pipe' })
      } catch {
        /* 卸载失败不阻塞构建 */
      }
    }
    fs.rmSync(mnt, { recursive: true, force: true })
  }
  if (!fs.existsSync(binPath)) throw new Error(`Blender 可执行文件缺失：${binPath}`)
  clearQuarantine(path.dirname(target))
  log(`blender 就绪：${binPath}`)
}

function writeManifest() {
  ensureDir(BIN)
  fs.writeFileSync(
    MANIFEST,
    JSON.stringify(
      {
        generatedAt: new Date().toISOString(),
        arch: process.arch,
        node: RUNTIMES.node.version,
        ffmpeg: RUNTIMES.ffmpeg.version,
        ffprobe: RUNTIMES.ffprobe.version,
        blender: RUNTIMES.blender.version,
      },
      null,
      2,
    ) + '\n',
  )
}

// ---------------------------------------------------------------- 入口

const argv = process.argv.slice(2)
const force = argv.includes('--force')
const onlyIdx = argv.indexOf('--only')
const only = onlyIdx >= 0 ? String(argv[onlyIdx + 1] || '').split(',') : []

function wants(name) {
  return only.length === 0 || only.includes(name)
}

if (process.platform !== 'darwin') {
  console.error('[runtime] 当前只支持 macOS 打包')
  process.exit(1)
}
if (process.arch !== 'arm64') {
  console.error('[runtime] 目前只提供 arm64 产物')
  process.exit(1)
}

try {
  if (wants('node')) await installNode({ force })
  if (wants('ffmpeg')) await installFlat({ name: 'ffmpeg', force })
  if (wants('ffprobe')) await installFlat({ name: 'ffprobe', force })
  if (wants('blender')) await installBlender({ force })
  writeManifest()
  log('全部完成')
} catch (e) {
  console.error(`[runtime] 失败：${e.message}`)
  process.exit(1)
}
