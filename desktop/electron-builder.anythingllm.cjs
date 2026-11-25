/**
 * 带内置知识库的打包配置。
 *
 * 用法：
 *   node desktop/scripts/bundle-anythingllm.mjs      # 先构建产物（约 1.7GB）
 *   npm run desktop:dist:knowledge                   # 打包
 *
 * 与默认配置的唯一差别是多带一个 knowledge/（约 1.7GB）：
 * AnythingLLM 的 server + collector（含 macOS 原生模块与预迁移空库）。
 * 主进程启动时会自动拉起它，并把地址与 API Key 注入本应用服务端。
 *
 * 体积代价：dmg 会比默认构建大约 1.7GB。这是产品决策——用户装完即可用知识库，
 * 不需要装 Docker。不需要时用默认构建（npm run desktop:dist）。
 *
 * 为什么不用 `extends`：见 electron-builder.bundled.cjs 的注释 ——
 * electron-builder 对 extraResources 是数组整体替换，extends 会冲掉主配置的条目。
 */
const fs = require('node:fs')
const path = require('node:path')

function loadMainConfig() {
  const file = path.join(__dirname, 'electron-builder.yml')
  let yaml
  try {
    yaml = require('js-yaml')
  } catch {
    throw new Error('找不到 js-yaml，无法读取 electron-builder.yml。请先 npm install，或改用默认构建。')
  }
  return yaml.load(fs.readFileSync(file, 'utf8'))
}

const base = loadMainConfig()

const runtimeDir = path.join(__dirname, 'bin', 'anythingllm')
const ready = fs.existsSync(path.join(runtimeDir, 'server', 'index.js'))
if (!ready) {
  throw new Error(
    [
      '内置知识库产物不存在或不可用：' + runtimeDir,
      '',
      '先构建它（需要本机有 docker 与 AnythingLLM 镜像）：',
      '  node desktop/scripts/bundle-anythingllm.mjs',
      '',
      '或者用默认构建（用户自己在设置页填外部知识库服务）：',
      '  npm run desktop:dist',
    ].join('\n'),
  )
}

module.exports = {
  ...base,
  extraResources: [
    ...(base.extraResources || []),
    /**
     * 内置知识库。放到 Resources/knowledge（与 bin、blender 同级）。
     *
     * 注意不能进 asar：里面有大量原生 .node 与 require 解析，asar 内不可 spawn
     * 也不可 dlopen。extraResources 是解包落盘，符合要求。
     */
    {
      from: 'desktop/bin/anythingllm',
      to: 'knowledge',
      filter: ['**/*', '!.bundle-manifest.json'],
    },
  ],
}
