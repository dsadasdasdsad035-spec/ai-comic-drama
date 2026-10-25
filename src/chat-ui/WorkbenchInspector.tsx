import { useState } from 'react'
import { cn } from '@/chat-ui/lib/utils'
import type { WorkbenchProfile, WorkbenchTaskView } from '../agent/workbenchChat'

const READ_LABELS: Record<string, string> = {
  read_source: '原著',
  read_episodes: '分集',
  read_script: '剧本',
  read_characters: '角色表',
  read_episode: '本集',
  read_shots: '镜头表',
  read_designs: '场景/道具',
}

const TABS = [
  ['overview', '概览'],
  ['system', '系统提示'],
  ['task', '本轮任务'],
  ['data', '带入数据'],
  ['read', '读取权限'],
] as const

type Tab = (typeof TABS)[number][0]

const SAVE_LABEL: Record<WorkbenchTaskView['saveMode'], string> = {
  explicit: '显式保存（在左侧点保存）',
  auto: '自动保存（角色表约 1 秒后落库）',
  immediate: '立即落库',
}

function textLength(value: unknown): number {
  if (value == null) return 0
  if (typeof value === 'string') return value.length
  try {
    return JSON.stringify(value).length
  } catch {
    return String(value).length
  }
}

function formatValue(value: unknown): string {
  if (typeof value === 'string') {
    const trimmed = value.trim()
    if (trimmed.startsWith('{') || trimmed.startsWith('[')) {
      try {
        return JSON.stringify(JSON.parse(trimmed), null, 2)
      } catch {
        /* 不是合法 JSON，按原文显示 */
      }
    }
    return value
  }
  try {
    return JSON.stringify(value, null, 2)
  } catch {
    return String(value)
  }
}

/**
 * 本轮发送内容：先回答“助手/模型/输入/规模/只读”，再提供原始提示和读取权限。
 * 全高覆盖在聊天面板内，不挤压对话，也不挡工作台。
 */
export function WorkbenchInspector({
  view,
  profile,
  onClose,
  onToast,
}: {
  view: WorkbenchTaskView
  profile: WorkbenchProfile
  onClose: () => void
  onToast?: (message: string) => void
}) {
  const [tab, setTab] = useState<Tab>('overview')
  const total = view.system.length + view.task.length
  const tokens = Math.ceil(total / 1.5)
  const sourceLabel = view.skillSource === 'override' ? '用户覆盖' : '内置'

  const copy = async (text: string) => {
    try {
      await navigator.clipboard.writeText(text)
      onToast?.('已复制')
    } catch {
      onToast?.('复制失败，请手动选择文本')
    }
  }

  return (
    <section
      id="workbench-chat-inspector"
      data-chat-inspector
      aria-label="本轮发送内容"
      className="skill-chat-inspect flex min-h-0 flex-1 flex-col bg-background text-foreground"
    >
      <header className="flex shrink-0 items-center justify-between border-b border-border px-3 py-2">
        <b className="text-[13px]">本轮发送内容</b>
        <button
          type="button"
          className="rounded border border-border px-1.5 py-0.5 text-[10px] text-muted-foreground hover:bg-muted hover:text-foreground"
          onClick={onClose}
          aria-label="关闭检查器"
        >
          关闭
        </button>
      </header>

      <div
        role="tablist"
        aria-label="本轮发送内容分区"
        className="flex shrink-0 gap-1 overflow-x-auto border-b border-border px-2 py-1.5"
      >
        {TABS.map(([id, label]) => (
          <button
            key={id}
            type="button"
            role="tab"
            onClick={() => setTab(id)}
            aria-selected={tab === id}
            className={cn(
              'shrink-0 rounded px-1.5 py-0.5 text-[11px]',
              tab === id
                ? 'bg-primary/10 text-primary'
                : 'text-muted-foreground hover:bg-muted hover:text-foreground',
            )}
          >
            {label}
          </button>
        ))}
      </div>

      <div
        role="tabpanel"
        aria-label={TABS.find(([id]) => id === tab)?.[1]}
        className="min-h-0 flex-1 overflow-y-auto px-3 py-2 text-[12px] leading-relaxed"
      >
        {tab === 'overview' && (
          <>
            <div className="grid grid-cols-[56px_minmax(0,1fr)] gap-x-2 gap-y-1.5">
              <span className="text-muted-foreground">助手</span>
              <span>
                {view.skillTitle}{' '}
                <span className="text-muted-foreground">
                  ({view.skillId} v{view.skillVersion} · {sourceLabel})
                </span>
              </span>
              <span className="text-muted-foreground">模型</span>
              <span>{view.modelLabel}</span>
              <span className="text-muted-foreground">保存</span>
              <span>{SAVE_LABEL[view.saveMode]}</span>
              <span className="text-muted-foreground">规模</span>
              <span>
                {total.toLocaleString()} 字 · 约 {tokens.toLocaleString()} tokens
                {total > 12000 && <span className="ml-1 text-[var(--warn)]">（较大，建议拆小范围）</span>}
              </span>
              <span className="text-muted-foreground">只读</span>
              <span>
                {view.readonly.length
                  ? view.readonly.map((s) => `${s.id} v${s.version}`).join('、')
                  : '无'}
              </span>
            </div>

            {view.missing.length > 0 && (
              <div className="mt-2 rounded border border-destructive/40 bg-destructive/5 px-2 py-1 text-[11px] text-destructive">
                缺少必需输入：{view.missing.join('、')}；发送会被阻止。
              </div>
            )}

            <div className="mt-3 text-[11px] text-muted-foreground">本轮输入</div>
            <div className="mt-1 space-y-1">
              {Object.entries(view.inputs).map(([key, value]) => {
                const chars = textLength(value)
                const reference = view.references.some((r) => r.key === key)
                const missing = view.missing.includes(key)
                return (
                  <div
                    key={key}
                    className="flex flex-wrap items-center gap-1.5 rounded border border-border/60 px-2 py-1"
                  >
                    <code className="text-[10px] text-muted-foreground">{key}</code>
                    <span className="text-[11px]">{profile.inputLabels[key] || key}</span>
                    <span className="text-[10px] text-muted-foreground">{chars} 字</span>
                    <span
                      className={cn(
                        'rounded px-1 text-[10px]',
                        reference
                          ? 'bg-primary/10 text-primary'
                          : 'bg-muted text-muted-foreground',
                      )}
                    >
                      {reference ? '按范围读取' : '内联'}
                    </span>
                    {missing && <span className="text-[10px] text-destructive">缺失</span>}
                  </div>
                )
              })}
            </div>
            <p className="mt-2 text-[10px] text-muted-foreground">
              超过 2000 字的输入不会每轮重发，模型会用读工具按范围读取。
            </p>
          </>
        )}

        {tab === 'system' && (
          <>
            <div className="mb-2 flex justify-end">
              <button
                type="button"
                className="rounded border border-border px-1.5 py-0.5 text-[10px] text-muted-foreground hover:bg-muted"
                onClick={() => copy(view.system)}
              >
                复制系统提示
              </button>
            </div>
            <pre className="whitespace-pre-wrap break-words text-[11px] leading-relaxed">
              {view.system}
            </pre>
          </>
        )}

        {tab === 'task' && (
          <>
            <div className="mb-2 flex justify-end">
              <button
                type="button"
                className="rounded border border-border px-1.5 py-0.5 text-[10px] text-muted-foreground hover:bg-muted"
                onClick={() => copy(view.task)}
              >
                复制本轮任务
              </button>
            </div>
            <pre className="whitespace-pre-wrap break-words text-[11px] leading-relaxed">
              {view.task}
            </pre>
          </>
        )}

        {tab === 'data' && (
          <div className="space-y-2">
            {Object.entries(view.inputs).map(([key, value]) => (
              <details
                key={key}
                open={Object.keys(view.inputs).length <= 2}
                className="rounded border border-border"
              >
                <summary className="cursor-pointer select-none px-2 py-1 text-[11px]">
                  {profile.inputLabels[key] || key} · {textLength(value)} 字
                </summary>
                <div className="border-t border-border px-2 py-1">
                  <div className="mb-1 flex justify-end">
                    <button
                      type="button"
                      className="text-[10px] text-muted-foreground hover:text-foreground"
                      onClick={() => copy(formatValue(value))}
                    >
                      复制
                    </button>
                  </div>
                  <pre className="max-h-[320px] overflow-auto whitespace-pre-wrap break-words text-[11px]">
                    {formatValue(value)}
                  </pre>
                </div>
              </details>
            ))}
          </div>
        )}

        {tab === 'read' && (
          <div>
            <div className="text-[11px] text-muted-foreground">宿主技能可读</div>
            {view.readTools.length ? (
              <ul className="mt-1 space-y-1">
                {view.readTools.map((tool) => (
                  <li key={tool} className="flex items-center gap-1.5">
                    <code className="rounded bg-muted px-1 py-0.5 text-[10px]">{tool}</code>
                    <span className="text-[11px]">{READ_LABELS[tool] || ''}</span>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="mt-1 text-muted-foreground">没有读工具。</p>
            )}
            <div className="mt-3 text-[11px] text-muted-foreground">只读技能</div>
            {view.readonly.length ? (
              <ul className="mt-1 space-y-0.5">
                {view.readonly.map((s) => (
                  <li key={s.id}>
                    {s.id} · v{s.version}
                  </li>
                ))}
              </ul>
            ) : (
              <p className="mt-1 text-muted-foreground">无。</p>
            )}
            <p className="mt-2 text-[10px] text-muted-foreground">
              只读技能只拿到读工具，不会出现写工具。
            </p>
          </div>
        )}
      </div>
    </section>
  )
}
