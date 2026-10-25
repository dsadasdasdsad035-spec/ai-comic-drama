import type { Readiness, ReadinessItem } from './publishChat'

const MARK: Record<ReadinessItem['state'], string> = {
  ok: '✓',
  warn: '!',
  danger: '!',
  'not-applicable': '·',
}

/**
 * 准备度条：五格回答「离能提交还差什么」。
 * 数据来自实际配置 + 账号 + 预检，不做第二套估算。
 */
export default function ReadinessBar({
  readiness,
  disabled,
  onJump,
}: {
  readiness: Readiness
  disabled?: boolean
  onJump?: (key: ReadinessItem['key']) => void
}) {
  return (
    <div
      data-publish-readiness
      role="group"
      aria-label={`准备度 ${readiness.done}/${readiness.total}`}
      className="flex shrink-0 flex-wrap items-center gap-x-1.5 gap-y-1 border-b border-border/60 px-3 py-1.5 text-[11px]"
    >
      <span className="shrink-0 text-muted-foreground">
        准备度 <b className="text-foreground">{readiness.done}/{readiness.total}</b>
      </span>
      {readiness.items.map((item) => (
        <button
          key={item.key}
          type="button"
          data-readiness={item.key}
          data-state={item.state}
          title={item.detail}
          disabled={disabled || item.state === 'not-applicable'}
          onClick={() => onJump?.(item.key)}
          className="inline-flex max-w-full items-center gap-1 rounded border border-border bg-background px-1.5 py-0.5 text-[10px] text-foreground disabled:cursor-default disabled:opacity-50"
        >
          <span aria-hidden="true" className="font-mono text-[10px] text-muted-foreground">
            {MARK[item.state]}
          </span>
          <span>{item.label}</span>
          {item.state !== 'ok' && item.state !== 'not-applicable' ? (
            <span className="truncate text-muted-foreground">· {item.detail}</span>
          ) : null}
        </button>
      ))}
    </div>
  )
}
