/**
 * 导出后的自动草稿。
 *
 * 只做「上传到平台草稿箱」这一件事：
 * - 只有账号显式开启 autoDraft 才参与；
 * - 目标平台必须在该成片（或同项目同集的上一条成片）的配置里被选中，否则跳过；
 * - 预检不通过不排队，原因写回成片记录；
 * - 任务 payload.auto = true，队列据此拒绝调用 submitFinal。
 */
import { getDeliverable, listDeliverables, setAutoDraftNote } from './deliverables.mjs'
import { listAccounts } from './publish-accounts.mjs'
import { runPreflight } from './publish-preflight.mjs'
import { createJob } from './publish-jobs.mjs'
import { enqueue } from './publish-queue.mjs'
import { getPlatform } from './publish-platforms.mjs'

/** 新成片没配置时，沿用同项目同集上一条成片的配置（系列剧的常见场景） */
function carriedConfig(root, deliverable) {
  const own = deliverable.config
  const hasTargets = Object.values(own?.targets || {}).some((t) => t.selected)
  if (hasTargets) return own
  const prev = listDeliverables(root, {
    project: deliverable.project,
    episode: deliverable.episode,
    limit: 5,
  }).find((d) => d.id !== deliverable.id && Object.values(d.config?.targets || {}).some((t) => t.selected))
  return prev?.config || own
}

export function autoDraftOnExport({ dbRoot, appRoot, deliverable }) {
  if (!deliverable) return { queued: 0, skipped: [] }
  const accounts = listAccounts(dbRoot)
  const autoAccounts = accounts.filter((a) => a.autoDraft)
  if (!autoAccounts.length) {
    setAutoDraftNote(dbRoot, deliverable.id, '')
    return { queued: 0, skipped: [] }
  }

  const config = carriedConfig(dbRoot, deliverable)
  const accountById = new Map(accounts.map((a) => [a.id, a]))
  const targets = []
  const skipped = []

  for (const account of autoAccounts) {
    let platform
    try {
      platform = getPlatform(account.platform)
    } catch {
      skipped.push({ platform: account.platform, reason: '未知平台' })
      continue
    }
    const t = config.targets?.[account.platform]
    if (!t?.selected) {
      skipped.push({ platform: account.platform, reason: '该成片没有选择这个平台' })
      continue
    }
    if (platform.manualOnly) {
      skipped.push({ platform: account.platform, reason: '该平台只能人工发布' })
      continue
    }
    targets.push({ platform: account.platform, accountId: account.id, mode: 'draft' })
  }

  if (!targets.length) {
    const note = skipped.map((s) => `${s.platform}：${s.reason}`).join('；').slice(0, 300)
    setAutoDraftNote(dbRoot, deliverable.id, note)
    return { queued: 0, skipped }
  }

  const pre = runPreflight({
    appRoot,
    projectsRoot: dbRoot,
    deliverable,
    targets,
    config,
    accounts: accountById,
  })
  if (!pre.ok) {
    const note = pre.blocking.map((b) => b.message).join('；').slice(0, 300)
    setAutoDraftNote(dbRoot, deliverable.id, note)
    return { queued: 0, skipped: targets.map((t) => ({ platform: t.platform, reason: note })) }
  }

  let queued = 0
  for (const t of targets) {
    try {
      const r = createJob(dbRoot, {
        deliverableId: deliverable.id,
        project: deliverable.project,
        episode: deliverable.episode,
        platform: t.platform,
        accountId: t.accountId,
        mode: 'draft',
        deliverableUrl: deliverable.url,
        payload: { auto: true, aiGenerated: config.master?.aiGenerated !== false },
      })
      if (r.reused) continue
      enqueue(r.job.id, { root: dbRoot, appRoot, projectsRoot: dbRoot })
      queued++
    } catch (e) {
      skipped.push({ platform: t.platform, reason: (e && e.message) || '创建任务失败' })
    }
  }

  // 成功排队就不留旧原因
  setAutoDraftNote(dbRoot, deliverable.id, skipped.length ? skipped.map((s) => `${s.platform}：${s.reason}`).join('；').slice(0, 300) : '')
  return { queued, skipped }
}
