/**
 * 带视频转白模推理环境的打包配置。
 *
 * 用法：
 *   node desktop/scripts/bundle-whitebox.mjs   # 先构建环境（约 2GB）
 *   BUNDLE_WHITEBOX=1 npm run desktop:dist     # 打包
 *
 * 与默认配置的唯一差别是多带一个 whitebox-runtime/（约 2GB）：
 * python-build-standalone 解释器 + 预装 torch/open3d 的 venv + DA3 源码 + DA3-BASE 权重。
 * 服务端（server/whitebox.mjs 的 whiteboxRoot）发现它就直接用，用户无需安装。
 *
 * 为什么不用 `extends`：electron-builder 的 doMergeConfigs 对 extraResources
 * 走 deepAssign，数组是整体替换而不是逐项追加（见 app-builder-lib/out/util/
 * config/config.js:173）。用 extends 会把主配置那二十多个条目全冲掉，
 * 打出来的包缺 server/dist/presets，能开窗但服务起不来。
 * 所以这里手工读 YAML、复制并追加，保持主配置为唯一真相源。
 */
const fs = require('node:fs')
const path = require('node:path')

function loadMainConfig() {
  const file = path.join(__dirname, 'electron-builder.yml')
  // js-yaml 由 electron-builder 的依赖树提供；没有就明确报错，
  // 不要静默退化成一个缺项的配置。
  let yaml
  try {
    yaml = require('js-yaml')
  } catch {
    throw new Error(
      '找不到 js-yaml，无法读取 electron-builder.yml。请先 npm install，或改用默认构建。',
    )
  }
  return yaml.load(fs.readFileSync(file, 'utf8'))
}

const base = loadMainConfig()

const runtimeDir = path.join(__dirname, 'bin', 'whitebox')
const runtimeReady = fs.existsSync(path.join(runtimeDir, 'venv', 'bin', 'python'))
if (!runtimeReady) {
  throw new Error(
    [
      '随包白模环境不存在或不可用：' + runtimeDir,
      '',
      '先构建它（约 2GB，需要网络）：',
      '  node desktop/scripts/bundle-whitebox.mjs',
      '',
      '或者用默认构建（用户首次使用时自己装环境）：',
      '  npm run desktop:dist',
    ].join('\n'),
  )
}

module.exports = {
  ...base,
  extraResources: [
    ...(base.extraResources || []),
    // 预装的推理环境。做成 app/whitebox-runtime，服务端按 appRoot 相对读取。
    {
      from: 'desktop/bin/whitebox',
      to: 'app/whitebox-runtime',
      filter: ['**/*', '!.bundle-manifest.json'],
    },
  ],
}
