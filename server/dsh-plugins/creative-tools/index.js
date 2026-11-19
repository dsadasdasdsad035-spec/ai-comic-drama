/**
 * dsh 宿主插件：把应用的工具桥注册成模型可调用的工具。
 *
 * 这个插件本身不含任何业务逻辑：
 * - 工具声明在启动时从应用的 `/api/studio/tools` 拉取（唯一来源是 zod schema）；
 * - 每次调用转发到 `/api/studio/tools/execute`，由应用进程执行真正的工具函数；
 * - 破坏性与生成类工具在这里返回 `ask`，交给 dsh 的审批流程，
 *   用户拒绝时工具体根本不会运行，也就不会产生上游请求或预扣。
 *
 * 之所以把执行留在应用进程：工具要读写项目库、媒体目录与账本，
 * 这些都在应用侧；宿主只负责模型循环与会话。
 */

/** 与 server/studio-tool-bridge.mjs 的 INTERNAL_TOKEN_HEADER 保持一致 */
const INTERNAL_TOKEN_HEADER = 'x-studio-internal'

/** 需要用户确认才能执行的工具：写库类（破坏性） */
const DESTRUCTIVE_TOOLS = new Set([
  'create_project',
  'update_project_meta',
  'delete_shots',
  'submit_episodes',
  'submit_characters',
  'submit_designs',
  'submit_prompts',
  'submit_shots',
  'submit_assets',
  'submit_joins',
  'set_character_visual',
  'set_shot_camera_lexicon',
  'attach_transition_refs',
  'link_shot_refs',
  'set_transition_audio',
])

/** 需要用户确认才能执行的工具：会产生上游费用（生图/生片/配音/渲染） */
const COSTLY_TOOLS = new Set([
  'generate_keyframe',
  'generate_clip',
  'generate_voice',
  'generate_character_views',
  'generate_expression_sheet',
])

export const name = 'creative-tools'
/** 工具注册表由 dsh 提供；没有它就无从注册 */
export const inject = ['tools']

function json(res, status, payload) {
  return { status, payload }
}

async function callApp(baseUrl, token, path, body, signal) {
  const res = await fetch(`${baseUrl}${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', [INTERNAL_TOKEN_HEADER]: token },
    body: JSON.stringify(body || {}),
    signal,
  })
  let payload
  try {
    payload = await res.json()
  } catch {
    payload = { ok: false, message: `应用返回了非 JSON 响应（${res.status}）` }
  }
  if (!res.ok) {
    const message = payload?.message || payload?.error || `应用返回 ${res.status}`
    throw new Error(message)
  }
  return payload
}

/**
 * 工具调用的展示标题。
 * 只依赖工具名与参数（dsh 会在会话回放时再次调用），不能读外部状态。
 */
function callView(toolName, args) {
  const kind = COSTLY_TOOLS.has(toolName)
    ? 'execute'
    : toolName.startsWith('delete_')
      ? 'delete'
      : toolName.startsWith('submit_') || toolName.startsWith('set_')
        ? 'edit'
        : toolName.startsWith('read_') || toolName.startsWith('list_')
          ? 'read'
          : 'other'
  const salient =
    args && typeof args === 'object'
      ? args.episode !== undefined
        ? { episode: args.episode }
        : args.no !== undefined
          ? { no: args.no }
          : undefined
      : undefined
  return {
    card: 'generic',
    title: toolName,
    kind,
    ...(salient ? { rawInput: salient } : {}),
  }
}

/**
 * 插件入口。
 * `config.baseUrl` / `config.internalToken` 由 profile patch 注入（见 server/studio-profile.mjs），
 * 缺任一项就整插件不注册 —— 半可用的工具桥比没有更危险。
 */
export function apply(ctx, config) {
  const baseUrl = String(config?.baseUrl || process.env.SB_STUDIO_BASE_URL || '').replace(/\/+$/, '')
  // 令牌只经环境变量传递：profile patch 会落盘，写进去等于把内部凭据留在文件里
  const internalToken = String(config?.internalToken || process.env.SB_STUDIO_INTERNAL_TOKEN || '')
  const project = String(config?.project || process.env.SB_STUDIO_PROJECT || '')
  const episode = Number(config?.episode || process.env.SB_STUDIO_EPISODE || 1)
  if (!baseUrl || !internalToken) {
    ctx.logger?.warn?.('[creative-tools] 缺少 baseUrl 或 internalToken，工具桥未注册')
    return
  }

  /** 没有工具调用时的兜底轮询间隔：空闲会话也要能发现清单变化 */
  const RECONCILE_INTERVAL_MS = 15000
  // 允许测试/排障调小间隔；生产不配置时就是 15 秒
  const intervalMs =
    Number.isFinite(config?.reconcileIntervalMs) && config.reconcileIntervalMs > 0
      ? Number(config.reconcileIntervalMs)
      : RECONCILE_INTERVAL_MS

  /** 当前生效的原始声明：热更新失败时用它回滚 */
  let loadedTools = []
  /** 当前生效的清单版本；null 表示服务端没给（旧服务端），此时不做热更新 */
  let loadedVersion = null
  let registered = []
  /** 正在执行的调用数：>0 时不换表，否则进行中的调用会丢掉工具定义 */
  let inFlight = 0
  let disposed = false
  let reconciling = null
  let timer = null

  async function fetchCatalog(signal) {
    const res = await fetch(`${baseUrl}/api/studio/tools`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', [INTERNAL_TOKEN_HEADER]: internalToken },
      body: JSON.stringify({ project, episode }),
      signal,
    })
    if (!res.ok) throw new Error(`拉取工具清单失败：${res.status}`)
    const payload = await res.json()
    const tools = Array.isArray(payload.tools) ? payload.tools : []
    const version = typeof payload.version === 'string' && payload.version ? payload.version : null
    return { tools, version }
  }

  async function reportReady(tools) {
    // 回报给应用：宿主自己的日志不到应用日志里，注册结果得留个可查的凭据
    await fetch(`${baseUrl}/api/studio/tools/ready`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', [INTERNAL_TOKEN_HEADER]: internalToken },
      body: JSON.stringify({ count: registered.length, names: tools.map((t) => t.name) }),
    }).catch(() => {})
  }

  /** 把一份工具声明注册进 dsh；中途失败会把已注册的摘掉再抛错 */
  function installTools(tools) {
    const disposers = []
    try {
      for (const tool of tools) {
        disposers.push(
          ctx.tools.register({
            name: tool.name,
            description: tool.description,
            parameters: tool.parameters,
            output: {
              // 摘要与详情都在这个值里；schema 只约束形状，不约束业务字段
              schema: {
                type: 'object',
                additionalProperties: true,
                properties: {
                  summary: { description: '模型可见摘要' },
                  details: { description: '界面可见完整结果' },
                  failed: { type: 'boolean' },
                },
                required: ['summary'],
              },
              // 送进模型的只有摘要：帧数据、整段代码、图片地址不进上下文
              render: (_args, value) => [{ type: 'text', text: JSON.stringify(value?.summary ?? value) }],
            },
            presentCall: (args) => callView(tool.name, args),
            execute: async (args, exec) => {
              inFlight += 1
              try {
                // 项目上下文优先取调用参数：一个宿主可能同时服务多个项目
                const callProject = String((args && typeof args === 'object' && args.project) || project || '')
                const callEpisode = Number((args && typeof args === 'object' && args.episode) || episode || 1)
                try {
                  const payload = await callApp(
                    baseUrl,
                    internalToken,
                    '/api/studio/tools/execute',
                    {
                      name: tool.name,
                      args,
                      project: callProject,
                      episode: callEpisode,
                      expertId: String(exec?.studioExpertId || ''),
                    },
                    exec?.signal,
                  )
                  // 缺参数不是「失败到结束」：把它变成一次结构化追问，
                  // 原调用标识一起带回，补齐后按同一次调用继续。
                  if (Array.isArray(payload.fields) && payload.fields.length) {
                    const needInput = {
                      ok: false,
                      needInput: true,
                      callId: String(exec?.rootCallId || ''),
                      message: '这次调用还缺必填信息，补齐后再试',
                      fields: payload.fields,
                    }
                    return { summary: needInput, details: { ...payload, ...needInput }, failed: true }
                  }
                  return {
                    summary:
                      payload.summary !== undefined
                        ? payload.summary
                        : payload.ok === false
                          ? { ok: false, error: payload.error || payload.message || '工具返回失败' }
                          : { ok: true },
                    details: payload.details ?? payload,
                    failed: payload.ok === false,
                  }
                } catch (e) {
                  // 失败也要走正常结果：抛错会被上游当成运行时故障，模型看不到可读原因
                  const message = e?.message || String(e)
                  return { summary: { ok: false, error: message }, details: { ok: false, error: message }, failed: true }
                }
              } finally {
                inFlight -= 1
              }
            },
            presentResult: (_args, result) => {
              const meta = result?.presentationMeta
              if (!meta || typeof meta !== 'object') return undefined
              // 追问结果要在界面上说清「补哪些字段」，而不是把 JSON 原样摊开
              if (meta.needInput && Array.isArray(meta.fields)) {
                const lines = meta.fields.map((f) => `- ${f.field || '（整体）'}：${f.message}`)
                return {
                  card: 'generic',
                  title: `${tool.name} 需要补充信息`,
                  kind: 'other',
                  content: [{ type: 'text', text: `${meta.message}\n${lines.join('\n')}` }],
                }
              }
              return {
                card: 'generic',
                title: tool.name,
                content: [{ type: 'text', text: JSON.stringify(meta) }],
              }
            },
          }),
        )
      }
    } catch (e) {
      uninstallAll(disposers)
      throw e
    }
    return disposers
  }

  function uninstallAll(disposers) {
    for (const dispose of disposers) {
      try {
        dispose()
      } catch {
        /* 卸载失败不影响换表 */
      }
    }
  }

  /**
   * 比对清单版本并在需要时换表。
   *
   * 「先构建新的注册表再注销旧的」在这里只能做到「先完成拉取与解析」：
   * dsh 的工具注册表按名字唯一，同名工具无法并存。所以真正的保证是
   * **拉取/解析失败绝不触碰正在生效的表**，以及注册失败时能回滚到旧定义。
   */
  async function reconcile() {
    if (disposed) return false
    // 旧服务端没有 version：保持兼容，退化为「启动时拉取一次」
    if (!loadedVersion) return false
    // 有调用在跑就不换表：注销的瞬间进行中的调用会找不到自己的工具定义
    if (inFlight > 0) return false
    if (reconciling) return reconciling
    reconciling = (async () => {
      let next
      try {
        next = await fetchCatalog()
      } catch (e) {
        ctx.logger?.warn?.(
          `[creative-tools] 工具清单刷新失败，保留现有 ${registered.length} 个工具：${e?.message || String(e)}`,
        )
        return false
      }
      if (disposed) return false
      if (inFlight > 0) return false
      if (next.version === loadedVersion) return false
      if (next.version === null) {
        ctx.logger?.warn?.('[creative-tools] 服务端未提供清单版本，跳过热更新')
        return false
      }
      const previousTools = loadedTools
      const previousVersion = loadedVersion
      uninstallAll(registered)
      registered = []
      try {
        registered = installTools(next.tools)
        loadedTools = next.tools
        loadedVersion = next.version
      } catch (e) {
        // 回滚：新装的一半先摘掉，再把上一版定义装回去
        uninstallAll(registered)
        registered = []
        try {
          registered = installTools(previousTools)
          loadedTools = previousTools
          loadedVersion = previousVersion
        } catch (e2) {
          registered = []
          loadedTools = []
          loadedVersion = null
          ctx.logger?.warn?.(
            `[creative-tools] 工具清单热更新与回滚都失败，工具暂不可用：${e2?.message || String(e2)}`,
          )
          return false
        }
        ctx.logger?.warn?.(`[creative-tools] 工具清单热更新失败，已回滚到上一版：${e?.message || String(e)}`)
        return false
      }
      ctx.logger?.info?.(`[creative-tools] 工具清单已热更新：${registered.length} 个工具（版本 ${loadedVersion}）`)
      void reportReady(loadedTools)
      return true
    })().finally(() => {
      reconciling = null
    })
    return reconciling
  }

  const ready = (async () => {
    const { tools, version } = await fetchCatalog()
    registered = installTools(tools)
    loadedTools = tools
    loadedVersion = version
    ctx.logger?.info?.(`[creative-tools] 已注册 ${registered.length} 个工具`)
    await reportReady(tools)
    // 只有拿到版本号才有「变化」可言；旧服务端连轮询都不必开
    if (version) {
      timer = setInterval(() => {
        void reconcile()
      }, intervalMs)
      timer.unref?.()
    }
  })().catch((e) => {
    // 目录拉不到就整桥不注册：半可用的工具桥会让模型以为工具存在却调不动
    ctx.logger?.warn?.(`[creative-tools] 工具清单加载失败，本次不注册工具：${e?.message || String(e)}`)
  })

  /** 写库/付费须先弹确认卡；prepend 确保优先于 Auto 预审（否则会按 low risk 直接执行） */
  async function gateDestructive(exec, next) {
    await ready.catch(() => {})
    const toolName = exec?.name
    if (!toolName) return next()
  // 不依赖 registered：清单热更新瞬间表为空时也不能裸奔；Auto 权限会把 allow 当终审
    if (DESTRUCTIVE_TOOLS.has(toolName)) {
      return {
        kind: 'ask',
        reason: `工具 ${toolName} 会写入项目数据，需要确认后执行`,
        displayReason: { en: `Approve ${toolName}?` },
      }
    }
    if (COSTLY_TOOLS.has(toolName)) {
      return {
        kind: 'ask',
        reason: `工具 ${toolName} 会产生上游费用，需要确认后执行`,
        displayReason: { en: `Approve ${toolName}?` },
      }
    }
    if (registered.length === 0) return next()
    // 每次调用前比对一次清单版本：schema 改完不必重启宿主。
    // 失败只记日志不阻断调用——刷新是增强，不是前置条件。
    await reconcile().catch(() => {})
    return next()
  }

  // 审批闸门：在工具体之前拦截，拒绝时工具不执行
  ctx.on('tools/pre-execute', gateDestructive, true)

  ctx.effect?.(() => () => {
    if (disposed) return
    disposed = true
    if (timer) {
      clearInterval(timer)
      timer = null
    }
    uninstallAll(registered)
    registered = []
    loadedTools = []
    loadedVersion = null
  })
}

export default { name, inject, apply }
