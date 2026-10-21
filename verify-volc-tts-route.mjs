/**
 * 火山 TTS 路由验证（不调用真实语音服务）：
 * 1) 单句合成 → mp3 落盘、时长 > 0、engine=volc-tts:*
 * 2) 多说话人 → 逐行合成后拼接为一条 m4a
 * 3) 扣减未开启 → 可读错误
 * 跑法：先 npm run dev，再 node verify-volc-tts-route.mjs
 */
import http from 'node:http'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { execFileSync } from 'node:child_process'

const APP_URL = 'http://127.0.0.1:5273'
let bad = 0
const check = (name, cond, extra = '') => {
  console.log(`${cond ? '✅' : '❌'} ${name}${extra ? ' | ' + extra : ''}`)
  if (!cond) bad++
}

const health = await fetch(`${APP_URL}/api/health`).then((r) => r.json()).catch(() => null)
if (!health) {
  console.error('dev server 未启动：先运行 npm run dev')
  process.exit(1)
}

const ffmpeg =
  ['/opt/homebrew/opt/ffmpeg-full/bin/ffmpeg', '/opt/homebrew/bin/ffmpeg', '/usr/local/bin/ffmpeg'].find(
    (p) => fs.existsSync(p),
  ) || 'ffmpeg'
const mp3Path = path.join(os.tmpdir(), `verify-tts-${process.pid}.mp3`)
execFileSync(ffmpeg, [
  '-hide_banner',
  '-loglevel',
  'error',
  '-f',
  'lavfi',
  '-i',
  'sine=frequency=440:duration=0.3',
  '-c:a',
  'libmp3lame',
  '-q:a',
  '9',
  '-y',
  mp3Path,
])
const mp3B64 = fs.readFileSync(mp3Path).toString('base64')

let origin = ''
let mode = 'success'
let ttsCalls = 0
const mock = http.createServer((req, res) => {
  if (req.method !== 'POST' || req.url !== '/api/v3/plan/tts/unidirectional') {
    res.statusCode = 404
    res.end('not found')
    return
  }
  ttsCalls++
  res.setHeader('Content-Type', 'application/json')
  if (mode === 'deduction') {
    res.end(
      JSON.stringify({
        code: 45000030,
        message: 'AgentPlanDeductNotEnabled message:enable the deduction setting',
      }) + '\n',
    )
    return
  }
  res.end(
    [JSON.stringify({ code: 0, data: mp3B64 }), JSON.stringify({ code: 20000000 })].join('\n') + '\n',
  )
})
await new Promise((resolve) => mock.listen(0, '127.0.0.1', resolve))
origin = `http://127.0.0.1:${mock.address().port}`

const api = (p, init) => fetch(`${APP_URL}${p}`, init).then((r) => r.json())
const putSettings = (body) =>
  api('/api/settings', {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })

const settings0 = (await api('/api/settings')).settings
const beforeVoices = new Set(fs.existsSync('public/voices') ? fs.readdirSync('public/voices') : [])

try {
  const providers = settings0.providers.map((p) =>
    p.id === 'volc-tts' ? { ...p, baseUrl: `${origin}/api/v3/plan`, apiKey: 'test-tts-key' } : p,
  )
  const saved = await putSettings({ providers })
  check('mock TTS 渠道设置已保存', saved.ok === true)

  const single = await api('/api/voice', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      text: '测试一句。',
      voice: 'zh_female_vv_uranus_bigtts',
      rate: 180,
      modelKey: 'volc-tts',
    }),
  })
  check('单句合成成功', single.ok === true && single.engine?.startsWith('volc-tts:'), JSON.stringify(single).slice(0, 200))
  check('单句时长大于 0', Number(single.seconds) > 0, String(single.seconds))
  const singleFile = single.url ? path.join('public', single.url.replace(/^\//, '')) : ''
  check('单句文件落盘', Boolean(singleFile && fs.existsSync(singleFile)), singleFile)

  const multi = await api('/api/voice', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      modelKey: 'volc-tts',
      lines: [
        { text: '第一句。', voice: 'zh_female_vv_uranus_bigtts', rate: 180 },
        { text: '第二句。', voice: 'zh_female_gaolengyujie_uranus_bigtts', rate: 180 },
      ],
    }),
  })
  check('多说话人合成成功', multi.ok === true && multi.lines === 2, JSON.stringify(multi).slice(0, 200))
  check('多说话人时长大于 0', Number(multi.seconds) > 0, String(multi.seconds))
  const multiFile = multi.url ? path.join('public', multi.url.replace(/^\//, '')) : ''
  check('多说话人文件落盘', Boolean(multiFile && fs.existsSync(multiFile)), multiFile)
  check('每行都调用了 TTS', ttsCalls === 3, String(ttsCalls))

  mode = 'deduction'
  const failed = await api('/api/voice', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ text: '会失败。', voice: 'zh_female_vv_uranus_bigtts', modelKey: 'volc-tts' }),
  })
  check(
    '扣减未开启返回可读错误',
    failed.ok === false && /开启扣减/.test(failed.message || ''),
    JSON.stringify(failed).slice(0, 220),
  )
} finally {
  await putSettings({ providers: settings0.providers }).catch(() => {})
  if (fs.existsSync('public/voices')) {
    for (const f of fs.readdirSync('public/voices')) {
      if (!beforeVoices.has(f)) {
        try {
          fs.unlinkSync(path.join('public/voices', f))
        } catch {
          /* ignore */
        }
      }
    }
  }
  try {
    fs.unlinkSync(mp3Path)
  } catch {
    /* ignore */
  }
  await new Promise((resolve) => mock.close(resolve))
}

console.log(bad === 0 ? '\n全部通过' : `\n${bad} 项失败`)
process.exit(bad === 0 ? 0 : 1)
