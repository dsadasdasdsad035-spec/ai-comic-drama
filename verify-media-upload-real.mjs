/**
 * 用真实拍摄照片验证本地上传链路（cat 仓库的 9 张猫咪参考照）。
 *
 * 与 verify-media-upload.mjs 的分工：那边测纯函数与假字节，这边测真实文件特征 ——
 * 1536×2048 的 JPEG、渐进式编码、EXIF、中文文件名、2.3MB 的 PNG。
 *
 * 覆盖：
 * 1) 客户端校验放行全部真实照片（类型/MIME/大小/编码膨胀）
 * 2) 真实 /api/save-image 往返：返回站内地址、落盘字节与源文件逐字节一致
 * 3) 中文文件名不破坏落盘与后续引用
 * 4) UI 里把真实照片上传进设定卡，卡片能渲染、能加入画布
 * 5) 真实照片走素材卡上传 + 连线参考，出图请求带上它
 *
 * 跑法：node verify-media-upload-real.mjs [照片目录]
 * 默认读 /tmp/cat-probe/猫咪真实参考照片；目录不存在则跳过并说明。
 */
import { spawn } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { execFileSync } from 'node:child_process'
import { chromium } from 'playwright-core'

const ROOT = path.dirname(fileURLToPath(import.meta.url))
const PHOTO_DIR = process.argv[2] || '/tmp/cat-probe/猫咪真实参考照片'
const PORT = 5317
const APP = `http://127.0.0.1:${PORT}`
const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'upload-real-'))
const PROJECT = 'cat-upload'

let bad = 0
let skipped = 0
const check = (n, c, e = '') => {
  console.log(`${c ? '✅' : '❌'} ${n}${e ? ' | ' + e : ''}`)
  if (!c) bad++
}
const skip = (n, why) => {
  console.log(`⏭️  ${n} | ${why}`)
  skipped++
}
const api = (p, init) =>
  fetch(`${APP}${p}`, init).then(async (r) => ({ ...(await r.json().catch(() => ({}))), status: r.status }))

if (!fs.existsSync(PHOTO_DIR)) {
  console.log(`⏭️  真实照片目录不存在：${PHOTO_DIR}`)
  console.log('   先克隆：git clone --depth 1 https://github.com/dsadasdasdsad035-spec/cat.git /tmp/cat-probe')
  process.exit(0)
}

const photos = fs
  .readdirSync(PHOTO_DIR)
  .filter((f) => /\.(jpe?g|png|webp)$/i.test(f))
  .map((f) => ({ name: f, file: path.join(PHOTO_DIR, f), bytes: fs.readFileSync(path.join(PHOTO_DIR, f)) }))
  .sort((a, b) => b.bytes.length - a.bytes.length)

if (photos.length === 0) {
  console.log('⏭️  目录里没有图片')
  process.exit(0)
}
console.log(`读取 ${photos.length} 张真实照片，共 ${(photos.reduce((n, p) => n + p.bytes.length, 0) / 1024 / 1024).toFixed(1)}MB\n`)

// ---------------------------------------------------------------- 1) 客户端校验
const outDir = fs.mkdtempSync(path.join(ROOT, '.verify-real-'))
const esbuild = path.join(ROOT, 'node_modules', '.bin', 'esbuild')
const bundle = (entry, name) => {
  const out = path.join(outDir, `${name}.mjs`)
  execFileSync(esbuild, [entry, '--bundle', '--platform=node', '--format=esm', '--log-level=error', `--outfile=${out}`])
  return out
}
const U = await import(bundle('src/mediaUpload.ts', 'mediaUpload'))

const mimeOf = (name) => (/\.png$/i.test(name) ? 'image/png' : 'image/jpeg')
let passedAll = true
for (const p of photos) {
  const v = U.pickImageFile({ name: p.name, size: p.bytes.length, type: mimeOf(p.name) })
  if (!v.ok) {
    passedAll = false
    console.log(`   ❌ ${p.name}: ${v.reason}`)
  }
}
check(`全部 ${photos.length} 张真实照片通过客户端校验`, passedAll)
check(
  '识别出真实 JPEG 的 MIME',
  U.imageMimeOf({ name: photos.find((p) => /\.jpe?g$/i.test(p.name)).name, type: 'image/jpeg' }) === 'image/jpeg',
)
check(
  '真实 PNG 识别为 png',
  U.imageMimeOf({ name: photos.find((p) => /\.png$/i.test(p.name)).name, type: 'image/png' }) === 'image/png',
)

// 中文文件名要能原样用于报错文案（不该被截断成乱码）
const cn = photos.find((p) => /[\u4e00-\u9fa5]/.test(p.name))
check('中文文件名被保留', Boolean(cn), cn?.name || '(没有中文名)')

// ---------------------------------------------------------------- 启动服务
const child = spawn(
  process.execPath,
  [path.join(ROOT, 'node_modules', 'vite', 'bin', 'vite.js'), '--port', String(PORT), '--strictPort'],
  { cwd: ROOT, env: { ...process.env, SB_PROJECTS_DIR: TMP }, stdio: 'ignore' },
)
const waitServer = async () => {
  for (let i = 0; i < 80; i++) {
    try {
      if ((await fetch(`${APP}/api/health`)).ok) return true
    } catch {
      /* 继续等 */
    }
    await new Promise((r) => setTimeout(r, 500))
  }
  return false
}

let browser
try {
  if (!(await waitServer())) throw new Error('dev server 启动失败')
  await api(`/api/project?name=${PROJECT}&create=1`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ title: '真实照片上传验证' }),
  })

  // ---------------------------------------------------------------- 2) 真实字节往返
  const saved = []
  for (const p of photos) {
    const dataUrl = `data:${mimeOf(p.name)};base64,${p.bytes.toString('base64')}`
    const r = await api('/api/save-image', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ dataUrl, project: PROJECT, prefix: 'real-upload' }),
    })
    const okShape = r.ok && String(r.url || '').startsWith(`/project-assets/${PROJECT}/`)
    if (okShape) saved.push({ ...p, url: r.url })
    else console.log(`   ❌ ${p.name} 保存失败：${r.message || r.status}`)
  }
  check(`全部 ${photos.length} 张真实照片保存成功`, saved.length === photos.length, `${saved.length}/${photos.length}`)

  let identical = 0
  for (const s of saved) {
    const disk = path.join(TMP, PROJECT, 'assets', decodeURIComponent(String(s.url).split('/').pop()))
    if (fs.existsSync(disk) && fs.readFileSync(disk).equals(s.bytes)) identical++
  }
  check('落盘字节与源文件逐字节一致', identical === saved.length, `${identical}/${saved.length}`)

  const urls = saved.map((s) => s.url)
  check('文件名不含中文（服务端生成安全名）', urls.every((u) => !/[\u4e00-\u9fa5]/.test(decodeURIComponent(u))), urls[0])
  check('所有地址都指向项目媒体目录', urls.every((u) => u.startsWith(`/project-assets/${PROJECT}/`)))

  // 通过站内地址能取回同样的字节（模拟 <img> 与出图参考读取）
  const biggest = saved[0]
  const fetched = await fetch(`${APP}${biggest.url}`)
  const fetchedBytes = Buffer.from(await fetched.arrayBuffer())
  check('站内地址可读回且字节一致', fetched.ok && fetchedBytes.equals(biggest.bytes), `${fetched.status} ${fetchedBytes.length}B`)

  // ---------------------------------------------------------------- 3) UI：设定卡上传真实照片
  browser = await chromium.launch({ headless: true, channel: 'chrome' })
  const page = await browser.newPage({ viewport: { width: 1500, height: 1000 } })
  const seedReqs = []
  await page.route('**/api/seedream', async (route) => {
    seedReqs.push(JSON.parse(route.request().postData() || '{}'))
    const svg = '<svg xmlns="http://www.w3.org/2000/svg" width="32" height="18"><rect width="32" height="18" fill="#123"/></svg>'
    const u = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`
    await route.fulfill({ contentType: 'application/json', body: JSON.stringify({ ok: true, urls: [u], url: u }) })
  })
  await page.goto(APP, { waitUntil: 'networkidle' })
  await page.waitForTimeout(1500)

  await api(`/api/project?name=${PROJECT}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      episodes: [{ no: 1, scenes: [{ no: 1, slug: '家', place: '客厅', time: '日', beats: '猫' }] }],
      shots: [
        {
          id: 'E01-S01',
          episode: 1,
          no: 'S01',
          scene_no: 1,
          scene_slug: '家',
          seconds: 3,
          size: '中景',
          move: '固定',
          desc: '主角猫坐在沙发上',
          dialogue: [],
          cast: [],
          keyframe_prompt: '客厅里的狸花猫',
        },
      ],
      designs: [
        {
          id: 'design-cat',
          kind: 'scene',
          name: '客厅',
          refs: ['E01-S01'],
          summaryCn: '真实照片验证',
          promptEn: '',
          keywords: [],
        },
      ],
    }),
  })
  await page.reload({ waitUntil: 'networkidle' })
  await page.waitForTimeout(1600)

  await page.getByRole('button', { name: '素材', exact: true }).click()
  await page.waitForTimeout(900)
  const card = page.locator('.design-card').filter({ hasText: '客厅' }).first()
  check('设定卡出现', (await card.count()) === 1)

  const realPhoto = photos.find((p) => /\.jpe?g$/i.test(p.name))
  await card.locator('input[type=file]').setInputFiles(realPhoto.file)
  await page.waitForTimeout(2200)
  const proj = (await api(`/api/project?name=${PROJECT}`)).project
  const design = (proj.designs || []).find((d) => d.id === 'design-cat')
  check('真实照片成为设定卡当前图', String(design?.image || '').startsWith(`/project-assets/${PROJECT}/`), design?.image)

  const shown = await card.locator('img').first().getAttribute('src')
  const natural = await card
    .locator('img')
    .first()
    .evaluate((el) => ({ w: el.naturalWidth, h: el.naturalHeight }))
    .catch(() => ({ w: 0, h: 0 }))
  check('卡片渲染真实照片（非破图）', natural.w > 800 && natural.h > 800, JSON.stringify(natural))
  check('卡片 img 指向刚上传的文件', shown === design.image, `${shown} vs ${design.image}`)

  // ---------------------------------------------------------------- 4) 加画布 + 连线 + 出图带上它
  await card.getByRole('button', { name: /加入画布|更新画布/ }).click()
  await page.waitForTimeout(1000)
  await page.getByRole('button', { name: '镜头表', exact: true }).click()
  await page.waitForTimeout(900)
  await page.getByRole('button', { name: '生成到画布' }).click()
  await page.waitForTimeout(1400)
  await page.getByRole('button', { name: '画布', exact: true }).click()
  await page.waitForTimeout(900)
  check('画布有素材卡与分镜卡', (await page.locator('.asset-node').count()) >= 1 && (await page.locator('.react-flow__node-shot').count()) >= 1)

  const assetNodeId = await page.evaluate(() => {
    const key = Object.keys(localStorage).find((k) => k.startsWith('storyboard-canvas-v1:'))
    const p = JSON.parse(localStorage.getItem(key) || '{}')
    return (p.nodes || []).find((n) => n.type === 'asset')?.id || ''
  })
  await api(`/api/project?name=${PROJECT}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ shots: [{ id: 'E01-S01', refIds: [assetNodeId] }] }),
  })
  await page.reload({ waitUntil: 'networkidle' })
  await page.waitForTimeout(1700)

  await page.locator('.react-flow__node-shot').first().click()
  await page.waitForTimeout(800)
  seedReqs.length = 0
  await page.getByRole('button', { name: /生成画面|重出画面/ }).first().click()
  await page.waitForTimeout(2600)
  const sent = seedReqs[0] || {}
  const refs = [...(sent.refImage ? [sent.refImage] : []), ...(Array.isArray(sent.refImages) ? sent.refImages : [])]
  check('出图请求带上真实照片', refs.includes(design.image), JSON.stringify(refs))
} catch (e) {
  check('真实照片端到端', false, e.message)
} finally {
  await browser?.close()
  child.kill('SIGTERM')
  fs.rmSync(outDir, { recursive: true, force: true })
  fs.rmSync(TMP, { recursive: true, force: true })
  console.log(bad === 0 ? `\n全部通过${skipped ? `（跳过 ${skipped}）` : ''}` : `\n${bad} 项未通过`)
  process.exit(bad === 0 ? 0 : 1)
}
