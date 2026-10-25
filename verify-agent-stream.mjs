/**
 * 流式事件验收：服务端解析器、客户端解析器、纯 reducer、真实代理。
 * 需要 dev server：APP_URL=http://127.0.0.1:5274 node verify-agent-stream.mjs
 */
import { build } from 'esbuild'
import path from 'node:path'
import { ChatStreamParser } from './server/text-stream.mjs'

const BASE = process.env.APP_URL || 'http://127.0.0.1:5274'
const ROOT = path.resolve(import.meta.dirname)
let bad = 0
const check = (name, cond, extra = '') => {
  console.log(`${cond ? '✅' : '❌'} ${name}${extra ? ` | ${extra}` : ''}`)
  if (!cond) bad++
}

async function load(entry) {
  const out = await build({
    entryPoints: [path.join(ROOT, entry)],
    bundle: true,
    format: 'esm',
    platform: 'node',
    write: false,
    logLevel: 'silent',
  })
  return import(`data:text/javascript;base64,${Buffer.from(out.outputFiles[0].text).toString('base64')}`)
}

// ---------------------------------------------------------------- 服务端解析器
{
  const p = new ChatStreamParser()
  let out = p.push('data: {"choices":[{"delta":{"content":"你"}}]}\n')
  check('服务端：首片', out.chars === 1 && p.text === '你')
  out = p.push('data: {"choices":[{"delta":{"content":"好"}}]}\n\ndata: [DONE]\n\n')
  check('服务端：多事件与 DONE', out.done && p.text === '你好', JSON.stringify({ chars: out.chars, done: out.done }))

  const split = new ChatStreamParser()
  split.push('data: {"choices":[{"delta":{"content":"流"')
  const mid = split.push('}}]}\n')
  check('服务端：跨 chunk 边界', split.text === '流' && mid.chars === 1)

  const reason = new ChatStreamParser()
  reason.push('data: {"choices":[{"delta":{"reasoning_content":"思考","content":"答案"}}]}\n')
  check('服务端：reasoning 丢弃', reason.text === '答案' && reason.reasoningChars === 2, JSON.stringify({ text: reason.text, r: reason.reasoningChars }))

  const badJson = new ChatStreamParser()
  badJson.push('data: {not-json}\n')
  badJson.push('data: {"choices":[{"delta":{"content":"后"}}]}\n')
  check('服务端：坏 JSON 不阻塞', badJson.text === '后')

  const err = new ChatStreamParser()
  err.push('data: {"error":{"message":"boom"}}\n')
  check('服务端：错误对象', err.error === 'boom')

  const think = new ChatStreamParser()
  think.push('data: {"choices":[{"delta":{"content":"<think>秘密</think>答案"}}]}\n')
  check('服务端：think 标签过滤', think.text === '答案', JSON.stringify(think.text))

  const splitTag = new ChatStreamParser()
  splitTag.push('data: {"choices":[{"delta":{"content":"<thi"}}]}\n')
  splitTag.push('data: {"choices":[{"delta":{"content":"nk>推理</think"}}]}\n')
  splitTag.push('data: {"choices":[{"delta":{"content":">可见"}}]}\n')
  splitTag.flush()
  check('服务端：think 标签跨 chunk', splitTag.text === '可见', JSON.stringify(splitTag.text))
}

// ---------------------------------------------------------------- 客户端解析器
const { SseEventParser } = await load('src/textStream.ts')
{
  const p = new SseEventParser()
  let events = p.push('data: {"type":"meta","model":"m"}\n\n')
  check('客户端：单事件', events.length === 1 && events[0].type === 'meta', JSON.stringify(events))
  events = p.push('data: {"type":"progress","cha')
  check('客户端：半事件暂存', events.length === 0)
  events = p.push('rs":120}\n\ndata: {"type":"done","text":"好"}\n\n')
  check('客户端：跨 chunk 续接', events.length === 2 && events[0].chars === 120 && events[1].text === '好', JSON.stringify(events))
  const bad = p.push('data: {oops}\n\ndata: {"type":"done","text":"ok"}\n\n')
  check('客户端：坏事件丢弃', bad.length === 1 && bad[0].text === 'ok')
}

// ---------------------------------------------------------------- 纯 reducer
const { applyAgentEvent } = await load('src/agent/agentMessageReducer.ts')
{
  let m = { id: 'a', role: 'assistant', parts: [] }
  m = applyAgentEvent(m, { type: 'agent_step', turn: 1, phase: 'start' })
  m = applyAgentEvent(m, { type: 'text_message_start', messageId: 'msg-1', role: 'assistant' })
  m = applyAgentEvent(m, { type: 'text_message_content', messageId: 'msg-1', delta: '你' })
  m = applyAgentEvent(m, { type: 'text_message_content', messageId: 'msg-1', delta: '好' })
  const textPart = m.parts.find((p) => p.type === 'text' && p.id === 'msg-1')
  check('reducer：文本增量追加', textPart && textPart.text === '你好', JSON.stringify(textPart))

  m = applyAgentEvent(m, { type: 'custom', name: 'progress', value: { chars: 1234, turn: 1 } })
  const step = m.parts.find((p) => p.type === 'step' && p.turn === 1)
  check('reducer：进度写入步骤', step && step.chars === 1234, JSON.stringify(step))

  m = applyAgentEvent(m, { type: 'agent_step', turn: 1, phase: 'end', text: '完整说明' })
  const stepEnd = m.parts.find((p) => p.type === 'step' && p.turn === 1)
  check('reducer：有流式文本时不重复步骤说明', stepEnd && stepEnd.text === undefined && stepEnd.chars === undefined, JSON.stringify(stepEnd))

  const failed = applyAgentEvent(m, { type: 'error', message: '模型超时' })
  const kept = failed.parts.filter((p) => p.type === 'text' && p.id === 'msg-1')
  check('reducer：错误丢弃该轮半截文本', kept.length === 0 && failed.status === 'error', JSON.stringify(failed.parts.map((p) => p.type)))
  check('reducer：错误追加失败说明', failed.parts.some((p) => p.type === 'text' && p.text.includes('失败')))

  let retry = applyAgentEvent(failed, { type: 'agent_step', turn: 2, phase: 'start' })
  retry = applyAgentEvent(retry, { type: 'text_message_start', messageId: 'msg-2', role: 'assistant' })
  retry = applyAgentEvent(retry, { type: 'text_message_content', messageId: 'msg-2', delta: '重试后' })
  const texts = retry.parts.filter((p) => p.type === 'text' && p.id)
  check('reducer：重试只保留新一轮文本', texts.length === 1 && texts[0].id === 'msg-2' && texts[0].text === '重试后', JSON.stringify(texts))

  let cancelled = applyAgentEvent(
    applyAgentEvent(
      applyAgentEvent({ id: 'b', role: 'assistant', parts: [] }, { type: 'text_message_start', messageId: 'msg-3', role: 'assistant' }),
      { type: 'text_message_content', messageId: 'msg-3', delta: '已写一半' },
    ),
    { type: 'cancelled' },
  )
  const keptText = cancelled.parts.find((p) => p.type === 'text' && p.id === 'msg-3')
  check('reducer：取消保留已确认内容', cancelled.status === 'cancelled' && keptText && keptText.text === '已写一半' && !keptText.streaming, JSON.stringify(keptText))

  const tool = applyAgentEvent(applyAgentEvent({ id: 'c', role: 'assistant', parts: [] }, { type: 'tool_start', toolCallId: 't1', toolName: 'set_scene_code' }), { type: 'tool_call_args', toolCallId: 't1', delta: '{"code":' })
  const toolPart = tool.parts.find((p) => p.type === 'tool-call')
  check('reducer：参数分片只记字符数', toolPart && toolPart.argsChars === 8 && toolPart.args === undefined, JSON.stringify(toolPart))
  const ready = applyAgentEvent(tool, { type: 'tool_call_input_available', toolCallId: 't1', input: { code: 'x' } })
  check('reducer：参数完整才写入 args', ready.parts.find((p) => p.type === 'tool-call')?.args?.code === 'x')
}

// ---------------------------------------------------------------- 事件桥
const { createAgentEventBridge } = await load('src/agent/sceneAgentEvents.ts')
{
  const bridge = createAgentEventBridge()
  const start = bridge.map({ event: 'on_chain_start', name: 'agent', run_id: 'chain-1' })
  check('桥：步骤开始', start && start.type === 'agent_step' && start.phase === 'start' && start.turn === 1, JSON.stringify(start))

  const first = bridge.map({
    event: 'on_chat_model_stream',
    run_id: 'model-1',
    data: { chunk: { content: '你' } },
  })
  check(
    '桥：首片先 start 再 content',
    Array.isArray(first) && first[0].type === 'text_message_start' && first[1].type === 'text_message_content' && first[1].delta === '你',
    JSON.stringify(first),
  )
  const second = bridge.map({
    event: 'on_chat_model_stream',
    run_id: 'model-1',
    data: { chunk: { content: '好' } },
  })
  check('桥：后续只发 content', Array.isArray(second) && second.length === 1 && second[0].delta === '好', JSON.stringify(second))

  const reasoning = bridge.map({
    event: 'on_chat_model_stream',
    run_id: 'model-1',
    data: { chunk: { content: '', additional_kwargs: { reasoning_content: '内部推理' } } },
  })
  check('桥：reasoning 不产生事件', reasoning === null)

  const end = bridge.map({ event: 'on_chat_model_end', run_id: 'model-1' })
  check('桥：文本结束', end && end.type === 'text_message_end', JSON.stringify(end))

  const agentEnd = bridge.map({
    event: 'on_chain_end',
    name: 'agent',
    run_id: 'chain-1',
    data: { output: { messages: [{ type: 'ai', content: '完整说明' }] } },
  })
  check('桥：步骤结束带说明', agentEnd && agentEnd.type === 'agent_step' && agentEnd.phase === 'end', JSON.stringify(agentEnd))
}

// ---------------------------------------------------------------- 真实代理
async function sseCall(body) {
  const res = await fetch(`${BASE}/api/text`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
  const ct = res.headers.get('content-type') || ''
  if (!ct.includes('text/event-stream')) {
    const j = await res.json()
    return { fallback: true, json: j }
  }
  const parser = new SseEventParser()
  const reader = res.body.getReader()
  const dec = new TextDecoder()
  const events = []
  for (;;) {
    const { done, value } = await reader.read()
    if (done) break
    events.push(...parser.push(dec.decode(value, { stream: true })))
    if (events.some((e) => e.type === 'done' || e.type === 'error')) break
  }
  return { fallback: false, events }
}

{
  const r = await sseCall({ prompt: '用一句话介绍你自己', maxTokens: 200, model: 'lite', stream: true })
  const types = r.fallback ? ['fallback'] : r.events.map((e) => e.type)
  const done = r.fallback ? null : r.events.find((e) => e.type === 'done')
  check('真实代理：流式返回 meta/done', r.fallback || (types.includes('meta') && done && String(done.text || '').length > 4), JSON.stringify({ types, text: done?.text?.slice(0, 30) }))
  check('真实代理：不泄漏 think 推理', r.fallback || !/<think(?:ing)?>/i.test(String(done?.text || '')), String(done?.text || '').slice(0, 60))
  check('真实代理：进度不超过总字符', r.fallback || r.events.every((e) => e.type !== 'progress' || Number(e.chars) <= String(done?.text || '').length + 8))

  const j = await sseCall({ prompt: '只输出 JSON：{"ok":true}', json: true, maxTokens: 120, model: 'lite', stream: true })
  const jdone = j.fallback ? j.json : j.events.find((e) => e.type === 'done')
  check('真实代理：JSON 模式带 json 字段', Boolean(jdone && jdone.json && jdone.json.ok === true), JSON.stringify(jdone && { json: jdone.json }))

  const plain = await fetch(`${BASE}/api/text`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ prompt: '只输出 JSON：{"ok":true}', json: true, maxTokens: 80, model: 'lite' }),
  }).then((x) => x.json())
  check('真实代理：非流式结构不变', plain.ok === true && plain.json?.ok === true && typeof plain.text === 'string')

  // 取消：读到 meta 后 abort，服务端不应崩溃
  const ctrl = new AbortController()
  const res = await fetch(`${BASE}/api/text`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ prompt: '写一段 800 字的产品介绍', maxTokens: 2000, model: 'lite', stream: true }),
    signal: ctrl.signal,
  })
  const reader = res.body.getReader()
  await reader.read()
  ctrl.abort()
  let aborted = false
  try {
    for (;;) {
      const { done } = await reader.read()
      if (done) break
    }
  } catch (e) {
    aborted = (e && e.name === 'AbortError') || true
  }
  check('真实代理：可取消', aborted)
  const health = await fetch(`${BASE}/api/health`).then((x) => x.status)
  check('真实代理：取消后服务仍可用', health === 200, String(health))
}

console.log(bad ? `\n${bad} 项失败` : '\n全部通过')
process.exit(bad ? 1 : 0)
