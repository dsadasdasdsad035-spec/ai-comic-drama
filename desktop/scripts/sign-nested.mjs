#!/usr/bin/env node
/**
 * sign-nested.mjs — 由内向外给应用包里的全部 Mach-O 补签
 *
 * 为什么 electron-builder 不够（见 design 决策 5）：
 * builder 会签 asar 与它自己产出的二进制，但 `Resources/blender/Blender.app` 是整个
 * 从上游 dmg 拷来的第三方应用包，内部有数百个 Mach-O（.dylib / .so / 内层可执行）。
 * 这些文件必须**先签内层、再签外层**：外层签名会覆盖内层文件的哈希，顺序反了外层
 * 签名随即失效，公证会以 "signature invalid" 直接拒绝。
 *
 * 用法：
 *   node desktop/scripts/sign-nested.mjs <path-to-app> [--identity <id>] [--entitlements <plist>]
 *
 * 在 electron-builder 的 afterSign 钩子里被调用时，参数是 (context)：
 *   context.appOutDir / context.packager.appInfo 等，本脚本兼容两种入口。
 *
 * 无证书时（--identity - 或环境里没有 Developer ID）会退化为 ad-hoc 签名，
 * 只用于本机验证遍历与漏签检测逻辑；公证必须用真实证书。
 */
import { execFileSync } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'

const ROOT = path.resolve(import.meta.dirname, '..', '..')

// ---------------------------------------------------------------- 参数

/** 兼容两种入口：直接 CLI 传路径，或 electron-builder 传 context 对象 */
function parseArgs() {
  const argv = process.argv.slice(2)
  let appPath = ''
  const rest = []
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]
    if (!a) continue
    if (a === '--identity' || a === '--entitlements' || a === '--app') {
      rest.push(a, argv[++i])
      continue
    }
    if (a.startsWith('--')) {
      rest.push(a)
      continue
    }
    // 第一个裸参数就是 .app 路径
    if (!appPath) {
      appPath = a
      continue
    }
    rest.push(a)
  }
  const opt = (name, fallback = '') => {
    const i = rest.indexOf(`--${name}`)
    return i >= 0 ? String(rest[i + 1] || '') : fallback
  }
  return {
    appPath: appPath || opt('app'),
    identity: opt('identity', process.env.SIGN_IDENTITY || ''),
    entitlements: opt('entitlements', path.join(ROOT, 'desktop', 'build', 'entitlements.mac.plist')),
    verifyOnly: rest.includes('--verify-only'),
  }
}

// ---------------------------------------------------------------- 工具

function run(cmd, args, opts = {}) {
  return execFileSync(cmd, args, { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024, ...opts })
}

function log(msg) {
  console.log(`[sign] ${msg}`)
}

/** 读文件的 Mach-O 魔数；不是 Mach-O 返回空串 */
function machoKind(file) {
  let fd
  try {
    fd = fs.openSync(file, 'r')
    const buf = Buffer.alloc(4)
    fs.readSync(fd, buf, 0, 4, 0)
    const be = buf.readUInt32BE(0)
    const le = buf.readUInt32LE(0)
    // 0xfeedface / 0xfeedfacf 是 32/64 位；cafebabe 是通用二进制（fat）
    if (be === 0xcafebabe || be === 0xbebafeca) return 'fat'
    if (le === 0xfeedface || le === 0xfeedfacf) return 'macho'
    if (be === 0xfeedface || be === 0xfeedfacf) return 'macho'
    // fat_64
    if (be === 0xcafebabf) return 'fat'
    return ''
  } catch {
    return ''
  } finally {
    if (fd !== undefined) fs.closeSync(fd)
  }
}

/**
 * 递归收集所有 Mach-O，按「深度大的先出现」排序。
 * 深度优先排序正是「由内向外」：内层文件路径更长、更深，先签它们，
 * 外层 .app 最后签，这样外层的签名覆盖的是内层的最终状态。
 */
function collectMachO(root) {
  const found = []
  const walk = (dir) => {
    let entries
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true })
    } catch {
      return
    }
    for (const e of entries) {
      const full = path.join(dir, e.name)
      if (e.isSymbolicLink()) continue
      if (e.isDirectory()) {
        walk(full)
        continue
      }
      if (!e.isFile()) continue
      if (machoKind(full)) found.push(full)
    }
  }
  walk(root)
  const depth = (p) => p.split(path.sep).length
  return found.sort((a, b) => depth(b) - depth(a) || b.localeCompare(a))
}

/** 该文件是否已有有效签名（ad-hoc 也算有签名，但会被 requirements 检查区分） */
function hasSignature(file) {
  try {
    run('codesign', ['--verify', '--strict', file], { stdio: 'pipe' })
    return true
  } catch {
    return false
  }
}

// ---------------------------------------------------------------- 主流程

const { appPath, identity, entitlements, verifyOnly } = parseArgs()

if (!appPath) {
  console.error('[sign] 缺少 .app 路径。用法：node desktop/scripts/sign-nested.mjs <App.app> [--verify-only]')
  process.exit(2)
}
if (!fs.existsSync(appPath)) {
  console.error(`[sign] 路径不存在：${appPath}`)
  process.exit(2)
}

// 先收集目标，签名与仅校验两种模式共用同一份清单
const blenderApp = path.join(appPath, 'Contents', 'Resources', 'blender', 'Blender.app')
const targets = []
if (fs.existsSync(blenderApp)) {
  log('扫描 Blender.app 内的 Mach-O…')
  const inner = collectMachO(blenderApp)
  log(`找到 ${inner.length} 个 Mach-O 文件`)
  targets.push(...inner)
  // Blender.app 本体最后签（它在 targets 末尾，且不在 inner 里）
  targets.push(blenderApp)
} else {
  log('未找到随包 Blender.app，跳过')
}

// 主应用包内的所有其它嵌套 Mach-O（Frameworks/、MacOS/、Resources/ 下的 helper、
// 随包 node/ffmpeg/ffprobe 等）。必须扫整个 Contents 而不是只扫 Resources——
// 只扫 Resources 会漏掉 Contents/Frameworks 下的 Electron Framework 与 Helper；
// 而 builder 跳过签名时（无证书、CSC_IDENTITY_AUTO_DISCOVERY=false），
// 这些文件就彻底没有签名，公证必拒。
const contents = path.join(appPath, 'Contents')
if (fs.existsSync(contents)) {
  const seen = new Set(targets.map((p) => path.resolve(p)))
  const extra = collectMachO(contents).filter((p) => {
    // Blender 包内的文件已经处理过
    if (p.startsWith(blenderApp + path.sep) || p === blenderApp) return false
    return !seen.has(path.resolve(p))
  })
  if (extra.length) log(`应用包内另有 ${extra.length} 个 Mach-O（Frameworks/helper/随包二进制等）`)
  targets.push(...extra)
}

if (!targets.length) {
  // 一个都没扫到通常意味着路径拼错了（例如 productName 与 .app 目录名不一致），
  // 静默通过会让"签名成功"变成假象
  console.error(`[sign] 未在 ${appPath} 内扫描到任何嵌套 Mach-O，疑似路径错误`)
  process.exit(1)
}

/** 逐个校验，返回无效文件列表 */
function verifyAll(list) {
  const badList = []
  for (const file of list) {
    if (!hasSignature(file)) badList.push(file)
  }
  return badList
}

// 仅校验模式：发布前复查、或验证「漏签能被抓出来」
if (verifyOnly) {
  const badList = verifyAll([...targets, appPath])
  if (badList.length) {
    for (const f of badList) console.error(`[sign] 签名无效：${path.relative(appPath, f) || path.basename(appPath)}`)
    console.error(`[sign] 共 ${badList.length} 个文件签名无效`)
    process.exit(1)
  }
  log(`校验通过：${targets.length + 1} 个文件签名有效`)
  process.exit(0)
}

// 没证书就退化成 ad-hoc（"-"）。这不是可发布的产物，只用于本机验证流程。
const signIdentity = identity || '-'
const adHoc = signIdentity === '-'
if (adHoc) {
  log('未指定签名身份，使用 ad-hoc 签名（仅本机验证，不可公证）')
}

const entArgs = []
if (fs.existsSync(entitlements)) {
  entArgs.push('--entitlements', entitlements)
} else {
  log(`未找到 entitlements：${entitlements}，将不带 entitlements 签名`)
}

/** 签一个具体文件 */
function signFile(file) {
  const args = ['--force', '--options', 'runtime', '--timestamp=none', ...entArgs, '--sign', signIdentity, file]
  run('codesign', args, { stdio: 'pipe' })
}

// 逐个签名，失败立刻退出并指名文件——漏签一个就会让公证失败，不能让脚本"差不多成功"
let signed = 0
for (const file of targets) {
  const rel = path.relative(appPath, file)
  try {
    signFile(file)
    signed++
  } catch (e) {
    console.error(`[sign] 签名失败：${rel}\n${String(e?.stderr || e?.message || e).trim().slice(0, 800)}`)
    process.exit(1)
  }
}
log(`已签名 ${signed} 个嵌套文件`)

// 第三步：签 .app 本体
try {
  signFile(appPath)
  log(`已签名应用本体：${path.basename(appPath)}`)
} catch (e) {
  console.error(`[sign] 应用本体签名失败：\n${String(e?.stderr || e?.message || e).trim().slice(0, 800)}`)
  process.exit(1)
}

// 第四步：整体校验。任何一项不过都非零退出
let bad = 0
for (const file of [...targets, appPath]) {
  if (!hasSignature(file)) {
    console.error(`[sign] 签名校验失败：${path.relative(appPath, file) || path.basename(appPath)}`)
    bad++
  }
}
if (bad) {
  console.error(`[sign] 共 ${bad} 个文件签名无效`)
  process.exit(1)
}

log(`全部 ${targets.length + 1} 个签名校验通过`)
