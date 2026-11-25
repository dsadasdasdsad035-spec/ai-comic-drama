/**
 * bundle-anythingllm.mjs — 把 AnythingLLM 做成可随桌面端分发的本地知识库服务。
 *
 * 为什么要这个脚本（而不是让用户装 docker）：
 * 桌面版要求「装上就能用」。让用户为了知识库去装 Docker、拉 5GB 镜像，是产品层面的
 * 断点。这里把镜像里的 server + collector 抠出来、换成 macOS 原生模块，做成一个
 * 可由主进程直接 spawn 的普通目录。
 *
 * 产物（desktop/bin/anythingllm/，已进 .gitignore）：
 *   server/          服务端（Node 程序 + node_modules）
 *   collector/       文档解析进程（Node 程序 + node_modules）
 *   template.db      预迁移好的空库，首次启动复制到用户数据目录
 *   .bundle-manifest.json  上游版本与构建时间
 *
 * 关键实现要点（都是踩出来的，改动时别丢）：
 *
 * 1. **不从源码 npm install**。镜像里的 node_modules 与它自己的 lockfile 不一致
 *    （实测 @modelcontextprotocol/sdk 要求 zod ^3.25 而 lock 是 3.23.5），重新安装
 *    会撞版本冲突。正确做法是直接搬镜像里那套已验证可运行的依赖树，只替换原生模块。
 *
 * 2. **原生模块必须换 darwin**。镜像里是 linux-arm64：@lancedb、@mintplex-labs/mdpdf、
 *    sharp、onnxruntime-node。直接跑会 dlopen 失败。
 *
 * 3. **prisma 要用 env("DATABASE_URL")**。schema 原本写死 file:../storage/anythingllm.db
 *    （相对 prisma/ 目录）。打包后 .app 只读，写不进去，所以构建期改成读环境变量。
 *
 * 4. **collector 的 hotdir 也要改成读环境变量**。它用 path.resolve(__dirname, "../hotdir")，
 *    在只读产物里同样写不进去。
 *
 * 用法：
 *   node desktop/scripts/bundle-anythingllm.mjs            # 构建（已存在则跳过）
 *   node desktop/scripts/bundle-anythingllm.mjs --force    # 强制重建
 *   node desktop/scripts/bundle-anythingllm.mjs --verify   # 只验证现有产物
 *
 * 前置：docker 有权访问镜像 mintplexlabs/anythingllm（默认用本地 :local 或 :latest 标签）。
 */
import { execFileSync } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

const ROOT = path.resolve(import.meta.dirname, '..', '..')
const OUT = path.join(ROOT, 'desktop', 'bin', 'anythingllm')
const MANIFEST = path.join(OUT, '.bundle-manifest.json')
const FORCE = process.argv.includes('--force')
const VERIFY_ONLY = process.argv.includes('--verify')

/** 镜像候选：本地打过的标签优先，其次官方名。 */
const IMAGE_CANDIDATES = [
  'mintplexlabs/anythingllm:local',
  'mintplexlabs/anythingllm:latest',
  'docker.1ms.run/mintplexlabs/anythingllm:latest',
]

/** 需要换成 macOS 原生版的模块（版本以镜像内为准，保证 ABI 一致）。 */
const NATIVE_MODULES = ['@lancedb/lancedb', '@mintplex-labs/mdpdf', 'sharp', 'onnxruntime-node']

function log(msg) {
  console.log(`[anythingllm] ${msg}`)
}

function run(cmd, args, opts = {}) {
  return execFileSync(cmd, args, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'inherit'], ...opts })
}

function exists(p) {
  try {
    return fs.existsSync(p)
  } catch {
    return false
  }
}

function dirSizeMB(dir) {
  try {
    const out = run('du', ['-sk', dir]).trim()
    return Math.round(Number(out.split(/\s+/)[0]) / 1024)
  } catch {
    return 0
  }
}

/** 找一个可用的镜像 */
function resolveImage() {
  for (const img of IMAGE_CANDIDATES) {
    try {
      run('docker', ['image', 'inspect', img])
      return img
    } catch {
      /* 试下一个 */
    }
  }
  throw new Error(
    [
      '找不到 AnythingLLM 镜像。先拉取一个（任选其一）：',
      '',
      '  docker pull mintplexlabs/anythingllm:latest',
      '  docker pull docker.1ms.run/mintplexlabs/anythingllm:latest   # 国内镜像源',
      '',
      '然后重新运行本脚本。',
    ].join('\n'),
  )
}

/** 从镜像读出发布版本，写进 manifest 便于日后判断是否需要重建 */
function imageVersion(image) {
  try {
    const out = run('docker', ['exec', `${image}`, 'printenv', 'DEPLOYMENT_VERSION'], {
      stdio: ['ignore', 'pipe', 'ignore'],
    }).trim()
    if (out) return out
  } catch {
    /* 镜像未运行也允许，退回去 inspect */
  }
  try {
    const labels = run('docker', ['image', 'inspect', image, '--format', '{{json .Config.Labels}}'])
    const obj = JSON.parse(labels || '{}')
    return String(obj['org.opencontainers.image.version'] || '')
  } catch {
    return ''
  }
}

/** 校验产物完整性：缺任何一个关键件就当作不可用 */
function verify() {
  const problems = []
  const need = [
    'server/index.js',
    'server/node_modules/.prisma/client',
    'server/node_modules/@lancedb/lancedb',
    'server/node_modules/onnxruntime-node',
    'server/node_modules/@xenova/transformers',
    // 换原生模块时最容易误伤的邻居：@mintplex-labs 下除了 mdpdf 还住着这两个
    'server/node_modules/@mintplex-labs/bree',
    'server/node_modules/@mintplex-labs/express-ws',
    'collector/index.js',
    'collector/node_modules/onnxruntime-node',
    'template.db',
  ]
  for (const rel of need) {
    if (!exists(path.join(OUT, rel))) problems.push(`缺少 ${rel}`)
  }
  // schema 必须已被改成读 env，否则打包后写不进数据库。
  // 只看 datasource 里的真实 url 行：注释里也有一份 file: 写法，用 includes 会误判。
  try {
    const schema = fs.readFileSync(path.join(OUT, 'server', 'prisma', 'schema.prisma'), 'utf8')
    const hasEnv = /^\s*url\s*=\s*env\(\s*"DATABASE_URL"\s*\)\s*$/m.test(schema)
    const hardcoded = /^\s*url\s*=\s*"file:\.\.\/storage\/anythingllm\.db"\s*$/m.test(schema)
    if (!hasEnv || hardcoded) {
      problems.push('schema.prisma 的 url 仍未指向 DATABASE_URL（打包后无法写入数据库）')
    }
  } catch {
    problems.push('读不到 server/prisma/schema.prisma')
  }
  // collector 的 hotdir 必须可被环境变量覆盖
  try {
    const constants = fs.readFileSync(path.join(OUT, 'collector', 'utils', 'constants.js'), 'utf8')
    if (!constants.includes('COLLECTOR_HOTDIR')) {
      problems.push('collector/utils/constants.js 未支持 COLLECTOR_HOTDIR')
    }
  } catch {
    problems.push('读不到 collector/utils/constants.js')
  }
  return problems
}

if (VERIFY_ONLY) {
  const problems = verify()
  if (problems.length) {
    console.error('[anythingllm] 产物不可用：')
    for (const p of problems) console.error('  - ' + p)
    process.exit(1)
  }
  const m = JSON.parse(fs.readFileSync(MANIFEST, 'utf8'))
  console.log(`[anythingllm] 产物可用：上游 ${m.upstreamVersion || '未知版本'}，${dirSizeMB(OUT)} MB`)
  process.exit(0)
}

// ---------------------------------------------------------------- 跳过或重建

if (!FORCE && exists(MANIFEST)) {
  const problems = verify()
  if (!problems.length) {
    const m = JSON.parse(fs.readFileSync(MANIFEST, 'utf8'))
    log(`已存在可用产物（上游 ${m.upstreamVersion || '未知版本'}，${dirSizeMB(OUT)} MB），跳过`)
    log('需要重建时加 --force')
    process.exit(0)
  }
  log('已有产物不完整，重建：')
  for (const p of problems) log('  - ' + p)
}

const image = resolveImage()
const version = imageVersion(image)
log(`来源镜像：${image}${version ? `（上游 ${version}）` : ''}`)

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'allm-bundle-'))
const nodeBin = path.join(ROOT, 'desktop', 'bin', 'node')
if (!exists(nodeBin)) {
  throw new Error(`缺少随包 Node：${nodeBin}（先跑 node desktop/scripts/fetch-runtime.mjs）`)
}

try {
  // ---------------------------------------------------------------- 1. 搬镜像里的完整依赖树
  /*
   * `docker cp` 只认容器，不认镜像名（直接对镜像用会报 No such container）。
   * 所以先 create 一个不启动的临时容器，拷完就删 —— create 不占端口也不跑进程，
   * 比 run 起一个再杀更干净。
   */
  const tmpContainer = `allm-bundle-${process.pid}`
  log('创建临时容器用于取文件 …')
  run('docker', ['create', '--name', tmpContainer, image])
  try {
    fs.rmSync(OUT, { recursive: true, force: true })
    fs.mkdirSync(OUT, { recursive: true })
    for (const part of ['server', 'collector']) {
      log(`复制 ${part}/ …`)
      run('docker', ['cp', `${tmpContainer}:/app/${part}`, path.join(OUT, part)])
    }
  } finally {
    try {
      run('docker', ['rm', '-f', tmpContainer])
    } catch {
      /* 清理失败不阻塞：容器不启动，留着也不会占端口 */
    }
  }
  // 镜像里的 storage 是它自己的运行数据，不能带进产物
  fs.rmSync(path.join(OUT, 'server', 'storage'), { recursive: true, force: true })
  fs.rmSync(path.join(OUT, 'server', '.env'), { force: true })
  log(`复制完成：${dirSizeMB(OUT)} MB`)

  // ---------------------------------------------------------------- 2. 换 macOS 原生模块
  log('安装 macOS 原生模块 …')
  const nativeDir = path.join(tmp, 'native')
  fs.mkdirSync(nativeDir, { recursive: true })
  const versions = {}
  for (const mod of NATIVE_MODULES) {
    try {
      const pkg = JSON.parse(
        fs.readFileSync(path.join(OUT, 'server', 'node_modules', mod, 'package.json'), 'utf8'),
      )
      versions[mod] = pkg.version
    } catch {
      throw new Error(`镜像里找不到 ${mod}，无法确定版本`)
    }
  }
  fs.writeFileSync(
    path.join(nativeDir, 'package.json'),
    JSON.stringify({ name: 'allm-natives', private: true, dependencies: versions }, null, 2),
  )
  execFileSync('npm', ['install', '--legacy-peer-deps', '--no-audit', '--no-fund'], {
    cwd: nativeDir,
    stdio: 'inherit',
    env: { ...process.env },
  })

  /**
   * 把装了 darwin 版的模块覆盖到产物里。
   *
   * 两条踩过的坑：
   * 1. @lancedb 与 @mintplex-labs 是「主包 + 平台子包」结构，主包本身不含二进制 ——
   *    只换平台子包会漏掉主包（Cannot find module '@lancedb/lancedb'）。
   * 2. **不能整目录覆盖 scope**。@mintplex-labs 下除了 mdpdf 还住着 bree / express-ws，
   *    整目录替换会把它们删掉（Cannot find module '@mintplex-labs/bree'）。
   *    所以按「具体包名」逐个覆盖，scope 目录只做 mkdir。
   */
  const copyInto = (targetRoot) => {
    const pkgs = [
      '@lancedb/lancedb',
      '@lancedb/lancedb-darwin-arm64',
      '@mintplex-labs/mdpdf',
      '@mintplex-labs/mdpdf-darwin-arm64',
      'sharp',
      'onnxruntime-node',
      '@img/sharp-darwin-arm64',
      '@img/sharp-libvips-darwin-arm64',
    ]
    for (const pkg of pkgs) {
      const from = path.join(nativeDir, 'node_modules', pkg)
      if (!exists(from)) continue
      const to = path.join(targetRoot, 'node_modules', pkg)
      fs.mkdirSync(path.dirname(to), { recursive: true })
      fs.rmSync(to, { recursive: true, force: true })
      fs.cpSync(from, to, { recursive: true, verbatimSymlinks: true })
    }
  }

  // server 与 collector 各有一份依赖树，都要换（版本可能不同，所以分别用各自镜像内的）
  for (const part of ['server', 'collector']) {
    const partNodeModules = path.join(OUT, part, 'node_modules')
    if (!exists(partNodeModules)) continue
    // 删掉 linux 平台子包，避免体积浪费与误加载
    for (const glob of ['@lancedb/lancedb-linux*', '@mintplex-labs/mdpdf-linux*']) {
      const [scope, name] = glob.split('/')
      const scopeDir = path.join(partNodeModules, scope)
      if (!exists(scopeDir)) continue
      for (const entry of fs.readdirSync(scopeDir)) {
        const prefix = name.replace(/\*$/, '')
        if (glob.endsWith('*') && entry.startsWith(prefix)) {
          fs.rmSync(path.join(scopeDir, entry), { recursive: true, force: true })
        }
      }
    }
    copyInto(path.join(OUT, part))
    log(`${part}/ 原生模块已替换`)
  }

  // ---------------------------------------------------------------- 3. 让数据库路径可配
  log('改写 prisma schema 为 DATABASE_URL …')
  const schemaPath = path.join(OUT, 'server', 'prisma', 'schema.prisma')
  let schema = fs.readFileSync(schemaPath, 'utf8')
  /*
   * 判「是否已改写」不能用 includes('file:../storage/...')：那串在注释里也出现，
   * 会把未改写的 schema 误判成已改，然后静默跳过（实测踩过）。
   * 只看 datasource 块里真正的 url 行。
   */
  const liveUrlRe = /^\s*url\s*=\s*"file:\.\.\/storage\/anythingllm\.db"\s*$/m
  if (liveUrlRe.test(schema)) {
    schema = schema.replace(liveUrlRe, 'url      = env("DATABASE_URL")')
    fs.writeFileSync(schemaPath, schema)
  }
  const check = fs.readFileSync(schemaPath, 'utf8')
  const hasEnvUrl = /^\s*url\s*=\s*env\(\s*"DATABASE_URL"\s*\)\s*$/m.test(check)
  const stillHardcoded = liveUrlRe.test(check)
  if (!hasEnvUrl || stillHardcoded) {
    throw new Error('schema.prisma 改写失败：url 行仍未指向 DATABASE_URL')
  }

  // ---------------------------------------------------------------- 4. 让 collector 的 hotdir 可配
  log('改写 collector hotdir 为环境变量 …')
  const constantsPath = path.join(OUT, 'collector', 'utils', 'constants.js')
  let constants = fs.readFileSync(constantsPath, 'utf8')
  if (!constants.includes('COLLECTOR_HOTDIR')) {
    constants = constants.replace(
      /const WATCH_DIRECTORY = require\("path"\)\.resolve\(__dirname, "\.\.\/hotdir"\);/,
      [
        '// 打包后端产物只读，hotdir 必须能指向用户数据目录（bundle-anythingllm.mjs 注入）',
        'const WATCH_DIRECTORY = process.env.COLLECTOR_HOTDIR',
        '  ? require("path").resolve(process.env.COLLECTOR_HOTDIR)',
        '  : require("path").resolve(__dirname, "../hotdir");',
      ].join('\n'),
    )
    if (!constants.includes('COLLECTOR_HOTDIR')) {
      throw new Error('collector/utils/constants.js 改写失败：没找到 WATCH_DIRECTORY 定义')
    }
    fs.writeFileSync(constantsPath, constants)
  }
  // 清空逻辑同样硬编码，一起改
  const filesPath = path.join(OUT, 'collector', 'utils', 'files', 'index.js')
  let filesSrc = fs.readFileSync(filesPath, 'utf8')
  if (filesSrc.includes('path.resolve(__dirname, "../../hotdir")')) {
    filesSrc = filesSrc.replace(
      'const directory = path.resolve(__dirname, "../../hotdir");',
      'const directory = process.env.COLLECTOR_HOTDIR\n      ? path.resolve(process.env.COLLECTOR_HOTDIR)\n      : path.resolve(__dirname, "../../hotdir");',
    )
    fs.writeFileSync(filesPath, filesSrc)
  }

  // ---------------------------------------------------------------- 5. 生成 prisma client + 空库模板
  log('生成 prisma client（darwin）…')
  const prismaBin = path.join(OUT, 'server', 'node_modules', '.bin', 'prisma')
  const baseEnv = { ...process.env, PATH: `${path.dirname(nodeBin)}:${process.env.PATH || ''}` }
  execFileSync(prismaBin, ['generate'], {
    cwd: path.join(OUT, 'server'),
    stdio: 'inherit',
    env: baseEnv,
  })

  log('生成预迁移的空库模板 …')
  const templateDb = path.join(OUT, 'template.db')
  fs.rmSync(templateDb, { force: true })
  /*
   * DATABASE_URL 必须是**绝对路径**。Prisma 对 `file:` 的相对路径是相对 schema 所在目录
   * 解析的，写成 file:template.db 会落到 server/storage/ 里（实测过），
   * 于是你以为在 OUT 下，实际找不到。
   */
  execFileSync(prismaBin, ['migrate', 'deploy'], {
    cwd: path.join(OUT, 'server'),
    stdio: 'inherit',
    env: { ...baseEnv, DATABASE_URL: `file:${templateDb}` },
  })
  // 迁移顺带在 server/storage 里留下的库要清掉：产物不该带运行数据
  fs.rmSync(path.join(OUT, 'server', 'storage'), { recursive: true, force: true })
  if (!exists(templateDb)) throw new Error(`迁移后没有生成 template.db（期望位置：${templateDb}）`)
  log(`template.db：${Math.round(fs.statSync(templateDb).size / 1024)} KB`)

  // ---------------------------------------------------------------- 6. 写清单
  fs.writeFileSync(
    MANIFEST,
    JSON.stringify(
      {
        upstreamVersion: version,
        image,
        nativeModules: versions,
        builtAt: new Date().toISOString(),
        nodeVersion: run(nodeBin, ['-v']).trim(),
      },
      null,
      2,
    ),
  )

  const problems = verify()
  if (problems.length) {
    throw new Error('构建产物自检失败：\n  - ' + problems.join('\n  - '))
  }
  log(`完成：${OUT}（${dirSizeMB(OUT)} MB）`)
  log('打包时用 BUNDLE_ANYTHINGLLM=1，见 desktop/electron-builder.anythingllm.cjs')
} finally {
  fs.rmSync(tmp, { recursive: true, force: true })
}
