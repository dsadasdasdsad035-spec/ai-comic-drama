import { useEffect, useRef, useState } from 'react'
import type { ProjectAsset } from '../api'
import {
  adoptReverseJob,
  cancelReverseJob,
  createReverseJob,
  getReverseHealth,
  getReverseJob,
  type ReaHealth,
  type ReverseJob,
  type ReverseTier,
  type VisionModelOption,
} from './api'

const POLL_MS = 1500

function fmtElapsed(ms: number): string {
  const s = Math.round((Number(ms) || 0) / 1000)
  return s < 60 ? `${s}s` : `${Math.floor(s / 60)}m${String(s % 60).padStart(2, '0')}s`
}

const STATUS_LABEL: Record<ReverseJob['status'], string> = {
  queued: '排队中',
  running: '拆解中',
  done: '完成',
  error: '失败',
  cancelled: '已取消',
}

/**
 * 反推我的片子。
 *
 * 源视频只能从当前项目的视频库选：反推结果是「这条片子的逐镜规格」，
 * 与项目绑定才有意义；也避免把任意本地路径交给外部进程。
 */
export default function ReversePanel({
  open,
  projectName,
  assets,
  onClose,
  onAdopted,
  toast,
}: {
  open: boolean
  projectName: string
  assets: ProjectAsset[]
  onClose: () => void
  onAdopted: () => void
  toast: (m: string) => void
}) {
  const [health, setHealth] = useState<ReaHealth | null>(null)
  const [tiers, setTiers] = useState<ReverseTier[]>([])
  const [tier, setTier] = useState('quick')
  const [videoUrl, setVideoUrl] = useState('')
  const [title, setTitle] = useState('')
  const [useVlm, setUseVlm] = useState(true)
  const [visionModels, setVisionModels] = useState<VisionModelOption[]>([])
  /** 空串 = 跟「默认路由 → 视觉」 */
  const [vlmModelKey, setVlmModelKey] = useState('')
  const [job, setJob] = useState<ReverseJob | null>(null)
  const [busy, setBusy] = useState('')
  const [error, setError] = useState('')
  const [adoptedId, setAdoptedId] = useState('')
  const timer = useRef<number | null>(null)

  const videos = assets.filter((a) => String(a.kind) === 'video' || /\.(mp4|mov|webm)(\?|$)/i.test(a.url))

  useEffect(() => {
    if (!open) return
    let alive = true
    setError('')
    getReverseHealth()
      .then((r) => {
        if (!alive) return
        setHealth(r.health)
        setTiers(r.tiers)
        setVisionModels(r.visionModels || [])
        if (r.tiers.length && !r.tiers.some((t) => t.id === tier)) setTier(r.tiers[0].id)
      })
      .catch((e) => alive && setError((e as Error).message))
    return () => {
      alive = false
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open])

  useEffect(() => {
    if (!open) {
      if (timer.current) window.clearTimeout(timer.current)
      timer.current = null
      setJob(null)
      setAdoptedId('')
    }
  }, [open])

  // 轮询运行中的作业；终态停止
  useEffect(() => {
    if (!job) return
    if (job.status !== 'running' && job.status !== 'queued') return
    if (timer.current) window.clearTimeout(timer.current)
    timer.current = window.setTimeout(async () => {
      try {
        const next = await getReverseJob(job.id)
        setJob(next)
      } catch (e) {
        setError((e as Error).message)
      }
    }, POLL_MS)
    return () => {
      if (timer.current) window.clearTimeout(timer.current)
    }
  }, [job])

  if (!open) return null

  const selectedTier = tiers.find((t) => t.id === tier)

  const start = async () => {
    if (!projectName) {
      setError('先在顶栏选择项目')
      return
    }
    if (!videoUrl) {
      setError('先选一条项目视频')
      return
    }
    setBusy('start')
    setError('')
    setAdoptedId('')
    try {
      const created = await createReverseJob({
        project: projectName,
        videoUrl,
        title: title.trim() || undefined,
        tier,
        useVlm,
        vlmModelKey,
      })
      setJob(created)
    } catch (e) {
      setError((e as Error).message || '发起失败')
    } finally {
      setBusy('')
    }
  }

  const cancel = async () => {
    if (!job) return
    setBusy('cancel')
    try {
      setJob(await cancelReverseJob(job.id))
    } catch (e) {
      setError((e as Error).message)
    } finally {
      setBusy('')
    }
  }

  const adopt = async () => {
    if (!job) return
    setBusy('adopt')
    try {
      const saved = await adoptReverseJob(job.id, title.trim() || undefined)
      setAdoptedId(saved.id)
      onAdopted()
      toast(`已存入案例库：${saved.title}`)
    } catch (e) {
      setError((e as Error).message)
    } finally {
      setBusy('')
    }
  }

  return (
    <div
      className="mp-backdrop"
      data-prompt-case-reverse-backdrop
      onMouseDown={(e) => {
        if (e.target === e.currentTarget && !busy) onClose()
      }}
    >
      <div className="mp-dialog pc-reverse-dialog" role="dialog" aria-modal="true" aria-label="反推我的片子">
        <header className="mp-head">
          <div>
            <b>反推我的片子</b>
            <span>用 rea-video 拆成逐镜制作方式与两段提示词，结果存入案例库</span>
          </div>
          <button type="button" className="mp-close" aria-label="关闭" disabled={Boolean(busy)} onClick={onClose}>
            ×
          </button>
        </header>

        <div className="pc-reverse-body">
          {health && !health.ok ? (
            <div className="pc-reverse-missing" data-prompt-case-rea-missing>
              <b>反推工具不可用</b>
              <p>{health.message}</p>
              <pre className="pc-cmd">{`uv tool install "rea-video[ocr] @ git+https://github.com/JuneYaooo/rea-video"`}</pre>
              <p className="board-hint">
                安装后在 <b>设置 → 提示词案例 · 反推工具</b> 填可执行文件路径，或让它在 PATH 里。
              </p>
            </div>
          ) : (
            <>
              <div className="pc-import-row">
                <label className="pc-field grow">
                  <span>源视频（项目视频库）</span>
                  <select
                    data-prompt-case-reverse-video
                    value={videoUrl}
                    onChange={(e) => setVideoUrl(e.target.value)}
                    disabled={Boolean(busy) || Boolean(job && (job.status === 'running' || job.status === 'queued'))}
                  >
                    <option value="">选择一条视频</option>
                    {videos.map((v) => (
                      <option key={v.url} value={v.url}>
                        {v.title || v.url.split('/').pop()}
                      </option>
                    ))}
                  </select>
                </label>
                <label className="pc-field grow">
                  <span>案例标题（可选）</span>
                  <input
                    value={title}
                    onChange={(e) => setTitle(e.target.value)}
                    placeholder="默认用视频标题"
                    disabled={Boolean(busy)}
                  />
                </label>
              </div>

              <div className="pc-reverse-tiers" role="radiogroup" aria-label="拆解档位">
                {tiers.map((t) => (
                  <button
                    key={t.id}
                    type="button"
                    role="radio"
                    aria-checked={tier === t.id}
                    className={`pc-tier ${tier === t.id ? 'on' : ''}`}
                    onClick={() => setTier(t.id)}
                    disabled={Boolean(busy) || Boolean(job && job.status === 'running')}
                  >
                    <b>{t.label}</b>
                    <em>{t.hint}</em>
                    <span className={t.downloadMb ? 'pc-tier-dl' : 'pc-tier-dl ok'}>
                      {t.downloadMb ? `首次需下载约 ${t.downloadMb} MB` : '零下载'}
                    </span>
                  </button>
                ))}
              </div>

              <label className="pc-check">
                <input type="checkbox" checked={useVlm} onChange={(e) => setUseVlm(e.target.checked)} disabled={Boolean(busy)} />
                <span>
                  用视觉模型复核（推荐）。开启后实拍/AI/3D 的区分明显更准，
                  并能拿到逐镜复刻提示词；未配置模型时无法开启。
                </span>
              </label>

              {useVlm ? (
                <label className="pc-field">
                  <span>视觉模型</span>
                  <select
                    data-prompt-case-reverse-vlm
                    value={vlmModelKey}
                    onChange={(e) => setVlmModelKey(e.target.value)}
                    disabled={Boolean(busy) || Boolean(job && (job.status === 'running' || job.status === 'queued'))}
                  >
                    <option value="">
                      跟默认路由（{visionModels.find((m) => m.isDefault)?.label || '未配置'}）
                    </option>
                    {visionModels.map((m) => (
                      <option key={m.key} value={m.key}>
                        {m.label} · {m.provider}
                        {m.isDefault ? '（默认）' : ''}
                      </option>
                    ))}
                  </select>
                  <em>
                    {visionModels.length === 0
                      ? '设置页「默认路由 → 视觉」还没有可用模型'
                      : '经应用内中转调用：SSE 归一 + 渠道代理，子进程拿不到渠道 Key'}
                  </em>
                </label>
              ) : null}

              {selectedTier && selectedTier.downloads.length && tier === 'full' ? (
                <details className="pc-import-disabled">
                  <summary>这一档首次运行会下载</summary>
                  <ul>
                    {selectedTier.downloads.map((d) => (
                      <li key={d.name}>
                        {d.name} · 约 {d.mb} MB
                      </li>
                    ))}
                  </ul>
                </details>
              ) : null}

              <div className="pc-import-actions">
                <button
                  type="button"
                  className="btn primary"
                  data-prompt-case-reverse-start
                  disabled={Boolean(busy) || !videoUrl || Boolean(job && (job.status === 'running' || job.status === 'queued'))}
                  onClick={() => void start()}
                >
                  {busy === 'start' ? '发起中…' : '开始拆解'}
                </button>
                {job && (job.status === 'running' || job.status === 'queued') ? (
                  <button type="button" className="btn-mini danger" disabled={busy === 'cancel'} onClick={() => void cancel()}>
                    取消
                  </button>
                ) : null}
              </div>

              {error ? <p className="board-hint pc-import-error">{error}</p> : null}

              {job ? (
                <div className="pc-reverse-progress" data-prompt-case-reverse-progress>
                  <div className="pc-reverse-status">
                    <span className={`pc-status ${job.status}`}>{STATUS_LABEL[job.status]}</span>
                    <span className="board-hint">
                      阶段 {job.phase} · 已用 {fmtElapsed(job.elapsedMs)}
                      {job.timeoutMs ? ` / 上限 ${fmtElapsed(job.timeoutMs)}` : ''}
                    </span>
                  </div>
                  {job.error ? <p className="pc-import-error">{job.error}</p> : null}
                  {job.result ? (
                    <ul className="pc-reverse-result">
                      <li>共 {job.result.shots} 镜</li>
                      <li>复刻建议模型：{job.result.engine || '未给出'}</li>
                      <li className={job.result.vlmStatus === 'ok' ? '' : 'warn'}>
                        视觉判定：{job.result.vlmNote || job.result.vlmStatus}
                      </li>
                    </ul>
                  ) : null}
                  {job.tail.length ? (
                    <pre className="pc-reverse-tail">{job.tail.slice(-6).join('\n')}</pre>
                  ) : null}

                  {job.status === 'done' && job.result?.reportUrl ? (
                    <div className="pc-reverse-report">
                      <div className="pc-prompt-head">
                        <b>拆解报告</b>
                        <span className="board-hint">禁脚本沙箱内预览</span>
                        <span className="spacer" />
                        <a
                          className="btn-mini ghost"
                          href={job.result.reportUrl}
                          target="_blank"
                          rel="noreferrer"
                        >
                          新窗口打开 ↗
                        </a>
                      </div>
                      {/*
                        沙箱白名单刻意不含 allow-scripts：报告是外部工具生成的 HTML。
                        实测产物零 script / 零内联事件 / 零外链，这里只是把边界钉死。
                      */}
                      <iframe
                        className="pc-report-frame"
                        data-prompt-case-report
                        title="拆解报告"
                        src={job.result.reportUrl}
                        sandbox="allow-same-origin"
                        referrerPolicy="no-referrer"
                        loading="lazy"
                      />
                    </div>
                  ) : job.status === 'done' ? (
                    <p className="board-hint">这次没有可预览的报告（复制失败），逐镜详情仍可存入案例库。</p>
                  ) : null}
                  {job.status === 'done' ? (
                    adoptedId ? (
                      <p className="board-hint pc-import-ok">已存入案例库（{adoptedId}），关闭后可在列表里看到。</p>
                    ) : (
                      <button
                        type="button"
                        className="btn primary"
                        data-prompt-case-reverse-adopt
                        disabled={busy === 'adopt'}
                        onClick={() => void adopt()}
                      >
                        {busy === 'adopt' ? '写入中…' : '存入案例库'}
                      </button>
                    )
                  ) : null}
                </div>
              ) : null}
            </>
          )}
        </div>

        <footer className="mp-foot">
          <button type="button" className="btn-mini" disabled={Boolean(busy)} onClick={onClose}>
            关闭
          </button>
        </footer>
      </div>
    </div>
  )
}
