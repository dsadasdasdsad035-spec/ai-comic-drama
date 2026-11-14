#!/usr/bin/env node
/**
 * notarize.mjs — 提交 Apple 公证并附加票据
 *
 * 为什么要单独一个脚本而不是全靠 electron-builder 内建公证：
 *
 * 1. 内建公证只认少数几种凭据形态，而团队既可能用 App Store Connect API Key
 *    （CI 推荐），也可能用 app-specific password（本机手动发布），需要都覆盖；
 * 2. 公证失败时的输出必须能直接定位原因（是签名无效、还是有未签名 Mach-O），
 *    notarytool 的 JSON 日志需要转成人能读的摘要；
 * 3. 打包后仍需对 dmg 本体单独 stapler，内建流程只处理 .app。
 *
 * 凭据来源（按优先级，与 xcrun notarytool 一致）：
 *   - --profile <name>        已用 `xcrun notarytool store-credentials` 存好的 keychain 条目
 *   - --key/--key-id/--issuer App Store Connect API Key（三个都要）
 *   - APPLE_ID + APPLE_APP_SPECIFIC_PASSWORD + APPLE_TEAM_ID 环境变量
 *
 * 用法：
 *   node desktop/scripts/notarize.mjs <App.app|xxx.dmg> [--profile mac-notary]
 *   node desktop/scripts/notarize.mjs <path> --key AuthKey.p8 --key-id ABC123 --issuer xxxx
 */
import { execFileSync } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

function log(msg) {
  console.log(`[notarize] ${msg}`)
}

function fail(msg, detail = '') {
  console.error(`[notarize] ${msg}`)
  if (detail) console.error(detail)
  process.exit(1)
}

function run(cmd, args, opts = {}) {
  return execFileSync(cmd, args, { encoding: 'utf8', maxBuffer: 32 * 1024 * 1024, ...opts })
}

// ---------------------------------------------------------------- 参数

const argv = process.argv.slice(2)
const target = argv.find((a) => !a.startsWith('--'))
const opt = (name, fallback = '') => {
  const i = argv.indexOf(`--${name}`)
  return i >= 0 ? String(argv[i + 1] || '') : fallback
}

if (!target) fail('缺少待公证路径。用法：node desktop/scripts/notarize.mjs <App.app|xxx.dmg>')
if (!fs.existsSync(target)) fail(`路径不存在：${target}`)

const profile = opt('profile', process.env.NOTARY_PROFILE || '')
const keyPath = opt('key', process.env.APPLE_API_KEY || '')
const keyId = opt('key-id', process.env.APPLE_API_KEY_ID || '')
const issuer = opt('issuer', process.env.APPLE_API_ISSUER || '')
const appleId = process.env.APPLE_ID || ''
const applePassword = process.env.APPLE_APP_SPECIFIC_PASSWORD || ''
const teamId = process.env.APPLE_TEAM_ID || ''

/** 组装 notarytool 的凭据参数；返回 null 表示凭据不全 */
function credentialArgs() {
  if (profile) return ['--keychain-profile', profile]
  if (keyPath && keyId && issuer) return ['--key', keyPath, '--key-id', keyId, '--issuer', issuer]
  if (appleId && applePassword && teamId) {
    return ['--apple-id', appleId, '--password', applePassword, '--team-id', teamId]
  }
  return null
}

const creds = credentialArgs()
if (!creds) {
  fail(
    '缺少公证凭据，拒绝产出未公证的安装包。\n' +
      '请任选一种方式提供：\n' +
      '  1) xcrun notarytool store-credentials "mac-notary" --apple-id <id> --team-id <team> --password <app-specific-password>\n' +
      '     然后设置 NOTARY_PROFILE=mac-notary（或传 --profile mac-notary）\n' +
      '  2) 环境变量 APPLE_API_KEY / APPLE_API_KEY_ID / APPLE_API_ISSUER（App Store Connect API Key）\n' +
      '  3) 环境变量 APPLE_ID / APPLE_APP_SPECIFIC_PASSWORD / APPLE_TEAM_ID',
  )
}

// ---------------------------------------------------------------- 前置检查

const isApp = target.endsWith('.app')
const isDmg = target.endsWith('.dmg')
if (!isApp && !isDmg) fail(`不支持公证的类型：${target}（只接受 .app 或 .dmg）`)

if (isApp) {
  try {
    run('codesign', ['--verify', '--deep', '--strict', target], { stdio: 'pipe' })
  } catch (e) {
    fail('签名校验未通过，先修签名再公证（公证不会修复无效签名）', String(e?.stderr || '').slice(0, 1200))
  }
}

// ---------------------------------------------------------------- 提交

log(`提交公证：${path.basename(target)}`)
const outFile = path.join(os.tmpdir(), `sb-notary-${process.pid}.json`)
let submitOutput = ''
try {
  submitOutput = run('xcrun', [
    'notarytool',
    'submit',
    target,
    ...creds,
    '--wait',
    '--output-format',
    'json',
    '--output',
    outFile,
  ])
} catch (e) {
  // notarytool 在 In Progress/Invalid 时也可能非零退出，先尝试读 JSON 再报错
  submitOutput = String(e?.stdout || '')
}

let result = null
try {
  if (fs.existsSync(outFile)) result = JSON.parse(fs.readFileSync(outFile, 'utf8'))
} catch {
  /* 用文本兜底 */
}

const status = result?.status || (submitOutput.match(/status:\s*(\w+)/)?.[1] ?? 'Unknown')
const id = result?.id || '(无 id)'

if (status !== 'Accepted') {
  console.error(`[notarize] 公证失败：status=${status} id=${id}`)
  // 拉取日志给出可读原因（未签名二进制、entitlements 不匹配等都能在这里看到）
  try {
    const logText = run('xcrun', ['notarytool', 'log', id, ...creds], { stdio: 'pipe' })
    const issues = logText
      .split('\n')
      .filter((l) => /"severity":\s*"(error|warning)"/i.test(l) || /"message"/i.test(l))
      .slice(0, 20)
      .join('\n')
    if (issues) console.error(issues)
  } catch {
    /* 日志拉取失败不覆盖主错误 */
  }
  process.exit(1)
}

log(`公证通过：id=${id}`)

// ---------------------------------------------------------------- 附加票据

// .app 必须 staple，否则在离线机器上首次启动会被 Gatekeeper 拦；
// .dmg 也 staple，用户离线挂载镜像时校验才不依赖网络。
try {
  run('xcrun', ['stapler', 'staple', target], { stdio: 'inherit' })
} catch {
  fail('stapler 附加票据失败')
}

try {
  const v = run('xcrun', ['stapler', 'validate', target], { stdio: 'pipe' })
  log(`stapler validate 通过：${v.trim().split('\n').pop()}`)
} catch (e) {
  fail('stapler validate 未通过', String(e?.stdout || e?.stderr || '').slice(0, 800))
}

log('完成')
