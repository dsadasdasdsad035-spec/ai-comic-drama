/**
 * 代码渲染回归：隐藏沙箱录制 → /api/save-video → ffprobe 时长/尺寸；取消不落文件。
 * 需要 dev server：APP_URL=http://127.0.0.1:5280 node verify-code-render.mjs
 */
import { chromium } from 'playwright-core'
import { execFileSync } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'

const URL = process.env.APP_URL || 'http://127.0.0.1:5280'
const root = process.cwd()
let bad = 0
const check = (name, cond, extra = '') => {
  console.log(`${cond ? '✅' : '❌'} ${name}${extra ? ` | ${extra}` : ''}`)
  if (!cond) bad++
}

const CODE = `
let S;
function init(ctx) {
  S = ctx;
  const mesh = new THREE.Mesh(
    new THREE.BoxGeometry(1, 1, 1),
    new THREE.MeshStandardMaterial({ color: 0x2a9d8f })
  );
  S.scene.add(mesh);
  S.scene.add(new THREE.HemisphereLight(0xffffff, 0x223344, 2));
  ctx.camera.position.set(0, 1.2, 4);
  ctx.camera.lookAt(0, 0, 0);
}
function renderAt(t) { if (S) S.scene.rotation.y = t; }
function dispose() {}
`

const browser = await chromium.launch({ headless: true, channel: 'chrome' })
const page = await browser.newPage({ viewport: { width: 1000, height: 800 } })
const errors = []
page.on('pageerror', (e) => errors.push(e.message))
await page.goto(URL, { waitUntil: 'domcontentloaded' })
await page.waitForTimeout(600)

const result = await page.evaluate(async (code) => {
  const { renderSceneCodeVideo, saveSceneCodeVideo } = await import('/src/sceneCodeRender.ts')
  const blob = await renderSceneCodeVideo({ code, assets: [], duration: 2, aspect: '9:16' })
  const url = await saveSceneCodeVideo(blob)
  const controller = new AbortController()
  let cancelled = ''
  setTimeout(() => controller.abort(), 450)
  try {
    await renderSceneCodeVideo({ code, assets: [], duration: 2, aspect: '16:9', signal: controller.signal })
  } catch (e) {
    cancelled = e.name || e.message
  }
  return { url, blobSize: blob.size, cancelled }
}, CODE)

check('录制成功并保存', Boolean(result.url?.startsWith('/videos/')), result.url)
check('取消被识别', result.cancelled === 'AbortError', result.cancelled)
const file = path.join(root, 'public', result.url.replace(/^\//, ''))
check('视频文件存在', fs.existsSync(file), file)
if (fs.existsSync(file)) {
  const probe = JSON.parse(
    execFileSync('ffprobe', [
      '-v', 'error',
      '-show_entries', 'format=duration:stream=width,height',
      '-of', 'json',
      file,
    ]).toString(),
  )
  const duration = Number(probe.format?.duration)
  const stream = probe.streams?.[0] || {}
  check('视频时长约 2 秒', duration >= 1.7 && duration <= 2.4, String(duration))
  check('视频为竖屏尺寸', Number(stream.width) < Number(stream.height), `${stream.width}x${stream.height}`)
}
check('页面无未捕获异常', errors.length === 0, errors.join(' | '))
await browser.close()
console.log(bad ? `\n${bad} failed` : '\nall passed')
process.exit(bad ? 1 : 0)
