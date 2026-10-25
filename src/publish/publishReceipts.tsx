import { useMemo, useState } from 'react'
import { makeAssistantToolUI } from '@assistant-ui/react'
import { ToolCard, type ToolCardStatus } from '@/chat-ui/tools/ToolCard'
import type { ConfigChange, PublishChatAdapter } from './publishChat'
import type { DeliverableConfig, PublishIntent, PublishMode } from './types'

type Rec = Record<string, unknown>

function rec(value: unknown): Rec {
  return value && typeof value === 'object' ? (value as Rec) : {}
}

const MODE_LABEL: Record<PublishMode, string> = {
  draft: '保存草稿',
  publish: '立即发布',
  package: '发布包',
}

const TOOL_LABEL: Record<string, string> = {
  read_publish_state: '发布概况',
  read_deliverables: '成片列表',
  read_config: '发布配置',
  read_accounts: '平台账号',
  read_platforms: '平台能力',
  read_preflight: '预检结果',
  read_jobs: '发布记录',
  set_targets: '平台选择',
  set_copy: '文案',
  set_mode: '发布方式',
  set_cover: '封面',
  stage_submit: '提交草稿',
  stage_package: '导出发布包',
  connect_account: '连接账号',
  ask_user: '待你确认',
}

/** 读工具压成一行，写工具升级成回执卡：读操作不该占版面 */
const READ_TOOLS = new Set([
  'read_publish_state',
  'read_deliverables',
  'read_config',
  'read_accounts',
  'read_platforms',
  'read_preflight',
  'read_jobs',
])

function statusOf(running: boolean, result: unknown): ToolCardStatus {
  const r = rec(result)
  if (running) return 'running'
  if (r.ok === false) return 'error'
  if (r.staged) return 'warn'
  if (Array.isArray(r.changes) && r.changes.length) return 'ok'
  if (r.ok === false) return 'error'
  return 'ok'
}

function ChangeList({ changes }: { changes: ConfigChange[] }) {
  const shown = changes.slice(0, 6)
  return (
    <ul data-receipt-changes className="flex flex-col gap-0.5">
      {shown.map((c, i) => (
        <li key={`${c.field}-${i}`} className="flex gap-1.5">
          <span className="min-w-0 truncate text-muted-foreground">{c.field}</span>
          <span className="shrink-0 text-muted-foreground">→</span>
          <span className="min-w-0 truncate">{c.to || '（空）'}</span>
        </li>
      ))}
      {changes.length > shown.length ? (
        <li className="text-muted-foreground">另有 {changes.length - shown.length} 处改动</li>
      ) : null}
    </ul>
  )
}

function ReadLine({ toolName, result }: { toolName: string; result: unknown }) {
  const r = rec(result)
  let detail = ''
  if (toolName === 'read_publish_state') detail = String(r.readinessText || '')
  else if (toolName === 'read_deliverables') detail = `${Number(r.total) || 0} 条成片`
  else if (toolName === 'read_config') detail = `${Array.isArray(r.selected) ? r.selected.length : 0} 个平台已选`
  else if (toolName === 'read_accounts') detail = `${Array.isArray(r.accounts) ? r.accounts.length : 0} 个账号`
  else if (toolName === 'read_platforms') detail = `${Array.isArray(r.platforms) ? r.platforms.length : 0} 个平台可用`
  else if (toolName === 'read_preflight') {
    detail = r.pending ? '等待预检' : `${Array.isArray(r.blocking) ? r.blocking.length : 0} 阻断 · ${Array.isArray(r.warnings) ? r.warnings.length : 0} 警告`
  } else if (toolName === 'read_jobs') detail = `${Number(r.total) || 0} 条任务`
  return (
    <div data-receipt="read" className="my-0.5 flex items-baseline gap-1.5 text-[11px] text-muted-foreground">
      <span className="shrink-0">已读 {TOOL_LABEL[toolName] || toolName}</span>
      {detail ? <span className="min-w-0 truncate">· {detail}</span> : null}
    </div>
  )
}

/** 一次写工具的完整回执：改了什么 + 撤销这一轮 */
function WriteReceipt({
  toolName,
  running,
  result,
  adapter,
}: {
  toolName: string
  running: boolean
  result: unknown
  adapter: PublishChatAdapter
}) {
  const r = rec(result)
  const changes = Array.isArray(r.changes) ? (r.changes as ConfigChange[]) : []
  const roundId = String(r.roundId || '')
  const [undone, setUndone] = useState(false)
  const [undoError, setUndoError] = useState('')
  const error = String(r.error || '')

  if (toolName === 'connect_account') {
    const ok = r.ok !== false
    return (
      <ToolCard tool={toolName} status={running ? 'running' : ok ? 'ok' : 'error'} title={running ? '正在打开登录窗口…' : ok ? '已打开登录窗口' : '无法连接'}>
        <div data-receipt="account">{String(r.message || (ok ? '请在浏览器里完成扫码' : '请稍后重试'))}</div>
      </ToolCard>
    )
  }

  const staged = Boolean(r.staged)
  const status = statusOf(running, result)
  const title = running
    ? `正在写入 ${TOOL_LABEL[toolName] || toolName}…`
    : staged
      ? '待你确认 · 还没有提交'
      : error
        ? `${TOOL_LABEL[toolName] || toolName}失败`
        : `已改 ${changes.length} 处，尚未提交`

  return (
    <ToolCard
      tool={toolName}
      status={status}
      title={title}
      aside={
        !running && changes.length && roundId && !staged ? (
          <button
            type="button"
            className="rounded border border-border px-1.5 py-0.5 text-[10px] text-muted-foreground hover:bg-muted hover:text-foreground disabled:opacity-50"
            disabled={undone}
            onClick={() => {
              const ok = adapter.undoRound(roundId)
              setUndone(ok)
              if (!ok) setUndoError('这一轮已无法撤销')
            }}
          >
            {undone ? '已撤销' : '撤销这一轮'}
          </button>
        ) : undefined
      }
    >
      {error ? (
        <div className="text-destructive">{error}</div>
      ) : staged ? (
        <div data-receipt="staged">已生成待确认卡；确认之前不会创建任何任务。</div>
      ) : changes.length ? (
        <ChangeList changes={changes} />
      ) : running ? null : (
        <div className="text-muted-foreground">没有需要改动的内容。</div>
      )}
      {undoError ? <div className="mt-1 text-destructive">{undoError}</div> : null}
    </ToolCard>
  )
}

/** 澄清卡：选项点击即作为下一条用户消息发送 */
function AskUserCard({
  result,
  onPick,
}: {
  result: unknown
  onPick?: (value: string) => void
}) {
  const r = rec(result)
  const options = Array.isArray(r.options) ? (r.options as { value: string; label: string }[]) : []
  return (
    <ToolCard tool="ask_user" status="warn" title={String(r.question || '需要你确认')}>
      <div data-receipt="ask" className="flex flex-wrap gap-1.5">
        {options.map((o) => (
          <button
            key={o.value}
            type="button"
            className="rounded-full border border-border bg-secondary px-2 py-0.5 text-[11px] text-secondary-foreground hover:bg-muted"
            onClick={() => onPick?.(o.value)}
          >
            {o.label}
          </button>
        ))}
      </div>
    </ToolCard>
  )
}

export function PublishToolUis({
  adapter,
  onPickOption,
}: {
  adapter: PublishChatAdapter
  onPickOption?: (value: string) => void
}) {
  const names = useMemo(() => Object.keys(TOOL_LABEL), [])
  const uis = useMemo(
    () =>
      names.map((toolName) =>
        makeAssistantToolUI({
          toolName,
          render: ({ status, result }) => {
            const running = status.type === 'running'
            if (running && !result) {
              if (READ_TOOLS.has(toolName)) {
                return <div data-receipt="read-running" className="my-0.5 text-[11px] text-muted-foreground">正在读取 {TOOL_LABEL[toolName]}…</div>
              }
              return <ToolCard tool={toolName} status="running" title={`正在执行 ${TOOL_LABEL[toolName]}…`} />
            }
            if (READ_TOOLS.has(toolName)) return <ReadLine toolName={toolName} result={result} />
            if (toolName === 'ask_user') return <AskUserCard result={result} onPick={onPickOption} />
            return <WriteReceipt toolName={toolName} running={running} result={result} adapter={adapter} />
          },
        }),
      ),
    [names, adapter, onPickOption],
  )
  return (
    <>
      {uis.map((Ui, i) => (
        <Ui key={`${names[i]}-${i}`} />
      ))}
    </>
  )
}

/** 卡片与当前配置的差异：用于提前告诉用户「这份待确认已过期」 */
export function intentStaleFields(intentConfig: DeliverableConfig, current: DeliverableConfig): string[] {
  const out: string[] = []
  const a = intentConfig?.master || ({} as DeliverableConfig['master'])
  const b = current?.master || ({} as DeliverableConfig['master'])
  if (String(a.title || '') !== String(b.title || '')) out.push('主标题')
  if (String(a.description || '') !== String(b.description || '')) out.push('主简介')
  if (JSON.stringify(a.tags || []) !== JSON.stringify(b.tags || [])) out.push('标签')
  if (Boolean(a.aiGenerated) !== Boolean(b.aiGenerated)) out.push('AI 声明')

  const ca = intentConfig?.cover || {}
  const cb = current?.cover || {}
  const keys = new Set([...Object.keys(ca), ...Object.keys(cb)])
  for (const k of keys) {
    if (String((ca as Rec)[k] || '') !== String((cb as Rec)[k] || '')) {
      out.push(`${k} 封面`)
      break
    }
  }

  const ta = intentConfig?.targets || {}
  const tb = current?.targets || {}
  const ids = new Set([...Object.keys(ta), ...Object.keys(tb)])
  for (const id of ids) {
    const x = ta[id]
    const y = tb[id]
    if (Boolean(x?.selected) !== Boolean(y?.selected)) {
      out.push(`${id} 是否选中`)
      break
    }
    if (String(x?.accountId || '') !== String(y?.accountId || '')) {
      out.push(`${id} 账号`)
      break
    }
    if (String(x?.mode || '') !== String(y?.mode || '')) {
      out.push(`${id} 发布方式`)
      break
    }
    if (JSON.stringify(x?.override || null) !== JSON.stringify(y?.override || null)) {
      out.push(`${id} 覆写`)
      break
    }
  }
  return out
}

/**
 * 预检回执：逐条列出阻断与警告，点条目跳到对应区块。
 * 与发布检查面板用的是同一份 issue 数据，不重新判断。
 */
export function PreflightReceipt({
  result,
  onJump,
}: {
  result: { ok?: boolean; blocking?: PreflightIssueLike[]; warnings?: PreflightIssueLike[] } | null
  onJump?: (field: string) => void
}) {
  if (!result) return null
  const blocking = result.blocking || []
  const warnings = result.warnings || []
  const status: ToolCardStatus = blocking.length ? 'error' : warnings.length ? 'warn' : 'ok'
  return (
    <ToolCard
      tool="read_preflight"
      status={status}
      title={
        blocking.length
          ? `预检未通过 · 阻断 ${blocking.length}`
          : warnings.length
            ? `预检通过 · 警告 ${warnings.length}`
            : '预检通过'
      }
    >
      <ul data-receipt="preflight" className="flex flex-col gap-0.5">
        {[...blocking, ...warnings].slice(0, 6).map((it, i) => (
          <li key={`${it.code}-${i}`}>
            <button
              type="button"
              className="w-full text-left hover:underline"
              onClick={() => onJump?.(it.field)}
              title={it.field}
            >
              <span className={it.level === 'block' ? 'text-destructive' : 'text-[var(--warn)]'}>
                {it.level === 'block' ? '阻断' : '警告'}
              </span>{' '}
              {it.message}
            </button>
          </li>
        ))}
        {blocking.length + warnings.length > 6 ? (
          <li className="text-muted-foreground">另有 {blocking.length + warnings.length - 6} 条</li>
        ) : null}
      </ul>
    </ToolCard>
  )
}

type PreflightIssueLike = { level?: string; code: string; target?: string; field: string; message: string }

/**
 * 待办回执：还差几步才能提交。用于助手说「还差什么」时给一个可点的清单。
 */
export function TodoReceipt({
  items,
  onJump,
}: {
  items: { label: string; detail: string; field?: string }[]
  onJump?: (field: string) => void
}) {
  if (!items.length) return null
  return (
    <ToolCard tool="todo" status="warn" title={`还差 ${items.length} 步才能提交`}>
      <ol data-receipt="todo" className="flex flex-col gap-0.5">
        {items.map((it, i) => (
          <li key={`${it.label}-${i}`}>
            <button type="button" className="w-full text-left hover:underline" onClick={() => it.field && onJump?.(it.field)}>
              {i + 1}. {it.label}
              {it.detail ? <span className="text-muted-foreground"> · {it.detail}</span> : null}
            </button>
          </li>
        ))}
      </ol>
      <div className="mt-1 text-muted-foreground">点条目可以直接跳到对应区块。</div>
    </ToolCard>
  )
}

/**
 * 交接回执：助手把「准备完了」交给用户。
 * 按钮只做定位，不代替点击。
 */
export function HandoffReceipt({
  summary,
  onLocate,
}: {
  summary: string
  onLocate?: () => void
}) {
  return (
    <ToolCard
      tool="handoff"
      status="ok"
      title="已准备好，交给你确认发布"
      aside={
        onLocate ? (
          <button
            type="button"
            className="rounded border border-border px-1.5 py-0.5 text-[10px] text-muted-foreground hover:bg-muted hover:text-foreground"
            onClick={onLocate}
          >
            定位到发布按钮
          </button>
        ) : undefined
      }
    >
      <div data-receipt="handoff">{summary}</div>
      <div className="mt-1 text-muted-foreground">最终发布只有你能点；助手不会代按。</div>
    </ToolCard>
  )
}

/**
 * 任务回执：四段步进器。
 * 后端只有 state + stage，没有百分比，所以只标「已完成 / 当前 / 未开始」，
 * 不画假进度条。
 */
const JOB_STEPS = [
  { key: 'opening', label: '打开后台' },
  { key: 'uploading', label: '上传视频' },
  { key: 'metadata', label: '填写文案' },
  { key: 'draft', label: '保存草稿' },
] as const

const TERMINAL_LABEL: Record<string, string> = {
  awaiting_confirmation: '待你到平台确认发布',
  submitted: '平台审核中',
  published: '已发布',
  failed: '失败',
  expired: '登录失效',
  cancelled: '已取消',
  unknown: '状态未知',
}

function stepIndex(stage: string): number {
  const i = JOB_STEPS.findIndex((s) => s.key === stage)
  return i < 0 ? (stage === 'confirm' || stage === 'published' ? JOB_STEPS.length : 0) : i
}

export function JobProgressReceipt({
  jobs,
  platformLabel,
}: {
  jobs: {
    id: string
    platform: string
    state: string
    stage: string
    mode: string
    errorMessage: string
    payload?: { source?: string }
  }[]
  platformLabel: (id: string) => string
}) {
  if (!jobs.length) return null
  return (
    <section data-receipt="job" aria-label="发布任务进度" className="mx-2 mb-1 shrink-0 rounded-md border border-border bg-background p-2 text-[11px] leading-relaxed">
      <div className="flex items-center gap-1.5">
        <span className="size-1.5 rounded-full bg-[var(--accent)]" aria-hidden="true" />
        <b className="text-foreground">任务进度</b>
        <span className="text-muted-foreground">{jobs.length} 个平台</span>
      </div>
      <ul className="mt-1 flex flex-col gap-1">
        {jobs.map((j) => {
          const done = j.state === 'published'
          const failed = ['failed', 'expired', 'unknown', 'rejected'].includes(j.state)
          const active = ['queued', 'uploading', 'awaiting_user'].includes(j.state)
          const idx = stepIndex(j.stage)
          return (
            <li key={j.id} data-job-state={j.state}>
              <div className="flex gap-1.5">
                <span className="w-14 shrink-0 truncate">{platformLabel(j.platform)}</span>
                <span className={failed ? 'text-destructive' : done ? 'text-[var(--ok)]' : 'text-muted-foreground'}>
                  {failed && j.errorMessage
                    ? j.errorMessage
                    : active
                      ? `进行中 · ${JOB_STEPS[idx]?.label || j.stage || '处理中'}`
                      : TERMINAL_LABEL[j.state] || j.state}
                </span>
              </div>
              <ol className="mt-0.5 flex gap-1.5 text-[10px] text-muted-foreground">
                {JOB_STEPS.map((s, i) => {
                  const mark = done || i < idx ? '✓' : i === idx && (active || j.state === 'awaiting_confirmation') ? '>' : '·'
                  return (
                    <li key={s.key} data-step={s.key} className={i === idx && active ? 'text-foreground' : undefined}>
                      {mark} {s.label}
                    </li>
                  )
                })}
              </ol>
            </li>
          )
        })}
      </ul>
      <div className="mt-1 text-muted-foreground">草稿保存在平台后台；公开发布需要你自己去点。</div>
    </section>
  )
}

/**
 * 待确认卡：这份提交的唯一定义。
 * 确认按钮是次级样式——页面唯一主色按钮是底部那个。
 */
export function PendingIntentCard({
  intent,
  platforms,
  accounts,
  currentConfig,
  submitting,
  disabledReason,
  onConfirm,
  onCancel,
  onRegenerate,
}: {
  intent: PublishIntent
  platforms: { id: string; label: string }[]
  accounts: { id: string; label: string }[]
  currentConfig: DeliverableConfig
  submitting?: boolean
  disabledReason?: string
  onConfirm: () => void
  onCancel: () => void
  onRegenerate?: () => void
}) {
  const stale = useMemo(() => intentStaleFields(intent.config, currentConfig), [intent.config, currentConfig])
  const ended = intent.state !== 'staged'
  const blocked = Boolean(disabledReason) || ended || stale.length > 0
  const pre = (intent.preflight || {}) as { ok?: boolean; blocking?: unknown[]; warnings?: unknown[] }
  const labelOf = (id: string) => platforms.find((p) => p.id === id)?.label || id
  const accountOf = (id: string) => accounts.find((a) => a.id === id)?.label || (id ? '未知账号' : '未选账号')

  return (
    <section
      data-pending-intent
      data-state={ended ? intent.state : stale.length ? 'stale' : 'staged'}
      aria-label="待确认提交"
      className="mx-2 mb-1 shrink-0 rounded-md border border-[var(--warn)]/50 bg-[var(--warn-dim)] p-2 text-[11px] leading-relaxed"
    >
      <div className="flex items-center gap-1.5">
        <span aria-hidden="true" className="font-mono text-[var(--warn)]">!</span>
        <b className="text-foreground">
          {ended
            ? intent.state === 'confirmed'
              ? '已确认并提交'
              : intent.state === 'cancelled'
                ? '已取消'
                : '已过期'
            : `待你确认 · ${intent.targets.length} 个平台`}
        </b>
      </div>

      <ul className="mt-1 flex flex-col gap-0.5">
        {intent.targets.map((t) => (
          <li key={t.platform} className="flex gap-1.5">
            <span className="w-16 shrink-0 truncate">{labelOf(t.platform)}</span>
            <span className="min-w-0 flex-1 truncate text-muted-foreground">{accountOf(t.accountId)}</span>
            <span className="shrink-0 text-muted-foreground">{MODE_LABEL[t.mode]}</span>
          </li>
        ))}
      </ul>

      <div className="mt-1 text-muted-foreground">
        封面 {Object.keys(intent.config.cover || {}).join(' / ') || '未准备'} · 预检{' '}
        {pre.ok === false ? `${pre.blocking?.length || 0} 条阻断` : '通过'}
        {pre.warnings?.length ? `（${pre.warnings.length} 条警告）` : ''}
      </div>

      <div data-intent-promise className="mt-1 text-muted-foreground">
        只会保存草稿或导出发布包，不会公开发布；公开发布要在平台后台由你自己点。
      </div>

      {stale.length ? (
        <div data-intent-stale className="mt-1 text-destructive">
          配置已变（{stale.join('、')}），这份待确认已过期。
        </div>
      ) : null}
      {disabledReason && !stale.length ? <div className="mt-1 text-[var(--warn)]">{disabledReason}</div> : null}

      <div className="mt-2 flex items-center gap-2">
        <button
          type="button"
          className="rounded border border-border px-2 py-1 text-[11px] hover:bg-muted"
          onClick={onCancel}
          disabled={submitting || ended}
        >
          取消
        </button>
        {stale.length && onRegenerate ? (
          <button
            type="button"
            className="rounded border border-border px-2 py-1 text-[11px] hover:bg-muted"
            onClick={onRegenerate}
            disabled={submitting}
          >
            按最新配置重新生成
          </button>
        ) : null}
        <span className="ml-auto" />
        <button
          type="button"
          data-confirm-intent
          className="rounded border border-[var(--accent-line)] bg-[var(--accent-dim)] px-2 py-1 text-[11px] text-[var(--accent)] hover:brightness-110 disabled:cursor-not-allowed disabled:opacity-50"
          onClick={onConfirm}
          disabled={blocked || Boolean(submitting)}
          title={stale.length ? '配置已变，请重新生成' : disabledReason || undefined}
        >
          {submitting ? '提交中…' : '确认提交'}
        </button>
      </div>
    </section>
  )
}
