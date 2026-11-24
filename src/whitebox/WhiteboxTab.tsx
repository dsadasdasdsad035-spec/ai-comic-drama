import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { ProjectAsset } from '../api'
import {
  PHASE_LABEL,
  cancelWhiteboxJob,
  fetchWhiteboxHealth,
  fetchWhiteboxJob,
  submitWhiteboxJob,
  whiteboxErrorText,
  type WhiteboxHealth,
  type WhiteboxJob,
} from './api'

const POLL_MS = 1200

const CHECK_LABEL: Record<string, string> = {
  python: 'Python 解释器',
  torch: 'torch',
  device: '推理设备',
  source: 'DA3 源码',
  weights: '模型权重',
}

const CHECK_HINT: Record<string, string> = {
  python: '需要 3.10–3.12（numpy<2 在 3.13 上没有 macOS wheel）',
  torch: 'Mac 上用 arm64 wheel，约 111MB',
  device: '有 MPS 走 GPU，没有则回落 CPU（慢几倍）',
  source: '锁 commit 的 DA3 源码，克隆失败通常是网络',
  weights: 'DA3-BASE 约 516MB，可断点续传',
}

type Props = {
  projectName: string
  assets: ProjectAsset[]
  toast: (m: string) => void
  /** 完成后跳到场景三维，让用户立刻用上产物 */
  onOpenStudio3d?: () => void
}

function formatBytes(n: number): string {
  if (!n) return '0 B'
  if (n > 1_048_576) return `${(n / 1_048_576).toFixed(1)} MB`
  return `${Math.round(n / 1024)} KB`
}

function elapsedText(ms: number): string {
  const s = Math.round(ms / 1000)
  if (s < 60) return `${s} 秒`
  return `${Math.floor(s / 60)} 分 ${s % 60} 秒`
}

/** 体检值可能是字符串，也可能是对象（weights 返回 {model,dir,bytes,license}）。
 *  直接 String() 会渲染成 [object Object]——实测踩过。 */
function checkValueText(value: unknown): string {
  if (value == null) return 'ok'
  if (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') {
    return String(value)
  }
  if (typeof value === 'object') {
    const obj = value as Record<string, unknown>
    if (typeof obj.model === 'string') {
      const mb = typeof obj.bytes === 'number' ? ` · ${Math.round(Number(obj.bytes) / 1_048_576)}MB` : ''
      return `${obj.model}${mb}`
    }
    const first = Object.values(obj).find((v) => typeof v === 'string')
    if (typeof first === 'string') return first
  }
  return 'ok'
}

export default function WhiteboxTab({ projectName, assets, toast, onOpenStudio3d }: Props) {
  const [health, setHealth] = useState<WhiteboxHealth | null>(null)
  const [healthLoading, setHealthLoading] = useState(true)
  const [sourceType, setSourceType] = useState<'video' | 'images'>('video')
  const [videoUrl, setVideoUrl] = useState('')
  /** 图片模式的选中项（站内 URL），按选择顺序保存——顺序影响相邻帧重叠 */
  const [imageUrls, setImageUrls] = useState<string[]>([])
  // 帧间隔是决定重建质量的关键：间隔越大，相邻帧重叠越少，位姿越容易崩。
  // 默认 0.5 秒（42 秒视频 → 84 帧，覆盖全片且画面重叠充足）。
  const [frameInterval, setFrameInterval] = useState(0.5)
  const [maxFrames, setMaxFrames] = useState(96)
  const [targetSize, setTargetSize] = useState(6)
  const [job, setJob] = useState<WhiteboxJob | null>(null)
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState('')
  const pollRef = useRef<number | null>(null)

  const images = useMemo(
    () =>
      (assets || []).filter((a) => {
        const u = String(a.url || '').toLowerCase().split('?')[0]
        return String(a.kind) === 'image' || /\.(png|jpe?g|webp)$/.test(u)
      }),
    [assets],
  )

  const videos = useMemo(
    () =>
      (assets || []).filter((a) => {
        const u = String(a.url || '').toLowerCase().split('?')[0]
        return String(a.kind) === 'video' || /\.(mp4|mov|webm|m4v|avi)$/.test(u)
      }),
    [assets],
  )

  const loadHealth = useCallback(
    async (refresh = false) => {
      setHealthLoading(true)
      try {
        setHealth(await fetchWhiteboxHealth(refresh))
      } catch (e) {
        setHealth(null)
        setError((e as Error).message)
      } finally {
        setHealthLoading(false)
      }
    },
    [],
  )

  useEffect(() => {
    void loadHealth()
  }, [loadHealth])

  // 停止轮询
  const stopPoll = useCallback(() => {
    if (pollRef.current !== null) {
      window.clearInterval(pollRef.current)
      pollRef.current = null
    }
  }, [])

  useEffect(() => stopPoll, [stopPoll])

  const startPoll = useCallback(
    (id: string) => {
      stopPoll()
      pollRef.current = window.setInterval(() => {
        void (async () => {
          try {
            const next = await fetchWhiteboxJob(id)
            setJob(next)
            if (next.status === 'done' || next.status === 'failed' || next.status === 'cancelled') {
              stopPoll()
            }
          } catch (e) {
            // 作业被服务重启清掉时轮询会 400，停掉并把消息摆出来
            stopPoll()
            setError((e as Error).message)
          }
        })()
      }, POLL_MS)
    },
    [stopPoll],
  )

  const busy = job?.status === 'queued' || job?.status === 'running'
  const ready = Boolean(health?.ok)
  const inputReady =
    sourceType === 'images' ? imageUrls.length >= 4 : Boolean(videoUrl)
  const canSubmit = Boolean(projectName && inputReady && ready && !busy && !submitting)

  const submit = async () => {
    if (!canSubmit) return
    setError('')
    setSubmitting(true)
    try {
      const created = await submitWhiteboxJob(
        sourceType === 'images'
          ? { projectName, imageUrls, maxFrames, targetSize }
          : { projectName, videoUrl, interval: frameInterval, maxFrames, targetSize },
      )
      setJob(created)
      startPoll(created.id)
    } catch (e) {
      const err = e as { message?: string; code?: string }
      setError(
        err.code === 'env-missing'
          ? `推理环境未就绪：${err.message || ''}`
          : err.message || '提交失败',
      )
      // 环境类错误顺手刷新体检，让用户看到到底缺什么
      if (err.code === 'env-missing') void loadHealth(true)
    } finally {
      setSubmitting(false)
    }
  }

  const cancel = async () => {
    if (!job || !busy) return
    try {
      setJob(await cancelWhiteboxJob(job.id))
      stopPoll()
    } catch (e) {
      setError((e as Error).message)
    }
  }

  const failed = job?.status === 'failed' || job?.status === 'cancelled'

  return (
    <div className="wb-tab" data-whitebox-tab>
      <header className="wb-hero">
        <div>
          <h3 className="wb-title">视频转白模</h3>
          <p className="board-hint wb-lede">
            用 Depth Anything 3 从视频估深度与位姿，融成三角网格后导成白模 GLB，可直接放进「场景三维」摆机位。
          </p>
          <p className="wb-caveat">
            产物是<strong>稠密重建的表面</strong>，不是语义分割后的墙/地/家具；尺度为估算值。重建质量取决于视频的视差与场景层次——相机只平移一小段、或画面几乎是平的，出来的只会是一层薄面。
          </p>
        </div>
      </header>

      {/* ---- 环境体检 ---- */}
      <section className="wb-section" data-whitebox-health>
        <div className="wb-section-head">
          <h4>推理环境</h4>
          <button
            type="button"
            className="btn ghost sm"
            disabled={healthLoading}
            onClick={() => void loadHealth(true)}
          >
            {healthLoading ? '检测中…' : '重新检测'}
          </button>
        </div>
        {healthLoading && !health ? (
          <p className="board-hint">正在检测…</p>
        ) : !health ? (
          <p className="wb-err">体检接口不可用</p>
        ) : (
          <>
            <ul className="wb-checks">
              {Object.entries(health.checks || {}).map(([key, check]) => (
                <li key={key} data-wb-check={key} data-ok={check.ok ? '1' : '0'}>
                  <span className={check.ok ? 'wb-dot ok' : 'wb-dot bad'} aria-hidden />
                  <span className="wb-check-name">{CHECK_LABEL[key] || key}</span>
                  <span className="wb-check-value">
                    {check.ok ? checkValueText(check.value) : check.reason || '缺失'}
                  </span>
                  {!check.ok && CHECK_HINT[key] ? (
                    <span className="wb-check-hint">{CHECK_HINT[key]}</span>
                  ) : null}
                </li>
              ))}
            </ul>
            {!health.ok ? (
              <div className="wb-env-missing">
                <p>{health.message || '推理环境不完整，无法转换。'}</p>
                {health.installHint ? (
                  <code className="wb-cmd" data-whitebox-install-hint>
                    {health.installHint}
                  </code>
                ) : null}
                <p className="board-hint">
                  首次安装约需 2GB 下载（torch 与模型权重），装好后回来点「重新检测」。
                </p>
              </div>
            ) : (
              <p className="board-hint">
                环境就绪 · 推理设备 <strong>{String(health.checks?.device?.value || 'cpu')}</strong>
              </p>
            )}
          </>
        )}
      </section>

      {/* ---- 输入 ---- */}
      <section className="wb-section">
        <h4>输入素材</h4>
        <div className="wb-mode" role="tablist" aria-label="输入类型">
          <button
            type="button"
            role="tab"
            aria-selected={sourceType === 'video'}
            className={sourceType === 'video' ? 'on' : ''}
            data-whitebox-mode="video"
            disabled={busy}
            onClick={() => setSourceType('video')}
          >
            一段视频
          </button>
          <button
            type="button"
            role="tab"
            aria-selected={sourceType === 'images'}
            className={sourceType === 'images' ? 'on' : ''}
            data-whitebox-mode="images"
            disabled={busy}
            onClick={() => setSourceType('images')}
          >
            多张图片
          </button>
        </div>

        {sourceType === 'video' ? (
          <>
            {videos.length === 0 ? (
              <p className="board-hint">
                当前项目还没有视频素材。先到「视频」分类上传或导入一条，再回来转换。
              </p>
            ) : (
              <select
                className="wb-select"
                data-whitebox-video
                value={videoUrl}
                disabled={busy}
                onChange={(e) => setVideoUrl(e.target.value)}
              >
                <option value="">选择一条视频…</option>
                {videos.map((v) => (
                  <option key={v.url} value={v.url}>
                    {v.title || v.url}
                  </option>
                ))}
              </select>
            )}
          </>
        ) : (
          <>
            <p className="wb-caveat wb-caveat-inline">
              图片可以自己挑——视频抽帧会抽到字幕帧、黑帧、特写帧，图片不会。
              建议 <strong>8–16 张</strong>：相邻两张转身不超过约 60°（保证有重叠），
              并且要<strong>走动</strong>而不是原地转圈（平移才产生视差）。
              实测同一房间：随机 8 张出 12,744 面，精挑 8 张出 73,528 面。
            </p>
            {images.length === 0 ? (
              <p className="board-hint">
                当前项目还没有图片素材。先到「场景/道具」或上传图片，再回来选。
              </p>
            ) : (
              <>
                <div className="wb-pick" data-whitebox-images>
                  {images.map((img) => {
                    const picked = imageUrls.includes(img.url)
                    const order = imageUrls.indexOf(img.url)
                    return (
                      <button
                        key={img.url}
                        type="button"
                        className={picked ? 'wb-pick-item on' : 'wb-pick-item'}
                        data-whitebox-image={img.url}
                        data-picked={picked ? '1' : '0'}
                        disabled={busy}
                        title={img.title || img.url}
                        onClick={() =>
                          setImageUrls((prev) =>
                            prev.includes(img.url)
                              ? prev.filter((u) => u !== img.url)
                              : [...prev, img.url],
                          )
                        }
                      >
                        <img src={img.url} alt="" loading="lazy" />
                        {picked ? <span className="wb-pick-order">{order + 1}</span> : null}
                      </button>
                    )
                  })}
                </div>
                <p className="wb-field-hint" data-whitebox-image-count>
                  已选 {imageUrls.length} 张
                  {imageUrls.length > 0 && imageUrls.length < 4
                    ? '（至少 4 张才能估出位姿，建议 8 张以上）'
                    : ''}
                  {imageUrls.length > 0 ? (
                    <button
                      type="button"
                      className="btn ghost sm"
                      disabled={busy}
                      onClick={() => setImageUrls([])}
                    >
                      清空
                    </button>
                  ) : null}
                </p>
              </>
            )}
          </>
        )}

        <div className="wb-grid">
          {/* 间隔只对视频有意义：图片模式下用户已经挑好了帧 */}
          {sourceType === 'video' ? (
            <label>
              抽帧间隔（秒）
              <input
                type="number"
                min={0.1}
                max={3}
                step={0.1}
                value={frameInterval}
                disabled={busy}
                onChange={(e) => setFrameInterval(Number(e.target.value) || 0.5)}
              />
              <span className="wb-field-hint">
                越小越密。间隔过大时相邻帧不重叠，位姿会崩、重建塌成薄板
              </span>
            </label>
          ) : null}
          <label>
            最大帧数
            <input
              type="number"
              min={4}
              max={96}
              value={maxFrames}
              disabled={busy}
              onChange={(e) => setMaxFrames(Math.min(96, Math.max(4, Number(e.target.value) || 96)))}
            />
            <span className="wb-field-hint">
              硬上限 96。长视频会自动拉大间隔以覆盖全片
            </span>
          </label>
          <label>
            目标尺寸（米）
            <input
              type="number"
              min={1}
              max={30}
              step={0.5}
              value={targetSize}
              disabled={busy}
              onChange={(e) => setTargetSize(Number(e.target.value) || 6)}
            />
            <span className="wb-field-hint">包围盒最大边归一到这个值</span>
          </label>
        </div>

        <div className="wb-actions">
          <button
            type="button"
            className="btn primary"
            data-whitebox-submit
            disabled={!canSubmit}
            onClick={() => void submit()}
          >
            {submitting ? '提交中…' : busy ? '转换中…' : '生成白模'}
          </button>
          {busy ? (
            <button type="button" className="btn" data-whitebox-cancel onClick={() => void cancel()}>
              取消
            </button>
          ) : null}
          {!ready && health ? (
            <span className="board-hint">环境未就绪，先按上面的提示安装</span>
          ) : null}
        </div>
      </section>

      {/* ---- 进度 ---- */}
      {job ? (
        <section className="wb-section" data-whitebox-job data-status={job.status}>
          <h4>进度</h4>
          <div className="wb-progress">
            <div className="wb-progress-bar">
              <span style={{ width: `${Math.round((job.progress || 0) * 100)}%` }} />
            </div>
            <span className="wb-progress-text">
              {PHASE_LABEL[job.phase] || job.phase}
              {busy && job.startedAt ? ` · 已用 ${elapsedText(Date.now() - job.startedAt)}` : ''}
            </span>
          </div>

          {failed ? (
            <p className="wb-err" data-whitebox-error>
              {whiteboxErrorText(job.errorCode, job.error)}
            </p>
          ) : null}

          {job.status === 'done' && job.glbUrl ? (
            <div className="wb-result" data-whitebox-result>
              <p className="wb-result-title">
                产物：<code>{job.glbUrl.split('/').pop()}</code>
              </p>
              {job.stats ? (
                <ul className="wb-stats">
                  <li>
                    <span>三角面</span>
                    <strong>{job.stats.triangles.toLocaleString()}</strong>
                  </li>
                  <li>
                    <span>包围盒</span>
                    <strong>{job.stats.bbox.map((v) => v.toFixed(1)).join(' × ')} m</strong>
                  </li>
                  <li>
                    <span>体积</span>
                    <strong>{formatBytes(job.stats.bytes)}</strong>
                  </li>
                  <li>
                    <span>用帧</span>
                    <strong>{job.stats.frames}</strong>
                  </li>
                </ul>
              ) : null}
              <p className="board-hint">
                已登记为素材卡「{job.assetTitle}」。尺度为估算值，可在场景三维里按需缩放。
              </p>
              <div className="wb-actions">
                {onOpenStudio3d ? (
                  <button type="button" className="btn" data-whitebox-open-3d onClick={onOpenStudio3d}>
                    在场景三维中打开
                  </button>
                ) : null}
                <a className="btn ghost" href={job.glbUrl} download>
                  下载 GLB
                </a>
              </div>
            </div>
          ) : null}
        </section>
      ) : null}

      {error ? (
        <p className="wb-err" data-whitebox-inline-error>
          {error}
        </p>
      ) : null}
    </div>
  )
}
