/**
 * 生成预置运镜库的缩略封面（poster）。
 *
 * 用法：
 *   node scripts/gen-lexicon-posters.mjs            # 只补缺失的封面
 *   node scripts/gen-lexicon-posters.mjs --force    # 全部重抽（替换 MP4 后用这个）
 *
 * 产物：public/presets/camera-moves-whitebox-132/thumbs/<key>.jpg
 * 并回写 manifest.json 的 entries[].poster
 */
import fs from 'node:fs'
import path from 'node:path'
import { execFileSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const CATALOG_DIR = path.join(ROOT, 'public/presets/camera-moves-whitebox-132')
const MANIFEST = path.join(CATALOG_DIR, 'manifest.json')
const THUMBS = path.join(CATALOG_DIR, 'thumbs')

/** 抽帧位置：4s 片的 0.8s 处，构图已展开又不贴片头 */
const SEEK = '0.8'
/** 缩略宽度；高度按 16:9 自动对齐（-2 保证偶数） */
const WIDTH = 480
const QUALITY = '4'

const force = process.argv.includes('--force')

function resolveFfmpeg() {
  const candidates = [
    process.env.FFMPEG_PATH,
    '/opt/homebrew/opt/ffmpeg-full/bin/ffmpeg',
    '/opt/homebrew/bin/ffmpeg',
    '/usr/local/bin/ffmpeg',
    '/usr/bin/ffmpeg',
  ].filter(Boolean)
  for (const bin of candidates) {
    try {
      execFileSync(bin, ['-version'], { stdio: 'ignore' })
      return bin
    } catch {
      // 换下一个候选
    }
  }
  throw new Error('未找到 ffmpeg，请安装或用 FFMPEG_PATH 指定')
}

function main() {
  if (!fs.existsSync(MANIFEST)) throw new Error(`manifest 缺失：${MANIFEST}`)
  const ffmpeg = resolveFfmpeg()
  const catalog = JSON.parse(fs.readFileSync(MANIFEST, 'utf8'))
  const entries = catalog.entries || []
  const basePath = catalog.basePath || '/presets/camera-moves-whitebox-132'
  fs.mkdirSync(THUMBS, { recursive: true })

  let made = 0
  let skipped = 0
  const failed = []

  for (const entry of entries) {
    const key = String(entry.key || '').trim()
    if (!key) continue
    const source = path.join(CATALOG_DIR, entry.filename || `${key}.mp4`)
    const target = path.join(THUMBS, `${key}.jpg`)
    entry.poster = `${basePath}/thumbs/${key}.jpg`

    if (!force && fs.existsSync(target) && fs.statSync(target).size > 0) {
      skipped++
      continue
    }
    if (!fs.existsSync(source)) {
      failed.push(`${key}（缺 MP4）`)
      continue
    }
    try {
      execFileSync(
        ffmpeg,
        [
          '-v', 'error',
          '-ss', SEEK,
          '-i', source,
          '-frames:v', '1',
          '-vf', `scale=${WIDTH}:-2`,
          '-q:v', QUALITY,
          '-y', target,
        ],
        { stdio: 'ignore' },
      )
      made++
    } catch (e) {
      failed.push(`${key}（${(e && e.message) || '抽帧失败'}）`)
    }
  }

  fs.writeFileSync(MANIFEST, `${JSON.stringify(catalog, null, 2)}\n`, 'utf8')

  console.log(
    `gen-lexicon-posters: 共 ${entries.length} 条，新生成 ${made}，复用 ${skipped}，失败 ${failed.length}`,
  )
  if (failed.length) {
    for (const f of failed) console.error(`  ❌ ${f}`)
    process.exit(1)
  }
  if (made > 0) {
    // 提示一下体积，避免误把大图提交进仓库
    const bytes = fs
      .readdirSync(THUMBS)
      .filter((f) => f.endsWith('.jpg'))
      .reduce((s, f) => s + fs.statSync(path.join(THUMBS, f)).size, 0)
    console.log(`  thumbs 目录共 ${(bytes / 1024).toFixed(0)} KB`)
  }
  console.log('gen-lexicon-posters: ok')
}

main()
