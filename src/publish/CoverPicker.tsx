import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { CoverAspect, Deliverable, DeliverableConfig } from './types'
import { loadVideoFrame } from './frames'

/**
 * 封面选择：按比例分组，同一比例只准备一次。
 * 抽帧用本地 video + canvas，不依赖服务端；上传走后端 save-image。
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
      const list = await loadVideoFrame(deliverable.url, 4)
      setFrames(list)
      if (!list.length) onToast('没有取到可用帧，可直接上传封面')
    } catch (e) {
      onToast((e as Error).message || '抽帧失败')
    } finally {
      setBusy(false)
    }
  }, [deliverable.url, onToast])

  const pickFrame = useCallback(
    (url: string) => {
      onChange({ cover: { ...config.cover, [aspect]: url } })
    },
    [aspect, config.cover, onChange],
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
        const r = await fetch('/api/save-image', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ dataUrl, name: `cover-${aspect.replace(':', 'x')}` }),
        })
        const j = await r.json().catch(() => ({}))
        if (!j.ok || !j.url) throw new Error(j.message || '保存封面失败')
        onChange({ cover: { ...config.cover, [aspect]: String(j.url) } })
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
            onClick={() => setAspect(a)}
          >
            {a}
            {config.cover[a] ? ' · 已准备' : ' · 待准备'}
          </button>
        ))}
      </div>

      <div className="pb-cover">
        <div className={`pb-cover-frame ${aspect === '9:16' ? 'portrait' : 'landscape'}`}>
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
              onClick={() => pickFrame(f)}
            >
              <img src={f} alt={`帧 ${i + 1}`} />
            </button>
          ))}
        </div>
      )}

      <div className="pb-hint">封面按比例复用：9:16 供抖音，16:9 供 B 站与头条。</div>
    </div>
  )
}
