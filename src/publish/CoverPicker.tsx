import { useCallback, useEffect, useRef, useState } from 'react'
import type { CoverAspect, Deliverable, DeliverableConfig } from './types'
import { loadVideoFrame } from './frames'
import { persistCoverImage } from './covers'

/**
 * 封面选择：按比例分组，同一比例只准备一次。
 * 抽帧用本地 video + canvas，但产物一律先落盘再写配置——
 * 配置里只存站内文件地址，dataURL 只在内存里存在一瞬。
 */
export default function CoverPicker({
  deliverable,
  config,
  aspects,
  onChange,
  onToast,
}: {
  deliverable: Deliverable
  config: DeliverableConfig
  aspects: CoverAspect[]
  onChange: (patch: Partial<DeliverableConfig>) => void
  onToast: (m: string) => void
}) {
  const [aspect, setAspect] = useState<CoverAspect>(aspects[0] || '9:16')
  const [frames, setFrames] = useState<string[]>([])
  const [busy, setBusy] = useState(false)
  const fileRef = useRef<HTMLInputElement | null>(null)

  useEffect(() => {
    if (!aspects.includes(aspect) && aspects.length) setAspect(aspects[0])
  }, [aspects, aspect])

  const grabFrames = useCallback(async () => {
    setBusy(true)
    try {
      // 按当前比例裁切，避免把成片原始画幅塞进另一种比例的封面框
      const list = await loadVideoFrame(deliverable.url, 4, 720, aspect)
      setFrames(list)
      if (!list.length) onToast('没有取到可用帧，可直接上传封面')
    } catch (e) {
      onToast((e as Error).message || '抽帧失败')
    } finally {
      setBusy(false)
    }
  }, [deliverable.url, aspect, onToast])

  const pickFrame = useCallback(
    async (dataUrl: string) => {
      setBusy(true)
      try {
        const url = await persistCoverImage(dataUrl, aspect)
        onChange({ cover: { ...config.cover, [aspect]: url } })
      } catch (e) {
        onToast((e as Error).message || '封面保存失败')
      } finally {
        setBusy(false)
      }
    },
    [aspect, config.cover, onChange, onToast],
  )

  const upload = useCallback(
    async (file: File | null) => {
      if (!file) return
      if (!/^image\/(png|jpe?g|webp)$/.test(file.type)) {
        onToast('封面只支持 PNG / JPG / WebP')
        return
      }
      setBusy(true)
      try {
        const dataUrl = await new Promise<string>((resolve, reject) => {
          const fr = new FileReader()
          fr.onload = () => resolve(String(fr.result || ''))
          fr.onerror = () => reject(new Error('读取图片失败'))
          fr.readAsDataURL(file)
        })
        const url = await persistCoverImage(dataUrl, aspect)
        onChange({ cover: { ...config.cover, [aspect]: url } })
      } catch (e) {
        onToast((e as Error).message || '上传封面失败')
      } finally {
        setBusy(false)
      }
    },
    [aspect, config.cover, onChange, onToast],
  )

  const current = config.cover[aspect]

  return (
    <div className="pb-field">
      <div className="pb-label">
        封面
        <span className="pb-count">{aspects.join(' / ')}</span>
      </div>

      <div className="pb-radios" role="tablist" aria-label="封面比例">
        {aspects.map((a) => (
          <button
            key={a}
            type="button"
            role="tab"
            aria-selected={a === aspect}
            className={`pb-radio ${a === aspect ? 'on' : ''}`}
            onClick={() => {
              setAspect(a)
              setFrames([])
            }}
          >
            {a}
            {config.cover[a] ? ' · 已准备' : ' · 待准备'}
          </button>
        ))}
      </div>

      <div className="pb-cover">
        <div className="pb-cover-frame" data-aspect={aspect}>
          {current ? <img src={current} alt={`${aspect} 封面`} /> : <span>{aspect} 未设置</span>}
        </div>
        <div className="pb-cover-acts">
          <button type="button" className="btn-mini" onClick={grabFrames} disabled={busy}>
            {busy ? '处理中…' : '从成片抽帧'}
          </button>
          <button type="button" className="btn-mini" onClick={() => fileRef.current?.click()} disabled={busy}>
            上传图片
          </button>
          {current ? (
            <button
              type="button"
              className="btn-mini"
              onClick={() => onChange({ cover: { ...config.cover, [aspect]: '' } })}
            >
              清除
            </button>
          ) : null}
        </div>
        <input
          ref={fileRef}
          type="file"
          accept="image/png,image/jpeg,image/webp"
          hidden
          onChange={(e) => {
            void upload(e.target.files?.[0] ?? null)
            e.target.value = ''
          }}
        />
      </div>

      {frames.length > 0 && (
        <div className="pb-frames">
          {frames.map((f, i) => (
            <button
              key={`${i}-${f.slice(-16)}`}
              type="button"
              className="pb-frame"
              title={`用作 ${aspect} 封面`}
              disabled={busy}
              onClick={() => void pickFrame(f)}
            >
              <img src={f} alt={`帧 ${i + 1}`} />
            </button>
          ))}
        </div>
      )}

      <div className="pb-hint">
        封面按比例复用：同一比例只需准备一次，供所有需要它的平台共用。抽帧会按当前比例裁切并保存为站内图片。
      </div>
    </div>
  )
}
