/**
 * 独立运行入口：一个普通 Node 进程同时托管前端静态产物与全部 /api/* 接口。
 *
 * 为什么不是 vite dev：
 * 生产环境跑 dev server 是不可接受的（模块热更新、按需编译、内存常驻）；
 * 桌面端也需要一个可以被 fork 的普通进程，而不是把 vite 塞进安装包。
 *
 * 接口实现来自 server/app.ts 的 esbuild 产物 server-build/app.mjs
 * （该模块 import 了 src/ 下的 TS，必须预打包才能被 node 直接加载）。
 *
 * 环境变量：
 * - SB_PORT   监听端口，默认 5273；设为 0 由系统分配
 * - SB_HOST   监听地址，默认 127.0.0.1（只回环）
 * - SB_MEDIA_ROOT / SB_PROJECTS_DIR  见 server/paths.mjs 与 server/data.mjs
 */
import fs from 'node:fs'
import http from 'node:http'
import path from 'node:path'
import { pathToFileURL } from 'node:url'
import { MEDIA_DIRS, ensureMediaDir, resolveStaticRoot } from './paths.mjs'

const ROOT = path.resolve(import.meta.dirname, '..')
const DIST_DIR = path.join(ROOT, 'dist')
const STATIC_ROOT = resolveStaticRoot(ROOT)
/** 随代码分发的只读资产目录（构建时 copyPublicDir 已关闭，需要单独兜底） */
const STATIC_PUBLIC_DIRS = ['presets']

const PORT_ENV = process.env.SB_PORT
const PORT = PORT_ENV === undefined || PORT_ENV.trim() === '' ? 5273 : Number(PORT_ENV)
const HOST = String(process.env.SB_HOST || '127.0.0.1').trim() || '127.0.0.1'

if (!Number.isInteger(PORT) || PORT < 0 || PORT > 65535) {
  console.error(`[server] SB_PORT 不合法：${PORT_ENV}`)
  process.exit(1)
}

const APP_ENTRY = path.join(ROOT, 'server-build', 'app.mjs')
if (!fs.existsSync(APP_ENTRY)) {
  console.error(`[server] 缺少 ${APP_ENTRY}，请先运行 npm run build:server`)
  process.exit(1)
}

const app = await import(pathToFileURL(APP_ENTRY).href)
const { createAppHandler, runServerShutdownTasks, runServerStartupTasks, serveFile } = app

/**
 * 静态资源的 Content-Type。
 * 不能复用 app.ts 的 mimeOf —— 那个函数是给媒体文件用的，未知扩展名一律返回
 * image/png（媒体语义里 png 是安全默认），拿它给 .js 用会让浏览器拒绝执行模块。
 */
const STATIC_MIME = {
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.html': 'text/html; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.map': 'application/json; charset=utf-8',
  '.txt': 'text/plain; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
  '.gif': 'image/gif',
  '.avif': 'image/avif',
  '.woff2': 'font/woff2',
  '.woff': 'font/woff',
  '.ttf': 'font/ttf',
  '.mp4': 'video/mp4',
  '.webm': 'video/webm',
  '.mp3': 'audio/mpeg',
  '.wav': 'audio/wav',
  '.vtt': 'text/vtt; charset=utf-8',
  '.glb': 'model/gltf-binary',
  '.gltf': 'model/gltf+json',
}

function staticMime(file) {
  return STATIC_MIME[path.extname(file).toLowerCase()] || 'application/octet-stream'
}

/** 判断 file 是否在 dir 内（挡掉 ../ 与绝对路径） */
function insideDir(dir, file) {
  const rel = path.relative(dir, file)
  return Boolean(rel) && !rel.startsWith('..') && !path.isAbsolute(rel)
}

function json404(res, message) {
  res.statusCode = 404
  res.setHeader('Content-Type', 'application/json; charset=utf-8')
  res.end(JSON.stringify({ ok: false, message }))
}

/** 静态层：dist 真实文件 > 只读资产兜底 > 入口 HTML（SPA 回退） */
function serveStatic(req, res) {
  const method = req.method || 'GET'
  const urlPath = (req.url || '').split('?')[0]

  if (method !== 'GET' && method !== 'HEAD') {
    res.statusCode = 405
    res.end()
    return
  }
  // 未实现的接口不能回退成 HTML，否则前端拿到 200 的页面当 JSON 解析
  if (urlPath.startsWith('/api/')) {
    json404(res, `接口不存在：${urlPath}`)
    return
  }

  let rel = ''
  try {
    rel = decodeURIComponent(urlPath).replace(/^\/+/, '')
  } catch {
    res.statusCode = 400
    res.end()
    return
  }

  if (rel) {
    const candidates = [{ base: DIST_DIR, file: path.join(DIST_DIR, rel) }]
    const top = rel.split('/')[0]
    if (STATIC_PUBLIC_DIRS.includes(top)) {
      candidates.push({ base: STATIC_ROOT, file: path.join(STATIC_ROOT, rel) })
    }
    for (const c of candidates) {
      if (!insideDir(c.base, c.file)) continue
      if (fs.existsSync(c.file) && fs.statSync(c.file).isFile()) {
        serveFile(res, req, c.file, staticMime(c.file))
        return
      }
    }
  }

  const indexFile = path.join(DIST_DIR, 'index.html')
  if (fs.existsSync(indexFile)) {
    serveFile(res, req, indexFile, 'text/html; charset=utf-8')
    return
  }
  res.statusCode = 404
  res.end('未找到前端产物：请先运行 npm run build')
}

runServerStartupTasks(ROOT)
// 媒体根可能挂在空卷上（桌面端首次启动、容器首次挂载），子目录必须先建好，
// 否则第一批写盘会因为父目录不存在直接失败。
for (const dir of MEDIA_DIRS) {
  try {
    ensureMediaDir(ROOT, dir)
  } catch (e) {
    console.error(`[server] 无法准备媒体目录 ${dir}：${e?.message || String(e)}`)
    process.exit(1)
  }
}
const handle = createAppHandler({ root: ROOT })

const server = http.createServer((req, res) => {
  // 接口未命中时（只有 /api/seedream 之外的最后一道 next）落到静态层
  const next = () => serveStatic(req, res)
  Promise.resolve(handle(req, res, next)).catch((e) => {
    if (res.writableEnded || res.destroyed) return
    res.statusCode = 500
    res.setHeader('Content-Type', 'application/json; charset=utf-8')
    res.end(JSON.stringify({ ok: false, message: e?.message || String(e) }))
  })
})

server.on('error', (err) => {
  if (err?.code === 'EADDRINUSE') {
    console.error(`[server] 端口 ${PORT} 已被占用（${HOST}），请换一个 SB_PORT 或先停掉占用进程`)
  } else {
    console.error(`[server] 启动失败：${err?.message || String(err)}`)
  }
  process.exit(1)
})

server.listen(PORT, HOST, () => {
  const addr = server.address()
  const actual = typeof addr === 'object' && addr ? addr.port : PORT
  // 单行握手：桌面外壳按这一行解析实际端口（SB_PORT=0 时端口由系统决定）
  console.log(`[server] listening http://${HOST}:${actual}`)
})

let closing = false
function shutdown(signal) {
  if (closing) return
  closing = true
  console.log(`[server] 收到 ${signal}，正在退出`)
  const timer = setTimeout(() => {
    console.error('[server] 退出超时，强制结束')
    process.exit(0)
  }, 5000)
  timer.unref()
  server.close(() => {
    try {
      runServerShutdownTasks()
    } catch {
      /* 清理失败不影响退出 */
    }
    clearTimeout(timer)
    process.exit(0)
  })
  // 长连接（视频 Range 下载）不主动断会拖住 close
  server.closeIdleConnections?.()
}

process.on('SIGTERM', () => shutdown('SIGTERM'))
process.on('SIGINT', () => shutdown('SIGINT'))
