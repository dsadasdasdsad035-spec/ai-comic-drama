#!/usr/bin/env node
/**
 * bundle-whitebox.mjs — 把视频转白模的推理环境做进桌面端安装包
 *
 * 为什么需要它（对比默认构建）：
 * 默认打出的 .app 只带 whitebox/ 的 Python 脚本，用户首次使用要自己在终端跑
 * install.sh 装约 2GB 环境。这个脚本把那 2GB 预先装好、重写掉所有绝对路径、
 * 放进 desktop/bin/whitebox/，让安装包开箱即用。
 *
 * 代价：dmg 从约 1GB 涨到约 3GB。所以它是**可选构建**，由 BUNDLE_WHITEBOX=1 开启。
 *
 * 只支持 Apple Silicon：随包解释器是 aarch64，Intel Mac 跑不了。做双架构要
 * 双份环境（约 4.2GB），当前不做。
 *
 * 产物结构（desktop/bin/whitebox/，已进 .gitignore）：
 *   python/          python-build-standalone 的 aarch64 解释器（约 56MB）
 *   venv/            预装 torch/open3d/DA3 依赖的虚拟环境（约 1.5GB）
 *   vendor/          DA3 源码（锁定 commit，约 47MB）
 *   models/da3-base/ DA3-BASE 权重（约 516MB）
 *   .bundle-manifest.json  版本与校验记录
 *
 * 用法：
 *   node desktop/scripts/bundle-whitebox.mjs              # 构建（已存在则跳过）
 *   node desktop/scripts/bundle-whitebox.mjs --force       # 强制重建
 *   node desktop/scripts/bundle-whitebox.mjs --verify      # 只验证现有产物
 *
 * 前置：需要网络（GitHub 拉解释器与 DA3 源码、PyPI 装依赖、HuggingFace 拉权重）。
 * 受限网络下会自动读系统代理（与其他下载脚本一致）。
 */
import { execFileSync, spawnSync } from 'node:child_process'
import crypto from 'node:crypto'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { Readable } from 'node:stream'
import { pipeline } from 'node:stream/promises'

const ROOT = path.resolve(import.meta.dirname, '..', '..')
const BIN = path.join(ROOT, 'desktop', 'bin')
const DEST = path.join(BIN, 'whitebox')
const MANIFEST = path.join(DEST, '.bundle-manifest.json')
const CACHE = path.join(os.tmpdir(), 'sb-whitebox-bundle-cache')

/** DA3 源码锁定的 commit，必须与 whitebox/install.sh 保持一致 */
const DA3_COMMIT = '3d835ec1a5802d64a8b8b15f817a1ab54809bfe4'
const DA3_REPO = 'https://github.com/ByteDance-Seed/depth-anything-3.git'

/** python-build-standalone：可搬迁的 CPython，解压即用、不依赖系统 Python */
const PYTHON = {
  version: '3.12.16',
  release: '20261123',
  // stripped 变体去掉调试符号与测试套件，25.3MB，解压后约 50MB
  file: 'cpython-3.12.16+20261123-aarch64-apple-darwin-install_only_stripped.tar.gz',
  sha256: '0de87cfc2649849da10a54084f87fd01fa1e653478e32eee92198c213550e15c',
  get url() {
    return `https://github.com/astral-sh/python-build-standalone/releases/download/${this.release}/${encodeURIComponent(this.file)}`
  },
}

/** 与 whitebox/weights.json 保持一致的权重清单 */
const WEIGHTS = {
  repo: 'depth-anything/DA3-BASE',
  files: [
    {
      name: 'model.safetensors',
      url: 'https://huggingface.co/depth-anything/DA3-BASE/resolve/main/model.safetensors',
      bytes: 541518028,
      sha256: 'e01067dc1659613083d9145a9a2547ccdbe6ccbbf83c4fe7b3e8a4e2bdae78b5',
    },
    {
      name: 'config.json',
      url: 'https://huggingface.co/depth-anything/DA3-BASE/resolve/main/config.json',
      bytes: 1205,
      sha256: '',
    },
  ],
}

/** 运行时依赖。与 whitebox/install.sh 的同名步骤保持一致（跳过 xformers）。 */
const RUNTIME_DEPS = [
  'einops',
  'huggingface_hub',
  'imageio',
  'omegaconf',
  'safetensors',
  'pillow',
  'trimesh',
  'plyfile',
  'typer',
  'addict',
  'requests',
  'opencv-python-headless',
  'pillow-heif',
  'matplotlib',
  'scipy',
  'uvicorn',
  'pycolmap',
  'evo',
  'e3nn',
  'moviepy==1.0.3',
]

const force = process.argv.includes('--force')
const verifyOnly = process.argv.includes('--verify')

function log(msg) {
  console.log(`[bundle] ${msg}`)
}

function fail(msg) {
  console.error(`[bundle] ✗ ${msg}`)
  process.exit(1)
}

/** 与 server/apimart-network.mjs 的 resolveSystemHttpsProxy 同一套顺序 */
function resolveProxy() {
  for (const k of ['SB_HTTPS_PROXY', 'HTTPS_PROXY', 'https_proxy', 'HTTP_PROXY', 'http_proxy']) {
    const v = String(process.env[k] || '').trim()
    if (v) return v
  }
  if (process.platform !== 'darwin') return ''
  try {
    const out = execFileSync('scutil', ['--proxy'], { encoding: 'utf8', timeout: 3000 })
    const grab = (re) => out.match(re)?.[1] || ''
    if (/HTTPSEnable\s*:\s*1/.test(out)) {
      const host = grab(/HTTPSProxy\s*:\s*(\S+)/)
      const port = grab(/HTTPSPort\s*:\s*(\d+)/)
      if (host && port) return `http://${host}:${port}`
    }
    if (/HTTPEnable\s*:\s*1/.test(out)) {
      const host = grab(/HTTPProxy\s*:\s*(\S+)/)
      const port = grab(/HTTPPort\s*:\s*(\d+)/)
      if (host && port) return `http://${host}:${port}`
    }
  } catch {
    /* 非 mac 或无 scutil */
  }
  return ''
}

const PROXY = resolveProxy()

function sha256File(file) {
  const h = crypto.createHash('sha256')
  h.update(fs.readFileSync(file))
  return h.digest('hex')
}

/** 下载到缓存目录（按 sha256 命名，命中即复用） */
async function fetchCached(url, filename, expectedSha, { minBytes = 0 } = {}) {
  fs.mkdirSync(CACHE, { recursive: true })
  const dest = path.join(CACHE, filename)
  if (fs.existsSync(dest)) {
    if (expectedSha && sha256File(dest) === expectedSha) {
      log(`缓存命中：${filename}`)
      return dest
    }
    if (!expectedSha && fs.statSync(dest).size >= minBytes) {
      log(`缓存命中（未校验）：${filename}`)
      return dest
    }
    fs.rmSync(dest, { force: true })
  }

  log(`下载：${filename}`)
  const args = ['-sL', '--fail', '--max-time', '600', '-C', '-', '-o', dest]
  if (PROXY) args.push('--proxy', PROXY)
  args.push(url)

  // 大文件（权重）走 curl 的断点续传与硬超时；Node 的 fetch 遇到中途断裂不好恢复
  // 完成判据：优先用已知的文件大小（minBytes）。没有已知大小时（例如解释器
  // 压缩包我们没有记录解压前字节数）查询 HTTP 的 Content-Length。
  //
  // 不能只靠「这一轮大小没变」判停滞：curl 正常下完时最后一轮大小当然不变，
  // 之前就是这个写法把刚下完的解释器误判成停滞。
  let expected = minBytes
  if (!expected) {
    const head = spawnSync('curl', ['-sIL', ...(PROXY ? ['--proxy', PROXY] : []), url], {
      encoding: 'utf8',
      timeout: 30_000,
    })
    const sizes = [...String(head.stdout || '').matchAll(/content-length:\s*(\d+)/gi)].map((m) =>
      Number(m[1]),
    )
    // 重定向链上有多条 content-length，最后一条是文件本体
    expected = sizes.length ? sizes[sizes.length - 1] : 0
  }

  let stableRounds = 0
  let lastSize = -1
  for (let round = 0; round < 40; round++) {
    const size = fs.existsSync(dest) ? fs.statSync(dest).size : 0
    if (expected && size >= expected) break
    if (size === lastSize) {
      // 连续 3 轮没有增长才认为真的卡住（一轮 curl 可能只是超时重连）
      stableRounds++
      if (stableRounds >= 3) fail(`下载停滞：${filename}（${size}${expected ? `/${expected}` : ''} 字节）`)
    } else {
      stableRounds = 0
    }
    lastSize = size
    spawnSync('curl', args, { stdio: 'ignore' })
  }

  if (!fs.existsSync(dest)) fail(`下载失败：${filename}`)
  if (expected && fs.statSync(dest).size < expected) {
    fail(`下载不完整：${filename} 只有 ${fs.statSync(dest).size} / ${expected} 字节`)
  }
  if (expectedSha) {
    const actual = sha256File(dest)
    if (actual !== expectedSha) fail(`校验失败：${filename}\n  期望 ${expectedSha}\n  实际 ${actual}`)
  }
  return dest
}

function run(cmd, args, opts = {}) {
  const r = spawnSync(cmd, args, { stdio: 'inherit', ...opts })
  if (r.status !== 0) fail(`命令失败（退出码 ${r.status}）：${cmd} ${args.join(' ')}`)
}

function runQuiet(cmd, args, opts = {}) {
  const r = spawnSync(cmd, args, { encoding: 'utf8', ...opts })
  if (r.status !== 0) {
    return { ok: false, out: `${r.stdout || ''}\n${r.stderr || ''}`.trim() }
  }
  return { ok: true, out: String(r.stdout || '').trim() }
}

// ------------------------------------------------------------------ 校验

function verifyBundle() {
  const problems = []
  const py = path.join(DEST, 'python', 'bin', 'python3.12')
  const venvPy = path.join(DEST, 'venv', 'bin', 'python')
  const src = path.join(DEST, 'vendor', 'depth-anything-3', 'src', 'depth_anything_3')
  const weights = path.join(DEST, 'models', 'da3-base', 'model.safetensors')
  const config = path.join(DEST, 'models', 'da3-base', 'config.json')

  if (!fs.existsSync(py)) problems.push(`解释器缺失：${py}`)
  if (!fs.existsSync(venvPy)) problems.push(`venv 缺失：${venvPy}`)
  if (!fs.existsSync(src)) problems.push(`DA3 源码缺失：${src}`)
  if (!fs.existsSync(weights)) problems.push(`权重缺失：${weights}`)
  else if (fs.statSync(weights).size !== WEIGHTS.files[0].bytes) {
    problems.push(`权重大小不符：${fs.statSync(weights).size}`)
  }
  if (!fs.existsSync(config)) problems.push(`config.json 缺失：${config}`)

  if (problems.length) return { ok: false, problems }

  // 真正跑一次导入：软链接/路径重写错了只有这一步能发现
  const r = runQuiet(
    venvPy,
    [
      '-W', 'ignore', '-c',
      // 用带前缀的单行输出：DA3 导入时会往 stdout 打 gsplat 警告，
      // 直接按行取前两行会把警告当成版本号（实测踩过）。
      `import sys, json, torch, open3d, trimesh, cv2
sys.path.insert(0, ${JSON.stringify(path.join(DEST, 'vendor', 'depth-anything-3', 'src'))})
from depth_anything_3.api import DepthAnything3
print('SELFTEST ' + json.dumps({'torch': torch.__version__, 'device': 'mps' if torch.backends.mps.is_available() else 'cpu'}))`,
    ],
    { env: { ...process.env, KMP_DUPLICATE_LIB_OK: 'TRUE' } },
  )
  if (!r.ok) {
    problems.push(`导入自检失败：${r.out.split('\n').filter(Boolean).slice(-3).join(' | ')}`)
    return { ok: false, problems }
  }
  const line = r.out.split('\n').find((l) => l.startsWith('SELFTEST '))
  if (!line) {
    problems.push(`自检输出无法解析：${r.out.slice(-300)}`)
    return { ok: false, problems }
  }
  const parsed = JSON.parse(line.slice('SELFTEST '.length))
  return { ok: true, torchVersion: parsed.torch, device: parsed.device }
}

if (verifyOnly) {
  const res = verifyBundle()
  if (!res.ok) {
    for (const p of res.problems) console.error(`[bundle] ✗ ${p}`)
    process.exit(1)
  }
  log(`✓ 产物可用：torch ${res.torchVersion} · 设备 ${res.device}`)
  process.exit(0)
}

// ------------------------------------------------------------------ 构建

if (process.arch !== 'arm64') {
  fail('只支持 Apple Silicon（随包解释器为 aarch64）。')
}

const existing = verifyBundle()
if (existing.ok && !force) {
  log(`已存在可用产物，跳过构建（--force 强制重建）`)
  log(`  torch ${existing.torchVersion} · 设备 ${existing.device}`)
  process.exit(0)
}

if (fs.existsSync(DEST)) {
  log('清理旧产物…')
  fs.rmSync(DEST, { recursive: true, force: true })
}
fs.mkdirSync(DEST, { recursive: true })

// ---- 1. Python 解释器 ----
log('步骤 1/5：准备可搬迁的 Python 解释器')
const pyTarball = await fetchCached(PYTHON.url, PYTHON.file, PYTHON.sha256)
const pyTmp = fs.mkdtempSync(path.join(os.tmpdir(), 'sb-py-'))
try {
  run('tar', ['-xzf', pyTarball, '-C', pyTmp])
  // install_only 包解压出 python/ 目录
  const extracted = path.join(pyTmp, 'python')
  if (!fs.existsSync(extracted)) fail(`解压后结构不符预期：${fs.readdirSync(pyTmp).join(', ')}`)
  fs.cpSync(extracted, path.join(DEST, 'python'), { recursive: true })
} finally {
  fs.rmSync(pyTmp, { recursive: true, force: true })
}
const bundledPy = path.join(DEST, 'python', 'bin', 'python3.12')
if (!fs.existsSync(bundledPy)) fail(`解释器不可执行：${bundledPy}`)
log(`  ✓ Python ${PYTHON.version}`)

// ---- 2. venv ----
log('步骤 2/5：创建 venv')
// --copies 让 venv/bin/python 是解释器的副本而不是软链接指向构建机路径。
// 用软链接的话，产物只能在同一台机器上工作（实测过：搬到别处就 bad interpreter）。
run(bundledPy, ['-m', 'venv', '--copies', path.join(DEST, 'venv')])
const venvPy = path.join(DEST, 'venv', 'bin', 'python')

// 把 pyvenv.cfg 的相对关系钉死在产物内：home 指向随包解释器
const cfg = path.join(DEST, 'venv', 'pyvenv.cfg')
fs.writeFileSync(
  cfg,
  [
    `home = ${path.join(DEST, 'python', 'bin')}`,
    'include-system-site-packages = false',
    `version = ${PYTHON.version}`,
    `executable = ${bundledPy}`,
    'command = bundle-whitebox.mjs',
    '',
  ].join('\n'),
)
log('  ✓ venv（--copies，pyvenv.cfg 已重写）')

// ---- 3. 依赖 ----
log('步骤 3/5：安装推理依赖（torch / open3d / DA3 runtime，约 1.5GB，耗时较长）')
const constraints = path.join(DEST, 'constraints.txt')
fs.writeFileSync(constraints, 'numpy==1.26.4\n')

runQuiet(venvPy, ['-m', 'pip', 'install', '--quiet', '--upgrade', 'pip'])
const pipHelp = runQuiet(venvPy, ['-m', 'pip', 'install', '--help'])
const resumeFlag = pipHelp.ok && pipHelp.out.includes('--resume-retries') ? ['--resume-retries', '30'] : []

const pipEnv = { ...process.env }
if (PROXY) {
  pipEnv.HTTPS_PROXY = PROXY
  pipEnv.HTTP_PROXY = PROXY
}

function pipInstall(label, pkgs) {
  log(`  → ${label}`)
  run(
    venvPy,
    ['-m', 'pip', 'install', '--quiet', '--constraint', constraints, '--timeout', '180', '--retries', '10', ...resumeFlag, ...pkgs],
    { env: pipEnv },
  )
}

pipInstall('torch + torchvision（约 111MB）', ['numpy==1.26.4', 'torch==2.13.0', 'torchvision==0.28.0'])
pipInstall('open3d（约 450MB）', ['open3d'])
pipInstall('DA3 runtime deps', RUNTIME_DEPS)
log('  ✓ 依赖就绪')

// ---- 4. DA3 源码 ----
log('步骤 4/5：克隆 DA3 源码（锁定 commit）')
const vendorDir = path.join(DEST, 'vendor', 'depth-anything-3')
fs.mkdirSync(path.dirname(vendorDir), { recursive: true })
const gitEnv = { ...process.env }
if (PROXY) {
  gitEnv.HTTPS_PROXY = PROXY
  gitEnv.HTTP_PROXY = PROXY
}
run('git', ['clone', '--filter=blob:none', '--no-checkout', DA3_REPO, vendorDir], { env: gitEnv })
run('git', ['-C', vendorDir, 'checkout', '--quiet', DA3_COMMIT])
// 不要 .git：几十 MB 的仓库元数据对运行时无用，还会被签名扫描拖慢
fs.rmSync(path.join(vendorDir, '.git'), { recursive: true, force: true })
log(`  ✓ DA3 @ ${DA3_COMMIT.slice(0, 8)}`)

// ---- 5. 权重 ----
log('步骤 5/5：下载 DA3-BASE 权重（约 516MB）')
const modelsDir = path.join(DEST, 'models', 'da3-base')
fs.mkdirSync(modelsDir, { recursive: true })
for (const f of WEIGHTS.files) {
  const cached = await fetchCached(f.url, `da3-base-${f.name}`, f.sha256, { minBytes: f.bytes })
  fs.copyFileSync(cached, path.join(modelsDir, f.name))
  log(`  ✓ ${f.name}`)
}

// ---- 清单 ----
const totals = {}
for (const part of ['python', 'venv', 'vendor', 'models']) {
  const dir = path.join(DEST, part)
  if (!fs.existsSync(dir)) continue
  totals[part] = Number(
    execFileSync('du', ['-sk', dir], { encoding: 'utf8' }).trim().split(/\s+/)[0],
  )
}
fs.writeFileSync(
  MANIFEST,
  JSON.stringify(
    {
      schema: 'whitebox_bundle_v1',
      builtAt: new Date().toISOString(),
      arch: process.arch,
      python: PYTHON.version,
      da3Commit: DA3_COMMIT,
      weights: WEIGHTS.repo,
      sizesKb: totals,
    },
    null,
    2,
  ),
)

// ---- 自检 ----
const final = verifyBundle()
if (!final.ok) {
  for (const p of final.problems) console.error(`[bundle] ✗ ${p}`)
  fail('构建完成但自检未通过')
}

const totalMb = Object.values(totals).reduce((a, b) => a + b, 0) / 1024
log(`✓ 完成：${DEST}（约 ${totalMb.toFixed(0)}MB）`)
log(`  torch ${final.torchVersion} · 设备 ${final.device}`)
log(`  下一步：BUNDLE_WHITEBOX=1 npm run desktop:dist`)
