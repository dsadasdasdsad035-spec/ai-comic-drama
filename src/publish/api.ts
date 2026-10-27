/** 发布台的服务端请求封装。统一 readJson 与错误消息，调用方只处理业务状态。 */
import type {
  Deliverable,
  DeliverableConfig,
  JobSummary,
  LoginSession,
  PlatformCapability,
  PlatformHealth,
  PreflightIssue,
  PreflightResult,
  PublishAccount,
  PublishIntent,
  PublishJob,
  PublishPackageResult,
} from './types'

async function readJson(res: Response): Promise<any> {
  const text = await res.text()
  if (!text) return {}
  try {
    return JSON.parse(text)
  } catch {
    return { ok: false, message: text.slice(0, 300) }
  }
}

function fail(j: any, fallback: string): never {
  throw new Error(String(j?.message || fallback))
}

export async function getPlatforms(): Promise<{
  platforms: PlatformCapability[]
  adapters: { platform: string; verified: boolean; manualOnly: boolean }[]
  browserAvailable: boolean
}> {
  const r = await fetch('/api/publish/platforms')
  const j = await readJson(r)
  if (!j.ok) fail(j, '读取平台能力失败')
  return j
}

export async function getPublishHealth(): Promise<PlatformHealth> {
  const r = await fetch('/api/publish/health')
  const j = await readJson(r)
  if (!j.ok) fail(j, '读取发布环境失败')
  return j
}

export async function listDeliverables(project: string, episode: number): Promise<Deliverable[]> {
  if (!project) return []
  const q = new URLSearchParams({ project, episode: String(episode || 0) })
  const r = await fetch(`/api/deliverables?${q}`)
  const j = await readJson(r)
  if (!j.ok) fail(j, '读取成片失败')
  return j.deliverables ?? []
}

export async function importDeliverable(
  project: string,
  episode: number,
  file: File,
): Promise<Deliverable> {
  const q = new URLSearchParams({ project, episode: String(episode || 0) })
  const r = await fetch(`/api/deliverables/import?${q}`, {
    method: 'POST',
    headers: { 'X-File-Name': encodeURIComponent(file.name), 'Content-Type': 'video/mp4' },
    body: file,
  })
  const j = await readJson(r)
  if (!j.ok) fail(j, '导入成片失败')
  return j.deliverable as Deliverable
}

export async function saveDeliverableConfig(
  id: string,
  config: DeliverableConfig,
): Promise<Deliverable> {
  const r = await fetch(`/api/deliverables/${encodeURIComponent(id)}/config`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ config }),
  })
  const j = await readJson(r)
  if (!j.ok) fail(j, '保存发布配置失败')
  return j.deliverable as Deliverable
}

export async function listAccounts(): Promise<PublishAccount[]> {
  const r = await fetch('/api/publish/accounts')
  const j = await readJson(r)
  if (!j.ok) fail(j, '读取账号失败')
  return j.accounts ?? []
}

export async function connectAccount(input: {
  platform: string
  label?: string
  accountId?: string
}): Promise<{ login: LoginSession; account: PublishAccount }> {
  const r = await fetch('/api/publish/accounts/connect', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(input),
  })
  const j = await readJson(r)
  if (!j.ok) fail(j, '启动登录失败')
  return j
}

export async function pollLogin(id: string): Promise<{ login: LoginSession; account: PublishAccount | null }> {
  const r = await fetch(`/api/publish/accounts/connect/${encodeURIComponent(id)}`)
  const j = await readJson(r)
  if (!j.ok) fail(j, '查询登录状态失败')
  return j
}

/** 取消登录：关掉浏览器窗口，别把它留到超时阻塞下一次连接 */
export async function cancelLogin(id: string): Promise<LoginSession> {
  const r = await fetch(`/api/publish/accounts/connect/${encodeURIComponent(id)}`, { method: 'DELETE' })
  const j = await readJson(r)
  if (!j.ok) fail(j, '取消登录失败')
  return j.login as LoginSession
}

/** 用户完成扫码后手动确认；服务端仍以真实会话为准确认登录 */
export async function confirmLogin(id: string): Promise<LoginSession> {
  const r = await fetch(`/api/publish/accounts/connect/${encodeURIComponent(id)}/confirm`, { method: 'POST' })
  const j = await readJson(r)
  if (!j.ok) fail(j, '确认登录失败')
  return j.login as LoginSession
}

export async function checkAccount(id: string): Promise<{ status: string; message: string; account: PublishAccount }> {
  const r = await fetch(`/api/publish/accounts/${encodeURIComponent(id)}/check`, { method: 'POST' })
  const j = await readJson(r)
  if (!j.ok) fail(j, '检查登录状态失败')
  return j
}

export async function deleteAccount(id: string): Promise<PublishAccount[]> {
  const r = await fetch(`/api/publish/accounts/${encodeURIComponent(id)}`, { method: 'DELETE' })
  const j = await readJson(r)
  if (!j.ok) fail(j, '删除账号失败')
  return j.accounts ?? []
}

export async function setAutoDraft(account: PublishAccount, enabled: boolean): Promise<PublishAccount> {
  const r = await fetch('/api/publish/accounts', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ id: account.id, platform: account.platform, label: account.label, autoDraft: enabled, status: account.status }),
  })
  const j = await readJson(r)
  if (!j.ok) fail(j, '更新自动草稿失败')
  return j.account as PublishAccount
}

export async function runPreflight(input: {
  deliverableId: string
  targets: { platform: string; accountId: string; mode: string }[]
  config: DeliverableConfig
}): Promise<PreflightResult> {
  const r = await fetch('/api/publish/preflight', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(input),
  })
  const j = await readJson(r)
  if (!j.ok) fail(j, '预检失败')
  const issues: PreflightIssue[] = j.issues ?? []
  return { ok: Boolean(j.ok), blocking: j.blocking ?? [], warnings: j.warnings ?? [], issues }
}

export async function createJobs(input: {
  deliverableId: string
  targets: { platform: string; accountId: string; mode: string }[]
  config: DeliverableConfig
  auto?: boolean
  republish?: boolean
}): Promise<PublishJob[]> {
  const r = await fetch('/api/publish/jobs', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(input),
  })
  const j = await readJson(r)
  if (!j.ok) {
    const message = j.preflight?.blocking?.map((b: PreflightIssue) => b.message).join('；')
    throw new Error(message || j.message || '创建发布任务失败')
  }
  return j.jobs ?? []
}

export async function listJobs(project: string, episode: number): Promise<{ jobs: PublishJob[]; summary: JobSummary }> {
  const q = new URLSearchParams({ project: project || '', episode: String(episode || 0) })
  const r = await fetch(`/api/publish/jobs?${q}`)
  const j = await readJson(r)
  if (!j.ok) fail(j, '读取发布记录失败')
  return { jobs: j.jobs ?? [], summary: j.summary ?? { running: 0, failed: 0, unknown: 0, total: 0 } }
}

export async function getJob(id: string): Promise<PublishJob> {
  const r = await fetch(`/api/publish/jobs/${encodeURIComponent(id)}`)
  const j = await readJson(r)
  if (!j.ok) fail(j, '读取任务详情失败')
  return j.job as PublishJob
}

export async function cancelJob(id: string): Promise<PublishJob> {
  const r = await fetch(`/api/publish/jobs/${encodeURIComponent(id)}/cancel`, { method: 'POST' })
  const j = await readJson(r)
  if (!j.ok) fail(j, '取消失败')
  return j.job as PublishJob
}

export async function retryJob(id: string): Promise<PublishJob> {
  const r = await fetch(`/api/publish/jobs/${encodeURIComponent(id)}/retry`, { method: 'POST' })
  const j = await readJson(r)
  if (!j.ok) fail(j, '重试失败')
  return j.job as PublishJob
}

export async function markJobPublished(id: string, workUrl = ''): Promise<PublishJob> {
  const r = await fetch(`/api/publish/jobs/${encodeURIComponent(id)}/mark-published`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ workUrl }),
  })
  const j = await readJson(r)
  if (!j.ok) fail(j, '标记发布失败')
  return j.job as PublishJob
}

export async function buildPackage(input: {
  deliverableId: string
  platforms: string[]
  config: DeliverableConfig
}): Promise<PublishPackageResult> {
  const r = await fetch('/api/publish/packages', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(input),
  })
  const j = await readJson(r)
  if (!j.ok) fail(j, '生成发布包失败')
  return j.package as PublishPackageResult
}

/**
 * 暂存一次提交意图：服务端只写一行 intent，不创建任务。
 * 这是助手的唯一提交入口——它拿不到任何直接建任务的能力。
 */
export async function stagePublishIntent(input: {
  deliverableId: string
  targets: { platform: string; accountId: string; mode: string }[]
  config: DeliverableConfig
  source?: 'assistant' | 'manual'
}): Promise<PublishIntent> {
  const r = await fetch('/api/publish/intents', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(input),
  })
  const j = await readJson(r)
  if (!j.ok) {
    const err = new Error(String(j.message || '暂存提交失败')) as Error & { code?: string }
    err.code = j.code
    throw err
  }
  return j.intent as PublishIntent
}

export async function getPublishIntent(id: string): Promise<PublishIntent | null> {
  const r = await fetch(`/api/publish/intents/${encodeURIComponent(id)}`)
  const j = await readJson(r)
  if (!j.ok) return null
  return j.intent as PublishIntent
}

/**
 * 确认提交意图。只传 intentId；带 config 时服务端只把它当「不是旧快照」的证明，
 * 实际执行永远使用 intent 行内保存的快照。
 */
export async function confirmPublishIntent(
  id: string,
  config?: DeliverableConfig,
): Promise<{ intent: PublishIntent; jobs: PublishJob[]; reused: boolean }> {
  const r = await fetch(`/api/publish/intents/${encodeURIComponent(id)}/confirm`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(config ? { config } : {}),
  })
  const j = await readJson(r)
  if (!j.ok) {
    const err = new Error(String(j.message || '确认提交失败')) as Error & {
      code?: string
      preflight?: PreflightResult
    }
    err.code = j.code
    if (j.preflight) err.preflight = j.preflight as PreflightResult
    throw err
  }
  return { intent: j.intent as PublishIntent, jobs: (j.jobs ?? []) as PublishJob[], reused: Boolean(j.reused) }
}

export async function cancelPublishIntent(id: string): Promise<PublishIntent | null> {
  const r = await fetch(`/api/publish/intents/${encodeURIComponent(id)}/cancel`, { method: 'POST' })
  const j = await readJson(r)
  if (!j.ok) return null
  return j.intent as PublishIntent
}


/**
 * 导出后的自动草稿：只对开启了 autoDraft 的账号、且成片已落库时触发。
 * 预检不通过不排队，并把原因返回给界面，不阻塞导出结果。
 */
export async function autoDraftAfterExport(input: {
  deliverableId: string
  config: DeliverableConfig
  targets: { platform: string; accountId: string; mode: string }[]
}): Promise<{ queued: number; skipped: { platform: string; reason: string }[] }> {
  if (!input.targets.length) return { queued: 0, skipped: [] }
  const pre = await runPreflight(input)
  if (!pre.ok) {
    return {
      queued: 0,
      skipped: input.targets.map((t) => ({
        platform: t.platform,
        reason: pre.blocking[0]?.message || '预检未通过',
      })),
    }
  }
  const made = await createJobs({ ...input, auto: true })
  return { queued: made.length, skipped: [] }
}
