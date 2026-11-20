/**
 * DSH Blender Bridge 扩展：解析随包 zip、隔离用户配置目录、幂等安装。
 *
 * 桌面端随包 Blender 不共用用户本机 Blender 配置；扩展装到 SB_STATE_ROOT 下，
 * 所有 spawn/exec 须带上 BLENDER_USER_*（见 blenderProcessEnv）。
 */
import fs from 'node:fs'
import path from 'node:path'
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { resolveStateRoot } from './paths.mjs'

const execFileAsync = promisify(execFile)

const ZIP_NAME = 'dsh_blender_bridge.zip'
const EXT_ID = 'user_default/dsh_blender_bridge'

/** Blender 用户目录落在状态根下，避免污染 ~/Library/Application Support/Blender */
export function blenderProfileDirs(appRoot) {
  const base = path.join(resolveStateRoot(appRoot), '.blender-profile')
  return {
    BLENDER_USER_CONFIG: path.join(base, 'config'),
    BLENDER_USER_SCRIPTS: path.join(base, 'scripts'),
    BLENDER_USER_EXTENSIONS: path.join(base, 'extensions'),
  }
}

/** 给子进程用的 env 片段（与 process.env 合并） */
export function blenderProcessEnv(appRoot) {
  const dirs = blenderProfileDirs(appRoot)
  const tmp = path.join(resolveStateRoot(appRoot), '.blender-tmp')
  for (const p of [...Object.values(dirs), tmp]) {
    try {
      fs.mkdirSync(p, { recursive: true })
    } catch {
      /* ignore */
    }
  }
  return { ...dirs, TMPDIR: tmp, TEMP: tmp, TMP: tmp }
}

/** 解析 bridge zip：打包目录 → node_modules → desktop 构建缓存 */
export function resolveBridgeZip(appRoot) {
  const root = path.resolve(appRoot || process.cwd())
  const candidates = [
    path.join(root, 'blender-bridge', ZIP_NAME),
    path.join(root, 'desktop', 'bin', 'blender-bridge', ZIP_NAME),
    path.join(root, 'node_modules', 'dsh-blender-plugin', 'extension', ZIP_NAME),
  ]
  for (const p of candidates) {
    try {
      if (fs.existsSync(p) && fs.statSync(p).isFile()) return p
    } catch {
      /* ignore */
    }
  }
  return null
}

export function bridgeExtensionInstalled(appRoot) {
  const extRoot = blenderProfileDirs(appRoot).BLENDER_USER_EXTENSIONS
  const manifest = path.join(extRoot, 'user_default', 'dsh_blender_bridge', 'blender_manifest.toml')
  try {
    return fs.existsSync(manifest)
  } catch {
    return false
  }
}

/**
 * 用 Blender 4.2+ CLI 安装 extension zip（幂等）。
 * @param {{ appRoot: string, log?: (line: string) => void }} opts
 */
export async function ensureBlenderBridgeExtension({ appRoot, bin, log = () => {} }) {
  if (String(process.env.SB_BLENDER_BRIDGE_AUTOINSTALL || '1').trim() === '0') {
    return { ok: false, reason: 'disabled' }
  }
  const blenderBin = String(bin || process.env.BLENDER_BIN || '').trim()
  if (!blenderBin || !fs.existsSync(blenderBin)) return { ok: false, reason: 'no-blender' }
  const zip = resolveBridgeZip(appRoot)
  if (!zip) {
    log('[blender-bridge] 未找到扩展 zip，跳过（需 dsh-blender-plugin 或桌面随包 blender-bridge/）')
    return { ok: false, reason: 'no-zip' }
  }
  if (bridgeExtensionInstalled(appRoot)) {
    return { ok: true, reason: 'already-installed', zip, extensionId: EXT_ID }
  }
  const env = { ...process.env, ...blenderProcessEnv(appRoot) }
  try {
    const { stdout, stderr } = await execFileAsync(
      blenderBin,
      ['--background', '--factory-startup', '--command', 'extension', 'install-file', '-r', 'user_default', '-e', zip],
      { env, timeout: 180_000, maxBuffer: 4 * 1024 * 1024 },
    )
    const out = `${stdout || ''}\n${stderr || ''}`
    if (!/Preferences saved/i.test(out) && !bridgeExtensionInstalled(appRoot)) {
      throw new Error(out.trim().slice(0, 400) || 'extension install-file 未返回成功')
    }
    log(`[blender-bridge] 已安装扩展（${zip}）`)
    return { ok: true, reason: 'installed', zip, extensionId: EXT_ID }
  } catch (e) {
    const msg = e?.message || String(e)
    log(`[blender-bridge] 扩展安装失败：${msg}`)
    return { ok: false, reason: 'install-failed', message: msg, zip }
  }
}