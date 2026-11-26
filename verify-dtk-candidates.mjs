/**
 * DTK 适配器候选展开与下载重试回归（不联网、不花额度、不起真实 HTTP 服务）。
 *
 * 背景（2026-11-26）：画布出片报「从 CDN 下载视频失败（已尝试 4 个地址）」。
 * 实测 DTK 对一条抖音视频返回 18 个 stream，每个 stream 还有 `urls` 数组带 3 个
 * 备用域名（v11-weba.douyinvod.com / v26-web.douyinvod.com / www.douyin.com）；
 * 旧代码只读 `url` 且只试前 4 条，等于丢掉了 2/3 的可用路径。
 *
 * 为什么 stub fetch 而不是起本地 http 服务：`assertPublicUrl` 会拒绝 127.0.0.1
 * （SSRF 防护，这是必须保留的行为）。把 fetch 换掉能在保留该校验的前提下，
 * 精确观察「试了哪些候选、按什么顺序、失败后如何继续」。
 *
 * 跑法：node verify-dtk-candidates.mjs
 */
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = path.dirname(fileURLToPath(import.meta.url))
let bad = 0
const check = (name, cond, extra = '') => {
  console.log(`${cond ? '✅' : '❌'} ${name}${extra ? ` | ${extra}` : ''}`)
  if (!cond) bad++
}

const MP4 = Buffer.alloc(64 * 1024, 7)
const CDN = 'https://v11-weba.douyinvod.com'

/** 每个 stream 节点：一个主地址 + 两个备用域名（照抖音真实形状） */
function node(i, base = CDN) {
  const primary = `${base}/v/${i}/primary.mp4`
  return {
    url: primary,
    urls: [primary, `https://v26-web.douyinvod.com/v/${i}/alt-a.mp4`, `https://www.douyin.com/aweme/v1/play/video_id=${i}`],
    width: 720,
    height: 1280,
    bitrate: 700000 - i * 1000,
    format: 'mp4',
  }
}
const parsePayload = () => ({
  success: true,
  data: {
    platform: 'douyin',
    desc: 'mock douyin video',
    media: {
      video: node(0),
      streams: Array.from({ length: 6 }, (_, i) => node(i)),
    },
  },
})

/** 记录每次 fetch 到 CDN 的 URL，并按 mode 决定成败 */
const state = { mode: 'ok', hits: [] }
const realFetch = globalThis.fetch
globalThis.fetch = async (input, init) => {
  const url = typeof input === 'string' ? input : input instanceof URL ? input.href : String(input?.url || input)
  // DTK 的 parse 请求走 mock 响应；其余视为 CDN 下载
  if (/\/api\/v1\/parse/.test(url)) {
    return new Response(JSON.stringify(parsePayload()), {
      status: 200,
      headers: { 'content-type': 'application/json' },
    })
  }
  state.hits.push(url)
  if (state.mode === 'reset') {
    // 模拟按域名 SNI 切断：undici 抛出的就是这种 cause.code
    const e = new TypeError('fetch failed')
    e.cause = Object.assign(new Error('Client network socket disconnected before secure TLS connection was established'), {
      code: 'ECONNRESET',
    })
    throw e
  }
  if (state.mode === 'expired' && !url.includes('good')) {
    return new Response('expired', { status: 403 })
  }
  if (state.mode === 'later-ok' && !url.includes('good')) {
    return new Response('expired', { status: 403 })
  }
  return new Response(MP4, { status: 200, headers: { 'content-type': 'video/mp4' } })
}

const { ingestSourceToDir } = await import(path.join(ROOT, 'server', 'ingest.mjs'))
const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'verify-dtk-cand-'))
const cfg = {
  ingest: {
    // baseUrl 用公网形状；fetch 已被 stub，不会真的连出去
    dtk: { enabled: true, baseUrl: 'https://dtk.example.com', apiKey: 'test-key' },
    ytdlp: { enabled: false, bin: '' },
  },
}
const DOUYIN = 'https://www.douyin.com/video/7602498028557093298'
const ctx = () => ({ sourceId: `s-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`, sourcesDir: path.join(TMP, 'src') })

try {
  // ---- 1. 正常：取第一条，且不重复试同一个地址 ----
  state.mode = 'ok'
  state.hits = []
  let got = await ingestSourceToDir({ url: DOUYIN }, ctx(), cfg)
  check('正常情况下载成功', Boolean(got.file) && fs.existsSync(got.file), got.adapter)
  check('落盘大小与内容一致', fs.statSync(got.file).size === MP4.length, String(fs.statSync(got.file).size))
  check('优先用第一条（最高码率主地址）', state.hits[0] === `${CDN}/v/0/primary.mp4`, state.hits[0] || '')
  check('成功后不再多试', state.hits.length === 1, String(state.hits.length))

  // ---- 2. 候选数量：urls[] 全部展开（6 stream × 3 = 18，去重后仍 18） ----
  state.mode = 'expired'
  state.hits = []
  let err = null
  try {
    await ingestSourceToDir({ url: DOUYIN }, ctx(), cfg)
  } catch (e) {
    err = e
  }
  check('全 403 时抛错', Boolean(err))
  check('尝试了全部 18 条候选而非 4 条', state.hits.length === 18, String(state.hits.length))
  check('覆盖三个域名', new Set(state.hits.map((u) => new URL(u).hostname)).size === 3, [...new Set(state.hits.map((u) => new URL(u).hostname))].join(','))
  check('同一地址不重复尝试', state.hits.length === new Set(state.hits).size)

  // ---- 3. 前几条死链、后面能下：要继续而不是放弃 ----
  state.mode = 'later-ok'
  state.hits = []
  // 让第 0、1 个节点的所有地址都是死链，第 2 个节点的备用地址里有一条 good
  const deadThenGood = async (input, init) => {
    const url = typeof input === 'string' ? input : String(input)
    if (/\/api\/v1\/parse/.test(url)) {
      return new Response(
        JSON.stringify({
          success: true,
          data: {
            platform: 'douyin',
            media: {
              video: { url: `${CDN}/dead-0.mp4`, urls: [`${CDN}/dead-0.mp4`] },
              streams: [
                { url: `${CDN}/dead-1.mp4`, urls: [`${CDN}/dead-1a.mp4`, `${CDN}/dead-1b.mp4`] },
                { url: `${CDN}/dead-2.mp4`, urls: [`${CDN}/dead-2a.mp4`, `${CDN}/good-2b.mp4`] },
              ],
            },
          },
        }),
        { status: 200, headers: { 'content-type': 'application/json' } },
      )
    }
    state.hits.push(url)
    if (url.includes('good')) return new Response(MP4, { status: 200 })
    return new Response('expired', { status: 403 })
  }
  globalThis.fetch = deadThenGood
  fs.rmSync(path.join(TMP, 'src'), { recursive: true, force: true })
  got = await ingestSourceToDir({ url: DOUYIN }, ctx(), cfg)
  check('跨节点继续尝试直到成功', Boolean(got.file), `试了 ${state.hits.length} 条`)
  check('命中的是 urls[] 里的备用地址', state.hits.at(-1)?.includes('good-2b'), state.hits.at(-1) || '')
  // dead-0(1) + dead-1(3) + dead-2 的前两条 = 6 条死链，第 7 条才是 good-2b
  check('前面的死链都被试过', state.hits.length === 7, String(state.hits.length))

  // ---- 4. 全被 TLS 切断：报错指明网络层拦截，不误导重解析 ----
  globalThis.fetch = async (input) => {
    const url = typeof input === 'string' ? input : String(input)
    if (/\/api\/v1\/parse/.test(url)) {
      return new Response(JSON.stringify(parsePayload()), { status: 200, headers: { 'content-type': 'application/json' } })
    }
    state.hits.push(url)
    const e = new TypeError('fetch failed')
    e.cause = Object.assign(new Error('Client network socket disconnected before secure TLS connection was established'), {
      code: 'ECONNRESET',
    })
    throw e
  }
  state.hits = []
  err = null
  try {
    await ingestSourceToDir({ url: DOUYIN }, ctx(), cfg)
  } catch (e) {
    err = e
  }
  const msg = String(err?.message || '')
  check('全失败时抛错', Boolean(msg), msg.slice(0, 60))
  check('报错指明按域名拦截', /网络层按域名拦截/.test(msg), msg.slice(0, 120))
  check('不误导为重解析', !/重新解析一次通常能拿到新的/.test(msg))
  check('列出条数与域名', /已尝试 \d+ 条候选/.test(msg) && /douyinvod\.com/.test(msg), msg.slice(0, 140))
} finally {
  globalThis.fetch = realFetch
  fs.rmSync(TMP, { recursive: true, force: true })
}

console.log(bad ? `\n❌ ${bad} 项失败` : '\n✅ 全部通过')
process.exit(bad ? 1 : 0)
