/**
 * 媒体摄取：本地上传 / 公网直链 / yt-dlp / DTK。
 *
 * 设计约束（见 design.md D5）：
 * - 默认只启用前两个，零外部服务；yt-dlp 与 DTK 必须显式配置才出现。
 * - 适配器失败不静默回退：已启用的适配器报错时直接返回错误，避免用户以为用的是 A 实际跑了 B。
 * - 直链下载必须做 SSRF 防护：只允许 http(s)，拒绝环回、私网与链路本地地址。
 */
import fs from 'node:fs'
import path from 'node:path'
import net from 'node:net'
import dns from 'node:dns/promises'
import crypto from 'node:crypto'
import { execFile } from 'node:child_process'

/** 单文件上限：创意会话是单人工作流，不需要更大的体量 */
export const MAX_SOURCE_BYTES = 200 * 1024 * 1024
/** 直链/下载超时 */
export const DOWNLOAD_TIMEOUT_MS = 180_000

const VIDEO_EXT = /\.(mp4|mov|webm|m4v|mkv)$/i

export function isVideoFile(name) {
  return VIDEO_EXT.test(String(name || ''))
}

/** 从 URL 猜扩展名；不认识的统一落 .mp4 */
function extFromUrl(url) {
  try {
    const p = new URL(url).pathname
    const m = p.match(/\.(mp4|mov|webm|m4v|mkv)$/i)
    return m ? `.${m[1].toLowerCase()}` : '.mp4'
  } catch {
    return '.mp4'
  }
}

function isPrivateAddress(ip) {
  const v = String(ip || '')
  if (!net.isIP(v)) return false
  if (net.isIPv4(v)) {
    const [a, b] = v.split('.').map(Number)
    if (a === 10) return true
    if (a === 127) return true
    if (a === 0) return true
    if (a === 169 && b === 254) return true
    if (a === 172 && b >= 16 && b <= 31) return true
    if (a === 192 && b === 168) return true
    if (a >= 224) return true
    return false
  }
  const lower = v.toLowerCase()
  if (lower === '::1' || lower === '::') return true
  if (lower.startsWith('fc') || lower.startsWith('fd')) return true
  if (lower.startsWith('fe80')) return true
  // IPv4 映射地址按内层判断
  const mapped = lower.match(/^::ffff:(\d+\.\d+\.\d+\.\d+)$/)
  if (mapped) return isPrivateAddress(mapped[1])
  return false
}

/** SSRF 防护：只放行公网 http(s)，解析后的地址也不能是内网 */
export async function assertPublicUrl(raw) {
  let u
  try {
    u = new URL(String(raw || ''))
  } catch {
    throw new Error('链接格式不正确')
  }
  if (u.protocol !== 'http:' && u.protocol !== 'https:') throw new Error('只支持 http / https 链接')
  const host = u.hostname
  if (!host) throw new Error('链接缺少主机名')
  if (host === 'localhost' || host.endsWith('.localhost')) throw new Error('不允许访问本机地址')
  if (net.isIP(host)) {
    if (isPrivateAddress(host)) throw new Error('不允许访问内网地址')
    return u
  }
  let records = []
  try {
    records = await dns.lookup(host, { all: true })
  } catch {
    throw new Error(`无法解析主机名：${host}`)
  }
  if (!records.length) throw new Error(`无法解析主机名：${host}`)
  for (const r of records) {
    if (isPrivateAddress(r.address)) throw new Error('链接指向内网地址，已拒绝')
  }
  return u
}

function writeFileChunk(dir, name, bytes) {
  fs.mkdirSync(dir, { recursive: true })
  const file = path.join(dir, name)
  fs.writeFileSync(file, bytes)
  return file
}

// ---------------------------------------------------------------- 适配器

/** 本地上传：前端把文件读成 base64；服务端写盘 */
const uploadAdapter = {
  id: 'upload',
  label: '本地上传',
  needsConfig: false,
  available: () => ({ ok: true }),
  async ingest(input, ctx) {
    const b64 = String(input.data || '')
    const m = b64.match(/^data:[^;]*;base64,(.+)$/) || [null, b64]
    const bytes = Buffer.from(m[1], 'base64')
    if (!bytes.length) throw new Error('上传内容为空')
    if (bytes.length > MAX_SOURCE_BYTES) {
      throw new Error(`视频超过 ${Math.round(MAX_SOURCE_BYTES / 1024 / 1024)}MB 上限`)
    }
    const name = String(input.name || 'upload.mp4')
    const ext = isVideoFile(name) ? path.extname(name).toLowerCase() : '.mp4'
    const file = writeFileChunk(
      ctx.sourcesDir,
      `${ctx.sourceId}-${crypto.randomBytes(3).toString('hex')}${ext}`,
      bytes,
    )
    return {
      file,
      bytes: bytes.length,
      meta: { platform: 'local', title: String(input.title || name), originalName: name },
    }
  },
}

/** 公网直链：流式下载到源目录 */
const directAdapter = {
  id: 'direct',
  label: '直链下载',
  needsConfig: false,
  available: () => ({ ok: true }),
  async ingest(input, ctx) {
    const url = String(input.url || '')
    const u = await assertPublicUrl(url)
    const ctrl = new AbortController()
    const timer = setTimeout(() => ctrl.abort(), DOWNLOAD_TIMEOUT_MS)
    try {
      const r = await fetch(u, { signal: ctrl.signal, redirect: 'follow' })
      if (!r.ok) throw new Error(`下载失败 HTTP ${r.status}`)
      const type = String(r.headers.get('content-type') || '')
      if (type && !/^(video\/|application\/octet-stream)/i.test(type)) {
        throw new Error(`链接返回的不是视频（${type.split(';')[0]}）`)
      }
      const len = Number(r.headers.get('content-length') || 0)
      if (len && len > MAX_SOURCE_BYTES) {
        throw new Error(`视频超过 ${Math.round(MAX_SOURCE_BYTES / 1024 / 1024)}MB 上限`)
      }
      const chunks = []
      let total = 0
      if (r.body) {
        const reader = r.body.getReader()
        for (;;) {
          const { done, value } = await reader.read()
          if (done) break
          total += value.length
          if (total > MAX_SOURCE_BYTES) {
            ctrl.abort()
            throw new Error(`视频超过 ${Math.round(MAX_SOURCE_BYTES / 1024 / 1024)}MB 上限`)
          }
          chunks.push(Buffer.from(value))
        }
      }
      const bytes = Buffer.concat(chunks)
      if (!bytes.length) throw new Error('下载内容为空')
      const file = writeFileChunk(
        ctx.sourcesDir,
        `${ctx.sourceId}-${crypto.randomBytes(3).toString('hex')}${extFromUrl(url)}`,
        bytes,
      )
      return {
        file,
        bytes: bytes.length,
        meta: { platform: 'direct', title: '', url },
      }
    } finally {
      clearTimeout(timer)
    }
  },
}

function execFileAsync(cmd, args, opts = {}) {
  return new Promise((resolve, reject) => {
    execFile(cmd, args, { timeout: opts.timeoutMs || DOWNLOAD_TIMEOUT_MS, maxBuffer: 8 * 1024 * 1024 }, (err, stdout, stderr) => {
      if (err) {
        const detail = String(stderr || err.message).trim()
        // 抖音/TikTok 的 403 是 cookies 问题，直接给出能照做的下一步
        const needsCookies = /cookies|403|Forbidden/i.test(detail) && /Douyin|TikTok|抖音/i.test(detail)
        const hint = needsCookies
          ? '（该平台需要浏览器 cookies：在设置页把「读取浏览器 cookies」设为 chrome 后重试，并确保浏览器里登录过该平台）'
          : ''
        reject(new Error(`${path.basename(cmd)} 失败${hint}：${detail.slice(0, 300)}`))
        return
      }
      resolve({ stdout: String(stdout || ''), stderr: String(stderr || '') })
    })
  })
}

/** yt-dlp：可选；可执行路径由设置提供，参数全部由服务端构造 */
const ytdlpAdapter = {
  id: 'ytdlp',
  label: 'yt-dlp',
  needsConfig: true,
  available(cfg = {}) {
    if (!cfg.enabled) return { ok: false, reason: '未启用：在设置页打开 yt-dlp 并填写可执行文件路径' }
    const bin = String(cfg.bin || '')
    if (!bin) return { ok: false, reason: '未填写 yt-dlp 可执行文件路径' }
    try {
      if (!fs.existsSync(bin) || !fs.statSync(bin).isFile()) {
        return { ok: false, reason: `yt-dlp 不存在：${bin}` }
      }
    } catch {
      return { ok: false, reason: `yt-dlp 不可读：${bin}` }
    }
    return { ok: true }
  },
  async ingest(input, ctx, cfg = {}) {
    const url = String(input.url || '')
    await assertPublicUrl(url)
    const dir = ctx.sourcesDir
    fs.mkdirSync(dir, { recursive: true })
    const args = [
      '--no-playlist',
      '--no-warnings',
      '--restrict-filenames',
      '--max-filesize', String(MAX_SOURCE_BYTES),
      '-f', 'mp4/bestvideo+bestaudio/best',
      '--merge-output-format', 'mp4',
      '-o', path.join(dir, `${ctx.sourceId}-%(id)s.%(ext)s`),
      '--print', 'after_move:filepath',
    ]
    // 抖音/TikTok 需要新鲜 cookies；只读浏览器 cookie，不上传、不落盘
    const browser = String(cfg.cookiesFromBrowser || '').trim()
    if (browser) args.push('--cookies-from-browser', browser)
    const cookieFile = String(cfg.cookiesFile || '').trim()
    if (!browser && cookieFile) args.push('--cookies', cookieFile)
    args.push(url)
    await execFileAsync(String(cfg.bin), args)
    const files = fs
      .readdirSync(dir)
      .filter((f) => f.startsWith(`${ctx.sourceId}-`) && isVideoFile(f))
      .map((f) => ({ f, mtime: fs.statSync(path.join(dir, f)).mtimeMs }))
      .sort((a, b) => b.mtime - a.mtime)
    if (!files.length) throw new Error('yt-dlp 没有产出视频文件')
    const file = path.join(dir, files[0].f)
    return {
      file,
      bytes: fs.statSync(file).size,
      meta: { platform: 'yt-dlp', url, title: '' },
    }
  },
}

/** DTK（Douyin_TikTok_Download_API）：只依赖 parse_url 与 download_media 两个稳定端点 */
const dtkAdapter = {
  id: 'dtk',
  label: 'DTK 下载服务',
  needsConfig: true,
  available(cfg = {}) {
    if (!cfg.enabled) return { ok: false, reason: '未启用：在设置页填写 DTK 服务地址' }
    const base = String(cfg.baseUrl || '').trim()
    if (!base) return { ok: false, reason: '未填写 DTK 服务地址' }
    try {
      const u = new URL(base)
      if (u.protocol !== 'http:' && u.protocol !== 'https:') return { ok: false, reason: 'DTK 地址必须是 http/https' }
    } catch {
      return { ok: false, reason: `DTK 地址格式不正确：${base}` }
    }
    return { ok: true }
  },
  async ingest(input, ctx, cfg = {}) {
    const base = String(cfg.baseUrl || '').replace(/\/+$/, '')
    const url = String(input.url || '')
    const headers = { 'Content-Type': 'application/json' }
    if (cfg.apiKey) headers.Authorization = `Bearer ${cfg.apiKey}`

    const call = async (pathname, body) => {
      const r = await fetch(`${base}${pathname}`, {
        method: 'POST',
        headers,
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(DOWNLOAD_TIMEOUT_MS),
      })
      const text = await r.text()
      if (!r.ok) throw new Error(`DTK ${pathname} 返回 HTTP ${r.status}：${text.slice(0, 200)}`)
      try {
        return JSON.parse(text)
      } catch {
        throw new Error(`DTK ${pathname} 返回的不是 JSON`)
      }
    }

    const parsed = await call('/api/v1/parse_url', { url })
    const data = parsed?.data || parsed
    const videoUrl =
      data?.video_url || data?.video?.play_addr?.url_list?.[0] || data?.aweme_detail?.video?.play_addr?.url_list?.[0] || ''
    if (!videoUrl) throw new Error('DTK 未返回可下载的视频地址')

    const dl = await call('/api/v1/download_media', { url: videoUrl, type: 'video' })
    const fileUrl = dl?.data?.url || dl?.url || videoUrl
    const u = await assertPublicUrl(fileUrl)
    const r = await fetch(u, { signal: AbortSignal.timeout(DOWNLOAD_TIMEOUT_MS) })
    if (!r.ok) throw new Error(`下载视频失败 HTTP ${r.status}`)
    const bytes = Buffer.from(await r.arrayBuffer())
    if (bytes.length > MAX_SOURCE_BYTES) {
      throw new Error(`视频超过 ${Math.round(MAX_SOURCE_BYTES / 1024 / 1024)}MB 上限`)
    }
    const file = writeFileChunk(
      ctx.sourcesDir,
      `${ctx.sourceId}-${crypto.randomBytes(3).toString('hex')}${extFromUrl(fileUrl)}`,
      bytes,
    )
    return {
      file,
      bytes: bytes.length,
      meta: {
        platform: String(data?.platform || 'dtk'),
        platformId: String(data?.aweme_id || data?.id || ''),
        author: String(data?.author?.nickname || ''),
        title: String(data?.desc || data?.title || ''),
        url,
      },
    }
  },
}

const ADAPTERS = [uploadAdapter, directAdapter, ytdlpAdapter, dtkAdapter]
const BY_ID = new Map(ADAPTERS.map((a) => [a.id, a]))

export function listAdapters(config = {}) {
  return ADAPTERS.map((a) => {
    const cfg = cfgFor(a.id, config)
    const availability = a.available(cfg)
    return {
      id: a.id,
      label: a.label,
      needsConfig: a.needsConfig,
      ok: availability.ok,
      reason: availability.reason || '',
    }
  })
}

function cfgFor(id, config = {}) {
  const ingest = config.ingest || {}
  if (id === 'ytdlp') return ingest.ytdlp || {}
  if (id === 'dtk') return ingest.dtk || {}
  return {}
}

/** 选适配器：显式指定优先；否则按 URL 形状推断（平台链接 → 已启用的解析器） */
export function pickAdapter(input, config = {}) {
  const explicit = String(input.adapter || '').trim()
  if (explicit) {
    const a = BY_ID.get(explicit)
    if (!a) throw new Error(`未知的摄取适配器：${explicit}`)
    const availability = a.available(cfgFor(a.id, config))
    if (!availability.ok) throw new Error(availability.reason || `适配器不可用：${a.id}`)
    return a
  }
  if (input.data) return BY_ID.get('upload')

  const url = String(input.url || '').trim()
  if (!url) throw new Error('缺少链接或文件内容')

  // 平台链接：优先交给已启用的解析器；一个都没有就明确说清楚，
  // 不要退回直链——分享页返回的是 HTML，用户只会看到「链接返回的不是视频」而不知道原因。
  const isPlatform = /(douyin\.com|iesdouyin\.com|bilibili\.com|b23\.tv|tiktok\.com|vm\.tiktok\.com)/i.test(url)
  if (isPlatform) {
    for (const id of ['ytdlp', 'dtk']) {
      const a = BY_ID.get(id)
      if (a.available(cfgFor(id, config)).ok) return a
    }
    const ytdlp = config.ingest?.ytdlp || {}
    const dtk = config.ingest?.dtk || {}
    const hints = []
    if (!ytdlp.enabled) hints.push('启用 yt-dlp 并填写可执行文件路径')
    else if (!ytdlp.bin) hints.push('yt-dlp 已启用但没填可执行文件路径')
    else hints.push(`yt-dlp 路径不可用（${ytdlp.bin}）`)
    if (!dtk.enabled) hints.push('或部署 DTK 并填写服务地址')
    throw new Error(
      `这个平台链接需要解析器，当前没有可用的：${hints.join('；')}。` +
        '也可以把视频下载到本地后直接用「上传视频」。',
    )
  }
  return BY_ID.get('direct')
}

/** 执行摄取；返回 { adapter, file, bytes, meta, warnings } */
export async function ingestSource(input, ctx, config = {}) {
  const adapter = pickAdapter(input, config)
  const cfg = cfgFor(adapter.id, config)
  const result = await adapter.ingest(input, ctx, cfg)
  const warnings = []
  if (!fs.existsSync(result.file)) throw new Error('摄取失败：目标文件不存在')
  if (!isVideoFile(result.file)) warnings.push('文件扩展名不是常见视频格式，仍尝试用 ffprobe 读取')
  return { adapter: adapter.id, adapterLabel: adapter.label, ...result, warnings }
}
