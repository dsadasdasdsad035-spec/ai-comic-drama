/**
 * 创意会话工具桥：把应用已有的 41 个平台/技能工具暴露给 dsh 宿主。
 *
 * 两条铁律：
 * 1. **声明只有一份**。JSON Schema 由 `ToolDef.schema`（zod）按 input 语义生成，
 *    执行前的校验也用同一份 schema；不存在第二份手写参数表。
 * 2. **实现不复制**。工具函数就是浏览器侧那一份，这里只补一个 fetch 垫片，
 *    把它们的相对路径 `/api/*` 指回本机，让 Node 也能跑同一段代码。
 *
 * 结果按「模型可见摘要 / 界面可见详情」拆开返回：摘要经 modelFacingResult 裁剪，
 * 详情原样给宿主界面。
 */
import path from 'node:path'
import { pathToFileURL } from 'node:url'
import { z } from 'zod'

/** 内部令牌请求头：宿主进程是唯一持有者，浏览器请求带不上它 */
export const INTERNAL_TOKEN_HEADER = 'x-studio-internal'

/**
 * 相对路径 fetch 垫片。
 * 只在工具运行时生效失败也无所谓 —— 应用自身的上游调用都用绝对地址，
 * 所以这个包装器只处理以 `/` 开头的字符串，其余原样转交。
 */
function installFetchShim(baseUrl, getContext) {
  if (globalThis.__sbStudioFetchShimmed) return
  globalThis.__sbStudioFetchShimmed = true
  const original = globalThis.fetch
  globalThis.fetch = (input, init) => {
    const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input?.url
    if (typeof url === 'string' && url.startsWith('/')) {
      const ctx = getContext()
      const headers = new Headers(init?.headers || (typeof input === 'object' && input?.headers) || {})
      if (ctx?.internalToken) headers.set(INTERNAL_TOKEN_HEADER, ctx.internalToken)
      // 工具里的 apiFetch 会显式带 credentials:'include'，这里换成真实会话 Cookie
      if (ctx?.sessionToken) headers.set('cookie', `sb_session=${encodeURIComponent(ctx.sessionToken)}`)
      const target = `${baseUrl}${url}`
      const nextInit = { ...(init || {}), headers }
      if (typeof input === 'object' && input && 'method' in input) {
        return original(target, {
          method: input.method,
          headers,
          body: input.body,
          signal: input.signal || nextInit.signal,
        })
      }
      return original(target, nextInit)
    }
    return original(input, init)
  }
}

export class StudioToolBridge {
  constructor({ root, baseUrl, internalToken, log = () => {} }) {
    this.root = root
    this.baseUrl = baseUrl.replace(/\/+$/, '')
    this.internalToken = internalToken
    this.log = log
    this.context = { internalToken, sessionToken: '' }
    this.module = null
    this.tools = new Map()
    this.loadedProject = ''
  }

  /** 当前调用上下文（会话令牌随每次调用更新，供垫片使用） */
  setSessionToken(token) {
    this.context.sessionToken = String(token || '')
  }

  /** 加载工具 bundle 并建好工具表；项目上下文变化时重建 */
  async ensureLoaded(projectName, epNo) {
    const bundle = path.join(this.root, 'server-build', 'studio-tools.mjs')
    if (!this.module) {
      installFetchShim(this.baseUrl, () => this.context)
      this.module = await import(pathToFileURL(bundle).href)
    }
    const key = `${projectName || ''}\u0000${epNo || 1}`
    if (key === this.loadedProject && this.tools.size) return this.tools

    const platform = this.module.createBuiltinPlatformTools({
      projectName: projectName || '',
      epNo: epNo || 1,
      onProjectDataChanged: () => {},
    })
    const pi = [...this.module.createPiNativeToolSet().byName.values()]
    const all = this.module.mergeBuiltinWithSkillTools(platform, pi)
    this.tools = new Map(all.map((tool) => [tool.name, tool]))
    this.loadedProject = key
    return this.tools
  }

  /** 生成模型可见的工具声明（JSON Schema 顶层强制 object，与 APIMart 的严格要求一致） */
  async catalog(projectName, epNo) {
    const tools = await this.ensureLoaded(projectName, epNo)
    return catalogFromTools([...tools.values()], this.log)
  }

  /**
   * 执行一个工具。
   * 参数先按同一份 zod schema 校验：缺必填字段时抛错且**不执行**工具体，
   * 错误文本里带字段名，模型据此补齐后重试。
   */
  async invoke(name, args, { projectName, epNo, sessionToken } = {}) {
    const tools = await this.ensureLoaded(projectName, epNo)
    const tool = tools.get(name)
    if (!tool) {
      return { ok: false, error: `没有名为「${name}」的工具` }
    }
    if (sessionToken) this.setSessionToken(sessionToken)
    let parsed
    try {
      parsed = tool.schema.parse(args ?? {})
    } catch (e) {
      // 附上结构化字段清单：宿主据此追问补齐，而不是让模型猜哪里漏了
      return {
        ok: false,
        kind: 'invalid-arguments',
        error: formatZodError(tool.name, e),
        fields: zodFieldIssues(e),
      }
    }
    try {
      const result = await tool.run(parsed)
      const failed = Boolean(result && typeof result === 'object' && result.ok === false)
      return {
        ok: !failed,
        ...(failed ? { error: String(result.error || result.message || '工具返回失败') } : {}),
        summary: this.module.modelFacingResult(name, result),
        details: result,
      }
    } catch (e) {
      return { ok: false, kind: 'tool-error', error: `${name} 执行失败：${e?.message || String(e)}` }
    }
  }
}

/**
 * ToolDef[] → 模型可见声明。
 *
 * 参数完全由 zod schema 推导（不查表、不手写）：源码里给某个工具加一个可选字段，
 * 这里生成的 JSON Schema 立刻多出该属性 —— 这就是「单一来源」的实现方式。
 * `io:'input'` 才与「省略则用默认值」一致；`io:'output'` 会把带默认值的字段算成必填。
 */
export function catalogFromTools(tools, log = () => {}) {
  return tools.map((tool) => {
    let parameters
    try {
      parameters = z.toJSONSchema(tool.schema, { io: 'input' })
    } catch (e) {
      log(`[studio-tools] ${tool.name} 的 schema 无法转成 JSON Schema：${e?.message || String(e)}`)
      parameters = { type: 'object', properties: {} }
    }
    const { $schema: _s, $id: _i, ...rest } = parameters || {}
    return {
      name: tool.name,
      description: tool.description,
      parameters: rest.type === 'object' ? rest : { type: 'object', properties: {}, ...rest },
    }
  })
}

/** zod 错误 → 指明字段的中文错误（模型据此补齐参数） */
export function formatZodError(name, error) {
  const issues = error?.issues
  if (!Array.isArray(issues) || !issues.length) {
    return `${name} 参数不合法：${error?.message || String(error)}`
  }
  const parts = issues.slice(0, 5).map((issue) => {
    const field = Array.isArray(issue.path) && issue.path.length ? issue.path.join('.') : '（整体）'
    return `${field}：${issue.message || '不合法'}`
  })
  return `${name} 参数不合法，请补齐后重试 —— ${parts.join('；')}`
}

/**
 * zod 错误 → 结构化字段清单。
 * 追问要能说清「补哪个字段、为什么」，只给一句拼好的错误文本做不到。
 */
export function zodFieldIssues(error) {
  const issues = error?.issues
  if (!Array.isArray(issues)) return []
  return issues.slice(0, 10).map((issue) => ({
    field: Array.isArray(issue.path) && issue.path.length ? issue.path.join('.') : '',
    message: issue.message || '不合法',
    ...(issue.code ? { code: String(issue.code) } : {}),
  }))
}
