/**
 * OpenAI 兼容模型门面：给创意会话宿主（dsh）用的 `/v1/chat/completions`。
 *
 * 为什么不让宿主直连上游渠道：
 * - 宿主直连就绕过了应用的预扣/结算与渠道能力判定，计费会直接漏掉；
 * - 渠道选择、Key、模型表都在应用侧，宿主没有理由知道这些。
 *
 * 实现方式是薄适配，而不是第二套模型循环：请求翻译成应用既有的 `/api/text`
 * （它已经支持 messages / tools / 流式，并且自带账本守卫），再把它的 SSE 事件
 * 翻译回 OpenAI 的 chunk 形状。
 */
const STREAM_DONE = '[DONE]'

/** 把宿主侧的模型标识还原成应用的模型键。`sb/<key>` 是推荐的写法。 */
export function resolveModelId(raw, models) {
  const id = String(raw || '').trim()
  const ids = models.map((m) => m.id)
  if (!id) return { modelKey: '', id: ids[0] || 'sb/default' }
  if (id.startsWith('sb/')) {
    const key = id.slice(3)
    if (models.some((m) => m.key === key)) return { modelKey: key, id }
    return { error: `模型标识「${id}」没有对应的应用模型键，可用：${ids.join(', ') || '（无）'}` }
  }
  const byId = models.find((m) => m.id === id)
  if (byId) return { modelKey: byId.key, id }
  // 兼容直接写模型键或档位
  if (models.some((m) => m.key === id)) return { modelKey: id, id: `sb/${id}` }
  if (id === 'lite' || id === 'pro') return { modelKey: '', id: `sb/${id}`, tier: id }
  return { error: `模型标识「${id}」没有对应的应用模型键，可用：${ids.join(', ') || '（无）'}` }
}

function sseFrame(payload) {
  return `data: ${typeof payload === 'string' ? payload : JSON.stringify(payload)}\n\n`
}

function errorBody(message, type = 'invalid_request_error', code = '') {
  return { error: { message: String(message || '请求失败'), type, ...(code ? { code } : {}) } }
}

/**
 * 创建门面。`baseUrl` 指向应用自身（回环），`getModels` 返回当前可用文本模型，
 * `getSessionToken` 返回当前操作员的会话令牌（账号模式下用于把账记到人头上）。
 */
export function createOpenAIGateway({ baseUrl, getModels, getSessionToken, log = () => {} }) {
  function models() {
    try {
      return getModels() || []
    } catch (e) {
      log(`[gateway] 读取模型表失败：${e?.message || String(e)}`)
      return []
    }
  }

  function isGatewayPath(url) {
    const pathname = String(url || '').split('?')[0]
    return pathname === '/v1/models' || pathname === '/v1/chat/completions'
  }

  function sendJson(res, status, payload) {
    if (res.writableEnded || res.destroyed) return
    res.statusCode = status
    res.setHeader('Content-Type', 'application/json; charset=utf-8')
    res.setHeader('Cache-Control', 'no-store')
    res.end(JSON.stringify(payload))
  }

  function handleModels(req, res) {
    const list = models()
    sendJson(res, 200, {
      object: 'list',
      data: list.map((m) => ({ id: m.id, object: 'model', created: 0, owned_by: 'storyboard-canvas' })),
    })
  }

  async function handleChat(req, res) {
    const chunks = []
    for await (const chunk of req) chunks.push(chunk)
    let body
    try {
      body = JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}')
    } catch (e) {
      sendJson(res, 400, errorBody(`请求体不是合法 JSON：${e?.message || String(e)}`))
      return
    }

    const list = models()
    const resolved = resolveModelId(body.model, list)
    if (resolved.error) {
      sendJson(res, 404, errorBody(resolved.error, 'invalid_request_error', 'model_not_found'))
      return
    }

    const stream = Boolean(body.stream)
    const upstreamBody = {
      messages: body.messages,
      tools: body.tools,
      modelKey: resolved.modelKey,
      ...(resolved.tier ? { tier: resolved.tier } : {}),
      stream: true,
    }

    const sessionToken = typeof getSessionToken === 'function' ? String(getSessionToken() || '') : ''
    const ctrl = new AbortController()
    res.on('close', () => ctrl.abort())

    let upstream
    try {
      upstream = await fetch(`${baseUrl}/api/text`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(sessionToken ? { cookie: `sb_session=${encodeURIComponent(sessionToken)}` } : {}),
        },
        body: JSON.stringify(upstreamBody),
        signal: ctrl.signal,
      })
    } catch (e) {
      sendJson(res, 502, errorBody(`应用模型代理不可用：${e?.message || String(e)}`, 'api_error', 'upstream_unavailable'))
      return
    }

    if (!upstream.ok) {
      let detail = ''
      try {
        detail = await upstream.text()
      } catch {
        /* 忽略 */
      }
      let message = detail.slice(0, 400)
      try {
        const parsed = JSON.parse(detail)
        message = String(parsed?.message || message)
      } catch {
        /* 保留原文 */
      }
      sendJson(res, upstream.status === 401 || upstream.status === 402 ? upstream.status : 502, errorBody(message, 'api_error', 'upstream_error'))
      return
    }

    const id = `chatcmpl-${Date.now().toString(36)}`
    const created = Math.floor(Date.now() / 1000)
    const modelId = resolved.id

    if (!stream) {
      const result = await collect(upstream, res)
      sendJson(res, 200, {
        id,
        object: 'chat.completion',
        created,
        model: modelId,
        choices: [
          {
            index: 0,
            message: {
              role: 'assistant',
              content: result.text || '',
              ...(result.toolCalls.length
                ? {
                    tool_calls: result.toolCalls.map((call, index) => ({
                      id: call.id,
                      type: 'function',
                      index,
                      function: { name: call.name, arguments: call.arguments },
                    })),
                  }
                : {}),
            },
            finish_reason: result.toolCalls.length ? 'tool_calls' : 'stop',
          },
        ],
        ...(result.usage ? { usage: result.usage } : {}),
      })
      return
    }

    // ---- 流式：把应用的 SSE 事件翻译成 OpenAI chunk ----
    res.statusCode = 200
    res.setHeader('Content-Type', 'text/event-stream; charset=utf-8')
    res.setHeader('Cache-Control', 'no-store')
    res.setHeader('X-Accel-Buffering', 'no')
    res.flushHeaders?.()

    const write = (payload) => {
      if (res.writableEnded || res.destroyed) return
      res.write(sseFrame(payload))
    }
    write({
      id,
      object: 'chat.completion.chunk',
      created,
      model: modelId,
      choices: [{ index: 0, delta: { role: 'assistant' }, finish_reason: null }],
    })

    /** 已经通过 delta 流出去的工具调用下标：done 里不要再整段重发 */
    const streamedToolIndexes = new Set()
    let text = ''
    let finishReason = ''

    const reader = upstream.body?.getReader()
    if (reader) {
      const decoder = new TextDecoder()
      let buffer = ''
      let finished = false
      while (!finished) {
        const { value, done } = await reader.read()
        if (done) break
        buffer += decoder.decode(value, { stream: true })
        let at
        while ((at = buffer.indexOf('\n\n')) >= 0) {
          const frame = buffer.slice(0, at)
          buffer = buffer.slice(at + 2)
          for (const line of frame.split('\n')) {
            if (!line.startsWith('data:')) continue
            const raw = line.slice(5).trim()
            if (!raw) continue
            let event
            try {
              event = JSON.parse(raw)
            } catch {
              continue
            }
            if (event.type === 'text_delta' && event.delta) {
              text += String(event.delta)
              write({ id, object: 'chat.completion.chunk', created, model: modelId, choices: [{ index: 0, delta: { content: String(event.delta) }, finish_reason: null }] })
            } else if (event.type === 'tool_call_delta') {
              streamedToolIndexes.add(Number(event.index ?? 0))
              write({
                id,
                object: 'chat.completion.chunk',
                created,
                model: modelId,
                choices: [
                  {
                    index: 0,
                    delta: {
                      tool_calls: [
                        {
                          index: Number(event.index ?? 0),
                          ...(event.id ? { id: String(event.id) } : {}),
                          type: 'function',
                          function: {
                            ...(event.name ? { name: String(event.name) } : {}),
                            ...(event.delta ? { arguments: String(event.delta) } : {}),
                          },
                        },
                      ],
                    },
                    finish_reason: null,
                  },
                ],
              })
            } else if (event.type === 'done') {
              const toolCalls = Array.isArray(event.toolCalls) ? event.toolCalls : []
              // 渠道可能不发增量、只在 done 里给完整文本（例如非流式上游或本地 Mock）：
              // 这种情况必须补一次 content，否则宿主收到的是一条空回复
              const finalText = typeof event.text === 'string' ? event.text : ''
              if (finalText.length > text.length) {
                const rest = finalText.slice(text.length)
                write({ id, object: 'chat.completion.chunk', created, model: modelId, choices: [{ index: 0, delta: { content: rest }, finish_reason: null }] })
                text = finalText
              }
              if (toolCalls.length && streamedToolIndexes.size === 0) {
                // 渠道没有流式工具增量：在收尾时整段补一次，否则宿主永远收不到工具调用
                write({
                  id,
                  object: 'chat.completion.chunk',
                  created,
                  model: modelId,
                  choices: [
                    {
                      index: 0,
                      delta: {
                        tool_calls: toolCalls.map((call, index) => ({
                          index,
                          id: call.id,
                          type: 'function',
                          function: { name: call.name, arguments: call.arguments },
                        })),
                      },
                      finish_reason: null,
                    },
                  ],
                })
              }
              finishReason = toolCalls.length ? 'tool_calls' : 'stop'
              if (event.usage && body.stream_options?.include_usage) {
                write({ id, object: 'chat.completion.chunk', created, model: modelId, choices: [], usage: event.usage })
              }
              finished = true
            } else if (event.type === 'error') {
              write(errorBody(event.message || '模型调用失败', 'api_error', event.kind || 'upstream_error'))
              finished = true
            }
          }
        }
      }
    }

    write({
      id,
      object: 'chat.completion.chunk',
      created,
      model: modelId,
      choices: [{ index: 0, delta: {}, finish_reason: finishReason || 'stop' }],
    })
    if (res.writableEnded || res.destroyed) return
    res.write(sseFrame(STREAM_DONE))
    res.end()
  }

  /** 非流式：把 SSE 读完拼成一次完整结果 */
  async function collect(upstream) {
    const out = { text: '', toolCalls: [], usage: undefined }
    const reader = upstream.body?.getReader()
    if (!reader) return out
    const decoder = new TextDecoder()
    let buffer = ''
    for (;;) {
      const { value, done } = await reader.read()
      if (done) break
      buffer += decoder.decode(value, { stream: true })
      let at
      while ((at = buffer.indexOf('\n\n')) >= 0) {
        const frame = buffer.slice(0, at)
        buffer = buffer.slice(at + 2)
        for (const line of frame.split('\n')) {
          if (!line.startsWith('data:')) continue
          const raw = line.slice(5).trim()
          if (!raw) continue
          let event
          try {
            event = JSON.parse(raw)
          } catch {
            continue
          }
          if (event.type === 'text_delta' && event.delta) out.text += String(event.delta)
          else if (event.type === 'done') {
            if (typeof event.text === 'string' && event.text.length >= out.text.length) out.text = event.text
            if (Array.isArray(event.toolCalls)) out.toolCalls = event.toolCalls
            if (event.usage) out.usage = event.usage
          } else if (event.type === 'error') {
            throw new Error(event.message || '模型调用失败')
          }
        }
      }
    }
    return out
  }

  async function handle(req, res) {
    const pathname = String(req.url || '').split('?')[0]
    if (pathname === '/v1/models') {
      handleModels(req, res)
      return true
    }
    if (pathname === '/v1/chat/completions') {
      if (req.method !== 'POST') {
        sendJson(res, 405, errorBody('只支持 POST'))
        return true
      }
      try {
        await handleChat(req, res)
      } catch (e) {
        log(`[gateway] 请求失败：${e?.message || String(e)}`)
        if (!res.headersSent) sendJson(res, 500, errorBody(e?.message || String(e), 'api_error', 'internal_error'))
        else if (!res.writableEnded) res.end()
      }
      return true
    }
    return false
  }

  return { handle, isGatewayPath }
}
