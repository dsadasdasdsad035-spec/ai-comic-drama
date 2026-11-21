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
import fs from 'node:fs'
import path from 'node:path'
import { createHash } from 'node:crypto'
import { pathToFileURL } from 'node:url'
import { z } from 'zod'
import {
  resolveExpertSkillAllowlist,
  resolveExpertToolNames,
  SKILL_READ_TOOLS,
} from './dsh-experts.mjs'
import { HOST_NATIVE_TOOLS } from './studio-host-tools.mjs'
import { canvasContextForProject } from './studio-canvas-context.mjs'
import { isStudioShellSyncTool } from './dsh-plugins/creative-tools/shell-sync-tools.mjs'
import { expandStudioToolCatalog, resolveStudioToolName } from './studio-tool-aliases.mjs'

const SKILL_ID_READ_TOOLS = new Set(SKILL_READ_TOOLS.filter((n) => n !== 'list_installed_skills'))

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
  constructor({ root, baseUrl, internalToken, onProjectWrite, log = () => {} }) {
    this.root = root
    this.baseUrl = baseUrl.replace(/\/+$/, '')
    this.internalToken = internalToken
    /** 写库成功后登记 revision，供浏览器壳轮询 */
    this.onProjectWrite =
      typeof onProjectWrite === 'function' ? onProjectWrite : () => {}
    this.log = log
    this.context = { internalToken, sessionToken: '' }
    this.module = null
    this.tools = new Map()
    this.loadedProject = ''
    /** 已加载产物的时间戳：用来发现「产物被重建」 */
    this.bundleMtimeMs = null
    /**
     * 工具表代号：每次重建 `this.tools` 都 +1。
     * 声明缓存失效只看它——缓存依据是工具表本身，而不是时间或调用次数。
     */
    this.toolsGeneration = 0
    /** 声明缓存：{ generation, list } */
    this.catalogCache = { generation: -1, list: null }
    /** 真正跑过 schema 推导的轮数（测试断言缓存生效，排障也能一眼看到） */
    this.catalogBuilds = 0
    /** 当前 invoke 的专家技能白名单（供 stageTools 闭包读取） */
    this.invokeExpertAllowlist = null
    /** 读工具快照重置：跨 invoke 前清空，避免进程级工具表钉死旧项目 */
    this.resetReadSnapshot = null
  }

  canvasHooks(projectName) {
    const want = String(projectName || '').trim()
    if (!want) return {}
    return {
      getCanvasContext: () => {
        const ctx = canvasContextForProject(want)
        if (!ctx) return undefined
        return {
          nodes: ctx.nodes,
          characters: ctx.characters,
          missingMedia: new Set(ctx.missingMedia || []),
          projectRevision: Number(ctx.projectRevision) || 0,
          canvasRevision: Number(ctx.canvasRevision) || 0,
        }
      },
      getSelectedVideoModel: () => canvasContextForProject(want)?.videoModel ?? null,
      getVideoResolution: () => String(canvasContextForProject(want)?.resolution || ''),
    }
  }

  /** 当前调用上下文（会话令牌随每次调用更新，供垫片使用） */
  setSessionToken(token) {
    this.context.sessionToken = String(token || '')
  }

  /** 加载工具 bundle 并建好工具表；产物被重建或项目上下文变化时重建 */
  async ensureLoaded(projectName, epNo) {
    const bundle = path.join(this.root, 'server-build', 'studio-tools.mjs')
    let mtimeMs = null
    try {
      mtimeMs = fs.statSync(bundle).mtimeMs
    } catch {
      // 缺产物时不在这里报错：交给下面的 import 抛，错误信息更直接
      mtimeMs = null
    }
    // 只有「之前加载过」且时间戳真的变了才算重建；首次加载走普通路径
    const rebuilt = mtimeMs !== null && this.bundleMtimeMs !== null && mtimeMs !== this.bundleMtimeMs
    if (!this.module || rebuilt) {
      installFetchShim(this.baseUrl, () => this.context)
      // `?v=<mtime>` 让 ESM 的模块缓存失效：重建产物后不必重启应用就能拿到新实现。
      // 只在时间戳变化时换 URL，否则每次调用都会新增一份模块实例。
      const href = pathToFileURL(bundle).href
      this.module = await import(mtimeMs === null ? href : `${href}?v=${Math.round(mtimeMs)}`)
      this.bundleMtimeMs = mtimeMs
      // 旧工具表里的 run 闭包指向旧模块，必须整表重建
      this.tools = new Map()
      this.toolsGeneration += 1
      this.loadedProject = ''
      if (rebuilt) this.log('[studio-tools] 工具实现已更新，已重新加载模块')
    }
    const key = `${projectName || ''}\u0000${epNo || 1}`
    if (key === this.loadedProject && this.tools.size) return this.tools

    const notifyWrite = () => {
      const pn = String(projectName || '').trim()
      if (pn) this.onProjectWrite(pn)
    }
    const platform = this.module.createBuiltinPlatformTools({
      projectName: projectName || '',
      epNo: epNo || 1,
      onProjectDataChanged: notifyWrite,
      expertAllowlist: () => this.invokeExpertAllowlist,
      ...this.canvasHooks(projectName),
    })
    this.resetReadSnapshot =
      typeof platform.resetReadSnapshot === 'function' ? platform.resetReadSnapshot : null
    const pi = [
      ...this.module.createPiNativeToolSet({ expertAllowlist: () => this.invokeExpertAllowlist }).byName.values(),
    ]
    const all = this.module.mergeBuiltinWithSkillTools(platform, pi)
    this.tools = new Map(all.map((tool) => [tool.name, tool]))
    this.toolsGeneration += 1
    this.loadedProject = key
    return this.tools
  }

  /**
   * 生成模型可见的工具声明（JSON Schema 顶层强制 object，与 APIMart 的严格要求一致）。
   *
   * 声明只取决于工具表，而工具表只在「产物重建 / 项目上下文变化」时变化，
   * 所以按代号缓存：一次会话里模型清单会被反复请求（每次宿主刷新页面都会要），
   * 每次都把几十个 zod schema 转一遍 JSON Schema 纯属重复劳动。
   */
  async catalog(projectName, epNo) {
    const tools = await this.ensureLoaded(projectName, epNo)
    if (this.catalogCache.generation === this.toolsGeneration && this.catalogCache.list) {
      return this.catalogCache.list
    }
    const list = expandStudioToolCatalog(catalogFromTools([...tools.values()], this.log))
    this.catalogBuilds += 1
    this.catalogCache = { generation: this.toolsGeneration, list }
    return list
  }

  /**
   * 执行一个工具。
   * 参数先按同一份 zod schema 校验：缺必填字段时抛错且**不执行**工具体，
   * 错误文本里带字段名，模型据此补齐后重试。
   */
  async invoke(name, args, { projectName, epNo, sessionToken, expertId } = {}) {
    const tools = await this.ensureLoaded(projectName, epNo)
    if (typeof this.resetReadSnapshot === 'function') this.resetReadSnapshot()
    const resolvedName = resolveStudioToolName(name)
    const tool = tools.get(resolvedName)
    if (!tool) {
      return { ok: false, error: `没有名为「${name}」的工具` }
    }
    const expert = String(expertId || '').trim()
    this.invokeExpertAllowlist = expert ? resolveExpertSkillAllowlist(expert, this.root).ids : null
    if (expert) {
      const allowedTools = resolveExpertToolNames(expert, [...tools.keys()])
      if (
        allowedTools &&
        !allowedTools.has(resolvedName) &&
        !HOST_NATIVE_TOOLS.includes(resolvedName)
      ) {
        return {
          ok: false,
          error: `专家「${expert}」不允许使用工具「${name}」`,
        }
      }
      const skillAllow = resolveExpertSkillAllowlist(expert, this.root)
      if (SKILL_ID_READ_TOOLS.has(resolvedName)) {
        const sid = String((args && typeof args === 'object' && (args.id || args.skillId)) || '').trim()
        if (sid && !skillAllow.ids.includes(sid)) {
          return {
            ok: false,
            error: `专家「${expert}」的技能白名单不含「${sid}」，请改用白名单内的技能。`,
          }
        }
      }
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
      let result = await tool.run(parsed)
      if (
        expert &&
        resolvedName === 'list_installed_skills' &&
        result &&
        typeof result === 'object' &&
        result.ok !== false &&
        Array.isArray(result.skills)
      ) {
        const allow = new Set(resolveExpertSkillAllowlist(expert, this.root).ids)
        const before = result.skills.length
        const skills = result.skills.filter((row) => allow.has(String(row?.id || '')))
        const restrictedCount = before - skills.length
        result = {
          ...result,
          count: skills.length,
          skills,
          ...(restrictedCount > 0 ? { restrictedCount } : {}),
          summary: restrictedCount
            ? `共 ${skills.length} 个技能在本专家白名单内（另有 ${restrictedCount} 个已安装技能未列出）`
            : result.summary || `共 ${skills.length} 个技能`,
        }
      }
      const failed = Boolean(result && typeof result === 'object' && result.ok === false)
      if (!failed && isStudioShellSyncTool(resolvedName)) {
        const written =
          parsed && typeof parsed === 'object' && parsed.project !== undefined
            ? String(parsed.project || '').trim()
            : String(projectName || '').trim()
        if (written) this.onProjectWrite(written)
      }
      return {
        ok: !failed,
        ...(failed ? { error: String(result.error || result.message || '工具返回失败') } : {}),
        summary: this.module.modelFacingResult(resolvedName, result),
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

/**
 * 工具清单版本：对「会影响模型调用」的字段取稳定哈希。
 *
 * 排序后哈希是必要的：`catalogFromTools` 的顺序来自工具注册顺序，
 * 只要源码里调换了两个 `mergeBuiltinWithSkillTools` 的分支顺序，
 * 清单内容其实没变，不排序就会误判成变化并触发一次重注册。
 * 只取前 12 位：它只用于相等判断，不需要抗碰撞强度。
 */
export function catalogVersion(tools) {
  const rows = [...(tools || [])]
    .map((tool) => ({
      name: String(tool?.name || ''),
      description: String(tool?.description || ''),
      parameters: tool?.parameters ?? {},
    }))
    .sort((a, b) => a.name.localeCompare(b.name))
  return createHash('sha256').update(JSON.stringify(rows)).digest('hex').slice(0, 12)
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
