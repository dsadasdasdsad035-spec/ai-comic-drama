/**
 * 素材 · 视频转白模：环境体检 / 链路可达 / 端到端真跑 / 取消 / GLB 可用性
 * 跑法：node verify-video-whitebox.mjs
 *
 * 三段式，第三段依赖真实推理环境：
 *   1. 环境体检（永远跑）
 *   2. 链路可达（永远跑；环境缺失时断言错误码是 env-missing）
 *   3. 端到端真跑（环境就绪时真跑模型；否则 skip 并退出 0）
 *
 * 为什么第三段 skip 而不是 fail：核心价值是「给一个视频能生成一个白模」，
 * 用 mock 让它常绿等于从未验证过这件事；但让没装环境的机器整体跑红，又会
 * 逼所有人跳过这个脚本。SKIPPED(env) + 退出码 0 是唯一诚实且可操作的选择。
 *
 * 环境变量：
 *   SB_STATE_ROOT   推理环境所在状态根（默认仓库根）
 *   WHITEBOX_FIXTURE 自定义测试视频（默认用仓库自带的 fixture）
 */
import fs from 'node:fs'
import path from 'node:path'
import os from 'node:os'
import crypto from 'node:crypto'
import { execFileSync } from 'node:child_process'
import { createCheck as createCheckRaw, makeProjectsDir, seed, startApp } from './verify-harness.mjs'
import { readProject, writeProject } from './server/db.mjs'

const PORT = 5377
const checkRaw = createCheckRaw()
/** 包一层只是为了让汇总行能报出「通过 N 项」——harness 的 check 只暴露 bad() */
let CHECK_TOTAL = 0
const check = (name, cond, extra = '') => {
  CHECK_TOTAL++
  return checkRaw(name, cond, extra)
}
check.bad = () => checkRaw.bad()
const PROJECTS = makeProjectsDir('whitebox-')
const PROJ = `wb-${Date.now()}`
const STATE_ROOT = process.env.SB_STATE_ROOT || process.cwd()

/**
 * 验收用素材：42 秒卧室巡游，单镜头、相机连续移动、视差充足。
 *
 * 这是「理想输入」的基准——之前用转场合集当 fixture，132 个切点导致位姿
 * 崩塌、重建只能出噪声（15,874 面且形态不可辨），拿去断言「质量」毫无意义。
 * 实测这条：84 帧 / 0.5 秒间隔 → 92,832 面、包围盒 6.0×1.9×3.9m。
 */
const DEFAULT_FIXTURE = path.join('fixtures', 'whitebox', 'room-tour.mp4')

function log(msg) {
  console.log(msg)
}

function section(name) {
  console.log(`\n── ${name} ──`)
}

/** 找一条可用的测试视频 */
function pickFixture() {
  const custom = process.env.WHITEBOX_FIXTURE
  if (custom) {
    if (!fs.existsSync(custom)) throw new Error(`WHITEBOX_FIXTURE 不存在：${custom}`)
    return path.resolve(custom)
  }
  const local = path.join(process.cwd(), DEFAULT_FIXTURE)
  if (fs.existsSync(local)) return local
  return null
}

/** 读 GLB 的 JSON chunk，返回 glTF 文档 */
function readGlbJson(file) {
  const buf = fs.readFileSync(file)
  if (buf.length < 20) throw new Error('文件过小，不是合法 GLB')
  const magic = buf.readUInt32LE(0)
  const version = buf.readUInt32LE(4)
  const chunkLen = buf.readUInt32LE(12)
  const json = JSON.parse(buf.subarray(20, 20 + chunkLen).toString('utf8'))
  return { magic, version, json, bytes: buf.length }
}

/**
 * 用应用里同一个 Babylon 加载器解析 GLB。
 *
 * Node 里没有 XMLHttpRequest，而 Babylon 的 fileTools 依赖它；这里起一个
 * 本地静态服务 + fetch 驱动的 XHR polyfill，让真正的 glTF loader 跑完整解析。
 * 目的不是模拟网络，而是证明「产物能被场景三维打开」。
 */
async function babylonLoad(glbFile) {
  const http = await import('node:http')
  const dir = path.dirname(glbFile)
  const name = path.basename(glbFile)

  const server = http.createServer((req, res) => {
    const want = decodeURIComponent(String(req.url || '').replace(/^\//, '').split('?')[0])
    const full = path.join(dir, want)
    if (!full.startsWith(dir)) {
      res.writeHead(403).end()
      return
    }
    try {
      const buf = fs.readFileSync(full)
      res.writeHead(200, { 'content-length': buf.length })
      res.end(buf)
    } catch {
      res.writeHead(404).end()
    }
  })
  await new Promise((r) => server.listen(0, '127.0.0.1', r))
  const base = `http://127.0.0.1:${server.address().port}`

  class FetchXHR {
    constructor() {
      this.readyState = 0
      this.status = 0
      this.response = null
      this.responseType = ''
      this.responseText = ''
      this._listeners = {}
      this._url = ''
    }
    open(_m, url) {
      this._url = url
      this.readyState = 1
    }
    setRequestHeader() {}
    getResponseHeader() {
      return null
    }
    getAllResponseHeaders() {
      return ''
    }
    addEventListener(type, fn) {
      ;(this._listeners[type] ||= []).push(fn)
    }
    removeEventListener(type, fn) {
      this._listeners[type] = (this._listeners[type] || []).filter((f) => f !== fn)
    }
    _emit(type, ev) {
      for (const fn of this._listeners[type] || []) fn(ev)
      const prop = this[`on${type}`]
      if (typeof prop === 'function') prop.call(this, ev)
    }
    abort() {}
    send() {
      void (async () => {
        try {
          const res = await fetch(this._url)
          this.status = res.status
          const ab = await res.arrayBuffer()
          this.readyState = 4
          if (this.responseType === 'arraybuffer') this.response = ab
          else {
            this.responseText = Buffer.from(ab).toString('utf8')
            this.response = this.responseText
          }
          this._emit('progress', { loaded: ab.byteLength, total: ab.byteLength })
          this._emit('readystatechange', {})
          this._emit('load', {})
        } catch (e) {
          this.readyState = 4
          this.status = 0
          this._emit('error', { error: e })
        }
      })()
    }
  }
  const hadXhr = globalThis.XMLHttpRequest
  globalThis.XMLHttpRequest = FetchXHR

  try {
    const BABYLON = await import(path.join(process.cwd(), 'node_modules', '@babylonjs', 'core', 'index.js'))
    await import(path.join(process.cwd(), 'node_modules', '@babylonjs', 'loaders', 'index.js'))
    const engine = new BABYLON.NullEngine()
    const scene = new BABYLON.Scene(engine)
    new BABYLON.FreeCamera('c', new BABYLON.Vector3(0, 2, 8), scene)
    try {
      const container = await BABYLON.SceneLoader.LoadAssetContainerAsync(`${base}/`, name, scene)
      const meshes = container.meshes.filter((m) => m.getTotalVertices() > 0)
      let vertices = 0
      let hasNormals = false
      for (const m of meshes) {
        vertices += m.getTotalVertices()
        if (m.getVerticesData(BABYLON.VertexBuffer.NormalKind)) hasNormals = true
      }
      container.dispose()
      engine.dispose()
      return { meshes: meshes.length, vertices, hasNormals }
    } finally {
      scene.dispose?.()
      try {
        engine.dispose()
      } catch {
        /* 已 dispose */
      }
    }
  } finally {
    if (hadXhr) globalThis.XMLHttpRequest = hadXhr
    else delete globalThis.XMLHttpRequest
    server.close()
  }
}

const pythonBin = path.join(STATE_ROOT, '.whitebox', 'venv', 'bin', 'python')

// ------------------------------------------------------------------ 1. 环境体检

section('1. 环境体检')
let health = null
try {
  const r = await fetch('http://127.0.0.1:1', { signal: AbortSignal.timeout(50) }).catch(() => null)
  void r
} catch {
  /* 只为确认 fetch 可用 */
}

// 直接跑 doctor.py：不依赖服务在跑，第一段要能独立判断
{
  const doctor = path.join(process.cwd(), 'whitebox', 'doctor.py')
  if (!fs.existsSync(doctor)) {
    check('doctor.py 存在', false, doctor)
  } else {
    const bin = fs.existsSync(pythonBin) ? pythonBin : 'python3'
    let raw = ''
    let exitCode = 0
    try {
      raw = execFileSync(bin, [doctor, '--state-root', STATE_ROOT], {
        encoding: 'utf8',
        timeout: 90_000,
        env: { ...process.env, KMP_DUPLICATE_LIB_OK: 'TRUE' },
      })
    } catch (e) {
      // doctor 在缺项时退出码 1，stdout 里仍有合法 JSON
      raw = String(e?.stdout || '')
      exitCode = e?.status ?? 1
    }
    let parsed = null
    for (const line of raw.trim().split('\n').reverse()) {
      try {
        parsed = JSON.parse(line)
        break
      } catch {
        /* 继续 */
      }
    }
    check('doctor.py 输出合法 JSON', Boolean(parsed), parsed ? '' : raw.slice(0, 200))
    if (parsed) {
      health = parsed
      check('体检返回五项', Object.keys(parsed.checks || {}).length === 5, JSON.stringify(Object.keys(parsed.checks || {})))
      if (!parsed.ok) {
        log(`  缺失项：${(parsed.missing || []).join(', ')}`)
        for (const [k, v] of Object.entries(parsed.checks || {})) {
          if (!v.ok) log(`    ✗ ${k}: ${v.reason || ''}`)
        }
        log(`  修复：${parsed.installHint || '(未提供)'}`)
      } else {
        log(`  设备：${parsed.checks?.device?.value} · torch ${parsed.checks?.torch?.value}`)
      }
      check('退出码与 ok 一致', (exitCode === 0) === parsed.ok, `exit=${exitCode} ok=${parsed.ok}`)
    }
  }
}

const envReady = Boolean(health?.ok)

// ------------------------------------------------------------------ 2. 链路可达

section('2. 链路可达')
// 种一个项目，并把 fixture 视频拷进项目媒体目录
const fixture = pickFixture()
if (!fixture) {
  check('找到测试视频', false, `未找到 ${DEFAULT_FIXTURE}，可用 WHITEBOX_FIXTURE 指定`)
} else {
  seed(
    PROJECTS,
    `import { createProject } from ${JSON.stringify(path.join(process.cwd(), 'server', 'db.mjs'))}
const root = ${JSON.stringify(PROJECTS)}
createProject(root, ${JSON.stringify(PROJ)}, { title: '白模冒烟' })
console.log('{}')
`,
  )
  const assetsDir = path.join(PROJECTS, PROJ, 'assets')
  fs.mkdirSync(assetsDir, { recursive: true })
  const videoName = 'fixture.mp4'
  fs.copyFileSync(fixture, path.join(assetsDir, videoName))
  const videoUrl = `/project-assets/${encodeURIComponent(PROJ)}/${videoName}`

  const { app, stop } = await startApp({ projectsDir: PROJECTS, port: PORT, extraEnv: { SB_STATE_ROOT: STATE_ROOT } })
  try {
    // 注册视频素材卡
    const root = PROJECTS
    const proj = readProject(root, PROJ)
    writeProject(root, PROJ, {
      ...proj,
      assets: [{ kind: 'video', title: 'fixture', url: videoUrl, tags: [], designId: '' }],
    })

    // ---- 体检接口 ----
    const hres = await fetch(`${app}/api/whitebox/health`)
    const hjson = await hres.json()
    check('GET /api/whitebox/health 返回 200', hres.ok)
    check('体检接口带 checks', Boolean(hjson.checks) && Object.keys(hjson.checks).length === 5)
    check('体检结论与 doctor 一致', hjson.ok === envReady, `http=${hjson.ok} doctor=${envReady}`)

    // ---- 提交 ----
    const submitRes = await fetch(`${app}/api/whitebox/jobs`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ projectName: PROJ, videoUrl, interval: 0.5, maxFrames: 96, targetSize: 6 }),
    })
    const submitJson = await submitRes.json()

    if (!envReady) {
      // 环境缺失时这条分支**必须**成立，不是跳过项
      check('环境缺失时提交被拒', !submitJson.ok, JSON.stringify(submitJson).slice(0, 200))
      check('错误码为 env-missing', submitJson.code === 'env-missing', String(submitJson.code))
      check('错误信息指出缺失项或安装方式', Boolean(submitJson.health?.missing?.length || submitJson.message))
      check('环境缺失时未产出 GLB', fs.readdirSync(path.join(PROJECTS, PROJ, 'assets')).every((f) => !f.endsWith('.glb')))
    } else {
      check('提交成功', submitJson.ok === true, JSON.stringify(submitJson).slice(0, 200))
      const jobId = submitJson.job?.id || ''
      check('返回 jobId', Boolean(jobId))

      // ---- 轮询 ----
      let job = null
      const deadline = Date.now() + 6 * 60 * 1000
      while (Date.now() < deadline) {
        await new Promise((r) => setTimeout(r, 1200))
        const pr = await fetch(`${app}/api/whitebox/progress?id=${encodeURIComponent(jobId)}`)
        const pj = await pr.json()
        if (!pj.ok) {
          check('进度查询成功', false, JSON.stringify(pj).slice(0, 200))
          break
        }
        job = pj.job
        if (job.status === 'done' || job.status === 'failed' || job.status === 'cancelled') break
      }
      check('作业到达终态', Boolean(job) && ['done', 'failed', 'cancelled'].includes(job.status), job?.status)
      check('作业成功', job?.status === 'done', job?.error || '')

      if (job?.status === 'done') {
        // ---- 产物 ----
        const glbPath = path.join(PROJECTS, PROJ, 'assets', path.basename(job.glbUrl))
        check('GLB 落在项目媒体目录', fs.existsSync(glbPath), glbPath)
        if (fs.existsSync(glbPath)) {
          const { magic, version, json, bytes } = readGlbJson(glbPath)
          check('glTF magic 正确', magic === 0x46546c67, `0x${magic.toString(16)}`)
          check('glTF 版本为 2', version === 2, String(version))
          const prim = json.meshes?.[0]?.primitives?.[0]
          const attrs = prim?.attributes || {}
          check('含 POSITION 属性', 'POSITION' in attrs)
          check('含 NORMAL 属性', 'NORMAL' in attrs, '缺法线会导致 Babylon 光照失真')
          const mat = json.materials?.[0] || {}
          check('材质 doubleSided', mat.doubleSided === true)
          const base = mat.pbrMetallicRoughness?.baseColorFactor || []
          check(
            '材质为中性灰',
            base.length === 4 && base[0] === base[1] && base[1] === base[2],
            JSON.stringify(base.map((v) => Math.round(v * 255))),
          )
          check('无外部依赖', (json.buffers || []).every((b) => !b.uri), '必须是自包含单文件')

          // 三角形数与包围盒（来自作业统计，由 Python 侧实测）
          const stats = job.stats || {}
          check('三角形数 > 20000', Number(stats.triangles) > 20000, String(stats.triangles))
          const maxEdge = Number(stats.bboxMaxEdge)
          check(
            '包围盒最大边在 6m ±10%',
            Math.abs(maxEdge - 6) <= 0.6,
            `${maxEdge}m`,
          )
          check('产物尺寸可控', bytes > 1024 && bytes < 60 * 1024 * 1024, `${Math.round(bytes / 1024)}KB`)

          // ---- 素材卡 ----
          const after = readProject(PROJECTS, PROJ)
          const card = (after?.assets || []).find((a) => String(a.url || '').includes(path.basename(glbPath)))
          check('登记为素材卡', Boolean(card))
          check('素材卡 kind=model', card?.kind === 'model', String(card?.kind))
          check('素材卡 url 以 /project-assets/ 开头', String(card?.url || '').startsWith('/project-assets/'))
          check('素材卡 note 说明估算尺度', /估算尺度|稠密重建/.test(String(card?.note || '')), String(card?.note || ''))
        }
      }
    }

    // ---- 图片模式 ----
    //
    // 图片路线是「视频」之外的第二条入口：用户自己挑图，避开视频抽帧会抽到的
    // 字幕帧/黑帧/特写帧。实测同一房间随机 8 张出 12,744 面、精挑 8 张出
    // 73,528 面，所以这里断言：能提交、能完成、面数达到可用量级。
    if (envReady && fixture) {
      const imgDir = path.join(PROJECTS, PROJ, 'assets')
      const imgUrls = []
      // 从 fixture 视频里抽 8 张当图片素材
      for (let i = 0; i < 8; i++) {
        const name = `smoke-img-${i}.jpg`
        const dest = path.join(imgDir, name)
        try {
          execFileSync('ffmpeg', [
            '-y', '-v', 'error',
            '-ss', String(i * 3),
            '-i', fixture,
            '-frames:v', '1',
            '-q:v', '2',
            dest,
          ])
          imgUrls.push(`/project-assets/${encodeURIComponent(PROJ)}/${name}`)
        } catch {
          break
        }
      }
      check('抽出图片素材', imgUrls.length >= 4, `${imgUrls.length} 张`)

      if (imgUrls.length >= 4) {
        const imgRes = await fetch(`${app}/api/whitebox/jobs`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ projectName: PROJ, imageUrls: imgUrls, maxFrames: 96, targetSize: 6 }),
        })
        const imgJson = await imgRes.json()
        check('图片模式提交成功', imgJson.ok === true, JSON.stringify(imgJson).slice(0, 160))

        if (imgJson.ok) {
          let imgJob = null
          const dl = Date.now() + 5 * 60 * 1000
          while (Date.now() < dl) {
            await new Promise((r) => setTimeout(r, 1200))
            const pr = await fetch(`${app}/api/whitebox/progress?id=${encodeURIComponent(imgJson.job.id)}`)
            const pj = await pr.json()
            if (!pj.ok) break
            imgJob = pj.job
            if (['done', 'failed', 'cancelled'].includes(imgJob.status)) break
          }
          check('图片模式作业完成', imgJob?.status === 'done', imgJob?.error || String(imgJob?.status))
          check('作业标记为 images 来源', imgJob?.sourceType === 'images', String(imgJob?.sourceType))
          check('图片数被记录', Number(imgJob?.imageCount) >= 4, String(imgJob?.imageCount))
          check(
            '图片模式重建面数 > 10000',
            Number(imgJob?.stats?.triangles) > 10000,
            String(imgJob?.stats?.triangles),
          )
          if (imgJob?.glbUrl) {
            const imgGlb = path.join(PROJECTS, PROJ, 'assets', path.basename(imgJob.glbUrl))
            check('图片模式产物落盘', fs.existsSync(imgGlb))
            if (fs.existsSync(imgGlb)) {
              const { magic, json } = readGlbJson(imgGlb)
              const attrs = json.meshes?.[0]?.primitives?.[0]?.attributes || {}
              check('图片模式产物 glTF 合法', magic === 0x46546c67 && 'NORMAL' in attrs)
            }
          }
        }

        // 混合尺寸回归：各张分辨率不同时必须能跑完，不能崩在 np.stack。
        //
        // 这是实测踩到的崩溃：npz 里曾把原始 frames 一起存（images=np.stack(frames)），
        // 而图片模式下各张尺寸可以不同 → "all input arrays must have the same shape"。
        // 视频模式不会触发（同一条视频所有帧同尺寸），所以只有图片模式能暴露。
        const mixedUrls = []
        for (let i = 0; i < 4; i++) {
          const name = `smoke-mixed-${i}.jpg`
          const dest = path.join(PROJECTS, PROJ, 'assets', name)
          // 每张给不同分辨率：宽高都变，避免碰巧同尺寸
          const w = 320 + i * 80
          const h = 240 + i * 60
          try {
            execFileSync('ffmpeg', [
              '-y', '-v', 'error',
              '-ss', String(i * 2),
              '-i', fixture,
              '-frames:v', '1',
              '-vf', `scale=${w}:${h}`,
              dest,
            ])
            mixedUrls.push(`/project-assets/${encodeURIComponent(PROJ)}/${name}`)
          } catch {
            break
          }
        }
        check('生成混合尺寸图片', mixedUrls.length >= 4, `${mixedUrls.length} 张`)

        if (mixedUrls.length >= 4) {
          const mRes = await fetch(`${app}/api/whitebox/jobs`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ projectName: PROJ, imageUrls: mixedUrls, maxFrames: 96 }),
          })
          const mJson = await mRes.json()
          check('混合尺寸可提交', mJson.ok === true, JSON.stringify(mJson).slice(0, 160))
          if (mJson.ok) {
            let mJob = null
            const md = Date.now() + 5 * 60 * 1000
            while (Date.now() < md) {
              await new Promise((r) => setTimeout(r, 1200))
              const pr = await fetch(`${app}/api/whitebox/progress?id=${encodeURIComponent(mJson.job.id)}`)
              const pj = await pr.json()
              if (!pj.ok) break
              mJob = pj.job
              if (['done', 'failed', 'cancelled'].includes(mJob.status)) break
            }
            check(
              '混合尺寸作业不崩',
              mJob?.status === 'done',
              mJob?.error || String(mJob?.status),
            )
            check(
              '混合尺寸产出网格',
              Number(mJob?.stats?.triangles) > 1000,
              String(mJob?.stats?.triangles),
            )
          }
        }

        // 少于 4 张必须被拒
        const tooFew = await fetch(`${app}/api/whitebox/jobs`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ projectName: PROJ, imageUrls: imgUrls.slice(0, 2) }),
        })
        const fewJson = await tooFew.json()
        check('少于 4 张被拒绝', fewJson.ok !== true, JSON.stringify(fewJson).slice(0, 140))

        // 视频与图片同时给必须被拒
        const both = await fetch(`${app}/api/whitebox/jobs`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ projectName: PROJ, videoUrl, imageUrls: imgUrls }),
        })
        const bothJson = await both.json()
        check('视频与图片互斥', bothJson.ok !== true, JSON.stringify(bothJson).slice(0, 140))
      }
    }

    // ---- 取消路径（环境就绪时做，需要真的跑起来才有东西可取消） ----
    if (envReady) {
      const beforeCount = fs.readdirSync(path.join(PROJECTS, PROJ, 'assets')).filter((f) => f.endsWith('.glb')).length
      const cRes = await fetch(`${app}/api/whitebox/jobs`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ projectName: PROJ, videoUrl, interval: 0.5, maxFrames: 96 }),
      })
      const cJson = await cRes.json()
      if (cJson.ok) {
        await new Promise((r) => setTimeout(r, 1500))
        const cancelRes = await fetch(`${app}/api/whitebox/cancel`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ id: cJson.job.id }),
        })
        const cancelJson = await cancelRes.json()
        check('取消返回 cancelled', cancelJson.job?.status === 'cancelled', String(cancelJson.job?.status))
        await new Promise((r) => setTimeout(r, 4000))
        const afterCount = fs.readdirSync(path.join(PROJECTS, PROJ, 'assets')).filter((f) => f.endsWith('.glb')).length
        check('取消后不新增 GLB', afterCount === beforeCount, `${beforeCount} → ${afterCount}`)
      }
    }

    // ---- 非法输入 ----
    const badRes = await fetch(`${app}/api/whitebox/jobs`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ projectName: PROJ, videoUrl: 'https://example.com/x.mp4' }),
    })
    const badJson = await badRes.json()
    check('拒绝外部链接', badJson.ok !== true, JSON.stringify(badJson).slice(0, 160))

    const missingProjRes = await fetch(`${app}/api/whitebox/jobs`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ projectName: 'no-such-project-xyz', videoUrl }),
    })
    const missingProjJson = await missingProjRes.json()
    check('拒绝不存在的项目', missingProjJson.ok !== true, JSON.stringify(missingProjJson).slice(0, 160))
  } finally {
    stop()
  }
}

// ------------------------------------------------------------------ 3. 端到端真跑

section('3. 端到端真跑（真实模型）')
if (!envReady) {
  log(`SKIPPED(env) 缺少：${(health?.missing || ['unknown']).join(', ')}`)
  log(`  安装：${health?.installHint || 'bash whitebox/install.sh'}`)
  log('  说明：第三段不产出任何伪造产物。装上环境后重跑本脚本才会真正验证「视频 → 白模」。')
} else {
  // 前面第 2 段已经在 envReady 时跑过完整端到端（提交 → 轮询 → 产物 → 素材卡），
  // 这里只把「真的用模型跑过」这件事单独确认一次，避免有人把第 2 段的
  // 环境分支误读成 mock。
  const glbs = fs.existsSync(path.join(PROJECTS, PROJ, 'assets'))
    ? fs.readdirSync(path.join(PROJECTS, PROJ, 'assets')).filter((f) => f.endsWith('.glb'))
    : []
  check('真跑产出了 GLB（非 mock）', glbs.length > 0, `${glbs.length} 个文件`)
  if (glbs.length) {
    const full = path.join(PROJECTS, PROJ, 'assets', glbs[0])
    const { json } = readGlbJson(full)
    const tri = json.meshes?.[0]?.primitives?.[0]?.attributes
    check('产物是该次运行的真实网格', Boolean(tri?.POSITION && tri?.NORMAL))

    // ---- Babylon 能否真正加载 ----
    //
    // 只验 GLB 结构不够：应用里走的是 Babylon 的 SceneLoader，它有自己的
    // 解析路径。这一步证明「产物能被场景三维打开」不是纸面结论。
    try {
      const loaded = await babylonLoad(full)
      check('Babylon 加载成功', loaded.meshes > 0, `${loaded.meshes} 个网格`)
      check('Babylon 读到顶点', loaded.vertices > 10000, String(loaded.vertices))
      check('Babylon 读到法线', loaded.hasNormals === true)
    } catch (e) {
      check('Babylon 加载成功', false, e?.message || String(e))
    }
  }
}

// ------------------------------------------------------------------ 汇总

/** 统计通过项：createCheck 只暴露 bad()，这里从输出里数 ✅ */
const bad = check.bad()

console.log(`\n项目：${PROJECTS}/${PROJ}`)

// verify-all.mjs 靠这行的格式做汇总（`汇总：通过 X；失败 Y；跳过 Z`）。
// 第三段是真跑模型，环境缺失时跳过的不是「一条断言」而是整段，
// 所以在汇总里如实标出，避免被读成「全部跑过了」。
const skippedNote = envReady ? 0 : 1
console.log(`汇总：通过 ${CHECK_TOTAL - bad}；失败 ${bad}；跳过 ${skippedNote}`)

if (bad === 0) {
  console.log(envReady ? '✅ 全部通过（含端到端真跑）' : '✅ 全部通过（端到端真跑已 SKIPPED，环境未安装）')
  process.exit(0)
}
console.log(`❌ ${bad} 项失败`)
process.exit(1)
