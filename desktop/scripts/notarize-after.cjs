/**
 * electron-builder 的 afterAllArtifactBuild 钩子：对产出物逐个公证。
 *
 * 为什么放在这里而不是 mac.notarize：
 * mac.notarize 在签名后、打包镜像前执行，只能处理 .app；dmg 本体需要单独 staple，
 * 而用户在离线挂载 dmg 时同样要过 Gatekeeper。afterAllArtifactBuild 拿到的是
 * 全部最终产物，是唯一能同时覆盖 .app 与 .dmg 的位置。
 *
 * 无凭据时默认让构建失败：静默跳过会产出"看起来成功、实际无法分发"的包。
 * 只有在显式设置 SKIP_NOTARIZE=1 时才跳过——那是「本机自用/内部试装」的明确意图，
 * 而且要打出一条足够醒目的警告，避免被当成可对外分发的产物。
 */
const { execFileSync } = require('node:child_process')
const path = require('node:path')

exports.default = async function afterAllArtifactBuild(buildResult) {
  // 不做平台判断：platformToTargets 的键是 electron-builder 的 Platform 枚举值而不是
  // 字符串 'darwin'，用字符串去 has() 永远为 false，会把所有产物都提前返回掉。
  // 直接按产物扩展名筛选更可靠，非 macOS 产物也不会是 .dmg/.app。
  const targets = (buildResult.artifactPaths || []).filter((p) => p.endsWith('.dmg') || p.endsWith('.app'))
  if (!targets.length) return []

  if (process.env.SKIP_NOTARIZE === '1') {
    console.warn('')
    console.warn('  ⚠  已按 SKIP_NOTARIZE=1 跳过公证与 stapler')
    console.warn('     产物为 ad-hoc 签名，仅供本机或内部可信环境安装；对外分发会被 Gatekeeper 拦。')
    console.warn(`     涉及文件：${targets.map((t) => path.basename(t)).join('、')}`)
    console.warn('')
    return []
  }

  const script = path.join(__dirname, 'notarize.mjs')
  for (const target of targets) {
    console.log(`[afterAllArtifactBuild] 公证：${target}`)
    execFileSync(process.execPath, [script, target], { stdio: 'inherit' })
  }
  return []
}
