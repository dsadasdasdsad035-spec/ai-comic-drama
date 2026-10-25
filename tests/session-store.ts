/**
 * 前端 sessionStore 的接口契约测试：在 Node 里拦截相对 URL 的 fetch，
 * 确认它发出的路径/方法/请求体与本文件的断言一致。
 * 由 verify-creative-session.mjs 在真实服务启动后调用（传入 base）。
 */
import assert from 'node:assert/strict'
import {
  autoTitle,
  createCreativeSession,
  deleteCreativeSession,
  getCreativeSession,
  listCreativeSessions,
  loadCreativeThread,
  patchCreativeSession,
  saveCreativeThread,
} from '../src/creative/sessionStore'

export async function runSessionStoreChecks(base: string, log: (name: string, ok: boolean, extra?: string) => void) {
  const realFetch = globalThis.fetch
  const calls: { url: string; method: string; body?: unknown }[] = []
  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const raw = typeof input === 'string' ? input : input instanceof URL ? input.toString() : input.url
    const url = raw.startsWith('http') ? raw : `${base}${raw}`
    calls.push({
      url: raw,
      method: init?.method || 'GET',
      ...(typeof init?.body === 'string' ? { body: JSON.parse(init.body) } : {}),
    })
    return realFetch(url, init)
  }) as typeof fetch

  try {
    const created = await createCreativeSession({ mode: 'reverse' })
    assert.ok(created.id)
    assert.equal(calls.at(-1)?.url, '/api/creative/sessions')
    assert.equal(calls.at(-1)?.method, 'POST')
    log('sessionStore.createCreativeSession', created.mode === 'reverse')

    const list = await listCreativeSessions(5)
    assert.ok(Array.isArray(list) && list.some((s) => s.id === created.id))
    assert.equal(calls.at(-1)?.url, '/api/creative/sessions?limit=5')
    log('sessionStore.listCreativeSessions', true, `${list.length} 条`)

    const renamed = await patchCreativeSession(created.id, { title: '前端改名' })
    assert.equal(renamed.title, '前端改名')
    log('sessionStore.patchCreativeSession', true)

    const empty = await loadCreativeThread(created.id)
    assert.deepEqual(empty.messages, [])
    log('sessionStore.loadCreativeThread', true)

    const messages = [{ id: 'x1', role: 'user', parts: [{ type: 'text', text: 'hi' }], status: 'complete' }]
    const saved = await saveCreativeThread(created.id, messages as never)
    assert.equal(saved.messages.length, 1)
    log('sessionStore.saveCreativeThread', true)

    const summary = await getCreativeSession(created.id)
    assert.equal(summary.messageCount, 1)
    log('sessionStore.getCreativeSession', true, `messages=${summary.messageCount}`)

    const removed = await deleteCreativeSession(created.id)
    assert.equal(removed, true)
    log('sessionStore.deleteCreativeSession', true)

    assert.equal(autoTitle('  这是一个很长的标题用于测试截断效果  ', 10), '这是一个很长的标题用…')
    log('sessionStore.autoTitle', true)
  } catch (e) {
    log('sessionStore 契约', false, (e as Error).message)
  } finally {
    globalThis.fetch = realFetch
  }
}
