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
import { randomBytes } from 'node:crypto'
import { pathToFileURL } from 'node:url'
import { MEDIA_DIRS, ensureMediaDir, ensureStateDir, resolveStaticRoot } from './paths.mjs'
import { dbPath, listProjects, resolveRoot } from './db.mjs'
import { assertNodeVersion } from './runtime-version.mjs'
import { createCreativeHost } from './creative-host.mjs'
import { createOpenAIGateway } from './openai-gateway.mjs'
import { createStudioProxy, isStudioPath } from './studio-proxy.mjs'
import { createStudioStarter } from './studio-start.mjs'
import {
  STUDIO_KEY_ENV,
  STUDIO_INTERNAL_ENV,
  writeStudioProfile,
} from './studio-profile.mjs'
import { installCreativeToolsBundle } from './dsh-bundle.mjs'
import { ensureBlenderBridgeExtension } from './blender-bridge.mjs'
import { resolveBlenderBin } from './blender.mjs'
import { expertsPatchPath, readCompiledExperts, writeExpertsPatch } from './dsh-experts.mjs'
import { isStudioEnabled, setStudioEnabled, studioFlagPayload } from './studio-flag.mjs'
import { createStudioPrewarm } from './studio-prewarm.mjs'
import {
  StudioToolBridge,
  catalogVersion,
  INTERNAL_TOKEN_HEADER as STUDIO_INTERNAL_HEADER,
} from './studio-tool-bridge.mjs'
import {
  clearStudioCanvasContext,
  getStudioCanvasContext,
  setStudioCanvasContext,
} from './studio-canvas-context.mjs'
import { bumpStudioProjectRevision, readProjectRevision } from './studio-project-sync.mjs'

// 运行时基线：不达标直接退出，避免界面起来了但创意会话永远打不开
if (!assertNodeVersion()) process.exit(1)

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
const {
  authorizeStudioRequest,
  createAppHandler,
  listStudioModels,
  listStudioRoutes,
  onSettingsChanged,
  runServerShutdownTasks,
  runServerStartupTasks,
  serveFile,
  studioCreativeMaxTokens,
  studioDefaultModel,
} = app

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
void ensureBlenderBridgeExtension({
  appRoot: ROOT,
  bin: resolveBlenderBin(),
  log: (line) => console.log(line),
}).catch((e) => console.warn(`[blender-bridge] 后台安装异常：${e?.message || String(e)}`))
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

// ---------------------------------------------------------------- 创意会话宿主
// 开关默认开启；关闭时 `/studio/` 直接返回未启用，且完全不拉起宿主进程，
// 用于灰度回滚（旧创意链路在此期间仍可用）。
// 开关是运行时可改的：环境变量只作为默认值，见 studio-flag.mjs
const STUDIO_PUBLIC_URL = String(process.env.SB_PUBLIC_URL || '').trim()
/** 宿主需要信任「浏览器实际访问的那个 authority」，否则它的信任围栏会拒绝转发过来的请求 */
const STUDIO_TRUSTED_HOSTS = String(process.env.SB_STUDIO_TRUSTED_HOSTS || '')
  .split(',')
  .map((s) => s.trim())
  .filter(Boolean)

/** @type {ReturnType<typeof createCreativeHost> | null} */
let creativeHost = null
/** @type {ReturnType<typeof createStudioProxy> | null} */
let studioProxy = null
/** @type {ReturnType<typeof createOpenAIGateway> | null} */
let gateway = null
/** 最近一次通过鉴权的操作员会话：模型门面据此把账记到人头上（单操作员，后写覆盖） */
let studioSessionToken = ''
/**
 * 创意会话的当前项目：宿主是一个进程服务所有会话，拿不到浏览器里顶栏选了什么，
 * 所以由前端在进入创意视图与切项目时推上来，工具执行时作为默认上下文（后写覆盖）。
 * 与 `studioSessionToken` 同构的单槽位：多标签会互相覆盖，属当前单租户架构的已知限制。
 */
let studioProject = ''
/** 门面专用密钥：宿主用 apiKeyEnv 引用它，外部请求无法冒充。可用环境变量覆盖以便联调。 */
const STUDIO_GATEWAY_KEY = String(process.env.SB_STUDIO_GATEWAY_KEY || '').trim() || randomBytes(24).toString('base64url')
/** 工具桥内部令牌：宿主插件持有，浏览器拿不到（它不在任何页面里出现） */
const STUDIO_INTERNAL_TOKEN = String(process.env.SB_STUDIO_INTERNAL_TOKEN || '').trim() || randomBytes(24).toString('base64url')
/** @type {import('./studio-tool-bridge.mjs').StudioToolBridge | null} */
let toolBridge = null
/** 宿主最近一次注册工具的结果；宿主日志不进应用日志，这里留一份可查的 */
let studioToolStatus = { count: 0, names: [], at: '' }
/** 宿主的配置根：专家 preset 与镜像都写在这里，接口要按同一处读回 */
let studioDshHome = ''
/** @type {ReturnType<typeof createStudioPrewarm> | null} */
let studioPrewarm = null
/**
 * 读取请求体（工具桥的请求都很小，限个上限防止被塞爆内存）。
 * @param {import('node:http').IncomingMessage} req
 * @param {number} [limit]
 */
function readBody(req, limit = 2 * 1024 * 1024) {
  return new Promise((resolve, reject) => {
    const chunks = []
    let size = 0
    req.on('data', (chunk) => {
      size += chunk.length
      if (size > limit) {
        reject(new Error('请求体过大'))
        req.destroy()
        return
      }
      chunks.push(chunk)
    })
    req.on('end', () => {
      const text = Buffer.concat(chunks).toString('utf8').trim()
      if (!text) return resolve({})
      try {
        resolve(JSON.parse(text))
      } catch (e) {
        reject(new Error(`请求体不是合法 JSON：${e?.message || String(e)}`))
      }
    })
    req.on('error', reject)
  })
}

/**
 * 宿主与反代在拿到真实监听端口后再建：`SB_PORT=0` 时端口由系统分配，
 * 而宿主的 trusted-host 白名单和 public-url 都必须写真实端口，
 * 用配置里的 0 会让信任围栏认不出转发过来的请求。
 */
function setupStudio(actualPort) {
  if (!isStudioEnabled() || creativeHost) return
  const gatewayBaseUrl = `http://127.0.0.1:${actualPort}/v1`
  const dshHome = ensureStateDir(ROOT, 'dsh')
  studioDshHome = dshHome

  /**
   * 把当前模型表同步进宿主的 profile patch。
   * 宿主每次请求都会重读这份文档，所以设置页改完模型不用重启宿主；
   * 换行只发生在模型集合或默认模型真的变化时，避免每次保存都重写文件。
   */
  /**
   * 把当前模型表同步进宿主的 profile patch。
   * 宿主每次请求都会重读这份文档，所以设置页改完模型不用重启宿主；
   * 是否落盘由 `writeStudioProfile` 按内容比对决定 —— 没变化不写文件，
   * 也就不会触发宿主重载。
   */
  let toolsBundleInstalled = false
  const syncProfile = () => {
    const routes = listStudioRoutes()
    const models = routes.flatMap((route) => route.models)
    try {
      writeStudioProfile({
        dshHome,
        gatewayBaseUrl,
        routes,
        defaultModelId: studioDefaultModel(),
        log: (line) => console.log(line),
      })
      // 工具桥是 bundle 层（用户层 patch 不能新增插件行），装完才能在宿主里生效
      if (!toolsBundleInstalled) {
        installCreativeToolsBundle({ dshHome, root: ROOT, log: (line) => console.log(line) })
        toolsBundleInstalled = true
      }
    } catch (e) {
      console.error(`[studio] 写入宿主模型配置失败：${e?.message || String(e)}`)
    }
    return models
  }
  syncProfile()

  /**
   * 把专家同步成宿主 preset。
   *
   * 专家集合与技能白名单都可能被设置页改动，因此按内容签名判断是否需要重写；
   * preset 只在宿主启动时读取，所以内容变了且宿主在跑时要重启一次，
   * 否则列表里看得见新专家、会话里却选不到。
   *
   * 签名来自 `writeExpertsPatch` 的返回值（内容指纹），调用方不再自己拼：
   * 只有和「真正写进 patch 的内容」同源的签名才不会漏掉 soul 改动。
   */
  let expertSignature = ''
  const syncExperts = async ({ restartIfRunning = true } = {}) => {
    try {
      if (!toolBridge) return { compiled: [], signature: '' }
      // 工具名清单来自工具桥本身（同一份 ToolDef），不另抄一张表
      const registeredNames = (await toolBridge.catalog('', 1)).map((tool) => tool.name)
      const result = writeExpertsPatch({
        dshHome,
        root: ROOT,
        registeredNames,
        log: (line) => console.log(line),
      })
      const nextSignature = result.signature
      const previous = expertSignature
      expertSignature = nextSignature
      if (previous === nextSignature) return result
      // 首次同步时宿主还没起，不用重启
      if (restartIfRunning && previous && creativeHost?.status().state === 'ready') {
        console.log('[studio-experts] 专家内容已变化，重启宿主以加载新 preset')
        await creativeHost.stop()
        await creativeHost.start()
      }
      return result
    } catch (e) {
      console.error(`[studio] 生成专家 preset 失败：${e?.message || String(e)}`)
      return { compiled: [], signature: '' }
    }
  }

  creativeHost = createCreativeHost({
    root: ROOT,
    dshHome,
    // 专家 preset 走叠加层：profile 用户层加不了新行
    patches: [expertsPatchPath(dshHome)],
    // public-url 只影响宿主自己打印/上下文里的地址；前缀必须是 `/studio/`，
    // 它的 <base href="./"> 与相对资源都按这个前缀工作。
    publicUrl: STUDIO_PUBLIC_URL
      ? `${STUDIO_PUBLIC_URL.replace(/\/+$/, '')}/studio/`
      : `http://127.0.0.1:${actualPort}/studio/`,
    trustedHosts: [
      `127.0.0.1:${actualPort}`,
      `localhost:${actualPort}`,
      ...STUDIO_TRUSTED_HOSTS,
      ...(STUDIO_PUBLIC_URL ? [new URL(STUDIO_PUBLIC_URL).host] : []),
    ],
    // 凭证只经环境变量交给宿主，配置文件里只有引用名
    env: {
      [STUDIO_KEY_ENV]: STUDIO_GATEWAY_KEY,
      // 工具桥：宿主插件需要回调地址与内部令牌；令牌同样只走环境变量
      [STUDIO_INTERNAL_ENV]: STUDIO_INTERNAL_TOKEN,
      SB_STUDIO_BASE_URL: `http://127.0.0.1:${actualPort}`,
    },
  })
  toolBridge = new StudioToolBridge({
    root: ROOT,
    baseUrl: `http://127.0.0.1:${actualPort}`,
    internalToken: STUDIO_INTERNAL_TOKEN,
    onProjectWrite: (name) => bumpStudioProjectRevision(ROOT, name),
    log: (line) => console.log(line),
  })
  // 先算一遍专家 preset：首次进创意时宿主就要能读到它，不能等第一次会话
  void syncExperts({ restartIfRunning: false })

  /**
   * 拉起宿主前的统一准备 + 启动。
   *
   * 反代与空闲预热都走这一个函数（实现在 `studio-start.mjs`，便于用假宿主断言）：
   * 宿主可能隔了很久才被拉起，期间模型表与专家 preset 都可能被设置页改过，
   * 所以「未就绪」时要先对齐再启动。已就绪时则直接返回——`start()` 本来就会
   * 立刻返回，此时再同步只是给每个 `/studio/*` 请求加 20ms 级同步阻塞。
   */
  const startHostForRequest = createStudioStarter({
    host: creativeHost,
    prepareProfile: syncProfile,
    prepareExperts: syncExperts,
    log: (line) => console.log(line),
  })

  studioProxy = createStudioProxy({
    host: creativeHost,
    authorize: (req) => {
      const decision = authorizeStudioRequest(req)
      if (decision.ok && decision.sessionToken) studioSessionToken = decision.sessionToken
      return decision
    },
    // 只从「还没开始 / 已停止」拉起：崩溃或启动失败后不再自动重试，
    // 由错误页上的「重试」按钮显式触发，避免一个坏掉的宿主被反复拉起刷屏
    ensureStarted: startHostForRequest,
    log: (line) => console.log(line),
  })
  gateway = createOpenAIGateway({
    baseUrl: `http://127.0.0.1:${actualPort}`,
    // 模型表随时可能在设置页变化，按请求读取，不做缓存
    getModels: () => listStudioModels(),
    // 创意环节的输出上限同理：设置页改完，下一轮请求就带上新值
    getCreativeMaxTokens: () => studioCreativeMaxTokens(),
    getSessionToken: () => studioSessionToken,
    log: (line) => console.log(line),
  })
  // 设置页保存后立即同步，模型选择器不必等下一次宿主启动。
  // 原因决定要不要重启：技能集合变化只需重建专家技能根（技能正文靠宿主文件监听
  // 热生效），重启一次纯属浪费，还会打断进行中的会话。
  onSettingsChanged(({ reason }) => {
    syncProfile()
    void syncExperts({ restartIfRunning: reason !== 'skills' })
  })

  // 空闲预热：把「第一次点创意」的冷启动挪到应用启动的尾巴上。
  // 延迟是必要的——立即预热会和首屏的 bundle 与静态资源抢带宽。
  // 桌面端例外：Electron 恢复上次路由时可能直接落在创意视图，
  // 那时 2 秒的延迟只会在冷启动上再加 2 秒，所以桌面端立即预热。
  // 预热失败不重试，错误页的「重试」仍是唯一显式入口。
  studioPrewarm = createStudioPrewarm({
    isEnabled: () => isStudioEnabled(),
    status: () => creativeHost.status(),
    prepare: startHostForRequest,
    delayMs: process.env.SB_DESKTOP_PARENT_PID ? 0 : undefined,
    log: (line) => console.log(line),
  })
  if (String(process.env.SB_STUDIO_NO_PREWARM || '').trim() !== '1') studioPrewarm.schedule()
}

const server = http.createServer((req, res) => {
  // 模型门面：只允许本机回环 + 门面密钥。宿主是同机子进程，外部永远不该到这里。
  const reqPath = String(req.url || '').split('?')[0]
  if (reqPath === '/v1/models' || reqPath === '/v1/chat/completions') {
    const remote = String(req.socket.remoteAddress || '')
    const loopback = remote === '127.0.0.1' || remote === '::1' || remote === '::ffff:127.0.0.1'
    const auth = String(req.headers.authorization || '')
    const bearer = auth.startsWith('Bearer ') ? auth.slice(7).trim() : ''
    if (!loopback || !gateway || bearer !== STUDIO_GATEWAY_KEY) {
      res.statusCode = 401
      res.setHeader('Content-Type', 'application/json; charset=utf-8')
      res.end(
        JSON.stringify({
          error: {
            message: loopback ? '模型门面密钥无效' : '模型门面只允许本机访问',
            type: 'invalid_request_error',
            code: 'unauthorized',
          },
        }),
      )
      return
    }
    Promise.resolve(gateway.handle(req, res)).catch((e) => {
      if (res.writableEnded || res.destroyed) return
      res.statusCode = 500
      res.setHeader('Content-Type', 'application/json; charset=utf-8')
      res.end(JSON.stringify({ error: { message: e?.message || String(e), type: 'api_error' } }))
    })
    return
  }

  // 工具桥：只对宿主进程开放。回环 + 内部令牌双重校验，
  // 因为这里的执行会写项目库、花上游额度，不能接受浏览器直连。
  if (
    reqPath === '/api/studio/tools' ||
    reqPath === '/api/studio/tools/execute' ||
    reqPath === '/api/studio/tools/ready' ||
    reqPath === '/api/studio/experts'
  ) {
    const remote = String(req.socket.remoteAddress || '')
    const loopback = remote === '127.0.0.1' || remote === '::1' || remote === '::ffff:127.0.0.1'
    const token = String(req.headers[STUDIO_INTERNAL_HEADER] || '')
    res.setHeader('Content-Type', 'application/json; charset=utf-8')
    if (!loopback || token !== STUDIO_INTERNAL_TOKEN) {
      res.statusCode = 401
      res.end(JSON.stringify({ ok: false, message: loopback ? '内部令牌无效' : '工具桥只允许本机访问' }))
      return
    }
    if (req.method !== 'POST') {
      res.statusCode = 405
      res.end(JSON.stringify({ ok: false, message: '只支持 POST' }))
      return
    }
    readBody(req)
      .then(async (body) => {
        // 项目上下文：宿主不带 project 时用前端推送的当前项目，避免 32 个平台工具全部报「未选项目」
        const project = String(body.project || studioProject || '')
        const episode = Number(body.episode || 1)
        if (!toolBridge) {
          res.statusCode = 503
          res.end(JSON.stringify({ ok: false, message: '工具桥未就绪' }))
          return
        }
        if (reqPath === '/api/studio/tools') {
          // version 让宿主插件判断「声明是否变了」：schema 改动不必重启宿主
          const tools = await toolBridge.catalog(project, episode)
          res.end(JSON.stringify({ ok: true, version: catalogVersion(tools), tools }))
          return
        }
        if (reqPath === '/api/studio/experts') {
          // 专家清单与 preset 映射：会话列表据此把 preset id 显示成专家名
          res.end(
            JSON.stringify({
              ok: true,
              experts: readCompiledExperts(studioDshHome).map((row) => ({
                ...row,
                presetId: row.presetId || `expert-${row.id}`,
              })),
            }),
          )
          return
        }
        if (reqPath === '/api/studio/tools/ready') {
          // 宿主注册完工具后回报一次：加载失败才看得见，不用去翻宿主日志
          studioToolStatus = {
            count: Number(body.count || 0),
            names: Array.isArray(body.names) ? body.names.slice(0, 200) : [],
            at: new Date().toISOString(),
          }
          console.log(`[studio-tools] 宿主已注册 ${studioToolStatus.count} 个工具`)
          res.end(JSON.stringify({ ok: true }))
          return
        }
        const result = await toolBridge.invoke(String(body.name || ''), body.args || {}, {
          projectName: project,
          epNo: episode,
          sessionToken: studioSessionToken,
          expertId: String(body.expertId || ''),
        })
        // 业务失败也用 200 返回：宿主据此得到「可读失败」而不是传输错误
        res.end(JSON.stringify(result))
      })
      .catch((e) => {
        if (res.writableEnded) return
        res.statusCode = 400
        res.end(JSON.stringify({ ok: false, message: e?.message || String(e) }))
      })
    return
  }

  // 创意入口开关：前端据此隐藏/显示左栏入口，切回时无需重启应用
  if (reqPath === '/api/studio/enabled') {
    const decision = authorizeStudioRequest(req)
    res.setHeader('Content-Type', 'application/json; charset=utf-8')
    res.setHeader('Cache-Control', 'no-store')
    if (!decision.ok) {
      res.statusCode = decision.status || 401
      res.end(JSON.stringify({ ok: false, message: decision.message || '未通过认证' }))
      return
    }
    if (req.method === 'GET') {
      res.end(JSON.stringify(studioFlagPayload()))
      return
    }
    if (req.method === 'POST') {
      // 处理函数是同步的：读 body 走 readBody 的 Promise，不能直接 await
      readBody(req)
        .then(async (body) => {
          const enabled = setStudioEnabled(body?.enabled)
          // 关掉就立刻停宿主；打开不在请求里拉起，避免把「点开关」变成一次长启动
          if (!enabled) await creativeHost?.stop()
          res.end(JSON.stringify({ ok: true, enabled }))
        })
        .catch((e) => {
          res.statusCode = 400
          res.end(JSON.stringify({ ok: false, message: e?.message || String(e) }))
        })
      return
    }
    res.statusCode = 405
    res.end(JSON.stringify({ ok: false, message: '只支持 GET / POST' }))
    return
  }

  // 创意会话的当前项目：前端在进入创意视图与切项目时推送，宿主工具执行时当默认上下文。
  // 名字必须在项目库里存在：默认值会被 32 个工具直接用，放过非法名会让每次调用都失败。
  if (reqPath === '/api/studio/project') {
    const decision = authorizeStudioRequest(req)
    res.setHeader('Content-Type', 'application/json; charset=utf-8')
    res.setHeader('Cache-Control', 'no-store')
    if (!decision.ok) {
      res.statusCode = decision.status || 401
      res.end(JSON.stringify({ ok: false, message: decision.message || '未通过认证' }))
      return
    }
    if (req.method === 'GET') {
      res.end(JSON.stringify({ ok: true, name: studioProject }))
      return
    }
    if (req.method === 'POST') {
      readBody(req)
        .then((body) => {
          const name = String(body?.name ?? '').trim()
          if (!name) {
            // 空串是显式清除：前端离开项目（回大厅或卸载创意视图）时用
            studioProject = ''
            clearStudioCanvasContext()
            res.end(JSON.stringify({ ok: true, name: studioProject }))
            return
          }
          const known = listProjects(resolveRoot(ROOT)).some((row) => row.name === name)
          if (!known) {
            // 保留最后一个合法值：前端推送时序抖动不该让进行中的会话突然失效
            res.statusCode = 400
            res.end(
              JSON.stringify({ ok: false, message: `项目不存在：${name}`, name: studioProject }),
            )
            return
          }
          studioProject = name
          res.end(JSON.stringify({ ok: true, name: studioProject }))
        })
        .catch((e) => {
          res.statusCode = 400
          res.end(JSON.stringify({ ok: false, message: e?.message || String(e) }))
        })
      return
    }
    res.statusCode = 405
    res.end(JSON.stringify({ ok: false, message: '只支持 GET / POST' }))
    return
  }

  // 项目 revision 探针：壳轮询对齐创意宿主写库，不必拉全量 GET /api/project
  if (reqPath === '/api/studio/project-revision') {
    const decision = authorizeStudioRequest(req)
    res.setHeader('Content-Type', 'application/json; charset=utf-8')
    res.setHeader('Cache-Control', 'no-store')
    if (!decision.ok) {
      res.statusCode = decision.status || 401
      res.end(JSON.stringify({ ok: false, message: decision.message || '未通过认证' }))
      return
    }
    if (req.method !== 'GET') {
      res.statusCode = 405
      res.end(JSON.stringify({ ok: false, message: '只支持 GET' }))
      return
    }
    const url = new URL(req.url || '/', `http://${req.headers.host || 'localhost'}`)
    const name = String(url.searchParams.get('name') || studioProject || '').trim()
    if (!name) {
      res.end(JSON.stringify({ ok: true, name: '', revision: 0 }))
      return
    }
    const known = listProjects(resolveRoot(ROOT)).some((row) => row.name === name)
    if (!known) {
      res.statusCode = 404
      res.end(JSON.stringify({ ok: false, message: `项目不存在：${name}` }))
      return
    }
    res.end(
      JSON.stringify({ ok: true, name, revision: readProjectRevision(ROOT, name) }),
    )
    return
  }

  // 画布实况：供创意宿主读工具与出片拼装对齐当前节点与模型选择（浏览器推送）。
  if (reqPath === '/api/studio/canvas-context') {
    const decision = authorizeStudioRequest(req)
    res.setHeader('Content-Type', 'application/json; charset=utf-8')
    res.setHeader('Cache-Control', 'no-store')
    if (!decision.ok) {
      res.statusCode = decision.status || 401
      res.end(JSON.stringify({ ok: false, message: decision.message || '未通过认证' }))
      return
    }
    if (req.method === 'GET') {
      const ctx = getStudioCanvasContext()
      res.end(JSON.stringify({ ok: true, context: ctx }))
      return
    }
    if (req.method === 'POST') {
      readBody(req)
        .then((body) => {
          const result = setStudioCanvasContext(body, {
            listProjectNames: () => listProjects(resolveRoot(ROOT)).map((row) => row.name),
          })
          if (!result.ok) {
            res.statusCode = result.status || 400
            res.end(JSON.stringify({ ok: false, message: result.message, name: result.name }))
            return
          }
          res.end(JSON.stringify({ ok: true }))
        })
        .catch((e) => {
          res.statusCode = 400
          res.end(JSON.stringify({ ok: false, message: e?.message || String(e) }))
        })
      return
    }
    res.statusCode = 405
    res.end(JSON.stringify({ ok: false, message: '只支持 GET / POST' }))
    return
  }

  // 创意会话：`/studio/` 及其子路径整体交给宿主，不进入应用的接口分发
  if (isStudioPath(req.url)) {
    const studioPath = String(req.url || '').split('?')[0]

    // 宿主自身的运维入口（不走反代）：错误页上的「重试」与排障用的状态查询
    if (studioPath === '/studio/_host/restart') {
      if (req.method !== 'POST') {
        res.statusCode = 405
        res.end()
        return
      }
      const decision = authorizeStudioRequest(req)
      if (!decision.ok) {
        res.statusCode = decision.status || 401
        res.setHeader('Content-Type', 'application/json; charset=utf-8')
        res.end(JSON.stringify({ ok: false, message: decision.message || '未通过认证' }))
        return
      }
      Promise.resolve(creativeHost?.stop())
        .then(() => creativeHost?.start())
        .then((ok) => {
          res.setHeader('Content-Type', 'application/json; charset=utf-8')
          res.setHeader('Cache-Control', 'no-store')
          const status = creativeHost?.status()
          res.statusCode = ok ? 200 : 503
          res.end(JSON.stringify({ ok: Boolean(ok), message: ok ? '宿主已重启' : status?.error || '重启失败' }))
        })
        .catch((e) => {
          res.statusCode = 500
          res.setHeader('Content-Type', 'application/json; charset=utf-8')
          res.end(JSON.stringify({ ok: false, message: e?.message || String(e) }))
        })
      return
    }
    if (studioPath === '/studio/_host/status') {
      const decision = authorizeStudioRequest(req)
      res.statusCode = decision.ok ? 200 : decision.status || 401
      res.setHeader('Content-Type', 'application/json; charset=utf-8')
      res.setHeader('Cache-Control', 'no-store')
      res.end(
        JSON.stringify(
          decision.ok
            ? {
                ok: true,
                ...(creativeHost?.status() || { state: 'not-configured', installed: false }),
                tools: studioToolStatus,
              }
            : { ok: false, message: decision.message || '未通过认证' },
        ),
      )
      return
    }

    if (!isStudioEnabled() || !studioProxy) {
      res.statusCode = 503
      res.setHeader('Content-Type', 'application/json; charset=utf-8')
      res.end(
        JSON.stringify({
          ok: false,
          message: isStudioEnabled() ? '创意会话宿主尚未就绪' : '创意会话已停用（设置里的创意入口开关已关闭）',
        }),
      )
      return
    }
    Promise.resolve(studioProxy.handle(req, res)).catch((e) => {
      if (res.writableEnded || res.destroyed) return
      res.statusCode = 502
      res.setHeader('Content-Type', 'application/json; charset=utf-8')
      res.end(JSON.stringify({ ok: false, message: `创意会话转发失败：${e?.message || String(e)}` }))
    })
    return
  }
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

// 宿主的会话通道是 WebSocket：升级请求必须原样透传，否则页面能打开但连不上
server.on('upgrade', (req, socket, head) => {
  if (!isStudioEnabled() || !studioProxy) {
    socket.end('HTTP/1.1 503 Service Unavailable\r\n\r\n')
    return
  }
  if (!studioProxy.upgrade(req, socket, head)) socket.destroy()
})

server.listen(PORT, HOST, () => {
  const addr = server.address()
  const actual = typeof addr === 'object' && addr ? addr.port : PORT
  // 打开设置库：创意入口开关、专家迁移都要读设置；首个请求之前就要可用
  try {
    dbPath(resolveRoot(ROOT))
  } catch (e) {
    console.error(`[server] 设置库打开失败：${e?.message || String(e)}`)
  }
  setupStudio(actual)
  // 单行握手：桌面外壳按这一行解析实际端口（SB_PORT=0 时端口由系统决定）
  console.log(`[server] listening http://${HOST}:${actual}`)
})

let closing = false
function shutdown(signal) {
  if (closing) return
  closing = true
  console.log(`[server] 收到 ${signal}，正在退出`)
  // 宿主是子进程：不显式停会留下孤儿进程继续占着端口和内存
  studioPrewarm?.cancel()
  Promise.resolve(creativeHost?.stop()).catch(() => {})
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
