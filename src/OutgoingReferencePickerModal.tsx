import { useEffect, useRef, useState, type KeyboardEvent } from 'react'
import type { BoundarySource } from './types'

export type OutgoingRefPickItem = {
  token: string
  label: string
  url: string
  source: 'character' | 'asset'
}

/** 一个首尾帧槽位；只有已选值与来源，候选来源固定为两镜成片抽帧 */
export type OutgoingBoundarySlot = {
  side: 'out' | 'in'
  label: string
  purpose: string
  value: string
  from?: BoundarySource
}

type Tab = 'boundary' | 'character' | 'asset'

export type OutgoingReferencePickerModalProps = {
  open: boolean
  onClose: () => void
  /** 弹窗标题，转场 / 分镜可各自传入 */
  title?: string
  /** morph 两个槽；空数组表示当前模式没有首尾帧槽位 */
  boundarySlots: OutgoingBoundarySlot[]
  onClearBoundary: (side: 'out' | 'in') => void
  onExtractBoundary?: () => void
  extractBusy?: boolean
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

const SOURCE_LABEL: Partial<Record<BoundarySource, string>> = {
  'source-tail': '上镜尾帧',
  'target-head': '下镜首帧',
  'source-frame': '上镜画面',
  'target-frame': '下镜画面',
  library: '媒体库',
  manual: '手填地址',
}

const sourceText = (from?: BoundarySource) => (from ? SOURCE_LABEL[from] ?? '已选画面' : '已选画面')

/**
 * 出片参考统一选择：结构首尾帧 + 角色 + 素材。
 * 首尾帧只来自两镜成片抽帧，不提供外部候选；抽取直接写入槽位。
 */
export default function OutgoingReferencePickerModal({
  open,
  onClose,
  title = '选择出片参考',
  boundarySlots,
  onClearBoundary,
  onExtractBoundary,
  extractBusy,
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

  const pickedCount = boundarySlots.filter((s) => Boolean(s.value)).length
  const boundarySummary = boundarySlots.length
    ? ` · 首尾帧 ${pickedCount}/${boundarySlots.length}${pickedCount === boundarySlots.length ? '' : '（未齐不能生成）'}`
    : ''

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
              {boundarySummary}
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
              <p className="orp-note">
                首帧取<b>上一镜成片的最后一帧</b>，尾帧取<b>下一镜成片的第一帧</b>；点「抽取两镜成片帧」一次填好两侧，两帧都就绪才能生成。
              </p>
              {boundarySlots.map((slot) => (
                <div key={slot.side} className="orp-slot" data-boundary-slot={slot.side}>
                  <div className="orp-boundary-row">
                    <div className="orp-boundary-meta">
                      <b>{slot.label}</b>
                      <span>{slot.purpose}</span>
                      <span className="orp-slot-state">
                        {slot.value ? `已选 · ${sourceText(slot.from)}` : '未选择'}
                      </span>
                    </div>
                    {slot.value ? (
                      <img src={slot.value} alt="" />
                    ) : (
                      <div className="orp-boundary-ph">未选择</div>
                    )}
                    <div className="orp-slot-btns">
                      <button
                        type="button"
                        className="btn-mini ghost"
                        onClick={() => onClearBoundary(slot.side)}
                        disabled={!slot.value}
                      >
                        清除
                      </button>
                    </div>
                  </div>
                </div>
              ))}
              {!boundarySlots.length ? (
                <p className="orp-note">当前模式无首尾帧槽位（例如旧版关键帧）。</p>
              ) : null}
              <div className="orp-actions">
                {onExtractBoundary ? (
                  <button
                    type="button"
                    className="btn"
                    onClick={onExtractBoundary}
                    disabled={extractBusy}
                  >
                    {extractBusy ? '抽取中…' : '抽取两镜成片帧'}
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
