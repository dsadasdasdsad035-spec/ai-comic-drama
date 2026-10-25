import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import WorkbenchBar from './WorkbenchBar'
import PlatformBadge from './publish/PlatformBadge'
import CoverPicker from './publish/CoverPicker'
import PublishRecords, { PublishJobDrawer } from './publish/PublishRecords'
import AccountList from './publish/AccountsPanel'
import {
  buildPackage,
  cancelJob,
  createJobs,
  getJob,
  getPlatforms,
  getPublishHealth,
  importDeliverable,
  listAccounts,
  listDeliverables,
  listJobs,
  markJobPublished,
  retryJob,
  runPreflight,
  saveDeliverableConfig,
} from './publish/api'
import {
  copyFor,
  emptyConfig,
  type CoverAspect,
  type Deliverable,
  type DeliverableConfig,
  type PlatformCapability,
  type PlatformHealth,
  type PreflightIssue,
  type PreflightResult,
  type PublishAccount,
  type PublishJob,
  type PublishMode,
} from './publish/types'
import './publish/publish.css'

type Tab = 'pending' | 'records' | 'accounts'
type SectionKey = 'targets' | 'copy' | 'cover' | 'mode'

const SECTION_ORDER: SectionKey[] = ['targets', 'copy', 'cover', 'mode']
const SECTION_LABEL: Record<SectionKey, string> = {
  targets: '平台与账号',
  copy: '文案',
  cover: '封面',
  mode: '发布方式',
}

function fmtDur(sec: number | null | undefined): string {
  if (!sec || !Number.isFinite(sec)) return '—'
  const s = Math.round(Number(sec))
  const m = Math.floor(s / 60)
  return m > 0 ? `${m}:${String(s % 60).padStart(2, '0')}` : `${s}s`
}

function fmtRes(w: number | null, h: number | null): string {
  if (!w || !h) return '未知分辨率'
  const label = h >= 1080 ? '1080p' : h >= 720 ? '720p' : h >= 480 ? '480p' : `${w}×${h}`
  return `${label} · ${w}×${h}`
}

/**
 * 发布台：成片栏 | 编排四段 | 预检检查器。
 * 配置随成片保存；切换成片、切换项目/集都按 id 重新取，不沿用上一份内存配置。
 */
export default function PublishBoard({
  projectName,
  epNo,
  onToast,
  initialDeliverableId,
  onConsumeInitial,
}: {
  projectName: string
  epNo: number
  onToast: (m: string) => void
  /** 从预览导出成功后带进来的成片 id */
  initialDeliverableId?: string | null
  onConsumeInitial?: () => void
}) {
  const [tab, setTab] = useState<Tab>('pending')
  const [platforms, setPlatforms] = useState<PlatformCapability[]>([])
  const [health, setHealth] = useState<PlatformHealth | null>(null)
  const [accounts, setAccounts] = useState<PublishAccount[]>([])
  const [deliverables, setDeliverables] = useState<Deliverable[]>([])
  const [activeId, setActiveId] = useState('')
  const [config, setConfig] = useState<DeliverableConfig>(emptyConfig())
  const [jobs, setJobs] = useState<PublishJob[]>([])
  const [summary, setSummary] = useState({ running: 0, failed: 0, unknown: 0, total: 0 })
  /** 默认四段全展开；用户可单独折叠。避免长表单一次铺满，也避免折叠后整页空白。 */
  const [collapsed, setCollapsed] = useState<Set<SectionKey>>(new Set())
  const [preflight, setPreflight] = useState<PreflightResult | null>(null)
  const [checking, setChecking] = useState(false)
  const [busy, setBusy] = useState(false)
  const [drawerJob, setDrawerJob] = useState<PublishJob | null>(null)
  const [confirmOpen, setConfirmOpen] = useState(false)
  const [loading, setLoading] = useState(true)
  const fileRef = useRef<HTMLInputElement | null>(null)
  const saveTimer = useRef<number | null>(null)

  const active = useMemo(() => deliverables.find((d) => d.id === activeId) ?? null, [deliverables, activeId])

  // ---- 初始加载：能力 + 健康 + 账号 ----
  useEffect(() => {
    let alive = true
    ;(async () => {
      try {
        const [p, h] = await Promise.all([getPlatforms(), getPublishHealth()])
        if (!alive) return
        setPlatforms(p.platforms)
        setHealth(h)
      } catch (e) {
        onToast((e as Error).message)
      }
    })()
    return () => {
      alive = false
    }
  }, [onToast])

  const reloadAccounts = useCallback(async () => {
    try {
      setAccounts(await listAccounts())
    } catch (e) {
      onToast((e as Error).message)
    }
  }, [onToast])

  useEffect(() => {
    void reloadAccounts()
  }, [reloadAccounts])

  // ---- 成片按项目 + 集 ----
  const reloadDeliverables = useCallback(async () => {
    if (!projectName) {
      setDeliverables([])
      setActiveId('')
      return
    }
    setLoading(true)
    try {
      const list = await listDeliverables(projectName, epNo)
      setDeliverables(list)
      setActiveId((cur) => {
        if (initialDeliverableId && list.some((d) => d.id === initialDeliverableId)) return initialDeliverableId
        if (cur && list.some((d) => d.id === cur)) return cur
        return list[0]?.id || ''
      })
    } catch (e) {
      onToast((e as Error).message)
    } finally {
      setLoading(false)
    }
  }, [projectName, epNo, initialDeliverableId, onToast])

  useEffect(() => {
    void reloadDeliverables()
  }, [reloadDeliverables])

  useEffect(() => {
    if (initialDeliverableId) onConsumeInitial?.()
    // 只在消费一次后通知父级清空
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [initialDeliverableId])

  // ---- 切到新成片时恢复它的配置 ----
  useEffect(() => {
    if (!active) {
      setConfig(emptyConfig())
      return
    }
    setConfig(active.config || emptyConfig())
    setPreflight(null)
    setCollapsed(new Set())
  }, [active?.id]) // eslint-disable-line react-hooks/exhaustive-deps

  // ---- 记录 ----
  const reloadJobs = useCallback(async () => {
    if (!projectName) return
    try {
      const r = await listJobs(projectName, epNo)
      setJobs(r.jobs)
      setSummary(r.summary)
    } catch {
      /* 记录刷新失败不打断编排 */
    }
  }, [projectName, epNo])

  useEffect(() => {
    void reloadJobs()
  }, [reloadJobs])

  useEffect(() => {
    if (tab !== 'records' && summary.running === 0) return
    const t = window.setInterval(() => void reloadJobs(), 3000)
    return () => window.clearInterval(t)
  }, [tab, summary.running, reloadJobs])

  // ---- 配置保存（防抖） ----
  const persist = useCallback(
    (next: DeliverableConfig) => {
      if (!active) return
      if (saveTimer.current) window.clearTimeout(saveTimer.current)
      saveTimer.current = window.setTimeout(async () => {
        try {
          const saved = await saveDeliverableConfig(active.id, next)
          setDeliverables((list) => list.map((d) => (d.id === saved.id ? saved : d)))
        } catch (e) {
          onToast((e as Error).message)
        }
      }, 500)
    },
    [active, onToast],
  )

  const patchConfig = useCallback(
    (patch: Partial<DeliverableConfig>) => {
      setConfig((cur) => {
        const next = { ...cur, ...patch }
        persist(next)
        return next
      })
    },
    [persist],
  )

  const patchTarget = useCallback(
    (platformId: string, patch: Partial<DeliverableConfig['targets'][string]>) => {
      setConfig((cur) => {
        const prev = cur.targets[platformId] || { selected: false, accountId: '', mode: 'draft' as PublishMode, override: null }
        const next = { ...cur, targets: { ...cur.targets, [platformId]: { ...prev, ...patch } } }
        persist(next)
        return next
      })
    },
    [persist],
  )

  const selectedTargets = useMemo(
    () =>
      Object.entries(config.targets)
        .filter(([, t]) => t.selected)
        .map(([platform]) => {
          const t = config.targets[platform]
          return { platform, accountId: t.accountId, mode: t.mode }
        }),
    [config.targets],
  )

  const requiredAspects = useMemo(() => {
    const set = new Set<CoverAspect>()
    for (const t of selectedTargets) {
      const p = platforms.find((x) => x.id === t.platform)
      for (const a of p?.coverAspects || []) if (a === '9:16' || a === '16:9') set.add(a)
    }
    return [...set]
  }, [selectedTargets, platforms])

  // ---- 预检（配置变化后防抖） ----
  const runCheck = useCallback(async () => {
    if (!active) return
    if (!selectedTargets.length) {
      setPreflight({ ok: false, blocking: [], warnings: [], issues: [] })
      return
    }
    setChecking(true)
    try {
      const r = await runPreflight({ deliverableId: active.id, targets: selectedTargets, config })
      setPreflight(r)
    } catch (e) {
      onToast((e as Error).message)
    } finally {
      setChecking(false)
    }
  }, [active, selectedTargets, config, onToast])

  useEffect(() => {
    if (!active) return
    const t = window.setTimeout(() => void runCheck(), 450)
    return () => window.clearTimeout(t)
  }, [active?.id, selectedTargets, config.master, config.cover, config.targets, runCheck]) // eslint-disable-line react-hooks/exhaustive-deps

  // ---- 导入成片 ----
  const doImport = useCallback(
    async (file: File | null) => {
      if (!file || !projectName) return
      setBusy(true)
      try {
        const d = await importDeliverable(projectName, epNo, file)
        setDeliverables((list) => [d, ...list])
        setActiveId(d.id)
        onToast(`已导入成片 v${d.version}`)
      } catch (e) {
        onToast((e as Error).message)
      } finally {
        setBusy(false)
      }
    },
    [projectName, epNo, onToast],
  )

  // ---- 提交 ----
  const submit = useCallback(
    async (mode: PublishMode) => {
      if (!active) return
      if (!selectedTargets.length) {
        onToast('至少选择一个发布平台')
        return
      }
      if (mode === 'package') {
        setBusy(true)
        try {
          const pkg = await buildPackage({
            deliverableId: active.id,
            platforms: selectedTargets.map((t) => t.platform),
            config,
          })
          onToast(`发布包已生成：${pkg.zipUrl || pkg.dirUrl}`)
          setTab('records')
        } catch (e) {
          onToast((e as Error).message)
        } finally {
          setBusy(false)
        }
        return
      }
      if (mode === 'publish') {
        setConfirmOpen(true)
        return
      }
      // 保存草稿
      setBusy(true)
      try {
        const made = await createJobs({
          deliverableId: active.id,
          targets: selectedTargets.map((t) => ({ ...t, mode: 'draft' })),
          config,
        })
        onToast(made.length ? `已提交 ${made.length} 个平台的草稿任务` : '任务已存在，未重复提交')
        setTab('records')
        await reloadJobs()
      } catch (e) {
        onToast((e as Error).message)
      } finally {
        setBusy(false)
      }
    },
    [active, selectedTargets, config, onToast, reloadJobs],
  )

  const confirmPublish = useCallback(async () => {
    if (!active) return
    setConfirmOpen(false)
    setBusy(true)
    try {
      const made = await createJobs({
        deliverableId: active.id,
        targets: selectedTargets.map((t) => ({ ...t, mode: 'publish' })),
        config,
      })
      onToast(made.length ? `已提交 ${made.length} 个平台的发布任务` : '任务已存在，未重复提交')
      setTab('records')
      await reloadJobs()
    } catch (e) {
      onToast((e as Error).message)
    } finally {
      setBusy(false)
    }
  }, [active, selectedTargets, config, onToast, reloadJobs])

  // ---- 回执操作 ----
  const openDrawer = useCallback(async (job: PublishJob) => {
    setDrawerJob(job)
    try {
      setDrawerJob(await getJob(job.id))
    } catch {
      /* 用列表里的数据兜底 */
    }
  }, [])

  const refreshAll = useCallback(async () => {
    await Promise.all([reloadJobs(), reloadDeliverables()])
  }, [reloadJobs, reloadDeliverables])

  const platformLabel = useCallback(
    (id: string) => platforms.find((p) => p.id === id)?.label || id,
    [platforms],
  )

  const toggleSection = useCallback((key: SectionKey) => {
    setCollapsed((cur) => {
      const next = new Set(cur)
      if (next.has(key)) next.delete(key)
      else next.add(key)
      return next
    })
  }, [])

  const blocking = preflight?.blocking ?? []
  const warnings = preflight?.warnings ?? []
  const canSubmit = Boolean(active) && selectedTargets.length > 0 && blocking.length === 0 && !busy

  const sectionStatus = (key: SectionKey): { done: boolean; issue: boolean; summary: string } => {
    if (key === 'targets') {
      const n = selectedTargets.length
      return {
        done: n > 0,
        issue: blocking.some((b) => ['targets', 'accounts', 'mode'].includes(b.field)),
        summary: n ? `${n} 个平台 · ${selectedTargets.filter((t) => config.targets[t.platform]?.accountId).length} 个已选账号` : '未选择',
      }
    }
    if (key === 'copy') {
      const t = config.master.title
      return {
        done: Boolean(t.trim()),
        issue: blocking.some((b) => b.field.startsWith('copy')),
        summary: t ? `${t.slice(0, 16)}${t.length > 16 ? '…' : ''}` : '未填写标题',
      }
    }
    if (key === 'cover') {
      const have = requiredAspects.filter((a) => config.cover[a])
      return {
        done: requiredAspects.length > 0 && have.length === requiredAspects.length,
        issue: blocking.some((b) => b.field.startsWith('cover')),
        summary: requiredAspects.length ? `${have.length}/${requiredAspects.length} 已准备` : '未选择平台',
      }
    }
    const modes = new Set(selectedTargets.map((t) => t.mode))
    return {
      done: selectedTargets.length > 0,
      issue: false,
      summary: modes.size === 1 ? modeLabel([...modes][0]) : '按平台不同',
    }
  }

  const body = () => {
    if (!projectName) {
      return (
        <div className="pb-empty">
          <b>先选择项目</b>
          发布台跟随顶栏当前项目；选好项目和集后才能看到成片。
        </div>
      )
    }
    if (loading) {
      return <div className="pb-empty">正在读取成片…</div>
    }
    if (tab === 'records') {
      return <PublishRecords jobs={jobs} platforms={platforms} onOpen={(j) => void openDrawer(j)} />
    }
    if (tab === 'accounts') {
      return (
        <AccountList
          accounts={accounts}
          platforms={platforms}
          onChanged={setAccounts}
          onToast={onToast}
        />
      )
    }
    if (!deliverables.length) {
      return (
        <div className="pb-empty">
          <b>当前集还没有成片</b>
          先在预览里导出成片，或直接导入一个已有的 MP4。
          <div className="pb-empty-acts">
            <button type="button" className="btn" onClick={() => fileRef.current?.click()} disabled={busy}>
              导入 MP4
            </button>
          </div>
        </div>
      )
    }
    if (!active) return <div className="pb-empty">选择左侧一条成片开始配置。</div>

    return (
      <>
        <div className="pb-section" data-section="targets">
          <button
            type="button"
            className={`pb-section-head`}
            aria-expanded={!collapsed.has('targets')}
            onClick={() => toggleSection('targets')}
          >
            <span className="pb-section-no">{sectionStatus('targets').done ? '✓' : '1'}</span>
            {SECTION_LABEL.targets}
            <span className="pb-section-sum">{sectionStatus('targets').summary}</span>
          </button>
          {!collapsed.has('targets') && (
            <div className="pb-section-body">
              <div className="pb-targets">
                {platforms.map((p) => {
                  const t = config.targets[p.id]
                  const on = Boolean(t?.selected)
                  const acc = accounts.find((a) => a.id === t?.accountId)
                  return (
                    <div className={`pb-target ${on ? '' : 'off'}`} key={p.id}>
                      <PlatformBadge platform={p.id} label={p.short} />
                      <div className="pb-target-main">
                        <label className="pb-target-name">
                          <input
                            type="checkbox"
                            checked={on}
                            onChange={(e) => {
                              const next = e.target.checked
                              const defaultAcc = accounts.find((a) => a.platform === p.id)
                              patchTarget(p.id, {
                                selected: next,
                                accountId: t?.accountId || defaultAcc?.id || '',
                              })
                            }}
                          />
                          {p.label}
                          {p.manualOnly ? <span className="pb-status unknown">仅手动</span> : null}
                          {!p.verified && !p.manualOnly ? <span className="pb-status unknown">未验证</span> : null}
                        </label>
                        <div className="pb-target-sub">
                          {p.notes}
                        </div>
                      </div>
                      <select
                        className="pb-input"
                        aria-label={`${p.label}账号`}
                        value={t?.accountId || ''}
                        disabled={!on}
                        onChange={(e) => patchTarget(p.id, { accountId: e.target.value })}
                        style={{ maxWidth: 160 }}
                      >
                        <option value="">选择账号</option>
                        {accounts
                          .filter((a) => a.platform === p.id)
                          .map((a) => (
                            <option key={a.id} value={a.id}>
                              {a.label || '默认账号'}（{a.status === 'connected' ? '已连接' : a.status === 'expired' ? '失效' : '未知'}）
                            </option>
                          ))}
                      </select>
                    </div>
                  )
                })}
              </div>
              <div className="pb-hint">
                没有账号？切到「平台账号」连接。未验证的平台只能保存草稿，不能直接公开发布。
              </div>
            </div>
          )}
        </div>

        <div className="pb-section" data-section="copy">
          <button
            type="button"
            className="pb-section-head"
            aria-expanded={!collapsed.has('copy')}
            onClick={() => toggleSection('copy')}
          >
            <span className="pb-section-no">{sectionStatus('copy').done ? '✓' : '2'}</span>
            {SECTION_LABEL.copy}
            <span className="pb-section-sum">{sectionStatus('copy').summary}</span>
          </button>
          {!collapsed.has('copy') && (
            <div className="pb-section-body">
              <div className="pb-field">
                <div className="pb-label">
                  主标题
                  <span className={`pb-count ${config.master.title.length > 30 ? 'over' : ''}`}>
                    {config.master.title.length}
                  </span>
                </div>
                <input
                  className="pb-input"
                  value={config.master.title}
                  placeholder="所有平台默认使用这个标题"
                  onChange={(e) =>
                    patchConfig({ master: { ...config.master, title: e.target.value } })
                  }
                />
              </div>
              <div className="pb-field">
                <div className="pb-label">
                  主简介
                  <span className="pb-count">{config.master.description.length}</span>
                </div>
                <textarea
                  className="pb-textarea"
                  value={config.master.description}
                  placeholder="成片简介；每个平台可单独覆写"
                  onChange={(e) =>
                    patchConfig({ master: { ...config.master, description: e.target.value } })
                  }
                />
              </div>
              <div className="pb-field">
                <div className="pb-label">
                  标签
                  <span className="pb-count">{config.master.tags.length}</span>
                </div>
                <TagEditor
                  tags={config.master.tags}
                  onChange={(tags) => patchConfig({ master: { ...config.master, tags } })}
                />
              </div>

              {selectedTargets.length > 0 && (
                <div className="pb-override">
                  <div className="pb-override-head">按平台微调</div>
                  {selectedTargets.map(({ platform }) => {
                    const p = platforms.find((x) => x.id === platform)
                    const t = config.targets[platform]
                    const ov = t?.override
                    const effective = copyFor(config, platform)
                    const over = Boolean(ov)
                    return (
                      <div className="pb-field" key={platform} data-override={platform}>
                        <div className="pb-label">
                          <PlatformBadge platform={platform} label={p?.short} />
                          {p?.label || platform}
                          <span className={`pb-count ${effective.title.length > (p?.limits.title || 999) ? 'over' : ''}`}>
                            {effective.title.length}/{p?.limits.title ?? '—'}
                          </span>
                          {over ? (
                            <button
                              type="button"
                              className="btn-mini"
                              onClick={() => patchTarget(platform, { override: null })}
                            >
                              恢复主文案
                            </button>
                          ) : null}
                        </div>
                        <input
                          className="pb-input"
                          value={effective.title}
                          placeholder={`继承主标题`}
                          onChange={(e) =>
                            patchTarget(platform, {
                              override: {
                                title: e.target.value,
                                description: ov?.description || '',
                                tags: ov?.tags || [],
                              },
                            })
                          }
                        />
                        {over ? <div className="pb-hint">该平台已覆写，主文案变化不会覆盖它。</div> : null}
                      </div>
                    )
                  })}
                </div>
              )}
            </div>
          )}
        </div>

        <div className="pb-section" data-section="cover">
          <button
            type="button"
            className="pb-section-head"
            aria-expanded={!collapsed.has('cover')}
            onClick={() => toggleSection('cover')}
          >
            <span className="pb-section-no">{sectionStatus('cover').done ? '✓' : '3'}</span>
            {SECTION_LABEL.cover}
            <span className="pb-section-sum">{sectionStatus('cover').summary}</span>
          </button>
          {!collapsed.has('cover') && (
            <div className="pb-section-body">
              {requiredAspects.length === 0 ? (
                <div className="pb-hint">先在上一步选择平台，才知道需要哪些比例的封面。</div>
              ) : (
                <CoverPicker
                  deliverable={active}
                  config={config}
                  aspects={requiredAspects}
                  onChange={patchConfig}
                  onToast={onToast}
                />
              )}
            </div>
          )}
        </div>

        <div className="pb-section" data-section="mode">
          <button
            type="button"
            className="pb-section-head"
            aria-expanded={!collapsed.has('mode')}
            onClick={() => toggleSection('mode')}
          >
            <span className="pb-section-no">4</span>
            {SECTION_LABEL.mode}
            <span className="pb-section-sum">{sectionStatus('mode').summary}</span>
          </button>
          {!collapsed.has('mode') && (
            <div className="pb-section-body">
              <div className="pb-field">
                <div className="pb-label">每个平台的方式</div>
                <div className="pb-targets">
                  {selectedTargets.map(({ platform }) => {
                    const p = platforms.find((x) => x.id === platform)
                    const t = config.targets[platform]
                    return (
                      <div className="pb-target" key={platform}>
                        <PlatformBadge platform={platform} label={p?.short} />
                        <div className="pb-target-main">
                          <div className="pb-target-name">{p?.label || platform}</div>
                          <div className="pb-target-sub">
                            {t?.mode === 'publish' && !p?.verified ? '适配器未验证，提交时会降级为草稿' : ''}
                          </div>
                        </div>
                        <select
                          className="pb-input"
                          value={t?.mode || 'draft'}
                          onChange={(e) => patchTarget(platform, { mode: e.target.value as PublishMode })}
                          style={{ maxWidth: 150 }}
                        >
                          <option value="draft">保存草稿</option>
                          <option value="publish">立即发布</option>
                          <option value="package">只导出发布包</option>
                        </select>
                      </div>
                    )
                  })}
                </div>
              </div>

              <label className="pb-check">
                <input
                  type="checkbox"
                  checked={config.master.aiGenerated}
                  onChange={(e) =>
                    patchConfig({ master: { ...config.master, aiGenerated: e.target.checked } })
                  }
                />
                本内容为 AI 生成，提交时会一并声明（平台合规要求）
              </label>

              <div className="pb-hint">
                自动草稿只上传到平台草稿箱，不会点最终发布；「立即发布」每次都会再确认一次。
              </div>
            </div>
          )}
        </div>
      </>
    )
  }

  return (
    <>
      <WorkbenchBar
        scope={
          <div className="viewtabs" role="tablist" aria-label="发布台页签">
            <button
              type="button"
              className={tab === 'pending' ? 'on' : ''}
              aria-selected={tab === 'pending'}
              onClick={() => setTab('pending')}
            >
              待发布
            </button>
            <button
              type="button"
              className={tab === 'records' ? 'on' : ''}
              aria-selected={tab === 'records'}
              onClick={() => setTab('records')}
            >
              发布记录{summary.total ? ` ${summary.total}` : ''}
            </button>
            <button
              type="button"
              className={tab === 'accounts' ? 'on' : ''}
              aria-selected={tab === 'accounts'}
              onClick={() => setTab('accounts')}
            >
              平台账号
            </button>
          </div>
        }
        scopeDetail={
          active
            ? `${fmtDur(active.duration)} · ${fmtRes(active.width, active.height)} · v${active.version}`
            : undefined
        }
        actions={
          <>
            {health && !health.browserAvailable ? (
              <span className="warn-chip" title="没有可用的本机 Chrome">
                自动发布不可用
              </span>
            ) : null}
            <input
              ref={fileRef}
              type="file"
              accept="video/mp4"
              hidden
              onChange={(e) => {
                void doImport(e.target.files?.[0] ?? null)
                e.target.value = ''
              }}
            />
            <button type="button" className="btn" onClick={() => fileRef.current?.click()} disabled={!projectName || busy}>
              导入成片
            </button>
          </>
        }
      />

      <div className="pb">
        <aside className="pb-rail" aria-label="成片列表">
          <div className="pb-rail-head">
            成片
            <span className="spacer" style={{ flex: 1 }} />
            <span>{deliverables.length}</span>
          </div>
          <div className="pb-rail-list">
            {deliverables.map((d) => (
              <button
                type="button"
                key={d.id}
                className={`pb-card ${d.id === activeId ? 'on' : ''}`}
                onClick={() => setActiveId(d.id)}
                aria-current={d.id === activeId ? 'true' : undefined}
              >
                <video className="pb-card-thumb" src={d.url} muted preload="metadata" />
                <span className="pb-card-main">
                  <span className="pb-card-title">
                    {d.title || `v${d.version}`} · v{d.version}
                  </span>
                  <span className="pb-card-meta">
                    {fmtDur(d.duration)} · {fmtRes(d.width, d.height)}
                  </span>
                  <span className="pb-card-meta">
                    {d.source === 'import' ? '导入' : '导出'} · {d.createdAt.slice(5, 16).replace('T', ' ')}
                  </span>
                  {d.autoDraftNote ? (
                    <span className="pb-card-meta" style={{ color: 'var(--warn)' }} title={d.autoDraftNote}>
                      自动草稿未排队
                    </span>
                  ) : null}
                </span>
              </button>
            ))}
            {!deliverables.length && <div className="pb-hint" style={{ padding: 8 }}>暂无成片</div>}
          </div>
        </aside>

        <main className="pb-main">{body()}</main>

        {tab === 'pending' && active ? (
          <aside className="pb-inspect" aria-label="发布检查">
            <div className="pb-inspect-head">
              发布检查
              <span className="spacer" style={{ flex: 1 }} />
              <button type="button" className="btn-mini" onClick={() => void runCheck()} disabled={checking}>
                {checking ? '检查中…' : '重新预检'}
              </button>
            </div>
            <div className="pb-inspect-body">
              {blocking.length === 0 && warnings.length === 0 ? (
                <div className="pb-ok-line">检查通过，可以提交</div>
              ) : null}
              {blocking.length > 0 && (
                <div className="pb-issue-group">
                  <div className="pb-issue-title">阻断（{blocking.length}）</div>
                  {blocking.map((b, i) => (
                    <IssueRow key={`b-${i}-${b.code}`} issue={b} onJump={() => jumpToIssue(b, (k) => setCollapsed((c) => { const n = new Set(c); n.delete(k); return n }))} />
                  ))}
                </div>
              )}
              {warnings.length > 0 && (
                <div className="pb-issue-group">
                  <div className="pb-issue-title">警告（{warnings.length}）</div>
                  {warnings.map((w, i) => (
                    <IssueRow key={`w-${i}-${w.code}`} issue={w} onJump={() => jumpToIssue(w, (k) => setCollapsed((c) => { const n = new Set(c); n.delete(k); return n }))} />
                  ))}
                </div>
              )}
              <div className="pb-hint">
                阻断项必须解决；警告可以确认后继续。平台「审核中」不等于已发布。
              </div>
            </div>
          </aside>
        ) : null}
      </div>

      {tab === 'pending' && active ? (
        <div className="pb-foot">
          <span className="pb-foot-plan">
            {selectedTargets.length} 个平台 · 草稿 {selectedTargets.filter((t) => t.mode === 'draft').length} · 立即{' '}
            {selectedTargets.filter((t) => t.mode === 'publish').length} · 发布包{' '}
            {selectedTargets.filter((t) => t.mode === 'package').length}
          </span>
          <span className="spacer" />
          <button type="button" className="btn" onClick={() => void submit('package')} disabled={!canSubmit}>
            导出发布包
          </button>
          <button
            type="button"
            className="btn primary"
            onClick={() => {
              const hasImmediate = selectedTargets.some((t) => t.mode === 'publish')
              void submit(hasImmediate ? 'publish' : 'draft')
            }}
            disabled={!canSubmit}
            title={blocking.length ? blocking[0].message : undefined}
          >
            {busy ? '提交中…' : `发布到 ${selectedTargets.length} 个平台`}
          </button>
        </div>
      ) : null}

      {confirmOpen ? (
        <div className="pb-modal-mask" role="dialog" aria-modal="true" aria-label="确认发布">
          <div className="pb-modal">
            <div className="pb-modal-head">确认发布</div>
            <div className="pb-modal-body">
              {selectedTargets.map((t) => (
                <div key={t.platform}>
                  <PlatformBadge platform={t.platform} /> {platformLabel(t.platform)} · {modeLabel(t.mode)} ·{' '}
                  {accounts.find((a) => a.id === t.accountId)?.label || '未选账号'}
                </div>
              ))}
              {warnings.length ? (
                <div className="pb-hint warn">
                  仍有 {warnings.length} 条警告：{warnings.slice(0, 3).map((w) => w.message).join('；')}
                </div>
              ) : null}
              <div className="pb-hint">确认后按上方方式逐平台提交；保存草稿不会公开，立即发布将进入平台审核。</div>
            </div>
            <div className="pb-modal-foot">
              <button type="button" className="btn" onClick={() => setConfirmOpen(false)}>
                取消
              </button>
              <button type="button" className="btn primary" onClick={() => void confirmPublish()}>
                确认发布
              </button>
            </div>
          </div>
        </div>
      ) : null}

      <PublishJobDrawer
        job={drawerJob}
        platformLabel={drawerJob ? platformLabel(drawerJob.platform) : ''}
        onClose={() => setDrawerJob(null)}
        onRetry={async (j) => {
          try {
            await retryJob(j.id)
            onToast('已重试该平台')
            setDrawerJob(null)
            await refreshAll()
          } catch (e) {
            onToast((e as Error).message)
          }
        }}
        onCancel={async (j) => {
          try {
            await cancelJob(j.id)
            onToast('已取消')
            setDrawerJob(null)
            await refreshAll()
          } catch (e) {
            onToast((e as Error).message)
          }
        }}
        onMarkPublished={async (j, workUrl) => {
          try {
            await markJobPublished(j.id, workUrl)
            onToast('已标记为已发布')
            setDrawerJob(null)
            await refreshAll()
          } catch (e) {
            onToast((e as Error).message)
          }
        }}
      />
    </>
  )
}

function modeLabel(mode: PublishMode): string {
  return mode === 'draft' ? '保存草稿' : mode === 'publish' ? '立即发布' : '发布包'
}

function jumpToIssue(issue: PreflightIssue, setOpen: (s: SectionKey) => void) {
  if (issue.field.startsWith('copy')) setOpen('copy')
  else if (issue.field.startsWith('cover')) setOpen('cover')
  else if (issue.field === 'mode' || issue.field === 'targets' || issue.field === 'accounts') setOpen('targets')
  else if (issue.field === 'ai') setOpen('mode')
  else setOpen('targets')
  // 滚动到对应区块
  window.setTimeout(() => {
    const key =
      issue.field.startsWith('copy')
        ? 'copy'
        : issue.field.startsWith('cover')
          ? 'cover'
          : issue.field === 'ai'
            ? 'mode'
            : 'targets'
    document.querySelector(`[data-section="${key}"]`)?.scrollIntoView({ block: 'start', behavior: 'smooth' })
  }, 60)
}

function IssueRow({ issue, onJump }: { issue: PreflightIssue; onJump: () => void }) {
  return (
    <button type="button" className={`pb-issue ${issue.level}`} onClick={onJump} title="定位到对应设置">
      <span className="pb-issue-dot" />
      <span>{issue.message}</span>
    </button>
  )
}

function TagEditor({ tags, onChange }: { tags: string[]; onChange: (next: string[]) => void }) {
  const [draft, setDraft] = useState('')
  const add = () => {
    const v = draft.trim()
    if (!v) return
    if (tags.includes(v)) {
      setDraft('')
      return
    }
    onChange([...tags, v].slice(0, 30))
    setDraft('')
  }
  return (
    <div className="pb-tags">
      {tags.map((t) => (
        <span className="pb-tag" key={t}>
          {t}
          <button
            type="button"
            aria-label={`移除标签 ${t}`}
            onClick={() => onChange(tags.filter((x) => x !== t))}
          >
            ×
          </button>
        </span>
      ))}
      <input
        className="pb-tag-add"
        value={draft}
        placeholder="+ 添加标签"
        onChange={(e) => setDraft(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Enter') {
            e.preventDefault()
            add()
          }
        }}
        onBlur={add}
      />
    </div>
  )
}
