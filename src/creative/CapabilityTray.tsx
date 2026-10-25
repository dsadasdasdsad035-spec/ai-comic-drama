import { useMemo, useState } from 'react'
import type { AppSettings, Cap } from '../api'
import { modelHasCap, isRunnableModel, modelCapsLabel } from '../modelCaps'
import type { CreativeSettings } from './settings'

const CAP_ORDER: Array<{ cap: Cap; label: string; action?: string }> = [
  { cap: 'vision', label: '视觉理解', action: '逐镜看证据帧' },
  { cap: 'videoVision', label: '视频理解', action: '公网视频直读' },
  { cap: 'image', label: '生图', action: '生成首帧' },
  { cap: 'view', label: '三视图', action: '角色多视图' },
  { cap: 'video', label: '生视频', action: '生成复刻片段' },
  { cap: 'videoRef', label: '视频参考', action: '带参考视频出片' },
  { cap: 'audio', label: '配音', action: '台词转语音' },
]

/**
 * 能力托盘：每类能力显示当前绑定的模型与就绪原因。
 * 不为了好看隐藏不可用项 —— 缺失本身就是需要用户看到的信息。
 */
export function CapabilityTray({
  settings,
  creative,
  onChange,
}: {
  settings: AppSettings | null
  creative: CreativeSettings
  onChange: (models: NonNullable<CreativeSettings['models']>) => void
}) {
  const [open, setOpen] = useState(false)
  const rows = useMemo(() => {
    return CAP_ORDER.map(({ cap, label, action }) => {
      const bound = creative.models?.[cap] || ''
      const list = (settings?.models ?? []).filter(
        (m) => (modelHasCap(m, cap) || (cap === 'videoRef' && m.supportsVideoRef)) && isRunnableModel(m),
      )
      const entry = bound ? list.find((m) => m.key === bound) : list.find((m) => m.key === settings?.defaults?.[cap])
      const fallback = entry || list[0]
      const status = bound && !list.some((m) => m.key === bound)
        ? ('missing' as const)
        : fallback
          ? ('ready' as const)
          : ('none' as const)
      return {
        cap,
        label,
        action,
        bound,
        list,
        entry: fallback,
        status,
        problem:
          status === 'missing'
            ? `绑定的模型不可用（${bound}）`
            : status === 'none'
              ? `未配置${label}模型`
              : '',
      }
    })
  }, [settings, creative.models])

  const readyCount = rows.filter((r) => r.status === 'ready').length
  const problems = rows.filter((r) => r.status !== 'ready')

  return (
    <div data-creative-capability-tray className="relative shrink-0">
      <button
        type="button"
        data-creative-action="toggle-capabilities"
        className="rounded border border-border px-1.5 py-0.5 text-[10px] text-muted-foreground hover:bg-muted hover:text-foreground"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        title="各能力绑定的模型"
      >
        能力 {readyCount}/{rows.length}
        {problems.length ? <span className="ml-1 text-[var(--warn)]">·{problems.length}</span> : null}
      </button>
      {open ? (
        <div
          data-creative-capability-panel
          className="absolute right-0 top-full z-40 mt-1 w-[300px] rounded border border-border bg-background p-2 shadow-lg"
          role="dialog"
          aria-label="能力与模型绑定"
        >
          <div className="mb-1 flex items-center justify-between">
            <b className="text-[11px]">能力与模型</b>
            <button
              type="button"
              className="rounded border border-border px-1 text-[9px] hover:bg-muted"
              onClick={() => onChange({})}
              title="清空创意会话的覆盖，全部跟随全局默认"
            >
              全部跟随全局
            </button>
          </div>
          <p className="mb-1.5 text-[9px] leading-relaxed text-muted-foreground">
            只影响创意会话，不改全站默认路由。
          </p>
          <div className="max-h-[320px] space-y-1 overflow-y-auto">
            {rows.map((row) => (
              <div key={row.cap} data-cap-row={row.cap} data-status={row.status} className="rounded border border-border/60 p-1">
                <div className="flex items-center justify-between gap-1">
                  <span className="text-[10px] font-medium">{row.label}</span>
                  <span
                    className={
                      row.status === 'ready'
                        ? 'text-[9px] text-[var(--ok)]'
                        : row.status === 'missing'
                          ? 'text-[9px] text-destructive'
                          : 'text-[9px] text-[var(--warn)]'
                    }
                  >
                    {row.status === 'ready' ? '就绪' : row.status === 'missing' ? '绑定失效' : '未绑定'}
                  </span>
                </div>
                <select
                  value={row.bound}
                  className="mt-0.5 w-full rounded border border-border bg-background px-1 py-0.5 text-[10px]"
                  onChange={(e) => {
                    const next = { ...(creative.models || {}) }
                    if (e.target.value) next[row.cap] = e.target.value
                    else delete next[row.cap]
                    onChange(next)
                  }}
                >
                  <option value="">跟随全局 · {row.entry?.model || settings?.defaults?.[row.cap] || '未配置'}</option>
                  {row.list.map((m) => (
                    <option key={m.key} value={m.key}>
                      {m.label} · {m.model}（{modelCapsLabel(m)}）
                    </option>
                  ))}
                </select>
                {row.problem ? (
                  <p className="mt-0.5 text-[9px] leading-snug text-destructive">{row.problem}</p>
                ) : (
                  <p className="mt-0.5 text-[9px] leading-snug text-muted-foreground">{row.action}</p>
                )}
              </div>
            ))}
          </div>
        </div>
      ) : null}
    </div>
  )
}
