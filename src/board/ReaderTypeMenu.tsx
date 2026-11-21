import { useEffect, useRef, useState } from 'react'
import {
  READER_LEADINGS,
  READER_SIZES,
  type ReaderAlign,
  type ReaderFamily,
  type ReaderPrefs,
} from './readerPrefs'

type Props = {
  prefs: ReaderPrefs
  onChange: (next: ReaderPrefs) => void
}

/**
 * 排版菜单（Aa）：字号 / 行距 / 字体 / 对齐 / 首行缩进。
 * 阅读偏好按用户记忆，不写项目。
 */
export default function ReaderTypeMenu({ prefs, onChange }: Props) {
  const [open, setOpen] = useState(false)
  const rootRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!open) return
    const onDown = (e: MouseEvent) => {
      if (!rootRef.current?.contains(e.target as Node)) setOpen(false)
    }
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpen(false)
    }
    document.addEventListener('mousedown', onDown)
    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('mousedown', onDown)
      document.removeEventListener('keydown', onKey)
    }
  }, [open])

  const patch = (p: Partial<ReaderPrefs>) => onChange({ ...prefs, ...p })

  return (
    <div className="reader-type" ref={rootRef}>
      <button
        type="button"
        className={`btn reader-type-trigger${open ? ' on' : ''}`}
        data-reader-type-toggle
        aria-haspopup="dialog"
        aria-expanded={open}
        title="排版设置"
        onClick={() => setOpen((v) => !v)}
      >
        Aa
      </button>

      {open ? (
        <div className="reader-type-panel" role="dialog" aria-label="排版设置" data-reader-type-panel>
          <div className="reader-type-row">
            <span className="reader-type-label">字号</span>
            <div className="reader-type-seg" role="group" aria-label="字号">
              {READER_SIZES.map((size) => (
                <button
                  key={size}
                  type="button"
                  className={`reader-type-btn${prefs.size === size ? ' on' : ''}`}
                  data-reader-size={size}
                  aria-pressed={prefs.size === size}
                  onClick={() => patch({ size })}
                >
                  {size}
                </button>
              ))}
            </div>
          </div>

          <div className="reader-type-row">
            <span className="reader-type-label">行距</span>
            <div className="reader-type-seg" role="group" aria-label="行距">
              {READER_LEADINGS.map((leading) => (
                <button
                  key={leading}
                  type="button"
                  className={`reader-type-btn${prefs.leading === leading ? ' on' : ''}`}
                  data-reader-leading={leading}
                  aria-pressed={prefs.leading === leading}
                  onClick={() => patch({ leading })}
                >
                  {leading.toFixed(1)}
                </button>
              ))}
            </div>
          </div>

          <div className="reader-type-row">
            <span className="reader-type-label">字体</span>
            <div className="reader-type-seg" role="group" aria-label="字体">
              {(
                [
                  ['serif', '宋'],
                  ['sans', '黑'],
                ] as Array<[ReaderFamily, string]>
              ).map(([id, label]) => (
                <button
                  key={id}
                  type="button"
                  className={`reader-type-btn${prefs.family === id ? ' on' : ''}`}
                  data-reader-family-btn={id}
                  aria-pressed={prefs.family === id}
                  onClick={() => patch({ family: id })}
                >
                  {label}
                </button>
              ))}
            </div>
          </div>

          <div className="reader-type-row">
            <span className="reader-type-label">对齐</span>
            <div className="reader-type-seg" role="group" aria-label="对齐">
              {(
                [
                  ['justify', '两端'],
                  ['left', '左'],
                ] as Array<[ReaderAlign, string]>
              ).map(([id, label]) => (
                <button
                  key={id}
                  type="button"
                  className={`reader-type-btn${prefs.align === id ? ' on' : ''}`}
                  data-reader-align-btn={id}
                  aria-pressed={prefs.align === id}
                  onClick={() => patch({ align: id })}
                >
                  {label}
                </button>
              ))}
            </div>
          </div>

          <div className="reader-type-row">
            <span className="reader-type-label">缩进</span>
            <div className="reader-type-seg" role="group" aria-label="首行缩进">
              <button
                type="button"
                className={`reader-type-btn${prefs.indent ? ' on' : ''}`}
                data-reader-indent-btn="on"
                aria-pressed={prefs.indent}
                onClick={() => patch({ indent: true })}
              >
                开
              </button>
              <button
                type="button"
                className={`reader-type-btn${prefs.indent ? '' : ' on'}`}
                data-reader-indent-btn="off"
                aria-pressed={!prefs.indent}
                onClick={() => patch({ indent: false })}
              >
                关
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  )
}
