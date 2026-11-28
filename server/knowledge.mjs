/**
 * 知识库（AnythingLLM）伴生服务客户端。
 *
 * 设计约定见 `openspec/changes/knowledge-base-anythingllm/design.md`：
 * - 浏览器只认本应用的 `/api/knowledge/*`，凭据不出服务端；
 * - 上游位于本机时**不能**走系统代理，否则必然连不上；
 * - 所有上游契约收在这个文件里，上游改版只改这里。
 *
 * 这个模块分两层：
 * 1. 纯函数（地址候选、错误翻译、上传表单、应答归一化）—— 可单测，不碰网络；
 * 2. 客户端（`createKnowledgeClient`）—— 需要 fetch 与配置，由 app.ts 注入。
 */

import fs from 'node:fs'
import path from 'node:path'

// ---------------------------------------------------------------- 常量

/** 上游默认端口。AnythingLLM 的 docker 默认就是 3001。 */
export const DEFAULT_KB_BASE_URL = 'http://127.0.0.1:3001'

/** 单文件上传上限。全量 Buffer 驻留内存，所以上限写死并在读 Body 前按 Content-Length 预拒绝。 */
export const MAX_KB_UPLOAD_BYTES = 100 * 1024 * 1024

/*
 * 问答相关的常量（`KB_SESSION_PREFIX` / `DEFAULT_KB_CHAT_MODE`）已随自写问答面板
 * 一起删除：问答收敛到创意会话，上游不再有本应用的问答会话分区。
 * 上游里既有的按库问答历史不删、不迁移，只是不再从这里访问。
 */

/** 回环主机名：这些地址直连，绝不过代理。 */
const LOOPBACK_HOSTS = new Set(['127.0.0.1', 'localhost', '::1', '[::1]', '0.0.0.0'])

/** 上游 workspace slug 允许的字符。用于校验映射表读出来的值，不用于生成。 */
const SLUG_RE = /^[a-z0-9][a-z0-9-]{0,63}$/

// ---------------------------------------------------------------- 纯函数

/**
 * 地址候选：保持用户配置优先，`host.docker.internal` 首次失败时回退 `127.0.0.1`。
 *
 * 与 `server/ingest.mjs` 的 `dtkBaseCandidates` 同构，但这里是**独立实现**而不是复用：
 * DTK 的候选顺序与容错来自抖音下载服务的历史坑，两边未来可能分叉（例如知识库还
 * 要支持局域网内另一台机器上的实例）。复制 8 行比让两个服务的耦合更难改。
 *
 * 反向（容器里写了 `127.0.0.1`）不做猜测：容器里确实连不上，应该由用户改配置。
 *
 * @param {string} base 用户配置的地址
 * @returns {string[]} 依次尝试的地址（去重、保持顺序）
 */
export function kbBaseCandidates(base) {
  const raw = String(base || '').trim()
  if (!raw) return []
  let parsed
  try {
    parsed = new URL(raw)
  } catch {
    return []
  }
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') return []
  const trimmed = raw.replace(/\/+$/, '')
  const out = [trimmed]
  if (parsed.hostname === 'host.docker.internal') {
    const alt = new URL(trimmed)
    alt.hostname = '127.0.0.1'
    const altStr = alt.toString().replace(/\/+$/, '')
    if (!out.includes(altStr)) out.push(altStr)
  }
  return out
}

/** 该地址是否必须直连（本机服务走系统代理一定失败）。 */
export function isLoopbackBase(base) {
  try {
    return LOOPBACK_HOSTS.has(new URL(String(base || '')).hostname)
  } catch {
    return false
  }
}

/** 地址合法性检查：返回错误文案或空串。设置页保存前用。 */
export function validateKbBaseUrl(base) {
  const raw = String(base || '').trim()
  if (!raw) return '请填写知识库服务地址'
  let u
  try {
    u = new URL(raw)
  } catch {
    return `地址格式不正确：${raw}`
  }
  if (u.protocol !== 'http:' && u.protocol !== 'https:') return '地址必须是 http 或 https'
  if (!u.hostname) return '地址缺少主机名'
  return ''
}

/** 映射表里读出的 slug 是否可用。空串与非法字符都要重建，不能拿去请求上游。 */
export function isUsableSlug(slug) {
  return SLUG_RE.test(String(slug || '').trim())
}

/**
 * 上游 `POST /v1/workspace/new` 未给出可用 slug 时的说明。
 * 内置实例在磁盘满时仍会 200，但 `workspace: null` 且 message 里是 Prisma/SQLite 错误。
 */
export function workspaceCreateFailureMessage(wanted, payload) {
  const wantedName = String(wanted || '').trim() || '未命名'
  const msg = String(payload?.message || '').trim()
  const lower = msg.toLowerCase()
  if (
    lower.includes('unable to open database') ||
    lower.includes('sqlitefailure') ||
    lower.includes('cannotopen') ||
    lower.includes('database or disk is full') ||
    lower.includes('disk i/o error')
  ) {
    return `无法创建知识库「${wantedName}」：知识库服务的本地数据库无法写入（常见于磁盘空间不足）。请释放系统磁盘空间后重启应用后重试`
  }
  if (msg) {
    const short = msg.length > 240 ? `${msg.slice(0, 240)}…` : msg
    return `无法创建知识库「${wantedName}」：${short}`
  }
  return `无法创建知识库「${wantedName}」：上游未返回可用标识`
}

/**
 * 上游错误的可读翻译。
 *
 * 顺序很重要：上游 403 会被我们自己的 fetch 包成普通 Error，所以既认 status
 * 也认文本；`collector` 的离线错误必须单独翻译，否则用户只看到「上传失败」。
 *
 * @param {unknown} err 抛出的错误（可能带 status / upstreamMessage）
 * @param {{ hasConfig?: boolean }} [opts]
 * @returns {string} 面向用户的说明
 */
export function translateKbError(err, opts = {}) {
  const e = /** @type {any} */ (err || {})
  if (opts.hasConfig === false) {
    return '知识库尚未配置：请到设置 → 连接与模型 → 知识库填写服务地址与 API Key'
  }
  const status = Number(e.status) || 0
  const raw = String(e.upstreamMessage || e.message || e).trim()
  const lower = raw.toLowerCase()

  if (status === 401 || status === 403) {
    return 'API Key 无效或已撤销：请在 AnythingLLM 设置 → API Keys 重新生成后填回来'
  }
  if (
    lower.includes('fetch failed') ||
    lower.includes('econnrefused') ||
    lower.includes('enotfound') ||
    lower.includes('etimedout') ||
    lower.includes('econnreset') ||
    lower.includes('socket hang up')
  ) {
    return '连不上知识库服务：请确认 AnythingLLM 已启动、地址与端口正确'
  }
  if (lower.includes('processing api is not online') || lower.includes('collector')) {
    return '文档解析服务未就绪：AnythingLLM 的 collector 未运行，请检查容器状态后重试'
  }
  if (lower.includes('no valid api key')) {
    return 'API Key 无效：请在 AnythingLLM 设置 → API Keys 重新生成后填回来'
  }
  if (lower.includes('no model') || lower.includes('no llm') || lower.includes('llm provider')) {
    return 'AnythingLLM 里还没有可用的对话模型：请先在它的设置中配置 LLM 与 embedder'
  }
  if (
    lower.includes('unable to open database') ||
    lower.includes('sqlitefailure') ||
    lower.includes('database or disk is full') ||
    lower.includes('disk i/o error')
  ) {
    return '知识库服务的本地数据库无法写入（常见于磁盘空间不足）：请释放磁盘空间后重启应用'
  }
  if (status === 404 || lower.includes('not found')) {
    /*
     * 404 有四个来源，不能都翻译成「上游库没了」：
     * - 本地前置校验（requireKnowledgeBase）判库不存在 → 文案带「知识库不存在」
     * - 会话选定的库被删 → 文案带「已被删除」，要求重选
     * - 作用域校验判文档不在本库 → 文案带「不在本次会话选定的知识库里」
     * - 上游文档不存在 → 文案带「文档」
     */
    if (
      lower.includes('知识库不存在') ||
      lower.includes('文档') ||
      lower.includes('已被删除')
    ) {
      return raw
    }
    return '上游知识库已不存在：可在知识库页删除这条记录后重新创建'
  }
  if (status === 400 && lower.includes('workspace')) {
    return '上游拒绝了知识库操作：请检查服务的 workspace 配置'
  }
  if (status >= 500) {
    return `知识库服务内部错误（${status}）：${raw || '请查看 AnythingLLM 日志'}`
  }
  return raw || '知识库操作失败'
}

/**
 * 拼上传表单。
 *
 * 上游要 multipart，本应用不引入 multipart 解析器：前端把原始字节送上来，
 * 服务端在这里包成 `FormData`。走 Buffer 而不是 base64，省一次 33% 膨胀与拷贝。
 *
 * @param {{ filename: string, bytes: Buffer|Uint8Array, mime?: string, workspaceSlug?: string }} input
 * @returns {{ form: FormData, filename: string }}
 */
export function buildUploadForm(input) {
  const filename = String(input.filename || '').trim()
  if (!filename) throw new Error('上传缺少文件名')
  const bytes = input.bytes
  const size = typeof bytes?.length === 'number' ? bytes.length : 0
  if (!size) throw new Error('上传文件内容为空')
  if (size > MAX_KB_UPLOAD_BYTES) {
    throw new Error(`文件超过上限 ${Math.round(MAX_KB_UPLOAD_BYTES / 1024 / 1024)}MB`)
  }
  const mime = String(input.mime || 'application/octet-stream').trim() || 'application/octet-stream'
  const form = new FormData()
  form.append('file', new Blob([bytes], { type: mime }), filename)
  const slug = String(input.workspaceSlug || '').trim()
  if (slug) form.append('addToWorkspaces', slug)
  return { form, filename }
}

/**
 * 直接读上游实例里的文档 JSON 拿正文。
 *
 * 为什么需要：`/v1/document/:docName` 只返回元数据，正文只在实例磁盘上的
 * `documents/<folder>/<name>.json` 的 `pageContent` 里。本应用与上游同机时可以直接读。
 *
 * 安全：`folder` 与 `name` 都来自我们自己拼的 docpath / 上游返回的文件名，
 * 但依然做一次路径穿越检查 —— 拼路径的代码一旦被别处复用，不该变成任意文件读取。
 *
 * @param {string} docpath 可能带目录前缀的标识
 * @param {string} filename 纯文件名（兜底用）
 * @param {string} [documentsRoot] 上游的 documents 根目录；未配置时直接返回空
 */
function readLocalDocText(docpath, filename, documentsRoot) {
  if (!documentsRoot) return ''
  try {
    const rel = String(docpath || '').replace(/\\/g, '/')
    const folder = rel.includes('/') ? rel.slice(0, rel.lastIndexOf('/')) : 'custom-documents'
    const file = rel.includes('/') ? rel.slice(rel.lastIndexOf('/') + 1) : String(filename || '')
    if (!file) return ''
    if (folder.includes('..') || file.includes('..')) return ''
    const base = path.resolve(documentsRoot)
    const target = path.resolve(base, folder, file)
    // 必须落在 documentsRoot 之内
    if (!target.startsWith(base + path.sep)) return ''
    if (!fs.existsSync(target)) return ''
    const parsed = JSON.parse(fs.readFileSync(target, 'utf8'))
    return String(parsed?.pageContent || parsed?.content || '').trim()
  } catch {
    /* 读不到就退回空串，让调用方自己决定怎么呈现 */
    return ''
  }
}

/**
 * 解析上游文档条目里的 `metadata`。
 *
 * 真实上游把它存成一个 JSON **字符串**（不是对象），形如：
 *   "{\"id\":\"...\",\"url\":\"file://...\",\"title\":\"世界观·朱雀卷.md\",...}"
 * 标题、作者、来源都在里面。解析失败一律返回空对象，让调用方退回别的字段 ——
 * 它不该因为元数据脏了就整条文档查不出来。
 */
export function parseDocMeta(raw) {
  if (!raw) return {}
  if (typeof raw === 'object') return /** @type {Record<string, unknown>} */ (raw)
  try {
    const obj = JSON.parse(String(raw))
    return obj && typeof obj === 'object' ? /** @type {Record<string, unknown>} */ (obj) : {}
  } catch {
    return {}
  }
}

/**
 * 把上游的 workspace 对象归一成前端要的形状。
 *
 * 上游 `GET /v1/workspaces` 的条目字段在各版本间有出入（documents 计数在
 * `documents.length`、`documentCount`、`_count.documents` 都出现过），这里一次收敛，
 * 前端只认 `docCount`。
 */
export function normalizeWorkspace(raw) {
  const w = /** @type {any} */ (raw || {})
  const docs = Array.isArray(w.documents) ? w.documents : []
  const count = Number(
    w.documentCount ?? w.documentsCount ?? w._count?.documents ?? docs.length ?? 0,
  )
  return {
    slug: String(w.slug || '').trim(),
    name: String(w.name || '').trim(),
    docCount: Number.isFinite(count) ? count : docs.length,
    documents: docs,
  }
}

/**
 * 归一上传应答里的文档条目。
 *
 * 上游返回 `{success, error, documents:[{id, url, title, wordCount, ...}]}`。
 * **实测差异**：真实实例的 upload 应答里**没有 `location`**，只有 `id` 与 `url`；
 * `location`（形如 `custom-documents/xxx.json`）只在 workspace 详情的 `docpath` 里出现。
 * 所以这里不能只认 location，否则上传成功的文档会被静默丢掉（mock 掩盖过这个缺陷）。
 *
 * 返回空 location 的条目仍保留 `docId`，调用方可用它回查 workspace 拿 docpath。
 */
export function normalizeUploadedDocs(raw, fallbackName = '') {
  const j = /** @type {any} */ (raw || {})
  const list = Array.isArray(j.documents) ? j.documents : []
  return list
    .map((d) => ({
      location: String(d?.location || d?.docpath || '').trim(),
      docId: String(d?.id || d?.docId || '').trim(),
      title: String(d?.title || parseDocMeta(d?.metadata)?.title || d?.name || d?.filename || fallbackName || '').trim(),
      wordCount: Number(d?.wordCount) || 0,
    }))
    .filter((d) => d.location || d.docId || d.title)
}

/**
 * 校验「移出/删除」的入参：必须是当前库内的文档标识。
 *
 * 为什么在本地挡：这些标识直接拼进上游请求体，空串或绝对路径写错会把
 * 删除作用到意外的文档上。只允许 `custom-documents/...json` 这类相对路径。
 */
export function assertDocLocations(list) {
  const out = []
  for (const item of Array.isArray(list) ? list : []) {
    const loc = String(item || '').trim().replace(/\\/g, '/')
    if (!loc) continue
    if (loc.startsWith('/') || loc.includes('..') || loc.includes('://')) {
      throw new Error(`文档标识不合法：${loc}`)
    }
    out.push(loc)
  }
  if (!out.length) throw new Error('没有指定要移除的文档')
  return out
}

/** 上游 SSE 的单个事件帧：`data: {...}`。非 JSON 帧返回 null 而不抛错（上游有心跳帧）。 */
export function baseSlugOf(base) {
  const slug = String(base?.upstreamSlug || '').trim()
  return isUsableSlug(slug) ? slug : ''
}

// ---------------------------------------------------------------- 客户端

/** 进程级 fetch 引用：测试时可以被替换，生产直接用 Node 原生实现。 */
let fetcher = (url, init) => globalThis.fetch(url, init)

/** 测试注入用：替换底层 fetch（只影响本模块，不影响其它模块） */
export function setKnowledgeFetcher(fn) {
  fetcher = fn || ((url, init) => globalThis.fetch(url, init))
}

/**
 * 创建一个绑定了配置来源的客户端。
 *
 * @param {{
 *   getSettings: () => { baseUrl: string, apiKey: string, enabled: boolean },
 *   getExternalFetch?: () => ((url: string, init?: any) => Promise<Response>) | null,
 *   timeoutMs?: number,
 *   log?: (line: string) => void,
 * }} deps
 */
export function createKnowledgeClient(deps) {
  const getSettings = deps.getSettings
  /** 可选：返回上游 documents 目录的绝对路径（用于读单文档正文） */
  const getDocumentsRoot = deps.getDocumentsRoot
  const log = deps.log || (() => {})
  const timeoutMs = Number(deps.timeoutMs) || 60_000

  /** 当前生效的配置；`enabled` 为 false 时所有方法都应先拦下。 */
  function config() {
    const s = getSettings() || {}
    return {
      baseUrl: String(s.baseUrl || '').trim().replace(/\/+$/, ''),
      apiKey: String(s.apiKey || '').trim(),
      enabled: Boolean(s.enabled) && Boolean(s.baseUrl),
      /*
       * 上游实例的 documents 根目录，只用于读单文档正文
       * （`/v1/document` 只回元数据，正文在磁盘上）。
       * 由调用方注入；拿不到就是空串，readDoc 会退回「只有元数据」。
       */
      documentsRoot: String((typeof getDocumentsRoot === 'function' ? getDocumentsRoot() : '') || '').trim(),
    }
  }

  function requireConfig() {
    const c = config()
    if (!c.enabled) {
      const err = new Error('知识库尚未配置：请到设置 → 连接与模型 → 知识库填写服务地址与 API Key')
      err.status = 0
      err.code = 'kb_not_configured'
      throw err
    }
    if (!c.apiKey) {
      const err = new Error('知识库缺少 API Key：请在 AnythingLLM 设置 → API Keys 生成后填入')
      err.status = 401
      err.code = 'kb_no_key'
      throw err
    }
    return c
  }

  /**
   * 按候选地址依次尝试；只有「连不上」才换下一个，业务错误直接抛。
   *
   * 路径前缀在这里统一加 `/api`：真实 AnythingLLM 的开发者接口在 `/api/v1/*`，
   * 直接打 `/v1/*` 会被它的前端 SPA 兜底成 HTML（实测：返回 200 + text/html），
   * 于是解析 JSON 失败而错误信息完全看不出根因。内部一律写 `/v1/...`，
   * 由这里补前缀，避免每个调用点记一遍。
   */
  async function request(pathname, init = {}) {
    const c = requireConfig()
    const candidates = kbBaseCandidates(c.baseUrl)
    if (!candidates.length) {
      const err = new Error(`知识库地址不正确：${c.baseUrl}`)
      err.code = 'kb_bad_base'
      throw err
    }
    const path = pathname.startsWith('/api/') ? pathname : `/api${pathname}`
    let lastErr = null
    for (const base of candidates) {
      const url = `${base}${path}`
      const headers = {
        Authorization: `Bearer ${c.apiKey}`,
        ...(init.headers || {}),
      }
      // 回环地址必须直连：系统代理会把它转给代理进程，必然失败。
      // 非回环才走统一的外部出网（可能带代理）。
      const fetchImpl = isLoopbackBase(base)
        ? fetcher
        : deps.getExternalFetch?.() || fetcher
      let res
      try {
        res = await fetchImpl(url, {
          ...init,
          headers,
          signal: init.signal || AbortSignal.timeout(timeoutMs),
        })
      } catch (e) {
        lastErr = e
        // 换下一个候选（host.docker.internal → 127.0.0.1）
        continue
      }
      if (!res.ok) {
        const text = await safeText(res)
        const err = new Error(`知识库请求失败（${res.status}）：${text || res.statusText}`)
        err.status = res.status
        err.upstreamMessage = text
        throw err
      }
      return res
    }
    const err = new Error(`连不上知识库服务：${lastErr?.message || '未知原因'}`)
    err.cause = lastErr
    throw err
  }

  async function json(pathname, init) {
    const res = await request(pathname, init)
    const text = await res.text()
    if (!text.trim()) return {}
    try {
      return JSON.parse(text)
    } catch {
      throw new Error(`知识库返回了非 JSON 内容：${text.slice(0, 200)}`)
    }
  }

  /** 连通性自检：`/v1/auth` 只验证 Key，不触发任何模型调用。 */
  async function test() {
    const c = requireConfig()
    const auth = await json('/v1/auth')
    const list = await json('/v1/workspaces')
    const workspaces = Array.isArray(list?.workspaces) ? list.workspaces : []
    return {
      ok: true,
      baseUrl: c.baseUrl,
      authenticated: auth?.authenticated !== false,
      workspaceCount: workspaces.length,
    }
  }

  /**
   * 把本应用的对话模型配置推给上游（AnythingLLM 的 `POST /v1/system/update-env`）。
   *
   * 为什么代配：上游自己必须有一个 LLM 才能回答，但用户已经在设置页为本应用配过
   * MiniMax 了 —— 再让他去上游界面手填一遍纯属重复劳动。这里把同一份 Key 推过去，
   * 「知识库能用」就变成连接测试的一部分。
   *
   * 三个约束：
   * - **键名是 camelCase**（`LLMProvider` / `GenericOpenAiBasePath`…），不是环境变量名；
   *   传下划线形式会被上游静默过滤，`error` 仍是 false —— 表现为「成功但什么都没写」。
   * - **幂等**：写相同值不报错，所以每次测试都推一遍是安全的。
   * - **失败不阻断**：连上了但配模型失败（例如旧版本没有这个接口），连接测试仍应算成功，
   *   只把原因回传让界面提示用户手工配。
   *
   * @param {{ basePath: string, model: string, apiKey: string, tokenLimit?: number }} input
   * @returns {Promise<{ ok: boolean, error?: string, written?: string[] }>}
   */
  async function applyLlmConfig(input) {
    const basePath = String(input?.basePath || '').trim()
    const model = String(input?.model || '').trim()
    const apiKey = String(input?.apiKey || '').trim()
    if (!basePath || !model || !apiKey) {
      return { ok: false, error: '缺少 basePath / model / apiKey，未写入上游' }
    }
    const payload = {
      LLMProvider: 'generic-openai',
      GenericOpenAiBasePath: basePath,
      GenericOpenAiModelPref: model,
      GenericOpenAiKey: apiKey,
      ...(Number(input?.tokenLimit) > 0
        ? { GenericOpenAiTokenLimit: String(Math.floor(Number(input.tokenLimit))) }
        : {}),
      /*
       * 输出上限必须显式抬高。上游 default 是 1024（见 genericOpenAi/index.js），
       * 而 MiniMax-M3.1-Flash **不允许关闭 thinking**（实测报 "requires adaptive
       * thinking"，M3/M2.7 可以但会输出 <think> 文本）。推理会先吃掉预算：
       * 实测一次复杂提问产生 4242 字符的未闭合 <think>，正文一个字没有，
       * 用户看到的是空白回答。给 8192 留出推理 + 正文的空间。
       */
      GenericOpenAiMaxTokens: '8192',
    }
    const j = await json('/v1/system/update-env', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    })
    if (j?.error) return { ok: false, error: String(j.error) }
    const written = Object.keys(j?.newValues || {})
    // 写了 0 个键 = 上游把所有键都过滤掉了（键名不对或版本不支持）
    if (!written.length) {
      return {
        ok: false,
        error: '上游没有接受任何配置项（版本可能不支持 update-env，或键名不匹配）',
      }
    }
    return { ok: true, written }
  }

  /**
   * 确保项目对应的库存在，返回 slug。
   *
   * 三条路径：
   * 1. 映射表已有合法 slug → 直接用（不探测，省一次请求；不存在时由调用方按 404 处理）；
   * 2. 没有映射 → 按项目名建库，回读上游返回的 slug 落表；
   * 3. 建库返回 400（同名已存在，常见于映射丢失）→ 按 name 在列表里找回。
   */
  /**
   * 在上游创建知识库，返回上游 slug。
   *
   * 与旧的 `ensureWorkspace(projectName)` 的区别：
   * - **不查本地映射**（本地 id ↔ slug 的对应由调用方用 db 访问器管）；
   * - **不由项目名派生**，只接受用户起的库名；
   * - 建库被拒（同名已存在）时按 name 找回，避免在用户库里堆出 `运镜手册-2`。
   *
   * 库名允许中文与空格：上游会归一成 slug，我们只回读结果，不猜。
   */
  async function createUpstreamWorkspace(name) {
    const wanted = String(name || '').trim()
    if (!wanted) throw new Error('缺少知识库名称')

    let created
    try {
      created = await json('/v1/workspace/new', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: wanted }),
      })
    } catch (e) {
      if (Number(e?.status) !== 400) throw e
      created = null
    }

    const slug = String(created?.workspace?.slug || '').trim()
    if (slug && isUsableSlug(slug)) return slug

    // 建库被拒（同名已存在）：按 name 找回，不重复建库
    const list = await json('/v1/workspaces')
    const found = (Array.isArray(list?.workspaces) ? list.workspaces : []).find(
      (w) => String(w?.name || '').trim() === wanted,
    )
    const foundSlug = String(found?.slug || '').trim()
    if (foundSlug && isUsableSlug(foundSlug)) return foundSlug
    throw new Error(workspaceCreateFailureMessage(wanted, created))
  }

  /** 单个库的详情（含文档清单）。上游这里返回的 workspace 是数组，已兼容。 */
  async function workspaceDetail(slug) {
    const j = await json(`/v1/workspace/${encodeURIComponent(slug)}`)
    const raw = j?.workspace
    const one = Array.isArray(raw) ? raw[0] : raw
    if (!one) {
      const err = new Error(`知识库「${slug}」在上游不存在`)
      err.status = 404
      throw err
    }
    const w = normalizeWorkspace(one)
    return {
      slug: w.slug || slug,
      name: w.name,
      docCount: w.docCount,
      documents: w.documents.map((d) => ({
        // 真实上游用 docpath；老版本/其它实现可能给 location
        location: String(d?.location || d?.docpath || '').trim(),
        docId: String(d?.docId || d?.id || '').trim(),
        /*
         * 标题的取值顺序：d.title → metadata.title → filename。
         *
         * 为什么必须读 metadata：真实上游的 workspace 详情里 `title` 是 null，
         * 真正的标题藏在 `metadata`（一个 JSON **字符串**）的 title 字段里。
         * 退回 `filename` 会显示成 `weknora_rag.md-902d283c-....json` —— 更糟的是
         * 上游对落盘名做了 slugify，中文文件名会被整个剥掉，只剩 `.md-<uuid>.json`。
         * 实测过：上传「世界观·朱雀卷.md」在清单里显示成 `.md-4082695e-....json`。
         */
        title: String(d?.title || parseDocMeta(d?.metadata)?.title || d?.filename || d?.name || '').trim(),
        wordCount: Number(d?.wordCount) || 0,
      })),
    }
  }

  /** 文档清单。库不存在时抛 404，由调用方决定重建。 */
  async function listDocs(slug) {
    return workspaceDetail(slug)
  }

  /**
   * 上传单个文件到当前库。返回归一后的文档条目。
   *
   * 实测差异：上游 upload 应答只给 `id`/`url`，**没有 `location`**；移出与删除
   * 需要的是 workspace 详情里的 `docpath`。所以应答里缺 location 时回查一次库详情，
   * 按 docId 或文件名把 docpath 补上 —— 否则前端拿到的是没法操作的空标识。
   */
  async function uploadDoc({ slug, filename, bytes, mime }) {
    const { form } = buildUploadForm({ filename, bytes, mime, workspaceSlug: slug })
    const j = await json('/v1/document/upload', { method: 'POST', body: form })
    if (j?.success === false) {
      const err = new Error(j?.error || '上游拒绝了这个文件')
      err.upstreamMessage = j?.error || ''
      throw err
    }
    const docs = normalizeUploadedDocs(j, filename)
    if (docs.every((d) => !d.location)) {
      try {
        const detail = await workspaceDetail(slug)
        const byId = new Map(detail.documents.map((d) => [String(d.docId || ''), d]))
        const byTitle = new Map(detail.documents.map((d) => [d.title, d]))
        for (const d of docs) {
          const hit = (d.docId && byId.get(d.docId)) || byTitle.get(d.title)
          if (hit?.location) d.location = hit.location
        }
      } catch {
        /* 回查失败不阻塞上传：界面仍能看到文件已入库，只是暂时不能移出 */
      }
    }
    return docs
  }

  /** 移出本库：只解绑，文档留在实例文档池。 */
  async function removeDocs(slug, locations) {
    const list = assertDocLocations(locations)
    await json(`/v1/workspace/${encodeURIComponent(slug)}/update-embeddings`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ adds: [], deletes: list }),
    })
    return { removed: list.length }
  }

  /** 从实例文档池彻底删除：会影响所有挂载同一文档的库。 */
  async function purgeDocs(locations) {
    const list = assertDocLocations(locations)
    await json('/v1/system/remove-documents', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ names: list }),
    })
    return { purged: list.length }
  }

  /** 非流式问答。给只需要最终文本的场景用（例如将来的摘要素材）。 */
  /** 向量检索：不经 LLM，Agent 工具用它。 */
  async function search(slug, query, opts = {}) {
    const q = String(query || '').trim()
    if (!q) throw new Error('检索关键词不能为空')
    const j = await json(`/v1/workspace/${encodeURIComponent(slug)}/vector-search`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        query: q,
        topN: Number(opts.topN) || 4,
        ...(opts.scoreThreshold !== undefined ? { scoreThreshold: Number(opts.scoreThreshold) } : {}),
      }),
    })
    const results = Array.isArray(j?.results) ? j.results : []
    return results.map((r) => ({
      /*
       * 必须剥 `<document_metadata>` 头：向量检索走的是这条路径（不是 normalizeSources），
       * 上游会把它塞进每段 text 开头。不剥的话模型和引用卡都会看到这堆内部标注。
       */
      text: stripChunkMetadata(r?.text),
      title: String(r?.metadata?.title || r?.metadata?.chunkSource || '').trim(),
      score: Number(r?.score) || 0,
      /*
       * `metadata.url` 是 `file://` 指向 collector 的 hotdir 暂存文件 —— 那是解析中间物，
       * 不是可复用的文档标识（read_knowledge_doc 拿它会 404）。
       * 真正能用的是 chunkSource（= 落盘文件名，形如 xxx.md-<uuid>.json）。
       */
      location: String(r?.metadata?.chunkSource || r?.metadata?.url || '').trim(),
    }))
  }

  /**
   * 按标题在实例文档清单里找落盘文件名。
   *
   * 为什么需要：向量检索返回的 metadata 里 `chunkSource` 为空、`url` 指向 collector
   * 暂存文件，两者都不是可复用标识（实测）。模型手里只有标题（`world.md`），
   * 而上游 `/v1/document/:name` 只认落盘名（`world.md-<uuid>.json`）。
   *
   * 找不到返回空串，由调用方报 404。
   */
  async function findByTitle(title) {
    const want = String(title || '').trim()
    if (!want) return ''
    try {
      const root = await json('/v1/documents')
      const files = []
      const walk = (node) => {
        if (!node || typeof node !== 'object') return
        if (node.type === 'file') files.push(node)
        for (const item of node.items || []) walk(item)
      }
      walk(root?.localFiles)
      // 先按上游填充的 title 精确匹配
      for (const f of files) {
        if (String(f.title || '').trim() === want) return String(f.name || '').trim()
      }
      // title 为空时按落盘名前缀匹配（落盘名形如 `<title>-<uuid>.json`）
      for (const f of files) {
        const n = String(f.name || '')
        if (n.startsWith(`${want}-`) && n.endsWith('.json')) return n
      }
    } catch {
      /* 清单读取失败就当没找到 */
    }
    return ''
  }

  /**
   * 读单个文档的正文。
   *
   * 入参 `docName` 可以是 workspace 详情里的 `docpath`（`custom-documents/xxx.json`）
   * 或纯文件名；上游只接受**纯文件名**（它把入参当 filename 拼到每个子目录去试，
   * 带斜杠会 404，实测）。
   *
   * 关键限制：`/v1/document/:docName` **只返回元数据，不含 pageContent**
   * （实测 keys 里没有正文）。正文存在实例的 `documents/<folder>/<name>.json` 里。
   * 本应用与上游同机（桌面内置或本机 docker），所以这里按 `documentsRoot` 直接读文件；
   * 远程部署时读不到就退回只给元数据，不让整个工具调用失败。
   */
  async function readDoc(docName) {
    const raw = String(docName || '').trim()
    if (!raw) throw new Error('缺少文档标识')
    const name = raw.includes('/') ? raw.slice(raw.lastIndexOf('/') + 1) : raw
    /*
     * `read_knowledge_doc` 的常见入参是「文档标题」（如 `world.md`），因为向量检索
     * 的 metadata 里 chunkSource 是空的、url 指向 collector 暂存文件，都不可复用。
     * 上游的 /v1/document/:name 只认落盘文件名（`xxx.md-<uuid>.json`），
     * 拿标题去查会 404。所以标题查不到时回退到「在库清单里按标题找文件名」。
     */
    let target = name
    let j = await json(`/v1/document/${encodeURIComponent(target)}`).catch((e) => {
      if (Number(e?.status) === 404) return null
      throw e
    })
    if (!j?.document && !j?.localFiles?.items?.length) {
      const found = await findByTitle(name)
      if (found) {
        target = found
        j = await json(`/v1/document/${encodeURIComponent(target)}`).catch(() => null)
      }
    }
    const doc = j?.document || j?.localFiles?.items?.[0] || null
    if (!doc) {
      const err = new Error(`文档「${raw}」在上游不存在`)
      err.status = 404
      throw err
    }
    /* 上游详情里的 title 常为 null，真标题在 metadata（JSON 字符串）里 */
    const meta = parseDocMeta(doc?.metadata)
    let text = String(doc?.pageContent || doc?.content || '').trim()
    if (!text) text = readLocalDocText(target, target, config().documentsRoot)
    return {
      title: String(doc?.title || meta?.title || doc?.name || name).trim(),
      text,
      wordCount: Number(doc?.wordCount) || 0,
    }
  }

  /** 上游可接受的文件类型。类型清单只认上游，本地不另存一份。 */
  async function acceptedTypes() {
    const j = await json('/v1/document/accepted-file-types')
    const types = j?.types && typeof j.types === 'object' ? j.types : {}
    const extensions = []
    for (const list of Object.values(types)) {
      if (!Array.isArray(list)) continue
      for (const ext of list) {
        const e = String(ext || '').trim()
        if (e.startsWith('.') && !extensions.includes(e)) extensions.push(e)
      }
    }
    return { types, extensions: extensions.sort() }
  }

  /** 删库。项目删除时用；上游 400（不存在）当成功处理。 */
  async function deleteWorkspace(slug) {
    const s = String(slug || '').trim()
    if (!s) return { deleted: false, reason: 'empty-slug' }
    try {
      await request(`/v1/workspace/${encodeURIComponent(s)}`, { method: 'DELETE' })
      return { deleted: true }
    } catch (e) {
      if (Number(e?.status) === 400 || Number(e?.status) === 404) {
        return { deleted: false, reason: 'not-found' }
      }
      throw e
    }
  }

  return {
    config,
    test,
    createUpstreamWorkspace,
    workspaceDetail,
    listDocs,
    uploadDoc,
    removeDocs,
    purgeDocs,
    search,
    readDoc,
    acceptedTypes,
    deleteWorkspace,
    applyLlmConfig,
  }
}

/**
 * 剥掉命中片段里的上游元数据头。
 *
 * AnythingLLM 的向量片段开头会带一段 `<document_metadata>sourceDocument: …</document_metadata>`，
 * 那是它给模型的上下文标注，对用户只有噪音（标题本来就单独显示了）。
 *
 * 为什么留在服务端而不是只在界面剥：这条路径同时喂模型（search_knowledge 的片段）
 * 与界面（引用/片段预览），两头都得干净。
 */
export function stripChunkMetadata(text) {
  return String(text || '')
    .replace(/<document_metadata>[\s\S]*?<\/document_metadata>/gi, '')
    .trim()
}

/** 读上游错误正文用于报错；失败不掩盖原始 HTTP 状态。 */
async function safeText(res) {
  try {
    const t = await res.text()
    return t.slice(0, 500)
  } catch {
    return ''
  }
}
