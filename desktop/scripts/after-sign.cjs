/**
 * electron-builder 的 afterSign 钩子。
 *
 * 为什么单独一个 .cjs 包装：builder 用 require() 加载钩子并调用导出的函数，
 * 而 sign-nested.mjs 是 ESM 且以 CLI 形式编写（便于单独跑与断点调试）。
 * 用 .cjs 做一层薄适配，两边职责清楚：这里只管取路径与转交退出码，
 * 签名顺序与校验逻辑全在 sign-nested.mjs 里。
 *
 * context 关键字段（electron-builder）：
 *   appOutDir              产出目录（如 desktop/dist/mac-arm64）
 *   packager.appInfo.productFilename  产品名（用来拼 .app）
 *   electronPlatformName   darwin / win32 / linux
 */
const { execFileSync } = require('node:child_process')
const fs = require('node:fs')
const path = require('node:path')

exports.default = async function afterSign(context) {
  if (context.electronPlatformName !== 'darwin') return

  const appOutDir = context.appOutDir
  const productName = context.packager?.appInfo?.productFilename || 'StoryboardCanvas'
  const appPath = path.join(appOutDir, `${productName}.app`)

  if (!fs.existsSync(appPath)) {
    throw new Error(`[afterSign] 找不到应用包：${appPath}`)
  }

  // CSC_IDENTITY_AUTO_DISCOVERY=false 或本机无证书时，builder 会跳过自己的签名；
  // 这种情况下我们仍跑一遍 ad-hoc 以验证流程，但要明确提示不可分发。
  const identity = process.env.CSC_NAME || process.env.SIGN_IDENTITY || ''
  const script = path.join(__dirname, 'sign-nested.mjs')
  const args = [script, appPath]
  if (identity) args.push('--identity', identity)
  else if (process.env.CSC_IDENTITY_AUTO_DISCOVERY === 'false') args.push('--identity', '-')

  console.log(`[afterSign] 补签嵌套 Mach-O：${appPath}`)
  execFileSync(process.execPath, args, { stdio: 'inherit' })
}
