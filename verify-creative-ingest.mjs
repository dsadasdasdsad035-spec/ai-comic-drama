/**
 * 创意摄取验收：适配器可用性、上传、直链、SSRF 防护、probe、切分、抽帧。
 * 用 ffmpeg 现场造一段样例视频，不依赖仓库里的媒体文件。
 * 跑法：node verify-creative-ingest.mjs
 */
import { spawn, execFileSync } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import http from 'node:http'

const ROOT = process.cwd()
const PORT = 5343
const APP = `http://127.0.0.1:${PORT}`
const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'creative-ingest-'))
const PROJECTS = path.join(TMP, 'projects')
let bad = 0
const check = (name, cond, extra = '') => {
  console.log(`${cond ? '✅' : '❌'} ${name}${extra ? ` | ${extra}` : ''}`)
  if (!cond) bad++
}

function which(bin) {
  try {
    execFileSync('which', [bin], { stdio: 'pipe' })
    return true
  } catch {
    return false
  }
}

if (!which('ffmpeg') || !which('ffprobe')) {
  console.error('缺少 ffmpeg/ffprobe，无法运行该验收')
  process.exit(1)
}

// 造素材：3 段黑白纯色，每段 1.2 秒，中间硬切（纯色视频的 scene 分数才够高）；再生成一条无音轨版本
const sample = path.join(TMP, 'sample.mp4')
execFileSync('ffmpeg', [
  '-y', '-hide_banner', '-loglevel', 'error',
  '-f', 'lavfi', '-i', 'color=c=black:s=320x240:d=1.2:r=25',
  '-f', 'lavfi', '-i', 'color=c=white:s=320x240:d=1.2:r=25',
  '-f', 'lavfi', '-i', 'color=c=black:s=320x240:d=1.2:r=25',
  '-filter_complex', '[0:v][1:v][2:v]concat=n=3:v=1:a=0[v]',
  '-map', '[v]', '-c:v', 'libx264', '-pix_fmt', 'yuv420p', sample,
])
const withAudio = path.join(TMP, 'sample-audio.mp4')
execFileSync('ffmpeg', [
  '-y', '-hide_banner', '-loglevel', 'error',
  '-i', sample,
  '-f', 'lavfi', '-i', 'sine=frequency=440:duration=3.6',
  '-c:v', 'copy', '-c:a', 'aac', '-shortest', withAudio,
])
const broken = path.join(TMP, 'broken.mp4')
fs.writeFileSync(broken, 'not a video at all')

// 本地 HTTP 服务：给直链下载用，同时提供一次私网地址拒绝测试
const fileServer = http.createServer((req, res) => {
  if (req.url === '/sample.mp4') {
    const buf = fs.readFileSync(sample)
    res.writeHead(200, { 'Content-Type': 'video/mp4', 'Content-Length': buf.length })
    res.end(buf)
    return
  }
  if (req.url === '/page.html') {
    res.writeHead(200, { 'Content-Type': 'text/html' })
    res.end('<html>not a video</html>')
    return
  }
  res.writeHead(404)
  res.end()
})
await new Promise((r) => fileServer.listen(0, '127.0.0.1', r))
const filePort = fileServer.address().port

fs.mkdirSync(PROJECTS, { recursive: true })
const child = spawn(
  process.execPath,
  [path.join(ROOT, 'node_modules', 'vite', 'bin', 'vite.js'), '--port', String(PORT), '--strictPort'],
  { cwd: ROOT, env: { ...process.env, SB_PROJECTS_DIR: PROJECTS }, stdio: 'ignore' },
)

const api = async (p, init) => {
  const r = await fetch(`${APP}${p}`, init)
  let json = null
  try {
    json = await r.json()
  } catch {
    /* ignore */
  }
  return { status: r.status, json }
}
const post = (p, body) =>
  api(p, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) })

let up = false
for (let i = 0; i < 80; i++) {
  try {
    const r = await fetch(`${APP}/api/health`)
    if (r.ok) {
      up = true
      break
    }
  } catch {
    /* wait */
  }
  await new Promise((r) => setTimeout(r, 400))
}
if (!up) {
  console.error('临时 dev server 启动失败')
  child.kill()
  fileServer.close()
  process.exit(1)
}

try {
  // 1) 默认只有 upload / direct 可用
  const adapters = await api('/api/creative/adapters')
  const byId = Object.fromEntries((adapters.json?.adapters || []).map((a) => [a.id, a]))
  check('默认 upload 可用', byId.upload?.ok === true)
  check('默认 direct 可用', byId.direct?.ok === true)
  check('默认 yt-dlp 不可用且有原因', byId.ytdlp?.ok === false && Boolean(byId.ytdlp?.reason), byId.ytdlp?.reason)
  check('默认 DTK 不可用且有原因', byId.dtk?.ok === false && Boolean(byId.dtk?.reason), byId.dtk?.reason)
  check('ffmpeg 状态可用', adapters.json?.ffmpeg?.ok === true)

  const created = await post('/api/creative/sessions', { mode: 'reverse' })
  const sessionId = created.json?.session?.id
  check('会话已创建', Boolean(sessionId))

  // 2) 本地上传 + probe
  const b64 = fs.readFileSync(withAudio).toString('base64')
  const uploaded = await post('/api/creative/ingest', {
    sessionId,
    adapter: 'upload',
    name: '样例.mp4',
    data: `data:video/mp4;base64,${b64}`,
  })
  check('上传摄取成功', uploaded.json?.ok === true, uploaded.json?.message)
  const src1 = uploaded.json?.source
  check('probe 返回时长', Math.abs(Number(src1?.duration) - 3.6) < 0.4, String(src1?.duration))
  check('probe 返回分辨率', src1?.width === 320 && src1?.height === 240, `${src1?.width}x${src1?.height}`)
  check('probe 识别音轨', src1?.hasAudio === true)
  check('封面已生成', Boolean(src1?.cover) && src1.cover.startsWith(`/creative/${sessionId}/`))
  const coverRes = await fetch(`${APP}${src1.cover}`)
  // 纯色帧压缩后很小，只断言是合法图片而不是体积
  check(
    '封面可访问',
    coverRes.ok && /image\//.test(String(coverRes.headers.get('content-type'))) && Number(coverRes.headers.get('content-length') || 0) > 200,
    `${coverRes.status} ${coverRes.headers.get('content-type')} ${coverRes.headers.get('content-length')}`,
  )
  const srcFileRes = await fetch(`${APP}${src1.file}`)
  check('源视频可站内访问', srcFileRes.ok)

  // 3) 直链：先拒绝内网，再从本地服务取（本地服务也是内网，所以用白名单外的公网形状测拒绝）
  const blocked = await post('/api/creative/ingest', {
    sessionId,
    adapter: 'direct',
    url: 'http://127.0.0.1:1/x.mp4',
  })
  check('直链拒绝环回地址', blocked.status === 400 && /内网|本机/.test(String(blocked.json?.message)), blocked.json?.message)

  const blockedLocal = await post('/api/creative/ingest', {
    sessionId,
    adapter: 'direct',
    url: `http://localhost:${filePort}/sample.mp4`,
  })
  check('直链拒绝 localhost', blockedLocal.status === 400, blockedLocal.json?.message)

  // 4) 损坏文件：摄取成功但 probe 报可读错误
  const brokenUp = await post('/api/creative/ingest', {
    sessionId,
    adapter: 'upload',
    name: 'broken.mp4',
    data: `data:video/mp4;base64,${fs.readFileSync(broken).toString('base64')}`,
  })
  check('损坏文件仍入库但带 probeError', brokenUp.json?.ok === true && Boolean(brokenUp.json?.probeError), brokenUp.json?.probeError)

  // 5) 平台链接在适配器都未启用时退回直链（并因内网/不可达失败，不静默成功）
  const platform = await post('/api/creative/ingest', {
    sessionId,
    url: 'https://v.douyin.com/xxxx/',
  })
  check('平台链接未配置解析器时给出可读失败', platform.json?.ok !== true, platform.json?.message)

  // 6) probe / split / frames
  const probed = await post('/api/creative/analyze', { sourceId: src1.id, action: 'probe' })
  check('显式 probe 成功', probed.json?.ok === true && Math.abs(probed.json.probe.duration - 3.6) < 0.4)

  const split = await post('/api/creative/analyze', { sourceId: src1.id, action: 'split', threshold: 0.2 })
  check('切分成功', split.json?.ok === true, split.json?.message)
  const shots = split.json?.shots || []
  check('切分覆盖整段', shots.length >= 1 && shots[0].start === 0 && Math.abs(shots[shots.length - 1].end - 3.6) < 0.4,
    shots.map((s) => `${s.start}-${s.end}`).join(' '))
  // 样例是 3 段黑白硬切，应当至少检出 2 个切点
  check('检出硬切', shots.length >= 3, `镜头数 ${shots.length}`)
  const contiguous = shots.every((s, i) => i === 0 || Math.abs(s.start - shots[i - 1].end) < 0.01)
  check('镜头段首尾相接', contiguous)
  check('没有零长度镜头', shots.every((s) => s.end > s.start))

  const framed = await post('/api/creative/analyze', { sourceId: src1.id, action: 'frames', framesPerShot: 1 })
  check('抽帧成功', framed.json?.ok === true, framed.json?.message)
  const allFramed = (framed.json?.shots || []).every((s) => s.frames.length >= 1)
  check('每镜至少一帧', allFramed)
  const firstFrame = framed.json?.shots?.[0]?.frames?.[0]
  const frameRes = firstFrame ? await fetch(`${APP}${firstFrame}`) : null
  check('证据帧可访问', Boolean(frameRes?.ok))

  // 7) 重复抽帧不覆盖旧帧
  const again = await post('/api/creative/analyze', { sourceId: src1.id, action: 'frames', framesPerShot: 1 })
  const before = framed.json?.shots?.[0]?.frames?.length || 0
  const after = again.json?.shots?.[0]?.frames?.length || 0
  check('重复抽帧追加而非覆盖', after > before, `${before} → ${after}`)

  // 8) 重新切分保留旧帧并标为过期
  const resplit = await post('/api/creative/analyze', { sourceId: src1.id, action: 'split', threshold: 0.6 })
  check('重新切分成功', resplit.json?.ok === true)
  check('旧结果标为过期', (resplit.json?.staleCount || 0) >= 1, String(resplit.json?.staleCount))
  const staleShot = (resplit.json?.shots || []).find((s) => s.frames.length)
  check('重新切分后旧帧未删除', Boolean(staleShot))

  // 9) 未知动作与不存在源
  const unknown = await post('/api/creative/analyze', { sourceId: src1.id, action: 'nope' })
  check('未知动作报错', unknown.status === 400)
  const missing = await post('/api/creative/analyze', { sourceId: 'src-nope', action: 'probe' })
  check('不存在的源返回 404', missing.status === 404)
} finally {
  child.kill()
  fileServer.close()
  fs.rmSync(TMP, { recursive: true, force: true })
}

console.log(bad ? `\n❌ ${bad} 项失败` : '\n✅ 全部通过')
process.exit(bad ? 1 : 0)
