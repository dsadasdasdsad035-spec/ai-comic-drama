/**
 * 代码沙箱回归：立方体、纹理、抓帧/定位、录制、CSP、父页面隔离、超时。
 * 需要 dev server：APP_URL=http://127.0.0.1:5280 node verify-code-sandbox.mjs
 */
import { chromium } from 'playwright-core'

const URL = process.env.APP_URL || 'http://127.0.0.1:5280'
let bad = 0
const check = (name, cond, extra = '') => {
  console.log(`${cond ? '✅' : '❌'} ${name}${extra ? ` | ${extra}` : ''}`)
  if (!cond) bad++
}

const CUBE = `
let S;
function init(ctx) {
  S = ctx;
  const mesh = new THREE.Mesh(
    new THREE.BoxGeometry(1, 1, 1),
    new THREE.MeshStandardMaterial({ color: 0x22aa88 })
  );
  S.scene.add(mesh);
  S.scene.add(new THREE.HemisphereLight(0xffffff, 0x334455, 2));
  ctx.camera.position.set(0, 1.2, 4);
  ctx.camera.lookAt(0, 0, 0);
}
function renderAt(t) { if (S) S.scene.rotation.y = t * 0.8; }
function dispose() {}
`

const TEXTURE = `
let S;
function init(ctx) {
  S = ctx;
  const asset = ctx.assets.get('image:test');
  const mat = new THREE.MeshBasicMaterial({ map: asset ? asset.texture : null, color: asset ? 0xffffff : 0xff0000 });
  const mesh = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), mat);
  S.scene.add(mesh);
  ctx.camera.position.set(0, 0, 4);
  ctx.camera.lookAt(0, 0, 0);
}
function renderAt() {}
function dispose() {}
`

const browser = await chromium.launch({ headless: true, channel: 'chrome' })
const page = await browser.newPage({ viewport: { width: 1000, height: 800 } })
const errors = []
page.on('pageerror', (e) => errors.push(e.message))
await page.goto(URL, { waitUntil: 'domcontentloaded' })
await page.waitForTimeout(800)

const run = async (payload) =>
  page.evaluate(async (p) => {
    const { SceneSandbox } = await import('/src/sceneSandbox.ts')
    const makeTestAsset = async () => {
      const c = document.createElement('canvas')
      c.width = 32
      c.height = 32
      const x = c.getContext('2d')
      x.fillStyle = '#e33'
      x.fillRect(0, 0, 32, 32)
      const blob = await new Promise((r) => c.toBlob(r, 'image/png'))
      const bytes = await blob.arrayBuffer()
      return { key: 'image:test', kind: 'image', label: 'test', mime: 'image/png', bytes, width: 32, height: 32 }
    }
    const host = document.createElement('div')
    host.style.cssText = 'position:fixed;left:-2000px;top:0;width:640px;height:360px;visibility:visible'
    document.body.appendChild(host)
    const observed = { time: 0 }
    const sb = new SceneSandbox(
      host,
      {
        code: p.code,
        assets: p.withTexture ? [await makeTestAsset()] : [],
        width: 640,
        height: 360,
        aspect: '16:9',
        duration: p.duration || 3,
        mode: 'clean',
      },
      { onTime: (t) => (observed.time = t) },
    )
    try {
      const ready = await sb.start()
      const sandboxAttr = sb.iframe?.getAttribute('sandbox') || ''
      const srcdoc = sb.iframe?.getAttribute('srcdoc') || ''
      if (p.seek != null) {
        sb.seek(p.seek)
        await new Promise((r) => setTimeout(r, 250))
      }
      if (p.spoof) {
        sb.iframe?.contentWindow?.postMessage({ token: 'wrong-token', type: 'dispose' }, '*')
        await new Promise((r) => setTimeout(r, 120))
      }
      const frame = p.capture ? await sb.capture() : ''
      let recorded = null
      if (p.record) {
        const blob = await sb.record()
        recorded = { size: blob.size, type: blob.type }
      }
      sb.dispose()
      host.remove()
      return {
        ok: true,
        ready,
        sandboxAttr,
        hasCsp: /connect-src 'none'/.test(srcdoc) && /default-src 'none'/.test(srcdoc),
        frameOk: frame.startsWith('data:image/'),
        observed,
        recorded,
      }
    } catch (e) {
      sb.dispose()
      host.remove()
      return { ok: false, error: e.message, phase: e.phase || '', children: host.children.length }
    }
  }, payload)

const cube = await run({ code: CUBE, seek: 2.4, capture: true, spoof: true })
check('立方体沙箱启动', cube.ok, cube.error || '')
check('首帧是图片', Boolean(cube.ready?.firstFrame?.startsWith('data:image/')), cube.ready?.firstFrame?.slice(0, 24))
check('iframe 无同源权限', cube.sandboxAttr === 'allow-scripts', cube.sandboxAttr)
check('srcdoc CSP 禁止网络', cube.hasCsp)
check('拖动到 2.4 秒', cube.ok && Math.abs(cube.observed.time - 2.4) < 0.15, String(cube.observed?.time))
check('抓帧返回图片', cube.frameOk)

const sanitize = await page.evaluate(async () => {
  const { checkSceneCode } = await import('/src/sceneCodeSanitize.ts')
  const big = 'function init() {}\n' + '// padding\n'.repeat(30000)
  return {
    big: checkSceneCode(big).ok,
    missing: checkSceneCode('function init() {}\nfunction dispose() {}').ok,
    network: checkSceneCode('function init(){ fetch("/x") }\nfunction renderAt(){}').ok,
  }
})
check('超大代码被拒绝', sanitize.big === false)
check('缺少 renderAt 被拒绝', sanitize.missing === false)
check('静态外联被拒绝', sanitize.network === false)


const THREE_SHADOW = `
const THREE = globalThis.THREE;
let S;
function init(ctx) {
  S = ctx;
  const mesh = new THREE.Mesh(new THREE.BoxGeometry(1, 1, 1), new THREE.MeshStandardMaterial({ color: 0x44aa88 }));
  S.scene.add(mesh);
  S.scene.add(new THREE.HemisphereLight(0xffffff, 0x223344, 2));
  ctx.camera.position.set(0, 1.2, 4);
  ctx.camera.lookAt(0, 0, 0);
}
function renderAt() {}
function dispose() {}
`
const shadow = await run({ code: THREE_SHADOW, capture: true })
check('顶层 THREE 声明不再和参数冲突', shadow.ok, shadow.error || '')
check('顶层 THREE 声明仍能渲染', Boolean(shadow.ready?.firstFrame?.startsWith('data:image/')))

const texture = await run({ code: TEXTURE, withTexture: true, capture: true })
check('素材纹理可用', texture.ok, texture.error || '')
check('纹理首帧非空', Boolean(texture.ready?.firstFrame?.startsWith('data:image/')))

const network = await run({
  code: `async function init() { await fetch('https://example.com/secret') }\nfunction renderAt() {}\nfunction dispose() {}`,
})
check('CSP 阻止网络请求', !network.ok && /fetch|network|Failed/i.test(network.error || ''), network.error)

const parent = await run({
  code: `function init() { return window.parent.document.body }\nfunction renderAt() {}\nfunction dispose() {}`,
})
check('父页面访问被阻止', !parent.ok && /cross-origin|Blocked|permission|security/i.test(parent.error || ''), parent.error)

const loop = await run({ code: `function init() { while (true) {} }\nfunction renderAt() {}\nfunction dispose() {}` })
check('初始化死循环被超时终止', !loop.ok && /超时/.test(loop.error || ''), loop.error)

const record = await run({ code: CUBE, record: true, duration: 2 })
check('沙箱录制返回视频', record.ok && record.recorded?.size > 1000, JSON.stringify(record.recorded))


const prep = await page.evaluate(async () => {
  const { prepareSceneAssets } = await import('/src/sceneCodeAssets.ts')
  const c = document.createElement('canvas')
  c.width = 4096
  c.height = 2048
  const x = c.getContext('2d')
  x.fillStyle = '#245'
  x.fillRect(0, 0, c.width, c.height)
  const dataUrl = c.toDataURL('image/png')
  const saved = await (await fetch('/api/save-image', {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ dataUrl }),
  })).json()
  const input = { key: 'image:big', source: 'image', kind: 'image', label: '大图', url: saved.url }
  const out = await prepareSceneAssets([
    input,
    { ...input, key: 'image:big-dup' },
    { key: 'image:missing', source: 'image', kind: 'image', label: '缺失', url: '/generated/definitely-missing.png' },
  ])
  return { count: out.assets.length, width: out.assets[0]?.ref.width || 0, missing: out.missing.length, url: saved.url }
})
check('素材 URL 去重', prep.count === 1, JSON.stringify(prep))
check('图片长边缩到 2048', prep.width > 0 && prep.width <= 2048, String(prep.width))
check('缺失素材单独报告', prep.missing === 1, JSON.stringify(prep))

check('页面无未捕获异常', errors.length === 0, errors.join(' | '))
await browser.close()
console.log(bad ? `\n${bad} failed` : '\nall passed')
process.exit(bad ? 1 : 0)
