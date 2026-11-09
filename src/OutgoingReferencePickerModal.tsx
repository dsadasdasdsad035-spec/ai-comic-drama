import { useEffect, useRef, useState, type KeyboardEvent } from 'react'
import type { TransitionAttachmentRole } from './transitionGen'

export type OutgoingRefPickItem = {
  token: string
  label: string
  url: string
  source: 'character' | 'asset'
}

export type OutgoingBoundaryRow = {
  role: TransitionAttachmentRole
  label: string
  purpose: string
}

type Tab = 'boundary' | 'character' | 'asset'

export type OutgoingReferencePickerModalProps = {
  open: boolean
  onClose: () => void
  /** 弹窗标题，转场 / 分镜可各自传入 */
  title?: string
  boundaryRows: OutgoingBoundaryRow[]
  boundaryOut: string
  boundaryIn: string
  onBoundaryChange: (side: 'out' | 'in', url: string) => void
  onRefreshBoundary?: () => void
  onFocusSourceShot?: () => void
  onFocusTargetShot?: () => void
  charItems: OutgoingRefPickItem[]
  assetItems: OutgoingRefPickItem[]
  selectedTokens: ReadonlySet<string>
  onToggleToken: (token: string) => void
}

const TAB_LABEL: Record<Tab, string> = {
  boundary: '首尾帧',
  character: '角色',
  asset: '素材',
}

/**
 * 出片参考统一选择：结构首尾帧 + 角色 + 素材。
 * 首期接转场；分镜视频 Tab 可复用同一壳子扩展字段。
 */
export default function OutgoingReferencePickerModal({
  open,
  onClose,
  title = '选择出片参考',
  boundaryRows,
  boundaryOut,
  boundaryIn,
  onBoundaryChange,
  onRefreshBoundary,
  onFocusSourceShot,
  onFocusTargetShot,
  charItems,
  assetItems,
  selectedTokens,
  onToggleToken,
}: OutgoingReferencePickerModalProps) {
  const dialogRef = useRef<HTMLDivElement>(null)
  const [tab, setTab] = useState<Tab>('boundary')

  useEffect(() => {
    if (!open) return
    setTab('boundary')
    window.setTimeout(() => dialogRef.current?.focus(), 0)
  }, [open])

  if (!open) return null

  const onDialogKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    if (e.key === 'Escape') {
      e.stopPropagation()
      onClose()
    }
  }

  const styleCount = [...selectedTokens].filter((t) =>
    [...charItems, ...assetItems].some((i) => i.token === t),
  ).length

  const renderPickGrid = (items: OutgoingRefPickItem[], empty: string) => {
    if (!items.length) return <p className="orp-note">{empty}</p>
    return (
      <div className="orp-pick-grid" role="listbox">
        {items.map((c) => {
          const on = selectedTokens.has(c.token)
          return (
            <button
              key={c.token}
              type="button"
              role="option"
              aria-selected={on}
              className={`orp-pick${on ? ' on' : ''}`}
              title={c.label}
              onClick={() => onToggleToken(c.token)}
            >
              <img src={c.url} alt="" loading="lazy" />
              <span>{c.label}</span>
            </button>
          )
        })}
      </div>
    )
  }

  return (
    <div
      className="orp-backdrop"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onClose()
      }}
    >
      <div
        ref={dialogRef}
        className="orp-dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby="orp-title"
        tabIndex={-1}
        onKeyDown={onDialogKeyDown}
      >
        <header className="orp-head">
          <div>
            <b id="orp-title">{title}</b>
            <span>
              已选手动参考 {styleCount} 项
              {boundaryOut && boundaryIn ? ' · 首尾帧已填' : boundaryOut || boundaryIn ? ' · 首尾帧未齐' : ''}
            </span>
          </div>
          <button type="button" className="orp-close" aria-label="关闭" onClick={onClose}>
            ×
          </button>
        </header>

        <div className="orp-tabs" role="tablist" aria-label="参考类型">
          {(['boundary', 'character', 'asset'] as const).map((key) => (
            <button
              key={key}
              type="button"
              role="tab"
              aria-selected={tab === key}
              className={tab === key ? 'on' : ''}
              onClick={() => setTab(key)}
            >
              {TAB_LABEL[key]}
              {key === 'character' ? ` (${charItems.length})` : ''}
              {key === 'asset' ? ` (${assetItems.length})` : ''}
            </button>
          ))}
        </div>

        <div className="orp-body" role="tabpanel">
          {tab === 'boundary' ? (
            <>
              <p className="orp-note">首尾帧锁定过渡起点与终点；路径可为本地 /generated/… 或成片抽帧地址。</p>
              {boundaryRows.map((row) => {
                const side = row.role === 'first_frame' ? 'out' : 'in'
                const value = side === 'out' ? boundaryOut : boundaryIn
                const url =
                  row.role === 'first_frame'
                    ? boundaryOut
                    : boundaryIn
                return (
                  <div key={row.role} className="orp-boundary-row">
                    <div className="orp-boundary-meta">
                      <b>{row.label}</b>
                      <span>{row.purpose}</span>
                    </div>
                    {url ? <img src={url} alt="" /> : <div className="orp-boundary-ph">无图</div>}
                    <input
                      type="text"
                      value={value}
                      placeholder="本地路径或 URL"
                      onChange={(e) => onBoundaryChange(side, e.target.value)}
                    />
                  </div>
                )
              })}
              {!boundaryRows.length ? (
                <p className="orp-note">当前模式无首尾帧槽位（例如旧版关键帧）。</p>
              ) : null}
              <div className="orp-actions">
                {onRefreshBoundary ? (
                  <button type="button" className="btn-mini" onClick={onRefreshBoundary}>
                    从两镜成片刷新
                  </button>
                ) : null}
                {onFocusSourceShot ? (
                  <button type="button" className="btn-mini" onClick={onFocusSourceShot}>
                    打开上镜
                  </button>
                ) : null}
                {onFocusTargetShot ? (
                  <button type="button" className="btn-mini" onClick={onFocusTargetShot}>
                    打开下镜
                  </button>
                ) : null}
              </div>
            </>
          ) : null}

          {tab === 'character' ? (
            <>
              <p className="orp-note">点选加入本条出片的角色外观参考（不自动继承镜头连线）。</p>
              {renderPickGrid(charItems, '暂无角色图：请先在角色卡生成外观图。')}
            </>
          ) : null}

          {tab === 'asset' ? (
            <>
              <p className="orp-note">点选画布上的场景 / 道具 / 图片素材卡。</p>
              {renderPickGrid(assetItems, '暂无素材卡：在画布点「+ 素材」或从素材库加入。')}
            </>
          ) : null}
        </div>

        <footer className="orp-foot">
          <button type="button" className="btn primary" onClick={onClose}>
            完成
          </button>
        </footer>
      </div>
    </div>
  )
}
