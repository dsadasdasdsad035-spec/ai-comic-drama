/**
 * 口型纯函数 + Sync Labs mock + 火山 TTS 表演映射回归。
 * 不调用真实外部服务。
 */
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { execFileSync } from 'node:child_process'

const root = path.dirname(fileURLToPath(import.meta.url))
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'verify-lipsync-'))
const entry = path.join(tmp, 'entry.ts')
const abs = (p) => JSON.stringify(path.join(root, p))
fs.writeFileSync(
  entry,
  [`export * from ${abs('src/lipSync.ts')}`, `export * from ${abs('server/volc-tts.mjs')}`].join('\n') + '\n',
)
const bundle = path.join(tmp, 'bundle.mjs')
execFileSync(path.join(root, 'node_modules', '.bin', 'esbuild'), [
  entry,
  '--bundle',
  '--platform=node',
  '--format=esm',
  '--log-level=error',
  `--outfile=${bundle}`,
])
const lib = await import(bundle)
const lipsync = await import(path.join(root, 'server/lipsync.mjs'))

let bad = 0
const check = (name, cond, extra = '') => {
  console.log(`${cond ? '✅' : '❌'} ${name}${extra ? ` | ${extra}` : ''}`)
  if (!cond) bad++
}

const one = [{ speaker: '陈默', text: '你来了。' }]
const two = [...one, { speaker: '林岚', text: '我不该来。' }]

check('模式归一化', lib.normalizeLipSyncMode('prompt') === 'prompt' && lib.normalizeLipSyncMode('x') === 'off')
check('off 永远可用', lib.lipSyncEligibility({ mode: 'off', dialogue: one, providerConfigured: false }).ok)
check(
  'prompt 无台词不可用',
  !lib.lipSyncEligibility({ mode: 'prompt', dialogue: [], providerConfigured: false }).ok,
)
check(
  'provider 缺视频',
  lib.lipSyncEligibility({ mode: 'provider', dialogue: one, voiceUrl: '/v/a.mp3', providerConfigured: true }).reason.includes('视频'),
)
check(
  'provider 缺音频',
  lib.lipSyncEligibility({ mode: 'provider', dialogue: one, videoUrl: '/v/a.mp4', providerConfigured: true }).reason.includes('配音'),
)
check(
  'provider 缺 Key',
  lib.lipSyncEligibility({
    mode: 'provider',
    dialogue: one,
    videoUrl: '/v/a.mp4',
    voiceUrl: '/v/a.mp3',
    providerConfigured: false,
  }).reason.includes('provider'),
)
check(
  '单说话人 provider 可用',
  lib.lipSyncEligibility({
    mode: 'provider',
    dialogue: one,
    videoUrl: '/v/a.mp4',
    voiceUrl: '/v/a.mp3',
    providerConfigured: true,
  }).ok,
)
check(
  '多说话人 provider 禁用',
  lib.lipSyncEligibility({
    mode: 'provider',
    dialogue: two,
    videoUrl: '/v/a.mp4',
    voiceUrl: '/v/a.mp3',
    providerConfigured: true,
  }).reason.includes('多说话人'),
)

const state = {
  mode: 'provider',
  outputVideo: '/v/lip.mp4',
  sourceVideo: '/v/a.mp4',
  audio: '/v/a.mp3',
  fingerprint: lib.lipSyncFingerprint('/v/a.mp4', '/v/a.mp3', one),
}
check('口型版采用后优先播放', lib.activeVideoUrl({ videoUrl: '/v/a.mp4', lipSync: { ...state, adopted: true } }) === '/v/lip.mp4')
check('未采用播放原视频', lib.activeVideoUrl({ videoUrl: '/v/a.mp4', lipSync: { ...state, adopted: false } }) === '/v/a.mp4')
check('源变化标 stale', lib.lipSyncStale(state, '/v/b.mp4', '/v/a.mp3', one))
check('未变化不 stale', !lib.lipSyncStale(state, '/v/a.mp4', '/v/a.mp3', one))

// ---- 火山 TTS 映射 ----
const mapped = lib.mapVoicePerformance({ emotion: 'angry', intensity: 4, pace: 'slow', volume: 'shout', emphasis: '走' })
check('火山情绪/强度', mapped.extra.emotion === 'angry' && mapped.extra.emotion_scale === 4)
check('火山语速/音量', mapped.extra.speech_rate === -20 && mapped.extra.loudness_rate === 20)
check('火山重音标记未应用', mapped.unsupported.includes('emphasis'))
const body = lib.buildTtsBody({ text: '你好', speaker: 'x', performance: { emotion: 'sad', intensity: 2 } })
check('火山 body 带 emotion', body.req_params.emotion === 'sad' && body.req_params.emotion_scale === 2)
check('火山 body 文本干净', body.req_params.text === '你好')

// ---- Sync Labs mock ----
const videoFile = path.join(tmp, 'in.mp4')
const audioFile = path.join(tmp, 'in.mp3')
const outputFile = path.join(tmp, 'out.mp4')
fs.writeFileSync(videoFile, Buffer.from('video'))
fs.writeFileSync(audioFile, Buffer.from('audio'))
let calls = 0
const json = (obj, status = 200) => ({
  ok: status >= 200 && status < 300,
  status,
  json: async () => obj,
  text: async () => JSON.stringify(obj),
  arrayBuffer: async () => new Uint8Array([1, 2, 3]).buffer,
})
const fetchImpl = async (url) => {
  calls++
  if (String(url).includes('/v2/assets/upload')) return json({ assetId: calls === 1 ? 'v1' : 'a1' })
  if (String(url).includes('/v2/generate') && !String(url).includes('/v2/generate/')) return json({ id: 'job1' }, 201)
  if (String(url).includes('/v2/generate/job1')) return json({ status: 'COMPLETED', outputUrl: 'https://cdn/out.mp4' })
  if (String(url).includes('cdn/out.mp4')) return json({})
  throw new Error(`unexpected ${url}`)
}
const result = await lipsync.runSyncLabs({
  apiKey: 'test-key',
  videoFile,
  audioFile,
  outputFile,
  fetchImpl,
  sleep: async () => {},
})
check('Sync Labs mock 全链路', result.jobId === 'job1' && fs.existsSync(outputFile))
check('Sync Labs 上传两次 + 提交 + 轮询 + 下载', calls === 5, `calls=${calls}`)

const auth = await lipsync
  .runSyncLabs({
    apiKey: 'bad',
    videoFile,
    audioFile,
    outputFile: path.join(tmp, 'no.mp4'),
    fetchImpl: async () => json({ error: 'bad key' }, 401),
    sleep: async () => {},
  })
  .then(() => 'no-error')
  .catch((e) => e.message)
check('Sync Labs 鉴权失败可读', String(auth).includes('鉴权失败'), String(auth))

// ---- 本地抽帧验收：1s 说话 + 1s 静音 + 1s 说话 ----
const qaVideo = path.join(tmp, 'qa.mp4')
execFileSync('ffmpeg', [
  '-y', '-hide_banner', '-loglevel', 'error',
  '-f', 'lavfi', '-i', 'color=c=black:s=320x240:d=3',
  '-f', 'lavfi', '-i', 'sine=frequency=440:duration=1',
  '-f', 'lavfi', '-i', 'anullsrc=r=44100:cl=mono:d=1',
  '-f', 'lavfi', '-i', 'sine=frequency=440:duration=1',
  '-filter_complex', '[1:a][2:a][3:a]concat=n=3:v=0:a=1[a]',
  '-map', '0:v', '-map', '[a]', '-shortest',
  '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-c:a', 'aac', qaVideo,
])
const qa = await import(path.join(root, 'server/lipsyncQa.mjs'))
const manifest = await qa.analyzeLipSync({
  video: qaVideo,
  outDir: path.join(tmp, 'qa-frames'),
  ffmpeg: 'ffmpeg',
  ffprobe: 'ffprobe',
})
check('抽帧：找到静音段', manifest.frames.some((f) => f.kind === 'silence'))
check('抽帧：找到发声段', manifest.frames.some((f) => f.kind === 'speech'))
check('抽帧：帧文件存在', manifest.frames.every((f) => fs.existsSync(f.path)))
check('抽帧：时间点在时长内', manifest.frames.every((f) => f.at >= 0 && f.at <= manifest.duration))

console.log(bad ? `\n❌ ${bad} 项失败` : '\n✅ 全部通过')
process.exit(bad ? 1 : 0)
