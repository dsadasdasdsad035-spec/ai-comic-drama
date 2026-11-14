#!/usr/bin/env node
/**
 * gen-notices.mjs — 生成 desktop/THIRD-PARTY-NOTICES.md
 *
 * 为什么用脚本生成而不是手写（见 specs/desktop-app-packaging「第三方组件说明」）：
 * 版本号已经固定在 fetch-runtime.mjs 的 RUNTIMES 里，手写文档必然在某次升级后过期，
 * 而"随包组件的版本写错"正是合规审查最常抓的问题。这里直接从同一份常量取版本，
 * 从 node_modules 取实际安装版本，许可全文从官方地址下载并缓存。
 *
 * 用法：node desktop/scripts/gen-notices.mjs
 */
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { execFileSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'

const ROOT = path.resolve(import.meta.dirname, '..', '..')
const CACHE = path.join(os.tmpdir(), 'sb-licenses-cache')
const OUT = path.join(ROOT, 'desktop', 'THIRD-PARTY-NOTICES.md')

// 与 fetch-runtime.mjs 的 RUNTIMES 保持一致（那里是运行时下载的唯一真相源）
const RUNTIMES = {
  node: { version: '22.23.5', url: 'https://nodejs.org/dist/v22.23.5/' },
  ffmpeg: { version: '9.0.2', url: 'https://www.osxexperts.net/' },
  ffprobe: { version: '9.0.2', url: 'https://www.osxexperts.net/' },
  blender: { version: '4.5.9', url: 'https://download.blender.org/release/Blender4.5/' },
}

/** 许可全文来源；key 与正文里的引用一致 */
const LICENSE_SOURCES = {
  mit: { file: 'MIT.txt', name: 'MIT', url: 'https://raw.githubusercontent.com/spdx/license-list-data/main/text/MIT.txt' },
  'gpl-3.0': {
    file: 'GPL-3.0-or-later.txt',
    name: 'GNU General Public License v3.0 or later',
    url: 'https://raw.githubusercontent.com/spdx/license-list-data/main/text/GPL-3.0-or-later.txt',
  },
  'gpl-2.0': {
    file: 'GPL-2.0-or-later.txt',
    name: 'GNU General Public License v2.0 or later',
    url: 'https://raw.githubusercontent.com/spdx/license-list-data/main/text/GPL-2.0-or-later.txt',
  },
}

/**
 * 全文优先级：仓库内 desktop/licenses（已入库，离线可复现）→ /tmp 缓存 → 网络。
 *
 * 为什么不只靠网络：gnu.org 对连续请求会限流，本机 node fetch 连它还会 IPv6 超时；
 * 许可全文是合规产物的一部分，必须能在离线构建里稳定生成。
 */
const LOCAL_DIR = path.join(ROOT, 'desktop', 'licenses')

/** 用 curl 取文本：本机 node fetch 连 gnu.org 会连接超时，curl 走系统代理配置更可靠 */
function fetchWithCurl(url) {
  try {
    // 必须带 -4：gnu.org 的 IPv6 在本机网络下不通，curl 会在 IPv6 上耗尽 --max-time
    return execFileSync('curl', ['-sL', '-4', '--max-time', '45', url], {
      encoding: 'utf8',
      maxBuffer: 16 * 1024 * 1024,
    })
  } catch {
    return ''
  }
}

async function fetchText(key) {
  const spec = LICENSE_SOURCES[key]

  // 1) 仓库内已入库的全文（构建可离线复现）
  const local = path.join(LOCAL_DIR, spec.file)
  if (fs.existsSync(local)) return fs.readFileSync(local, 'utf8')

  // 2) 临时缓存
  const cached = path.join(CACHE, `${key}.txt`)
  if (fs.existsSync(cached)) return fs.readFileSync(cached, 'utf8')

  // 3) 网络
  let text = fetchWithCurl(spec.url)
  if (!text.trim()) {
    try {
      const res = await fetch(spec.url, { redirect: 'follow' })
      if (res.ok) text = await res.text()
    } catch {
      /* 落到报错 */
    }
  }
  if (!text.trim()) {
    throw new Error(
      `无法获取 ${spec.name} 全文。请把官方全文放到 ${path.relative(ROOT, local)} 后重跑。\n来源：${spec.url}`,
    )
  }
  // 少数地址返回 HTML 包裹时剔除标签
  const clean = text.includes('<html') ? stripHtml(text) : text
  fs.mkdirSync(CACHE, { recursive: true })
  fs.writeFileSync(cached, clean)
  return clean
}

function stripHtml(html) {
  return html
    .replace(/<script[\s\S]*?<\/script>/gi, '')
    .replace(/<style[\s\S]*?<\/style>/gi, '')
    .replace(/<[^>]+>/g, '')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&amp;/g, '&')
    .replace(/&quot;/g, '"')
    .replace(/\n{3,}/g, '\n\n')
    .trim()
}

function installedVersion(pkg) {
  try {
    return JSON.parse(fs.readFileSync(path.join(ROOT, 'node_modules', pkg, 'package.json'), 'utf8')).version
  } catch {
    return '(未安装)'
  }
}

function indent(text, prefix = '    ') {
  return text
    .trim()
    .split('\n')
    .map((l) => (l.trim() ? prefix + l : l))
    .join('\n')
}

const [mit, gpl3, gpl2] = await Promise.all([fetchText('mit'), fetchText('gpl-3.0'), fetchText('gpl-2.0')])

const electronVersion = installedVersion('electron')
const zodVersion = installedVersion('zod')
const fflateVersion = installedVersion('fflate')

const md = `# 第三方组件说明

本文档列出随「分镜画布（StoryboardCanvas）」安装包分发的全部第三方运行时与二进制，
以及它们各自适用的许可证。完整许可证全文见文末附录。

生成方式：\`node desktop/scripts/gen-notices.mjs\`（版本号取自 \`desktop/scripts/fetch-runtime.mjs\`
的固定常量与 \`node_modules\` 的实际安装版本，避免文档与产物不一致）。

## 总览

| 组件 | 版本 | 许可证 | 随包位置 |
|---|---|---|---|
| Electron | ${electronVersion} | MIT | \`Contents/Frameworks/\` |
| Node.js | ${RUNTIMES.node.version} | MIT | \`Contents/Resources/bin/node\` |
| FFmpeg | ${RUNTIMES.ffmpeg.version} | **GPL-3.0-or-later** | \`Contents/Resources/bin/ffmpeg\` |
| FFprobe | ${RUNTIMES.ffprobe.version} | **GPL-3.0-or-later** | \`Contents/Resources/bin/ffprobe\` |
| Blender | ${RUNTIMES.blender.version} | **GPL-2.0-or-later** | \`Contents/Resources/blender/Blender.app\` |
| zod | ${zodVersion} | MIT | \`Contents/Resources/app/node_modules/zod\` |
| fflate | ${fflateVersion} | MIT | \`Contents/Resources/app/node_modules/fflate\` |

---

## Electron

- 版本：${electronVersion}
- 来源：https://github.com/electron/electron/releases/tag/v${electronVersion}
- 许可证：MIT（见附录 A）
- 说明：应用外壳与窗口渲染进程。其内置的 Chromium 与 Node.js 组件的许可全文随包位于
  \`Contents/Resources/LICENSE.electron.txt\` 与 \`Contents/Resources/LICENSES.chromium.html\`。

## Node.js

- 版本：${RUNTIMES.node.version}
- 来源：${RUNTIMES.node.url}
- 许可证：MIT（见附录 A）
- 源码：https://github.com/nodejs/node/tree/v${RUNTIMES.node.version}
- 说明：本地服务的运行时。选择随包而非依赖用户安装，是为了保证 \`node:sqlite\` 可用且版本固定。

## FFmpeg / FFprobe

- 版本：${RUNTIMES.ffmpeg.version}
- 来源：${RUNTIMES.ffmpeg.url}（macOS arm64 静态构建）
- 许可证：**GNU General Public License v3.0 or later**（见附录 B）
- 上游项目：https://ffmpeg.org/

该构建启用了 \`--enable-gpl --enable-version3\`，因此整体以 GPL-3.0-or-later 分发。

**获取对应源码**

- FFmpeg 官方源码：https://ffmpeg.org/download.html
  或 Git 镜像 https://git.ffmpeg.org/ffmpeg.git（tag 对应版本 ${RUNTIMES.ffmpeg.version}）
- 该预编译构建的编译配置完整记录在二进制内，可用
  \`Contents/Resources/bin/ffmpeg -version\` 的前三行查看（\`configuration:\` 行）
- 如需可复现构建，可按上述 configuration 自行编译；本项目未修改 FFmpeg 源码

**分发说明**：FFmpeg 与本应用以独立进程方式协作（通过命令行调用，未静态或动态链接），
属于聚合分发。若贵方对 GPL 传染范围有更严格的要求，可将随包构建替换为
\`--disable-gpl\` 的 LGPL 构建，替换点仅 \`desktop/scripts/fetch-runtime.mjs\` 的 ffmpeg/ffprobe 条目。

## Blender

- 版本：${RUNTIMES.blender.version}
- 来源：${RUNTIMES.blender.url}（\`blender-${RUNTIMES.blender.version}-macos-arm64.dmg\`）
- 许可证：**GNU General Public License v2.0 or later**（见附录 C）
- 上游项目：https://www.blender.org/

**获取对应源码**

- 官方源码包：https://download.blender.org/source/
- 对应版本的发布说明与源码索引：https://download.blender.org/release/Blender4.5/
- Git 镜像：https://projects.blender.org/blender/blender.git（tag \`v${RUNTIMES.blender.version}\`）
- 本项目未修改 Blender 源码，仅原样拷贝官方发布的应用包

**分发说明**：Blender 以完整未修改的独立应用形式随包分发，通过命令行以子进程方式调用。

## zod

- 版本：${zodVersion}
- 来源：https://www.npmjs.com/package/zod/v/${zodVersion}
- 许可证：MIT（见附录 A）
- 说明：服务端请求校验。

## fflate

- 版本：${fflateVersion}
- 来源：https://www.npmjs.com/package/fflate/v/${fflateVersion}
- 许可证：MIT（见附录 A）
- 说明：服务端 zip 打包与解包。

---

## 附录 A：MIT License

适用组件：Electron、Node.js、zod、fflate

\`\`\`text
${mit.trim()}
\`\`\`

## 附录 B：GNU General Public License v3.0

适用组件：FFmpeg、FFprobe

\`\`\`text
${indent(gpl3).trimStart()}
\`\`\`

## 附录 C：GNU General Public License v2.0

适用组件：Blender

\`\`\`text
${indent(gpl2).trimStart()}
\`\`\`
`

fs.mkdirSync(path.dirname(OUT), { recursive: true })
fs.writeFileSync(OUT, md)
const sizeKb = (fs.statSync(OUT).size / 1024).toFixed(1)
console.log(`[notices] 已生成 ${path.relative(ROOT, OUT)}（${sizeKb} KB）`)
console.log(`[notices] Electron ${electronVersion} / Node ${RUNTIMES.node.version} / Blender ${RUNTIMES.blender.version}`)
console.log(`[notices] zod ${zodVersion} / fflate ${fflateVersion}`)

// 自检：每一项都必须能在文档里按版本号检索到
const text = fs.readFileSync(OUT, 'utf8')
const expected = [
  `Electron`,
  electronVersion,
  RUNTIMES.node.version,
  RUNTIMES.ffmpeg.version,
  RUNTIMES.blender.version,
  zodVersion,
  fflateVersion,
  'GPL-3.0-or-later',
  'GPL-2.0-or-later',
  'download.blender.org/source',
  'ffmpeg.org/download.html',
]
const missing = expected.filter((e) => !text.includes(e))
if (missing.length) {
  console.error(`[notices] 自检失败，缺少：${missing.join('、')}`)
  process.exit(1)
}
console.log('[notices] 自检通过')
