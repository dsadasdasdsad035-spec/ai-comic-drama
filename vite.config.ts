import { defineConfig, type Plugin } from 'vite'
import react from '@vitejs/plugin-react'
import fs from 'node:fs'
import path from 'node:path'
import os from 'node:os'
import crypto from 'node:crypto'
import { execFile } from 'node:child_process'
import { createProject, listProjects, readProject, writeProject, mergeShots, resolveRoot, getSetting, setSetting, dbPath } from './server/db.mjs'

const ARK_URL = 'https://ark.cn-beijing.volces.com/api/v3/images/generations'
const ARK_CHAT = 'https://ark.cn-beijing.volces.com/api/v3/chat/completions'
const MODEL = 'doubao-seedream-4-5-251128'
/** 文本档位：拆镜 / 提示词这种长输出用 pro，其余用 lite */
const TEXT_MODELS = {
  lite: process.env.ARK_TEXT_MODEL || 'doubao-seed-2-0-lite-260428',
  pro: process.env.ARK_TEXT_MODEL_PRO || 'doubao-seed-2-1-pro-260915',
} as const

/** 账户已开通的图生视频模型（2.0 / 2.5 系列需在方舟控制台单独开通） */
const VIDEO_MODEL = 'doubao-seedance-1-0-pro-250528'
/** 多参考图（reference_image，1~4 张）走 Lite I2V；已开通 1.5 pro 可在设置页换模型 */
const VIDEO_REF_MODEL = 'doubao-seedance-1-0-lite-i2v-250428'
const SEEDANCE_CLI = path.join(
  os.homedir(),
  '.workbuddy',
  'skills',
  'seedance-video-generation',
  'seedance.py',
)

/** 画幅 → Seedream 合规像素（4.5 要求总像素 ≥ 3,686,400） */
const RATIO_SIZE: Record<string, string> = {
  '16:9': '2560x1440',
  '9:16': '1440x2560',
  '4:3': '2304x1728',
  '3:4': '1728x2304',
  '1:1': '2048x2048',
  '21:9': '3024x1296',
}

function readApiKey(): string | null {
  // 设置页里填的 Key 优先于 .env / 环境变量
  const fromSettings = String(getAppSettings().apiKey || '').trim()
  if (fromSettings) return fromSettings
  const candidates = [
    path.join(os.homedir(), '.canghe-skills', '.env'),
    path.join(process.cwd(), '.canghe-skills', '.env'),
    path.join(process.cwd(), '.env'),
  ]
  for (const f of candidates) {
    try {
      const txt = fs.readFileSync(f, 'utf8')
      const m = txt.match(/^\s*ARK_API_KEY\s*=\s*(.+)$/m)
      if (m) return m[1].trim().replace(/^["']|["']$/g, '')
    } catch {
      /* 继续找下一个 */
    }
  }
  return process.env.ARK_API_KEY || null
}

/** 从 ~/.canghe-skills/.env 或进程环境里读任意 KEY */
function readEnvKey(name: string): string | null {
  const candidates = [
    path.join(os.homedir(), '.canghe-skills', '.env'),
    path.join(process.cwd(), '.canghe-skills', '.env'),
    path.join(process.cwd(), '.env'),
  ]
  const re = new RegExp(`^\\s*${name}\\s*=\\s*(.+)$`, 'm')
  for (const f of candidates) {
    try {
      const m = fs.readFileSync(f, 'utf8').match(re)
      if (m) return m[1].trim().replace(/^["']|["']$/g, '')
    } catch {
      /* 继续找下一个 */
    }
  }
  return process.env[name] || null
}

// ---------------------------------------------------------------- 设置（存 SQLite settings 表）

type RulePack = { enabled: boolean; text: string }

/** 能力：文本两档 / 图像 / 三视图 / 视频两档 / 音频 */
type Cap = 'text' | 'textPro' | 'image' | 'view' | 'video' | 'videoRef' | 'audio'

/** 渠道协议：决定请求怎么发 */
type ProviderKind = 'ark' | 'openai' | 'minimax' | 'elevenlabs'

type Provider = {
  id: string
  label: string
  kind: ProviderKind
  baseUrl: string
  /** 留空则 ARK 回落到 .env / 环境变量 */
  apiKey?: string
  note?: string
}

type ModelEntry = {
  /** 唯一键，生成时按它选模型 */
  key: string
  label: string
  cap: Cap
  /** Provider.id */
  provider: string
  /** 真实模型 ID */
  model: string
  note?: string
}

type AppSettings = {
  providers: Provider[]
  models: ModelEntry[]
  defaults: Partial<Record<Cap, string>>
  /** 旧的单 Key 字段，保留给 ARK 兜底与老数据 */
  apiKey: string
  rules: Record<string, RulePack>
}

/** 预置渠道：用户不用配也能跑（Key 留空时 ARK 走 .env） */
const DEFAULT_PROVIDERS: Provider[] = [
  {
    id: 'ark',
    label: '字节 · 火山方舟',
    kind: 'ark',
    baseUrl: 'https://ark.cn-beijing.volces.com/api/v3',
    note: '文本 / Seedream 生图 / Seedance 视频，Key 可留空沿用 .env',
  },
  {
    id: 'deepseek',
    label: 'DeepSeek',
    kind: 'openai',
    baseUrl: 'https://api.deepseek.com/v1',
    note: 'OpenAI 兼容，填 Key 即用',
  },
  {
    id: 'minimax',
    label: 'MiniMax',
    kind: 'minimax',
    baseUrl: 'https://api.minimaxi.com/v1',
    note: '文本 chatcompletion_v2 / 语音 t2a_v2',
  },
  {
    id: 'elevenlabs',
    label: 'ElevenLabs',
    kind: 'elevenlabs',
    baseUrl: 'https://api.elevenlabs.io',
    note: '配音，多角色音色',
  },
  {
    id: 'openai',
    label: '第三方 · OpenAI 兼容',
    kind: 'openai',
    baseUrl: 'https://api.openai.com/v1',
    note: '中转站 / 自建服务，改 baseUrl 即可',
  },
]

/** 预置模型：每个能力至少一条，默认指向 ARK 现状 */
const DEFAULT_MODELS: ModelEntry[] = [
  { key: 'ark-text-lite', label: '豆包 · lite', cap: 'text', provider: 'ark', model: TEXT_MODELS.lite },
  { key: 'ark-text-pro', label: '豆包 · pro', cap: 'textPro', provider: 'ark', model: TEXT_MODELS.pro },
  { key: 'deepseek-chat', label: 'DeepSeek Chat', cap: 'text', provider: 'deepseek', model: 'deepseek-chat' },
  {
    key: 'deepseek-reasoner',
    label: 'DeepSeek Reasoner',
    cap: 'textPro',
    provider: 'deepseek',
    model: 'deepseek-reasoner',
  },
  { key: 'minimax-text', label: 'MiniMax M1', cap: 'text', provider: 'minimax', model: 'MiniMax-M1' },
  { key: 'ark-image', label: 'Seedream 4.5', cap: 'image', provider: 'ark', model: MODEL },
  { key: 'ark-view', label: 'Seedream 4.5（三视图）', cap: 'view', provider: 'ark', model: MODEL },
  {
    key: 'openai-image',
    label: 'gpt-image-1（第三方）',
    cap: 'image',
    provider: 'openai',
    model: 'gpt-image-1',
    note: '需在渠道里配好 baseUrl + Key',
  },
  { key: 'ark-video', label: 'Seedance 1.0 pro', cap: 'video', provider: 'ark', model: VIDEO_MODEL },
  { key: 'ark-video-ref', label: 'Seedance Lite I2V（多参考）', cap: 'videoRef', provider: 'ark', model: VIDEO_REF_MODEL },
  { key: 'eleven-tts', label: 'ElevenLabs 多语言 v2', cap: 'audio', provider: 'elevenlabs', model: 'eleven_multilingual_v2' },
  { key: 'minimax-tts', label: 'MiniMax speech-02-hd', cap: 'audio', provider: 'minimax', model: 'speech-02-hd' },
]

const DEFAULT_DEFAULTS: Partial<Record<Cap, string>> = {
  text: 'ark-text-lite',
  textPro: 'ark-text-pro',
  image: 'ark-image',
  view: 'ark-view',
  video: 'ark-video',
  videoRef: 'ark-video-ref',
  audio: 'eleven-tts',
}

/** 老结构（models.lite/pro/image/video/videoRef）→ 新结构，只做读时转换 */
function normalizeSettings(raw: any): AppSettings {
  const rules = (raw?.rules || {}) as Record<string, RulePack>
  const apiKey = String(raw?.apiKey || '')
  if (Array.isArray(raw?.providers) && Array.isArray(raw?.models)) {
    return {
      providers: raw.providers,
      models: raw.models,
      defaults: { ...DEFAULT_DEFAULTS, ...(raw.defaults || {}) },
      apiKey,
      rules,
    }
  }
  const legacy = (raw?.models || {}) as Record<string, string>
  const providers = DEFAULT_PROVIDERS.map((p) => (p.id === 'ark' ? { ...p, apiKey } : { ...p }))
  const models = DEFAULT_MODELS.map((m) => {
    if (m.key === 'ark-text-lite' && legacy.lite) return { ...m, model: legacy.lite }
    if (m.key === 'ark-text-pro' && legacy.pro) return { ...m, model: legacy.pro }
    if (m.key === 'ark-image' && legacy.image) return { ...m, model: legacy.image }
    if (m.key === 'ark-view' && legacy.image) return { ...m, model: legacy.image }
    if (m.key === 'ark-video' && legacy.video) return { ...m, model: legacy.video }
    if (m.key === 'ark-video-ref' && legacy.videoRef) return { ...m, model: legacy.videoRef }
    return { ...m }
  })
  return { providers, models, defaults: { ...DEFAULT_DEFAULTS }, apiKey, rules }
}

let settingsReady = false
/** 插件启动时赋值（server.config.root），供设置层定位 DB */
let appRoot = ''
/** 懒打开 DB（供设置/模型覆盖用；项目路由也会各自 open，同一文件同一连接缓存） */
function getAppSettings(): AppSettings {
  try {
    if (!settingsReady) {
      dbPath(resolveRoot(appRoot || process.cwd()))
      settingsReady = true
    }
    return normalizeSettings(getSetting('app'))
  } catch {
    return normalizeSettings(null)
  }
}

function saveAppSettings(patch: Partial<AppSettings>): AppSettings {
  dbPath(resolveRoot(appRoot || process.cwd()))
  settingsReady = true
  const cur = getAppSettings()
  const next: AppSettings = {
    providers: Array.isArray(patch.providers) ? patch.providers : cur.providers,
    models: Array.isArray(patch.models) ? patch.models : cur.models,
    defaults: { ...cur.defaults, ...(patch.defaults || {}) },
    apiKey: typeof patch.apiKey === 'string' ? patch.apiKey : cur.apiKey,
    rules: { ...cur.rules, ...(patch.rules || {}) },
  }
  setSetting('app', next)
  return next
}

/** 按能力取模型条目：显式 key > 该能力默认 > 该能力第一条 */
function pickModel(cap: Cap, keyOverride?: string): { entry?: ModelEntry; provider?: Provider } {
  const s = getAppSettings()
  const key = String(keyOverride || '').trim()
  const entry =
    (key && s.models.find((m) => m.key === key && m.cap === cap)) ||
    s.models.find((m) => m.key === s.defaults[cap] && m.cap === cap) ||
    s.models.find((m) => m.cap === cap)
  const provider = entry ? s.providers.find((p) => p.id === entry.provider) : undefined
  return { entry, provider }
}

/** 渠道 Key：非 ARK 渠道不会拿 ARK 的 Key 兜底，避免串号 401 */
function providerKey(p?: Provider): string {
  const own = String(p?.apiKey || '').trim()
  if (own) return own
  if (!p || p.kind === 'ark') return readApiKey() || ''
  return ''
}

/** 生效的模型 ID（兼容旧调用点） */
function effTextModel(tier: 'lite' | 'pro'): string {
  return pickModel(tier === 'pro' ? 'textPro' : 'text').entry?.model || TEXT_MODELS[tier]
}
function effImageModel(cap: 'image' | 'view' = 'image'): string {
  return pickModel(cap).entry?.model || MODEL
}
function effVideoModel(): string {
  return pickModel('video').entry?.model || VIDEO_MODEL
}

/** 多参考图（reference_image）模式用的模型：默认 Lite I2V，可在设置页覆盖 */
function effVideoRefModel(): string {
  return pickModel('videoRef').entry?.model || VIDEO_REF_MODEL
}

function readJson(req: any): Promise<any> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = []
    let size = 0
    req.on('data', (c: Buffer) => {
      size += c.length
      if (size > 40 * 1024 * 1024) {
        reject(new Error('请求体超过 40MB'))
        req.destroy()
        return
      }
      chunks.push(c)
    })
    req.on('end', () => {
      try {
        resolve(JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}'))
      } catch {
        reject(new Error('请求体不是合法 JSON'))
      }
    })
    req.on('error', reject)
  })
}

/** 模型常把 JSON 包在 ```json 代码块里，或前后带解释文字，这里剥出来 */
function extractJson(text: string): any {
  const s = String(text || '').trim()
  const fence = s.match(/```(?:json)?\s*([\s\S]*?)```/i)
  const body = (fence ? fence[1] : s).trim()
  try {
    return JSON.parse(body)
  } catch {
    /* 降级到截取首个 {...} */
  }
  const a = body.indexOf('{')
  const b = body.lastIndexOf('}')
  if (a >= 0 && b > a) {
    try {
      return JSON.parse(body.slice(a, b + 1))
    } catch {
      /* ignore */
    }
  }
  throw new Error(`模型返回的不是合法 JSON：${body.slice(0, 120)}`)
}

/** 本地相对路径 / dataURL / http URL → 可直接给方舟的 image 字段 */
function resolveRef(ref: string, root: string): string {
  if (ref.startsWith('data:') || ref.startsWith('http')) return ref
  const clean = ref.split('?')[0].replace(/^\//, '')
  const file = path.join(root, 'public', clean)
  const buf = fs.readFileSync(file)
  const ext = path.extname(file).slice(1) || 'png'
  return `data:image/${ext === 'jpg' ? 'jpeg' : ext};base64,${buf.toString('base64')}`
}

// ---------- 视频任务 ----------

type VideoJob = {
  status: 'running' | 'succeeded' | 'failed'
  url?: string
  message?: string
  startedAt: number
  elapsed?: number
}

const videoJobs = new Map<string, VideoJob>()

function runSeedance(args: string[], apiKey: string): Promise<string> {
  return new Promise((resolve, reject) => {
    execFile(
      'python3',
      [SEEDANCE_CLI, ...args],
      {
        env: { ...process.env, ARK_API_KEY: apiKey },
        timeout: 10 * 60 * 1000,
        maxBuffer: 16 * 1024 * 1024,
      },
      (err, stdout, stderr) => {
        if (err) {
          const raw = `${stderr || ''}\n${stdout || ''}`
          const line =
            raw
              .split('\n')
              .map((s) => s.trim())
              .filter((s) => s && !s.startsWith('{') && !s.startsWith('"') && !s.startsWith('}'))
              .slice(-2)
              .join(' · ') || err.message
          reject(new Error(line))
          return
        }
        resolve(stdout)
      },
    )
  })
}

/** 静态文件直出：绕开 vite 启动时建立的 public 索引 + 支持 Range（视频拖动进度条需要） */
function serveFile(res: any, req: any, file: string, mime: string) {
  if (!fs.existsSync(file)) {
    res.statusCode = 404
    res.end()
    return
  }
  const size = fs.statSync(file).size
  const range = String(req.headers?.range || '')
  res.setHeader('Content-Type', mime)
  res.setHeader('Accept-Ranges', 'bytes')
  res.setHeader('Cache-Control', 'no-cache')
  const m = range.match(/bytes=(\d*)-(\d*)/)
  if (m) {
    const start = m[1] ? Number(m[1]) : 0
    const end = m[2] ? Math.min(Number(m[2]), size - 1) : size - 1
    if (start >= size || start > end) {
      res.statusCode = 416
      res.setHeader('Content-Range', `bytes */${size}`)
      res.end()
      return
    }
    res.statusCode = 206
    res.setHeader('Content-Range', `bytes ${start}-${end}/${size}`)
    res.setHeader('Content-Length', String(end - start + 1))
    fs.createReadStream(file, { start, end }).pipe(res)
    return
  }
  res.setHeader('Content-Length', String(size))
  fs.createReadStream(file).pipe(res)
}

function mimeOf(ext: string): string {
  const e = ext.toLowerCase()
  if (e === 'jpg' || e === 'jpeg') return 'image/jpeg'
  if (e === 'webp') return 'image/webp'
  if (e === 'mp4') return 'video/mp4'
  if (e === 'mov') return 'video/quicktime'
  if (e === 'm4a') return 'audio/mp4'
  if (e === 'aac') return 'audio/aac'
  if (e === 'mp3') return 'audio/mpeg'
  if (e === 'wav') return 'audio/wav'
  return 'image/png'
}

/** 缓存的可用音色列表 */
let voiceCache: { provider: string; voices: { id: string; label: string }[]; at: number } | null = null

/** say 的 zh 发音人里有一堆"列表里有但没下载"的，会静默输出 15ms 空音频，必须实测 */
async function probeSayVoices(): Promise<{ id: string; label: string }[]> {
  const labels: Record<string, string> = {
    Tingting: 'Tingting · 普通话 · 女',
    Meijia: 'Meijia · 台湾国语 · 女',
    Sinji: 'Sinji · 粤语 · 男',
  }
  const ids = Object.keys(labels)
  const tmp = path.join(os.tmpdir(), 'storyboard-canvas')
  fs.mkdirSync(tmp, { recursive: true })

  const results = await Promise.all(
    ids.map(async (id) => {
      const f = path.join(tmp, `probe-${id}.aiff`)
      try {
        await new Promise<void>((resolve, reject) => {
          execFile(
            SAY,
            ['-v', id, '-r', '180', '-o', f, '--data-format=BEI16@22050', '测试'],
            { timeout: 20000 },
            (err) => (err ? reject(err) : resolve()),
          )
        })
        const d = await probeDuration(f)
        return d > 0.4 ? { id, label: labels[id] } : null
      } catch {
        return null
      } finally {
        try {
          fs.unlinkSync(f)
        } catch {
          /* ignore */
        }
      }
    }),
  )
  return results.filter((v): v is { id: string; label: string } => Boolean(v))
}

async function listVoices(): Promise<{ provider: string; voices: { id: string; label: string }[] }> {
  if (voiceCache && Date.now() - voiceCache.at < 10 * 60 * 1000) return voiceCache

  const key = readEnvKey('ELEVENLABS_API_KEY')
  if (key) {
    try {
      const r = await fetch(ELEVEN_VOICES, { headers: { 'xi-api-key': key } })
      if (r.ok) {
        const j: any = await r.json()
        const voices = (j?.voices ?? []).map((v: any) => ({
          id: String(v.voice_id),
          label: `${v.name}${v.labels?.accent ? ` · ${v.labels.accent}` : ''}${
            v.labels?.gender ? ` · ${v.labels.gender}` : ''
          }`,
        }))
        if (voices.length > 0) {
          voiceCache = { provider: 'elevenlabs', voices, at: Date.now() }
          return voiceCache
        }
      }
    } catch {
      /* 落回本地 */
    }
  }

  const voices = await probeSayVoices()
  voiceCache = { provider: 'macos-say', voices, at: Date.now() }
  return voiceCache
}

// ---------- animatic 合成（ffmpeg） ----------

const FFMPEG = '/opt/homebrew/bin/ffmpeg'
const FFPROBE = '/opt/homebrew/bin/ffprobe'
/** 带 libass 的完整版优先（keg-only，不会顶掉系统 ffmpeg） */
const FFMPEG_CANDIDATES = [
  '/opt/homebrew/opt/ffmpeg-full/bin/ffmpeg',
  '/opt/homebrew/bin/ffmpeg',
  '/usr/local/bin/ffmpeg',
]

/** 运行时探测结果：哪条二进制、支不支持 subtitles 滤镜 */
let FF: { bin: string; probe: string; ass: boolean } | null = null

function siblingProbe(bin: string) {
  const p = bin.replace(/ffmpeg$/, 'ffprobe')
  return fs.existsSync(p) ? p : FFPROBE
}

async function hasSubtitlesFilter(bin: string): Promise<boolean> {
  return new Promise((resolve) => {
    if (!fs.existsSync(bin) && bin !== 'ffmpeg') return resolve(false)
    execFile(bin, ['-hide_banner', '-h', 'filter=subtitles'], { timeout: 10000 }, (err, stdout, stderr) => {
      if (err) return resolve(false)
      resolve(!/Unknown filter/i.test(`${stdout}${stderr}`))
    })
  })
}

async function ensureFf() {
  if (FF) return FF
  for (const bin of FFMPEG_CANDIDATES) {
    if (await hasSubtitlesFilter(bin)) {
      FF = { bin, probe: siblingProbe(bin), ass: true }
      return FF
    }
  }
  const bin = FFMPEG_CANDIDATES.find((b) => fs.existsSync(b)) || FFMPEG
  FF = { bin, probe: siblingProbe(bin), ass: false }
  return FF
}

const ffBin = () => FF?.bin ?? FFMPEG
const ffProbe = () => FF?.probe ?? FFPROBE
const SAY = '/usr/bin/say'
const ELEVEN_TTS = 'https://api.elevenlabs.io/v1/text-to-speech'
const ELEVEN_VOICES = 'https://api.elevenlabs.io/v1/voices'
const ELEVEN_MODEL = 'eleven_multilingual_v2'
const EXPORT_SIZE: Record<string, [number, number]> = {
  '480p': [854, 480],
  '720p': [1280, 720],
  '1080p': [1920, 1080],
}

type ExportJob = {
  status: 'running' | 'succeeded' | 'failed'
  url?: string
  message?: string
  shots?: number
  seconds?: number
  voiced?: number
  subbed?: number
  overflows?: { shot: number; voice: number; shotLen: number }[]
  startedAt: number
  elapsed?: number
}

const exportJobs = new Map<string, ExportJob>()

function runFfmpeg(args: string[]): Promise<string> {
  return new Promise((resolve, reject) => {
    execFile(
      ffBin(),
      args,
      { timeout: 8 * 60 * 1000, maxBuffer: 32 * 1024 * 1024 },
      (err, _stdout, stderr) => {
        if (err) {
          const tail = String(stderr || '')
            .split('\n')
            .map((s) => s.trim())
            .filter(Boolean)
            .slice(-3)
            .join(' · ')
          reject(new Error(tail || err.message))
          return
        }
        resolve('')
      },
    )
  })
}

/** 站内路径 / http / dataURL → 本地绝对路径（ffmpeg 只吃文件） */
function materialize(ref: string, root: string, tmpDir: string, tag: string): string {
  if (ref.startsWith('http')) return ref
  if (ref.startsWith('data:')) {
    const b64 = ref.split(',')[1] || ''
    const ext = /image\/png/.test(ref) ? 'png' : 'jpg'
    const file = path.join(tmpDir, `${tag}.${ext}`)
    fs.writeFileSync(file, Buffer.from(b64, 'base64'))
    return file
  }
  return path.join(root, 'public', ref.replace(/^\//, '').split('?')[0])
}

/**
 * 配音 provider 分发：
 *   1. 有 ELEVENLABS_API_KEY → ElevenLabs REST（多角色，中文走 multilingual_v2）
 *   2. 否则 → macOS say（单机兜底，普通话实际只有 Tingting 可用）
 * 换引擎只改这一个函数。
 */
async function synthesize(
  text: string,
  voice: string,
  rate: number,
  outDir: string,
  stamp: string,
  modelKey?: string,
): Promise<{ url: string; engine: string; seconds: number }> {
  // 设置页选了哪个音频模型，就走对应渠道；没配 Key 再回落旧行为
  const { provider, entry } = pickModel('audio', modelKey)
  const kind = provider?.kind
  const ownKey = providerKey(provider)
  if (kind === 'minimax' && ownKey) {
    return synthesizeMinimax(text, voice, ownKey, outDir, stamp, provider!, entry?.model)
  }
  if (kind === 'elevenlabs' && ownKey) {
    return synthesizeEleven(text, voice, ownKey, outDir, stamp, entry?.model)
  }
  const elevenKey = readEnvKey('ELEVENLABS_API_KEY')
  if (elevenKey) return synthesizeEleven(text, voice, elevenKey, outDir, stamp, entry?.model)
  return synthesizeSay(text, voice, rate, outDir, stamp)
}

/** MiniMax 语音合成：t2a_v2 返回 hex 音频 */
async function synthesizeMinimax(
  text: string,
  voiceId: string,
  key: string,
  outDir: string,
  stamp: string,
  provider: Provider,
  model?: string,
): Promise<{ url: string; engine: string; seconds: number }> {
  const base = String(provider.baseUrl || 'https://api.minimaxi.com/v1').replace(/\/+$/, '')
  const vid = voiceId && /^[a-zA-Z0-9_-]+$/.test(voiceId) ? voiceId : 'male-qn-qingse'
  const r = await fetch(`${base}/t2a_v2`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      model: model || 'speech-02-hd',
      text,
      stream: false,
      voice_setting: { voice_id: vid, speed: 1, vol: 1, pitch: 0 },
      audio_setting: { sample_rate: 32000, bitrate: 128000, format: 'mp3' },
    }),
  })
  const raw = await r.text()
  if (!r.ok) throw new Error(`MiniMax ${r.status} — ${raw.slice(0, 240)}`)
  let j: any
  try {
    j = JSON.parse(raw)
  } catch {
    throw new Error(`MiniMax 返回非 JSON：${raw.slice(0, 160)}`)
  }
  const code = j?.base_resp?.status_code
  if (code !== undefined && code !== 0) {
    throw new Error(`MiniMax ${code} — ${j?.base_resp?.status_msg || '合成失败'}`)
  }
  const hex = String(j?.data?.audio || '')
  if (!hex) throw new Error('MiniMax 未返回音频数据')
  const buf = Buffer.from(hex, 'hex')
  if (buf.length < 1024) throw new Error('MiniMax 返回的音频为空')
  const file = path.join(outDir, `voice-${stamp}.mp3`)
  fs.writeFileSync(file, buf)
  const seconds = await probeDuration(file)
  return { url: `/voices/voice-${stamp}.mp3`, engine: `minimax:${vid}`, seconds }
}

async function synthesizeEleven(
  text: string,
  voiceId: string,
  key: string,
  outDir: string,
  stamp: string,
  model?: string,
): Promise<{ url: string; engine: string; seconds: number }> {
  const id = voiceId || '21m00Tcm4TlvDq8ikWAM'
  const r = await fetch(`${ELEVEN_TTS}/${encodeURIComponent(id)}?output_format=mp3_44100_128`, {
    method: 'POST',
    headers: { 'xi-api-key': key, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      text,
      model_id: model || ELEVEN_MODEL,
      voice_settings: { stability: 0.45, similarity_boost: 0.8, style: 0.15 },
    }),
  })
  if (!r.ok) {
    const msg = (await r.text()).slice(0, 240)
    throw new Error(`ElevenLabs ${r.status} — ${msg}`)
  }
  const buf = Buffer.from(await r.arrayBuffer())
  if (buf.length < 1024) throw new Error('ElevenLabs 返回的音频为空')
  const file = path.join(outDir, `voice-${stamp}.mp3`)
  fs.writeFileSync(file, buf)
  const seconds = await probeDuration(file)
  return { url: `/voices/voice-${stamp}.mp3`, engine: `elevenlabs:${id.slice(0, 6)}`, seconds }
}

/** macOS say → aiff → m4a（Chrome 不认 aiff，必须转码） */
async function synthesizeSay(
  text: string,
  voice: string,
  rate: number,
  outDir: string,
  stamp: string,
): Promise<{ url: string; engine: string; seconds: number }> {
  if (!fs.existsSync(SAY)) throw new Error('未找到 /usr/bin/say（非 macOS 环境请改用其他 TTS 引擎）')

  const aiff = path.join(outDir, `tmp-${stamp}.aiff`)
  const m4a = path.join(outDir, `voice-${stamp}.m4a`)

  await new Promise<void>((resolve, reject) => {
    execFile(
      SAY,
      ['-v', voice, '-r', String(rate), '-o', aiff, '--data-format=BEI16@22050', text],
      { timeout: 120000 },
      (err, _o, stderr) => {
        if (err) reject(new Error(String(stderr || '').trim() || err.message))
        else resolve()
      },
    )
  })

  try {
    await runFfmpeg(['-y', '-i', aiff, '-c:a', 'aac', '-b:a', '128k', '-ar', '48000', m4a])
  } finally {
    try {
      fs.unlinkSync(aiff)
    } catch {
      /* 临时文件删不掉无所谓 */
    }
  }

  const seconds = await probeDuration(m4a)
  return { url: `/voices/voice-${stamp}.m4a`, engine: `say:${voice}`, seconds }
}

/** 读媒体真实时长，失败返回 0 */
async function probeDuration(file: string): Promise<number> {
  try {
    const out = await new Promise<string>((resolve, reject) => {
      execFile(
        ffProbe(),
        ['-v', 'error', '-show_entries', 'format=duration', '-of', 'csv=p=0', file],
        (err, stdout) => (err ? reject(err) : resolve(stdout)),
      )
    })
    const d = Number(String(out).trim())
    return Number.isFinite(d) && d > 0 ? d : 0
  } catch {
    return 0
  }
}

function srtTime(sec: number): string {
  const ms = Math.max(0, Math.round(sec * 1000))
  const h = Math.floor(ms / 3600000)
  const m = Math.floor((ms % 3600000) / 60000)
  const s2 = Math.floor((ms % 60000) / 1000)
  const r = ms % 1000
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}:${String(s2).padStart(2, '0')},${String(r).padStart(3, '0')}`
}

/** 单引号包裹 + 反斜杠转义，给 filter_complex 用 */
function filtQuote(v: string): string {
  return `'${v.replace(/\\/g, '\\\\').replace(/'/g, "'\\''")}'`
}

type ResolvedSeg = {
  file: string
  isVideo: boolean
  dur: number
  voice?: string
  sub?: string
  dialogue?: string
  voiceDur?: number
  voiceOffset: number
  subOffset: number
}

/**
 * 一条 ffmpeg 命令把静帧 + 视频混编成片：
 *   每段统一 分辨率/帧率/SAR（letterbox 补边，不裁切）
 *   → 有字幕的段先 overlay 一张整帧透明 PNG（本机 ffmpeg 没有 libass，不能用 subtitles 滤镜）
 *   → concat
 *   → 台词配音按镜头起点 adelay 后 amix 到音轨
 */
async function buildAnimatic(
  segments: {
    seconds: number
    video?: string
    image?: string
    voice?: string
    /** 配音相对镜头起点的偏移（秒，可负＝提前），由时间线拖动产生 */
    voiceOffset?: number
    /** 字幕相对镜头起点的偏移（秒） */
    subOffset?: number
    /** 无 libass 时的兜底：整帧透明 PNG */
    sub?: string
    /** 有 libass 时走真字幕（SRT + subtitles 滤镜） */
    dialogue?: string
  }[],
  resolution: '480p' | '720p' | '1080p',
  root: string,
  outFile: string,
): Promise<{
  shots: number
  seconds: number
  voiced: number
  subbed: number
  overflows: { shot: number; voice: number; shotLen: number }[]
}> {
  const [W, H] = EXPORT_SIZE[resolution] || EXPORT_SIZE['720p']
  const tmpDir = path.join(os.tmpdir(), 'storyboard-canvas')
  fs.mkdirSync(tmpDir, { recursive: true })

  // 先解析每段并拿到真实时长 —— 字幕/配音都要按真实起点对齐
  const resolved: ResolvedSeg[] = []
  for (let i = 0; i < segments.length; i++) {
    const seg = segments[i]
    const nominal = Math.min(30, Math.max(0.5, Number(seg.seconds) || 2))
    let file = ''
    let isVideo = false
    if (seg.video) {
      file = materialize(seg.video, root, tmpDir, `exp-${i}`)
      isVideo = true
    } else if (seg.image) {
      file = materialize(seg.image, root, tmpDir, `exp-${i}`)
    }
    if (!file || !fs.existsSync(file)) continue

    const dur = isVideo ? (await probeDuration(file)) || nominal : nominal

    let voice: string | undefined
    let voiceDur: number | undefined
    if (seg.voice) {
      const vf = materialize(seg.voice, root, tmpDir, `exp-a-${i}`)
      if (fs.existsSync(vf)) {
        voice = vf
        voiceDur = await probeDuration(vf)
      }
    }

    let sub: string | undefined
    if (seg.sub) {
      const sf = materialize(seg.sub, root, tmpDir, `exp-s-${i}`)
      if (fs.existsSync(sf)) sub = sf
    }

    // 偏移只在镜头时长内有效，夹紧避免拖出荒唐值
    const vo = Math.max(-dur, Math.min(dur, Number(seg.voiceOffset) || 0))
    const so = Math.max(-dur, Math.min(dur, Number(seg.subOffset) || 0))
    resolved.push({ file, isVideo, dur, voice, voiceDur, sub, dialogue: seg.dialogue, voiceOffset: vo, subOffset: so })
  }

  if (resolved.length === 0) throw new Error('没有任何可用的画面或视频，先出图/出片再导出')

  const starts: number[] = []
  let total = 0
  for (const r of resolved) {
    starts.push(total)
    total += r.dur
  }

  /** 配音比镜头长 → 会被截断，回传给前端告警 */
  const overflows = resolved
    .map((r, i) => ({ r, i }))
    .filter(({ r }) => {
      const avail = Math.max(0.3, r.dur - Math.max(0, r.voiceOffset))
      return !!r.voiceDur && r.voiceDur > avail + 0.2
    })
    .map(({ r, i }) => ({
      shot: i + 1,
      voice: Math.round((r.voiceDur as number) * 10) / 10,
      shotLen: Math.round(r.dur * 10) / 10,
    }))

  const args: string[] = ['-y']
  const vFilters: string[] = []
  const aFilters: string[] = []
  const vIdx: number[] = []
  const sIdx: (number | null)[] = []
  const aInputs: { idx: number; startMs: number; keep: number; cut: boolean }[] = []
  let inputIdx = 0

  // 输入顺序：画面 → 字幕 PNG → 配音（索引必须按这个顺序记）
  resolved.forEach((r) => {
    if (r.isVideo) args.push('-i', r.file)
    else args.push('-loop', '1', '-t', r.dur.toFixed(3), '-i', r.file)
    vIdx.push(inputIdx++)
  })

  resolved.forEach((r) => {
    if (!r.sub) {
      sIdx.push(null)
      return
    }
    args.push('-i', r.sub)
    sIdx.push(inputIdx++)
  })

  resolved.forEach((r, i) => {
    if (!r.voice) return
    args.push('-i', r.voice)
    // 配音比镜头长：在镜头末尾收掉（0.12s 淡出），否则会盖住后面几镜的声音，
    // 也会跟字幕的截断点对不上。
    // 起点 = 镜头起点 + 用户拖出来的偏移（不能为负时刻）
    const absStart = Math.max(0, starts[i] + r.voiceOffset)
    // 延后多少就少多少可用时长；提前的话可用时长仍是整镜
    const available = Math.max(0.3, r.dur - Math.max(0, r.voiceOffset))
    const cut = !!r.voiceDur && r.voiceDur > available + 0.2
    aInputs.push({
      idx: inputIdx,
      startMs: Math.round(absStart * 1000),
      keep: cut ? available : 0,
      cut,
    })
    inputIdx++
  })

  const vTails = resolved.map((r, i) => {
    vFilters.push(
      `[${vIdx[i]}:v]scale=${W}:${H}:force_original_aspect_ratio=decrease:in_range=auto:out_range=tv,` +
        `pad=${W}:${H}:(ow-iw)/2:(oh-ih)/2:color=0x000000,` +
        `fps=24,setsar=1,format=yuv420p[v${i}]`,
    )
    const si = sIdx[i]
    if (si === null) return `[v${i}]`
    // 单帧 PNG + eof_action=repeat（默认）即可覆盖整段
    vFilters.push(`[v${i}][${si}:v]overlay=0:0:format=auto,format=yuv420p[vw${i}]`)
    return `[vw${i}]`
  })

  vFilters.push(`${vTails.join('')}concat=n=${resolved.length}:v=1:a=0[out]`)

  // 有 libass：用真字幕（SRT + subtitles 滤镜），比 overlay PNG 干净得多
  let srtFile = ''
  let vOut = '[out]'
  if (FF?.ass) {
    const cues: { start: number; end: number; text: string }[] = []
    resolved.forEach((r, i) => {
      const text = (r.dialogue ?? '').replace(/\r?\n/g, ' ').trim()
      if (!text) return
      const base = Math.max(0, starts[i] + r.subOffset)
      const lead = 0.15
      const start = base + lead
      const voiced = r.voiceDur && r.voiceDur > 0.3
      const want = voiced ? (r.voiceDur as number) : r.dur - lead - 0.15
      const end = Math.min(start + Math.max(0.5, want), base + r.dur - 0.08)
      if (end > start + 0.25) cues.push({ start, end, text })
    })

    if (cues.length > 0) {
      srtFile = path.join(tmpDir, `subs-${Date.now()}-${crypto.randomBytes(3).toString('hex')}.srt`)
      const body = cues
        .map((c, i) => `${i + 1}\n${srtTime(c.start)} --> ${srtTime(c.end)}\n${c.text}\n`)
        .join('\n')
      fs.writeFileSync(srtFile, body, 'utf8')

      // ASS 颜色是 &HAABBGGRR —— AA 在前，00 才是不透明。
      // 之前写成 &HC8000000 等于 78% 透明的描边，等于没描边。
      const fontSize = Math.round(H * 0.05)
      const marginV = Math.round(H * 0.05)
      const outline = Math.max(1.5, Math.round(H * 0.0035 * 10) / 10)
      const style =
        `FontName=PingFang SC,FontSize=${fontSize},` +
        `PrimaryColour=&H00FFFFFF,OutlineColour=&H00000000,` +
        `BorderStyle=1,Outline=${outline},Shadow=0,Spacing=1,` +
        `Alignment=2,MarginV=${marginV}`
      vFilters.push(
        `[out]subtitles=filename=${filtQuote(srtFile)}:` +
          `original_size=${W}x${H}:force_style=${filtQuote(style)}[vsub]`,
      )
      vOut = '[vsub]'
    }
  }

  if (aInputs.length > 0) {
    aInputs.forEach((a, i) => {
      let chain =
        `[${a.idx}:a]aresample=48000,` +
        `aformat=sample_fmts=fltp:channel_layouts=stereo`
      if (a.cut) {
        const fade = 0.12
        const st = Math.max(0, a.keep - fade)
        chain += `,atrim=0:${a.keep.toFixed(3)},asetpts=PTS-STARTPTS`
        if (st > 0) chain += `,afade=t=out:st=${st.toFixed(3)}:d=${fade}`
      }
      chain += `,volume=1.6,adelay=${a.startMs}:all=1[a${i}]`
      aFilters.push(chain)
    })
    aFilters.push(
      `${aInputs.map((_, i) => `[a${i}]`).join('')}` +
        `amix=inputs=${aInputs.length}:normalize=0:dropout_transition=0,` +
        `apad=whole_dur=${total.toFixed(3)},atrim=0:${total.toFixed(3)}[aout]`,
    )
  }

  args.push('-filter_complex', [...vFilters, ...aFilters].join(';'), '-map', vOut)

  if (aInputs.length > 0) {
    args.push('-map', '[aout]', '-c:a', 'aac', '-b:a', '160k', '-ar', '48000')
  } else {
    args.push('-an')
  }

  args.push(
    '-c:v', 'libx264',
    '-preset', 'veryfast',
    '-crf', '20',
    '-pix_fmt', 'yuv420p',
    '-color_range', 'tv',
    '-r', '24',
    '-movflags', '+faststart',
    '-shortest',
    outFile,
  )

  await runFfmpeg(args)

  // 上报真实片长（静帧段按名义时长、视频段按实际长度，拼完以探测结果为准）
  let real = total
  try {
    const out = await new Promise<string>((resolve, reject) => {
      execFile(
        ffProbe(),
        ['-v', 'error', '-show_entries', 'format=duration', '-of', 'csv=p=0', outFile],
        (err, stdout) => (err ? reject(err) : resolve(stdout)),
      )
    })
    const d = Number(String(out).trim())
    if (Number.isFinite(d) && d > 0) real = d
  } catch {
    /* 探测失败就用估算值 */
  }

  return {
    shots: resolved.length,
    seconds: Math.round(real * 10) / 10,
    voiced: aInputs.length,
    subbed: srtFile ? resolved.filter((r) => (r.dialogue ?? '').trim()).length : sIdx.filter((v) => v !== null).length,
    overflows,
  }
}


function seedreamProxy(): Plugin {
  return {
    name: 'seedream-proxy',
    configureServer(server) {
      const root = server.config.root
      appRoot = root
      const outDir = path.join(root, 'public', 'generated')

      server.middlewares.use(async (req, res, next) => {
        const url = (req.url || '').split('?')[0]

        // 直接提供生成产物：vite 的 public 索引在启动时建立，
        // 运行中新写入的文件在 watcher 更新前会被 SPA fallback 吃掉（返回 index.html）
        for (const dir of ['generated', 'videos', 'exports', 'voices']) {
          if (url.startsWith(`/${dir}/`)) {
            const file = path.join(root, 'public', dir, path.basename(url))
            serveFile(res, req, file, mimeOf(path.extname(file).slice(1) || 'png'))
            return
          }
        }

        if (url === '/api/health') {
          const ff = await ensureFf()
          res.setHeader('Content-Type', 'application/json')
          res.end(
            JSON.stringify({
              hasKey: Boolean(readApiKey()),
              ffmpegAss: ff.ass,
              ffmpegPath: ff.bin,
              model: effImageModel(),
              videoModel: effVideoModel(),
              videoRefModel: effVideoRefModel(),
              videoReady: fs.existsSync(SEEDANCE_CLI),
              ffmpegReady: fs.existsSync(FFMPEG),
              ttsReady: fs.existsSync(SAY),
              ttsProvider: readEnvKey('ELEVENLABS_API_KEY') ? 'elevenlabs' : 'macos-say',
            }),
          )
          return
        }

        // ---- 设置页：大模型 + 技能规则包，存 SQLite settings 表 ----
        if (url === '/api/settings') {
          res.setHeader('Content-Type', 'application/json; charset=utf-8')
          try {
            if (req.method === 'GET') {
              res.end(JSON.stringify({ ok: true, settings: getAppSettings(), db: dbPath(resolveRoot(root)) }))
              return
            }
            if (req.method === 'PUT') {
              const body = await readJson(req)
              const settings = saveAppSettings(body || {})
              res.end(JSON.stringify({ ok: true, settings }))
              return
            }
            res.statusCode = 405
            res.end(JSON.stringify({ ok: false, message: '只支持 GET / PUT' }))
          } catch (e: any) {
            res.statusCode = 500
            res.end(JSON.stringify({ ok: false, message: e?.message || String(e) }))
          }
          return
        }

        // ---- 项目数据：SQLite 读写（工作台与画布共用同一真相源；首次启动自动迁移 project.json）----
        if (url === '/api/project') {
          res.setHeader('Content-Type', 'application/json; charset=utf-8')
          const q = new URL(req.url || '', 'http://x')
          const name = q.searchParams.get('name') || ''
          try {
            const rootDir = resolveRoot(root)

            if (req.method === 'GET' && !name) {
              res.end(JSON.stringify({ ok: true, root: rootDir, projects: listProjects(rootDir) }))
              return
            }

            if (req.method === 'GET') {
              res.end(JSON.stringify({ ok: true, project: readProject(rootDir, name) }))
              return
            }

            // 新建项目：?create=1
            if (req.method === 'POST' && q.searchParams.get('create')) {
              const body = await readJson(req).catch(() => ({}))
              const made = createProject(rootDir, name, body || {})
              res.end(JSON.stringify({ ok: true, name: made.name, created: true }))
              return
            }

            const body = await readJson(req)

            // POST = 局部合并（镜头按 id 合并、角色整体替换），保留未传的字段
            if (req.method === 'POST') {
              const cur = readProject(rootDir, name)
              const patch: Record<string, unknown> = {}
              if (Array.isArray(body.shots)) patch.shots = mergeShots(cur.shots, body.shots)
              // 角色 / 集 / 原著 / 元信息整体替换（都是人改的结果，不是 LLM 增量）
              for (const k of ['characters', 'episodes']) {
                if (body[k] === undefined) continue
                if (!Array.isArray(body[k])) throw new Error(`${k} 必须是数组`)
                patch[k] = body[k]
              }
              for (const k of ['source', 'logline', 'style', 'aspect']) {
                if (body[k] === undefined) continue
                if (typeof body[k] !== 'string') throw new Error(`${k} 必须是字符串`)
                patch[k] = body[k]
              }
              if (Object.keys(patch).length === 0) {
                throw new Error('POST 需要 shots / characters / episodes / source 等字段之一')
              }
              const saved = writeProject(rootDir, name, patch)
              res.end(
                JSON.stringify({
                  ok: true,
                  shots: saved.shots ?? [],
                  characters: saved.characters ?? [],
                  savedAt: saved.updated_at,
                }),
              )
              return
            }

            if (req.method === 'PUT') {
              const saved = writeProject(rootDir, name, body.project || body)
              res.end(JSON.stringify({ ok: true, savedAt: saved.updated_at, shots: saved.shots?.length ?? 0 }))
              return
            }

            res.statusCode = 405
            res.end(JSON.stringify({ ok: false, message: '只支持 GET / POST / PUT' }))
          } catch (e: any) {
            res.statusCode = 400
            res.end(JSON.stringify({ ok: false, message: e?.message || String(e) }))
          }
          return
        }

        // ---- 文本 LLM：拆镜 / 提示词共用这一个原语 ----
        if (url === '/api/text') {
          res.setHeader('Content-Type', 'application/json; charset=utf-8')
          if (req.method !== 'POST') {
            res.statusCode = 405
            res.end(JSON.stringify({ ok: false, message: '只支持 POST' }))
            return
          }
          try {
            const body = await readJson(req)
            const system = String(body.system || '')
            const prompt = String(body.prompt || '')
            if (!prompt.trim()) throw new Error('prompt 不能为空')
            const wantJson = Boolean(body.json)

            // 选模型：modelKey（设置页里的模型表键）> 档位 lite/pro
            const modelKey = String(body.modelKey || '').trim()
            const tier: 'lite' | 'pro' = body.model === 'pro' ? 'pro' : 'lite'
            const cap: Cap = modelKey ? 'text' : tier === 'pro' ? 'textPro' : 'text'
            const { entry, provider } = pickModel(cap, modelKey)
            const model = entry?.model || effTextModel(tier)
            const kind: ProviderKind = provider?.kind || 'ark'
            const key = providerKey(provider)
            if (!key) {
              res.statusCode = 400
              res.end(
                JSON.stringify({
                  ok: false,
                  message: `渠道「${provider?.label || kind}」没有 API Key，去设置页填一下`,
                  kind: 'no-key',
                }),
              )
              return
            }
            if (kind === 'elevenlabs') {
              throw new Error('ElevenLabs 渠道不支持文本生成，请换文本模型')
            }
            const base = String(provider?.baseUrl || 'https://ark.cn-beijing.volces.com/api/v3').replace(/\/+$/, '')
            // MiniMax 走自家 chatcompletion_v2，其余是标准 OpenAI /chat/completions
            const endpoint = kind === 'minimax' ? `${base}/text/chatcompletion_v2` : `${base}/chat/completions`

            const messages: { role: string; content: string }[] = []
            if (system) messages.push({ role: 'system', content: system })
            messages.push({ role: 'user', content: prompt })

            const r = await fetch(endpoint, {
              method: 'POST',
              headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
              body: JSON.stringify({
                model,
                messages,
                max_tokens: Number(body.maxTokens) || 8192,
                temperature: body.temperature ?? 0.7,
              }),
            })
            const raw = await r.text()
            if (!r.ok) throw new Error(`${provider?.label || kind} ${r.status}: ${raw.slice(0, 300)}`)

            const j = JSON.parse(raw)
            const text = String(j?.choices?.[0]?.message?.content ?? j?.reply ?? '')
            const meta = { model, provider: provider?.label || kind }
            if (!wantJson) {
              res.end(JSON.stringify({ ok: true, text, ...meta }))
              return
            }
            res.end(JSON.stringify({ ok: true, json: extractJson(text), text, ...meta }))
          } catch (e: any) {
            res.statusCode = 500
            res.end(JSON.stringify({ ok: false, message: e?.message || String(e) }))
          }
          return
        }

        // ---- 可用音色 ----
        if (url === '/api/voices') {
          res.setHeader('Content-Type', 'application/json; charset=utf-8')
          try {
            const list = await listVoices()
            res.end(JSON.stringify({ ok: true, ...list }))
          } catch (e) {
            res.statusCode = 500
            res.end(JSON.stringify({ ok: false, message: (e as Error).message, voices: [] }))
          }
          return
        }

        // ---- 台词配音 ----
        // provider 目前只有 macOS 内置 say（ElevenLabs 需要 belt CLI + 账号，当前环境没有）。
        // 换引擎只需重写 synthesize()：接 ElevenLabs 时改成
        //   belt app run elevenlabs/text-to-dialogue --input '{"segments":[{"text":...,"voice":...}]}'
        if (url === '/api/voice') {
          res.setHeader('Content-Type', 'application/json; charset=utf-8')
          if (req.method !== 'POST') {
            res.statusCode = 405
            res.end(JSON.stringify({ ok: false, message: '只支持 POST' }))
            return
          }
          try {
            const body = await readJson(req)
            const text = String(body.text || '').trim()
            const hasLines = Array.isArray(body.lines) && body.lines.length > 0
            if (!text && !hasLines) {
              res.statusCode = 400
              res.end(JSON.stringify({ ok: false, message: '台词为空' }))
              return
            }
            if (text.length > 400) {
              res.statusCode = 400
              res.end(JSON.stringify({ ok: false, message: '单句台词过长（上限 400 字）' }))
              return
            }
            const voiceKey = String(body.modelKey || '').trim()
            const voice = String(body.voice || 'Tingting')
            const rate = Math.min(260, Math.max(110, Number(body.rate) || 180))

            await ensureFf()
            const t0 = Date.now()
            const outDir = path.join(root, 'public', 'voices')
            fs.mkdirSync(outDir, { recursive: true })
            const stamp = `${Date.now()}-${crypto.randomBytes(3).toString('hex')}`

            // 一镜多说话人：每行各自合成，再拼成一条音轨
            const lines = Array.isArray(body.lines) ? body.lines.slice(0, 12) : []
            if (lines.length > 0) {
              const parts: { file: string; seconds: number; engine: string }[] = []
              for (let i = 0; i < lines.length; i++) {
                const t = String(lines[i]?.text || '').trim()
                if (!t) continue
                if (t.length > 400) throw new Error(`第 ${i + 1} 句台词过长（上限 400 字）`)
                const v = String(lines[i]?.voice || voice)
                const r = Math.min(260, Math.max(110, Number(lines[i]?.rate) || rate))
                const one = await synthesize(t, v, r, outDir, `${stamp}-${i}`, voiceKey)
                parts.push({
                  file: path.join(root, 'public', one.url.replace(/^\//, '')),
                  seconds: one.seconds,
                  engine: one.engine,
                })
              }
              if (parts.length === 0) throw new Error('没有可配音的台词')

              if (parts.length === 1) {
                const only = parts[0]
                res.end(
                  JSON.stringify({
                    ok: true,
                    url: `/${path.relative(path.join(root, 'public'), only.file).split(path.sep).join('/')}`,
                    engine: only.engine,
                    seconds: only.seconds,
                    lines: 1,
                    elapsed: Date.now() - t0,
                  }),
                )
                return
              }

              // 重编码拼接：不同 provider 的容器/编码可能不一样，直接 -c copy 会炸
              const merged = path.join(outDir, `${stamp}-mix.m4a`)
              const args: string[] = ['-y']
              for (const pt of parts) args.push('-i', pt.file)
              const streams = parts.map((_, i) => `[${i}:a]`).join('')
              args.push(
                '-filter_complex',
                `${streams}concat=n=${parts.length}:v=0:a=1[a]`,
                '-map', '[a]', '-c:a', 'aac', '-b:a', '128k', '-ar', '48000',
                merged,
              )
              await runFfmpeg(args)
              const total = await probeDuration(merged)
              res.end(
                JSON.stringify({
                  ok: true,
                  url: `/voices/${path.basename(merged)}`,
                  engine: parts[0].engine,
                  seconds: total,
                  lines: parts.length,
                  elapsed: Date.now() - t0,
                }),
              )
              return
            }

            const result = await synthesize(text, voice, rate, outDir, stamp, voiceKey)
            res.end(
              JSON.stringify({
                ok: true,
                url: result.url,
                engine: result.engine,
                seconds: result.seconds,
                elapsed: Date.now() - t0,
              }),
            )
          } catch (e) {
            res.statusCode = 500
            res.end(JSON.stringify({ ok: false, message: (e as Error).message }))
          }
          return
        }

        // ---- animatic 合成：静帧 + 视频混编（同样走任务 + 轮询） ----
        if (url === '/api/assemble') {
          res.setHeader('Content-Type', 'application/json; charset=utf-8')

          if (req.method === 'GET') {
            const q = new URL(req.url || '', 'http://x').searchParams
            const job = exportJobs.get(q.get('id') || '')
            if (!job) {
              res.statusCode = 404
              res.end(JSON.stringify({ ok: false, message: '任务不存在', status: 'failed' }))
              return
            }
            res.end(JSON.stringify({ ok: true, ...job }))
            return
          }

          if (req.method !== 'POST') {
            res.statusCode = 405
            res.end(JSON.stringify({ ok: false, message: '只支持 POST / GET' }))
            return
          }
          const ff = await ensureFf()
          if (!fs.existsSync(ff.bin)) {
            res.statusCode = 500
            res.end(JSON.stringify({ ok: false, message: `未找到 ffmpeg：${ff.bin}` }))
            return
          }

          try {
            const body = await readJson(req)
            const segments = Array.isArray(body.segments) ? body.segments : []
            if (segments.length === 0) {
              res.statusCode = 400
              res.end(JSON.stringify({ ok: false, message: '没有镜头可合成' }))
              return
            }
            const resolution = ['480p', '720p', '1080p'].includes(String(body.resolution))
              ? (String(body.resolution) as '480p' | '720p' | '1080p')
              : '720p'

            const id = `e-${Date.now()}-${crypto.randomBytes(3).toString('hex')}`
            exportJobs.set(id, { status: 'running', startedAt: Date.now() })
            res.end(JSON.stringify({ ok: true, id }))

            ;(async () => {
              const t0 = Date.now()
              try {
                const outRoot = path.join(root, 'public', 'exports')
                fs.mkdirSync(outRoot, { recursive: true })
                const name = `animatic-${resolution}-${Date.now()}.mp4`
                const outFile = path.join(outRoot, name)
                const info = await buildAnimatic(segments, resolution, root, outFile)
                exportJobs.set(id, {
                  status: 'succeeded',
                  url: `/exports/${name}`,
                  shots: info.shots,
                  seconds: info.seconds,
                  voiced: info.voiced,
                  subbed: info.subbed,
                  overflows: info.overflows,
                  startedAt: t0,
                  elapsed: Date.now() - t0,
                })
              } catch (e) {
                exportJobs.set(id, {
                  status: 'failed',
                  message: (e as Error).message,
                  startedAt: t0,
                  elapsed: Date.now() - t0,
                })
              }
            })()
          } catch (e) {
            res.statusCode = 500
            res.end(JSON.stringify({ ok: false, message: (e as Error).message }))
          }
          return
        }

        // ---- 图生视频：提交 + 轮询（生成可能 1~4 分钟，不走长连接） ----
        if (url === '/api/seedance') {
          res.setHeader('Content-Type', 'application/json; charset=utf-8')
          const key = readApiKey()

          if (req.method === 'GET') {
            const q = new URL(req.url || '', 'http://x').searchParams
            const id = q.get('id') || ''
            const job = videoJobs.get(id)
            if (!job) {
              res.statusCode = 404
              res.end(JSON.stringify({ ok: false, message: '任务不存在', status: 'failed' }))
              return
            }
            res.end(JSON.stringify({ ok: true, ...job }))
            return
          }

          if (req.method !== 'POST') {
            res.statusCode = 405
            res.end(JSON.stringify({ ok: false, message: '只支持 POST / GET' }))
            return
          }
          if (!fs.existsSync(SEEDANCE_CLI)) {
            res.statusCode = 500
            res.end(
              JSON.stringify({ ok: false, message: `未找到 Seedance 脚本：${SEEDANCE_CLI}`, kind: 'no-cli' }),
            )
            return
          }

          try {
            const body = await readJson(req)
            const image = String(body.image || '')
            // 参考图（reference_image）模式：1~4 张，多了截断（方舟上限）
            const refImages: string[] = Array.isArray(body.refImages)
              ? body.refImages.map((x: unknown) => String(x || '')).filter(Boolean).slice(0, 4)
              : []
            const refMode = refImages.length > 0
            if (!image && !refMode) {
              res.statusCode = 400
              res.end(JSON.stringify({ ok: false, message: '缺少首帧图片或参考图，请先生成画面或连线参考' }))
              return
            }

            // 图片入参统一落地：http 直接用，dataURL 写临时文件，/xxx 映射到 public
            const tmpDir = path.join(os.tmpdir(), 'storyboard-canvas')
            fs.mkdirSync(tmpDir, { recursive: true })
            const prep = (src: string, tag: string): string => {
              if (src.startsWith('data:')) {
                const b64 = src.split(',')[1] || ''
                const ext = /image\/png/.test(src) ? 'png' : 'jpg'
                const out = path.join(tmpDir, `${tag}-${Date.now()}-${crypto.randomBytes(3).toString('hex')}.${ext}`)
                fs.writeFileSync(out, Buffer.from(b64, 'base64'))
                return out
              }
              const p = src.startsWith('/')
                ? path.join(root, 'public', src.replace(/^\//, '').split('?')[0])
                : src
              if (!p.startsWith('http') && !fs.existsSync(p)) throw new Error(`${tag} 图片不存在：${p}`)
              return p
            }
            let imgPath = ''
            const refPaths: string[] = []
            const skipped: string[] = []
            try {
              if (refMode) {
                // 参考图里个别文件失效不该整单失败：跳过并回报，全坏才算错
                for (const [i, r] of refImages.entries()) {
                  try {
                    refPaths.push(prep(r, `ref${i + 1}`))
                  } catch {
                    skipped.push(r)
                  }
                }
                if (refPaths.length === 0) throw new Error(`参考图都不可用：${skipped.join('、')}`)
              } else {
                imgPath = prep(image, 'first')
              }
            } catch (e) {
              res.statusCode = 400
              res.end(JSON.stringify({ ok: false, message: (e as Error).message }))
              return
            }

            const seconds = Math.min(12, Math.max(2, Math.round(Number(body.seconds) || 5)))
            const ratio = ['16:9', '9:16', '4:3', '1:1', '3:4', '21:9'].includes(String(body.ratio))
              ? String(body.ratio)
              : '16:9'
            const resolution = body.resolution === '720p' ? '720p' : '480p'
            const prompt = String(body.prompt || '').trim() || '镜头缓慢推进，环境细节自然流动，人物保持姿态'
            const cameraFixed = body.cameraFixed ? 'true' : 'false'

            const id = `v-${Date.now()}-${crypto.randomBytes(3).toString('hex')}`
            videoJobs.set(id, { status: 'running', startedAt: Date.now() })

            const outDir = path.join(root, 'public', 'videos')
            fs.mkdirSync(outDir, { recursive: true })

            // 参考图模式走 reference_image 模型，首帧模式走 video 模型；都可由前端指定 modelKey
            const wantKey = String(body.modelKey || '').trim()
            const refPick = pickModel('videoRef', wantKey)
            const pick = refMode
              ? refPick.entry
                ? refPick
                : pickModel('video', wantKey)
              : pickModel('video', wantKey)
            const model = pick.entry?.model || (refMode ? effVideoRefModel() : effVideoModel())
            const provider = pick.provider
            const runKey = providerKey(provider)
            if (!runKey) {
              res.statusCode = 400
              res.end(
                JSON.stringify({
                  ok: false,
                  message: `渠道「${provider?.label || 'ark'}」没有 API Key，去设置页填一下`,
                  kind: 'no-key',
                }),
              )
              return
            }
            if (provider && provider.kind !== 'ark') {
              res.statusCode = 400
              res.end(
                JSON.stringify({
                  ok: false,
                  message: '视频出片目前只走方舟 Seedance CLI，请在设置里选方舟渠道的视频模型',
                }),
              )
              return
            }
            const cliArgs = [
              'create',
              '-p', prompt,
              ...(refMode ? ['--ref-images', ...refPaths] : ['-i', imgPath]),
              '--ratio', ratio,
              '-d', String(seconds),
              '-r', resolution,
              '-m', model,
              '--camera-fixed', cameraFixed,
              '--wait',
              '--interval', '8',
              '--download', outDir,
            ]

            // dryRun：只回显将要提交的参数，不真的出片（调试 / 验证用）
            if (body.dryRun) {
              res.end(
                JSON.stringify({
                  ok: true,
                  id: 'dry-run',
                  mode: refMode ? 'ref' : 'first',
                  model,
                  skipped,
                  args: cliArgs,
                }),
              )
              return
            }

            res.end(JSON.stringify({ ok: true, id, mode: refMode ? 'ref' : 'first', model, skipped }))

            // 后台执行，前端轮询
            ;(async () => {
              const t0 = Date.now()
              try {
                const stdout = await runSeedance(cliArgs, runKey)
                const m = stdout.match(/Saved to:\s*(.+?\.(?:mp4|mov))/)
                if (!m) throw new Error('未解析到视频产物路径')
                const src = m[1].trim()
                const name = `shot-vid-${Date.now()}-${crypto.randomBytes(3).toString('hex')}.mp4`
                fs.copyFileSync(src, path.join(outDir, name))
                try {
                  fs.unlinkSync(src)
                } catch {
                  /* 临时文件删不掉无所谓 */
                }
                videoJobs.set(id, {
                  status: 'succeeded',
                  url: `/videos/${name}`,
                  startedAt: t0,
                  elapsed: Date.now() - t0,
                })
              } catch (e) {
                videoJobs.set(id, {
                  status: 'failed',
                  message: (e as Error).message,
                  startedAt: t0,
                  elapsed: Date.now() - t0,
                })
              }
            })()
          } catch (e) {
            res.statusCode = 500
            res.end(JSON.stringify({ ok: false, message: (e as Error).message }))
          }
          return
        }

        if (url !== '/api/seedream') return next()

        res.setHeader('Content-Type', 'application/json; charset=utf-8')
        if (req.method !== 'POST') {
          res.statusCode = 405
          res.end(JSON.stringify({ ok: false, message: '只支持 POST' }))
          return
        }

        const key = readApiKey()
        if (!key) {
          res.statusCode = 500
          res.end(
            JSON.stringify({
              ok: false,
              message: '未找到 ARK_API_KEY，请配置 ~/.canghe-skills/.env',
              kind: 'no-key',
            }),
          )
          return
        }

        try {
          const body = await readJson(req)
          const prompt = String(body.prompt || '').trim()
          if (!prompt) {
            res.statusCode = 400
            res.end(JSON.stringify({ ok: false, message: '提示词为空', kind: 'bad-request' }))
            return
          }

          // 渠道分发：方舟 Seedream 支持参考图；第三方走 OpenAI 兼容 images/generations（纯文生图）
          const cap: Cap = body.cap === 'view' ? 'view' : 'image'
          const { entry: imgEntry, provider: imgProvider } = pickModel(cap, String(body.modelKey || ''))
          const kind: ProviderKind = imgProvider?.kind || 'ark'
          const model = imgEntry?.model || effImageModel(cap)
          const imgKey = providerKey(imgProvider)
          if (!imgKey) {
            res.statusCode = 400
            res.end(
              JSON.stringify({
                ok: false,
                message: `渠道「${imgProvider?.label || 'ark'}」没有 API Key，去设置页填一下`,
                kind: 'no-key',
              }),
            )
            return
          }
          const base = String(imgProvider?.baseUrl || 'https://ark.cn-beijing.volces.com/api/v3').replace(
            /\/+$/,
            '',
          )
          const imgEndpoint = `${base}/images/generations`
          const refSupported = kind === 'ark'

          const ratio = String(body.ratio || '16:9')
          const size = RATIO_SIZE[ratio] || RATIO_SIZE['16:9']
          const n = Math.min(4, Math.max(1, Number(body.n) || 1))
          const payload: Record<string, unknown> = {
            model,
            prompt,
            size,
            response_format: 'url',
            ...(refSupported ? { watermark: false } : {}),
          }
          const dropRefs: string[] = []
          if (refSupported && body.refImage) {
            const ref = String(body.refImage)
            // 方舟不接受 svg 参考图；示例占位图是 svg，直接跳过
            if (!ref.startsWith('data:image/svg')) payload.image = resolveRef(ref, root)
          }
          // 多参考图（角色三视图 / 场景图 / 道具图）：Seedream 4.5 的 image 字段收数组，上限 10 张。
          const multiRefs: string[] = Array.isArray(body.refImages) ? body.refImages.map(String) : []
          if (refSupported && multiRefs.length) {
            const single = payload.image ? [payload.image as string] : []
            const resolved = multiRefs
              .filter((r) => r && !r.startsWith('data:image/svg'))
              .map((r) => resolveRef(r, root))
            payload.image = [...single, ...resolved].slice(0, 10)
          }
          if (!refSupported) dropRefs.push(...[body.refImage, ...multiRefs].filter(Boolean).map(String))

          const t0 = Date.now()

          // n 张 = n 次独立请求（不是 sequential 组图：组图出的是一组连贯故事板，
          // 不是同一提示词的多个变体，做"候选选优"语义不对）
          const callArk = async (pl: Record<string, unknown>) => {
            const r = await fetch(imgEndpoint, {
              method: 'POST',
              headers: { Authorization: `Bearer ${imgKey}`, 'Content-Type': 'application/json' },
              body: JSON.stringify(pl),
            })
            const text = await r.text()
            if (!r.ok) {
              let msg = text.slice(0, 300)
              try {
                const j = JSON.parse(text)
                msg = `${j?.error?.code ?? ''} — ${j?.error?.message ?? msg}`
              } catch {
                /* 保持原文 */
              }
              const kind = /overdue|arrear|balance|insufficient|欠费/.test(text.toLowerCase())
                ? 'billing'
                : r.status === 401
                  ? 'auth'
                  : 'api'
              const err = new Error(msg) as Error & { kind?: string; status?: number }
              err.kind = kind
              err.status = r.status
              throw err
            }
            return JSON.parse(text)
          }

          const settled = await Promise.allSettled(
            Array.from({ length: n }, () => callArk(payload)),
          )
          const fulfilled = settled.filter(
            (s): s is PromiseFulfilledResult<any> => s.status === 'fulfilled',
          )

          if (fulfilled.length === 0) {
            const first = settled.find((s) => s.status === 'rejected') as
              | PromiseRejectedResult
              | undefined
            const e = first?.reason as (Error & { kind?: string; status?: number }) | undefined
            res.statusCode = e?.status || 500
            res.end(
              JSON.stringify({ ok: false, message: e?.message ?? '生成失败', kind: e?.kind ?? 'api' }),
            )
            return
          }

          const items: any[] = fulfilled
            .flatMap((s) => s.value?.data ?? [])
            .filter((it: any) => it?.url || it?.b64_json)
          if (items.length === 0) {
            res.statusCode = 502
            res.end(JSON.stringify({ ok: false, message: '接口未返回图片', kind: 'api' }))
            return
          }

          fs.mkdirSync(outDir, { recursive: true })
          const urls: string[] = []

          for (const item of items) {
            let ext = 'png'
            let bytes: Buffer
            if (item.url) {
              const ir = await fetch(item.url)
              if (!ir.ok) throw new Error(`下载生成的图片失败 HTTP ${ir.status}`)
              const ct = ir.headers.get('content-type') || ''
              ext =
                ct.includes('jpeg') || ct.includes('jpg') ? 'jpg' : ct.includes('webp') ? 'webp' : 'png'
              bytes = Buffer.from(await ir.arrayBuffer())
            } else {
              bytes = Buffer.from(item.b64_json, 'base64')
            }
            const name = `shot-${Date.now()}-${crypto.randomBytes(3).toString('hex')}.${ext}`
            fs.writeFileSync(path.join(outDir, name), bytes)
            urls.push(`/generated/${name}`)
          }

          res.end(
            JSON.stringify({
              ok: true,
              urls,
              url: urls[0],
              size,
              model,
              provider: imgProvider?.label || kind,
              ...(dropRefs.length ? { warning: '该渠道不支持参考图，已按纯文生图处理', droppedRefs: dropRefs.length } : {}),
              elapsed: Date.now() - t0,
            }),
          )
        } catch (e) {
          res.statusCode = 500
          res.end(JSON.stringify({ ok: false, message: (e as Error).message, kind: 'network' }))
        }
      })
    },
  }
}

export default defineConfig({
  plugins: [react(), seedreamProxy()],
  server: {
    port: 5273,
    host: '127.0.0.1',
    // ngrok / 反代 / 局域网访问时 Vite 默认按 Host 头拦请求（403 text/plain）。
    // 这里显式放开，否则公网只能通 /api/*，页面和模块全被挡。
    allowedHosts: true,
  },
})
