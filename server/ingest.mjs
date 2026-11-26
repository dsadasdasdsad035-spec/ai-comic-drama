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
import { extractIngestUrl } from './ingest-url.mjs'

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

/**
 * DTK 服务地址的「容器内 / 宿主机」双栈兜底。
 *
 * 同一个 `.env` 要同时给两种形态用，但两边的回环写法不同：
 * - 容器里的应用访问宿主机的 DTK：`host.docker.internal:8000`
 * - 宿主机上的桌面端 / `npm run dev`：`127.0.0.1:8000`
 *
 * `host.docker.internal` 在宿主机上没有 DNS（实测 macOS 直接 ENOTFOUND），
 * 所以宿主机形态下报错文案会变成「连不上 DTK」这种看不出原因的话。
 * 这里在首次连接失败且主机名是 `host.docker.internal` 时替换成 `127.0.0.1` 重试一次；
 * 反过来（容器里写了 127.0.0.1）不做猜测 —— 容器里也确实连不上，需要用户改配置。
 *
 * @param {string} base 用户配置的 DTK 地址
 * @returns {string[]} 依次尝试的地址（去重、保持用户配置优先）
 */
export function dtkBaseCandidates(base) {
  const trimmed = String(base || '').trim().replace(/\/+$/, '')
  if (!trimmed) return []
  const out = [trimmed]
  try {
    const u = new URL(trimmed)
    if (u.hostname === 'host.docker.internal') {
      const alt = new URL(trimmed)
      alt.hostname = '127.0.0.1'
      const altStr = alt.toString().replace(/\/+$/, '')
      if (!out.includes(altStr)) out.push(altStr)
    }
  } catch {
    /* 地址不合法时交给调用方报格式错误 */
  }
  return out
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
      const chunks = []
      if (r.body) {
        const reader = r.body.getReader()
        for (;;) {
          const { done, value } = await reader.read()
          if (done) break
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

/**
 * DTK（Douyin_TikTok_Download_API）适配器。
 *
 * 真实契约（源码 src/dtk/api/routes/content.py 与 models/content.py）：
 *   POST /api/v1/parse            → 202 {success, data:{task_id}, ...}
 *   GET  /api/v1/tasks/{task_id}  → {success, data:{state, data:{media:{video:{url}}}}}
 *   POST /api/v1/parse?wait=30    → 同步等待，直接返回结果
 *
 * 注意 downloads 端点把文件存在 DTK 自己的磁盘、不从 API 回传，
 * 所以这里只取 parse 结果里的 CDN 直链，由本机下载。
 */
const dtkAdapter = {
  id: 'dtk',
  label: 'DTK 下载服务',
  needsConfig: true,
  available(cfg = {}) {
    if (!cfg.enabled) return { ok: false, reason: '未启用：在设置页填写 DTK 服务地址与 API Key' }
    const base = String(cfg.baseUrl || '').trim()
    if (!base) return { ok: false, reason: '未填写 DTK 服务地址' }
    try {
      const u = new URL(base)
      if (u.protocol !== 'http:' && u.protocol !== 'https:') return { ok: false, reason: 'DTK 地址必须是 http/https' }
    } catch {
      return { ok: false, reason: `DTK 地址格式不正确：${base}` }
    }
    if (!String(cfg.apiKey || '').trim()) {
      return { ok: false, reason: '未填写 DTK API Key：首次启动后到控制台创建（MCP/REST 都要 Bearer）' }
    }
    return { ok: true }
  },
  async ingest(input, ctx, cfg = {}) {
    const configuredBase = String(cfg.baseUrl || '').replace(/\/+$/, '')
    const url = String(input.url || '')
    const headers = { 'Content-Type': 'application/json', Accept: 'application/json' }
    if (cfg.apiKey) {
      // DTK 的 REST 契约是 X-API-Key；早期版本还认 Authorization: Bearer，
      // 两个都带上，换版本时不必再改这里。
      headers['X-API-Key'] = String(cfg.apiKey)
      headers.Authorization = `Bearer ${cfg.apiKey}`
    }

    // 首次连接时确定用哪个地址：容器内写 host.docker.internal、宿主机写 127.0.0.1。
    // 网络层失败（连不上）才换下一个候选；HTTP 错误与信封错误是服务本身的答复，
    // 换地址重试只会把真实原因掩盖成「全都连不上」。
    const bases = dtkBaseCandidates(configuredBase)
    let base = ''
    const baseErrors = []

    /** 解析统一信封：{success, data, error, meta}；错误码稳定、文案可本地化 */
    const readBody = async (pathname, r) => {
      const text = await r.text()
      let body
      try {
        body = JSON.parse(text)
      } catch {
        throw new Error(`DTK ${pathname} 返回的不是 JSON（HTTP ${r.status}）`)
      }
      if (body?.success === false) {
        const code = body?.error?.code || ''
        const msg = body?.error?.message || ''
        throw new Error(`DTK 解析失败${code ? `（${code}）` : ''}：${msg || `HTTP ${r.status}`}`)
      }
      if (!r.ok) throw new Error(`DTK ${pathname} 返回 HTTP ${r.status}：${text.slice(0, 200)}`)
      return body
    }

    const readEnvelope = async (pathname, init) => {
      for (const candidate of base ? [base] : bases) {
        let r
        try {
          r = await fetch(`${candidate}${pathname}`, {
            ...init,
            headers,
            signal: AbortSignal.timeout(DOWNLOAD_TIMEOUT_MS),
          })
        } catch (e) {
          baseErrors.push(`${candidate} → ${e?.cause?.code || e?.message || String(e)}`)
          continue
        }
        base = candidate
        return readBody(pathname, r)
      }
      throw new Error(
        `连不上 DTK：${baseErrors.join('；') || '未配置服务地址'}。` +
          '容器部署写 host.docker.internal，本机桌面端 / npm run dev 写 127.0.0.1。',
      )
    }

    // 用 ?wait= 让服务端帮我们等，避免自己轮询；
    // 没等到会返回 202 + task_id，再轮询任务端点。
    let parsed = await readEnvelope('/api/v1/parse?wait=25', {
      method: 'POST',
      body: JSON.stringify({ url }),
    })
    let data = parsed?.data
    if (data && !data.media && (data.state === 'queued' || data.state === 'running' || data.task_id)) {
      const taskId = String(data.task_id || '')
      if (!taskId) throw new Error('DTK 返回了任务但没有 task_id')
      const deadline = Date.now() + DOWNLOAD_TIMEOUT_MS
      for (;;) {
        if (Date.now() > deadline) throw new Error('等待 DTK 解析超时')
        await new Promise((res) => setTimeout(res, 1500))
        const task = await readEnvelope(`/api/v1/tasks/${encodeURIComponent(taskId)}`, { method: 'GET' })
        const t = task?.data || {}
        if (t.state === 'done') {
          data = t.data
          break
        }
        if (t.state === 'failed') {
          throw new Error(`DTK 解析失败：${t?.error?.message || t?.error?.code || '未知原因'}`)
        }
      }
    }
    if (!data) throw new Error('DTK 没有返回解析结果')

    // 归一化后视频在 data.media.video.url；不同版本可能落在 streams/顶层字段。
    //
    // 每个 video / stream 节点还有 `urls` 数组：同一个清晰度的**多个 CDN 备用地址**
    // （抖音实测一条 stream 给 3 条：v11-weba.douyinvod.com / v26-web.douyinvod.com /
    // www.douyin.com）。只取 `url` 会丢掉 2/3 的可用路径——而抖音这类 CDN 会按域名
    // 做 SNI 阻断，多一个域名就多一次绕过机会，所以备用地址必须一起收。
    const media = data?.media || {}
    /** 把 {url, urls[]} 形状的节点摊平成候选；`url` 排在自己那组的最前面 */
    const expandNode = (node) => {
      if (!node || typeof node !== 'object') return []
      const out = []
      if (typeof node.url === 'string') out.push(node.url)
      if (Array.isArray(node.urls)) {
        for (const u of node.urls) if (typeof u === 'string') out.push(u)
      }
      return out
    }
    const rawCandidates = [
      ...expandNode(media?.video),
      ...(Array.isArray(media?.streams) ? media.streams.flatMap((s) => expandNode(s)) : []),
      ...expandNode(data?.video),
      typeof data?.video_url === 'string' ? data.video_url : '',
    ].filter((u) => typeof u === 'string' && /^https?:\/\//i.test(u))

    // 去重但保序：同一个 URL 常在 video 与 streams[0] 里各出现一次
    const candidates = [...new Set(rawCandidates)]
    let videoUrl = candidates[0] || ''
    if (!videoUrl) throw new Error('DTK 未返回可下载的视频地址（可能是图集或解析不到视频流）')

    // CDN 直链不走 SSRF 白名单校验的业务语义：它是 DTK 解析出的外部地址，
    // 但仍是外部 URL，所以仍要挡内网，避免被诱导访问本机服务。
    //
    // 抖音 CDN 会校验 Referer/UA：直接 fetch 常返回 403，而浏览器里能播。
    // 这里按平台带最小必要头，并对多个候选直链依次重试——
    // 签名 URL 有时效，primary 过期时备用地址往往还有效。
    const platform = String(data?.platform || '').toLowerCase()
    const referer = platform.includes('douyin') || platform.includes('tiktok')
      ? 'https://www.douyin.com/'
      : platform.includes('bilibili')
        ? 'https://www.bilibili.com/'
        : ''
    const ua =
      'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 ' +
      '(KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36'
    const cdnHeaders = {
      'User-Agent': ua,
      Accept: '*/*',
      ...(referer ? { Referer: referer } : {}),
    }

    /**
     * 逐条尝试全部候选，而不是只试前 4 条。
     *
     * 抖音/B 站对 CDN 域名做按域名的 SNI 阻断（TCP 能连、TLS 握手中被 reset），
     * 同一视频的备用地址分布在不同域名（douyinvod.com / douyin.com / bilivideo
     * 镜像等），多一个域名就多一次机会。候选按 DTK 给出的顺序（清晰度从高到低）
     * 依次尝试，取第一条成功的：能下的往往是高码率那条。
     *
     * 失败原因按类型归类，便于判断是「网络层拦截」还是「链接过期」——
     * 前者重解析无用，后者重解析通常能好。
     */
    const failureKinds = { blocked: 0, expired: 0, other: 0 }
    const failedHosts = new Set()
    let bytes = null
    let usedUrl = ''
    let lastDetail = ''
    for (const candidate of candidates) {
      try {
        const u = await assertPublicUrl(candidate)
        const vr = await fetch(u, { headers: cdnHeaders, signal: AbortSignal.timeout(DOWNLOAD_TIMEOUT_MS), redirect: 'follow' })
        if (!vr.ok) {
          // 4xx 多为签名过期/鉴权失败；5xx 与网络错误另算
          if (vr.status >= 400 && vr.status < 500) failureKinds.expired++
          else failureKinds.other++
          lastDetail = `HTTP ${vr.status}`
          try {
            failedHosts.add(new URL(candidate).hostname)
          } catch {
            /* 非法 URL 已在 filter 阶段排除 */
          }
          continue
        }
        const buf = Buffer.from(await vr.arrayBuffer())
        if (!buf.length) {
          failureKinds.other++
          lastDetail = '响应为空'
          continue
        }
        bytes = buf
        usedUrl = candidate
        break
      } catch (e) {
        const msg = String(e?.cause?.code || e?.message || e || '')
        // TLS 被 reset / 连接被拒 = 网络层拦截；超时既不明确也不算干净
        if (/ECONNRESET|EPROTO|UNEXPECTED_EOF|SSL|TLS|socket hang up|ECONNREFUSED|ECONNABORTED/i.test(msg)) {
          failureKinds.blocked++
        } else if (/ETIMEDOUT|timeout|aborted/i.test(msg)) {
          failureKinds.other++
        } else {
          failureKinds.other++
        }
        lastDetail = msg.slice(0, 40)
        try {
          failedHosts.add(new URL(candidate).hostname)
        } catch {
          /* ignore */
        }
      }
    }
    if (!bytes) {
      const hosts = [...failedHosts]
      const hostList = hosts.length ? hosts.join(' / ') : '无'
      // 主要失败原因是 TLS/连接被切断时，重解析拿到的还是同一批域名，白等一轮
      const blockedMostly = failureKinds.blocked >= Math.max(1, candidates.length / 2)
      const hint = blockedMostly
        ? `已尝试 ${candidates.length} 条候选、${hosts.length} 个域名（${hostList}），多数是 TLS/连接被切断——` +
          '这是网络层按域名拦截该平台 CDN，重新解析不会变好。' +
          '换用其它网络（如手机热点）、或给解析服务配一个能访问该平台的代理后再试。'
        : `已尝试 ${candidates.length} 条候选、${hosts.length} 个域名（${hostList}），最后错误：${lastDetail}。` +
          '直链可能已过期，重新解析一次通常能拿到新的。'
      throw new Error(`从 CDN 下载视频失败：${hint}`)
    }
    videoUrl = usedUrl
    if (!bytes.length) throw new Error('DTK 返回的视频地址内容为空')
    const file = writeFileChunk(
      ctx.sourcesDir,
      `${ctx.sourceId}-${crypto.randomBytes(3).toString('hex')}${extFromUrl(videoUrl)}`,
      bytes,
    )
    const author = data?.author || {}
    return {
      file,
      bytes: bytes.length,
      meta: {
        platform: String(data?.platform || 'dtk'),
        platformId: String(data?.content_id || data?.id || ''),
        author: String(author?.nickname || author?.name || ''),
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

  let url = extractIngestUrl(String(input.url || '').trim())
  if (!url) throw new Error('缺少链接或文件内容')
  if (!/^https?:\/\//i.test(url)) {
    throw new Error('未识别到有效的 http/https 链接，请只粘贴分享链接或整段口令（会自动提取 URL）')
  }

  // 平台链接：优先交给已启用的解析器；一个都没有就明确说清楚，
  // 不要退回直链——分享页返回的是 HTML，用户只会看到「链接返回的不是视频」而不知道原因。
  //
  // 顺序按「平台适配性」排，不是按实现顺序：抖音对 yt-dlp 需要新鲜 cookies，
  // 实测即使带了 cookies 也常 403，而 DTK 配了 browser-rpc 就能稳定拿到。
  // 所以抖音优先 DTK；B 站反过来，yt-dlp 不需要任何凭据。
  const url_isDouyin = /(douyin\.com|iesdouyin\.com|tiktok\.com|vm\.tiktok\.com)/i.test(url)
  const isPlatform = /(douyin\.com|iesdouyin\.com|bilibili\.com|b23\.tv|tiktok\.com|vm\.tiktok\.com)/i.test(url)
  if (isPlatform) {
    const order = url_isDouyin ? ['dtk', 'ytdlp'] : ['ytdlp', 'dtk']
    for (const id of order) {
      const a = BY_ID.get(id)
      if (a.available(cfgFor(id, config)).ok) return a
    }
    const ytdlp = config.ingest?.ytdlp || {}
    const dtk = config.ingest?.dtk || {}
    const hints = []
    if (!dtk.enabled) hints.push('部署 DTK 并填写服务地址与 API Key（抖音推荐）')
    else hints.push('DTK 已启用但地址或 Key 不完整')
    if (!ytdlp.enabled) hints.push('或启用 yt-dlp 并填写可执行文件路径（B 站够用）')
    else if (!ytdlp.bin) hints.push('yt-dlp 已启用但没填可执行文件路径')
    else hints.push(`yt-dlp 路径不可用（${ytdlp.bin}）`)
    throw new Error(
      `这个平台链接需要解析器，当前没有可用的：${hints.join('；')}。` +
        '也可以把视频下载到本地后直接用「上传视频」。',
    )
  }
  return BY_ID.get('direct')
}

/**
 * 在指定目录执行摄取（创意会话 sources / 项目 assets 共用）。
 * ctx: { sourceId, sourcesDir, sessionId? }
 */
export async function ingestSourceToDir(input, ctx, config = {}) {
  return ingestSource(input, ctx, config)
}

/** 执行摄取；返回 { adapter, file, bytes, meta, warnings } */
export async function ingestSource(input, ctx, config = {}) {
  const normalized = { ...input }
  if (normalized.url) normalized.url = extractIngestUrl(String(normalized.url).trim())
  const adapter = pickAdapter(normalized, config)
  const cfg = cfgFor(adapter.id, config)
  const result = await adapter.ingest(normalized, ctx, cfg)
  const warnings = []
  if (!fs.existsSync(result.file)) throw new Error('摄取失败：目标文件不存在')
  if (!isVideoFile(result.file)) warnings.push('文件扩展名不是常见视频格式，仍尝试用 ffprobe 读取')
  return { adapter: adapter.id, adapterLabel: adapter.label, ...result, warnings }
}
