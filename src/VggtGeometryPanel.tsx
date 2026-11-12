import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { VggtJob, VggtReportV1 } from './api'
import { getVggtJob, ingestShot3dReference, submitVggtAnalyze, vggtWorkerStatus } from './api'

type SourceOption = { kind: 'reference' | 'schedule'; label: string; url: string }

type Props = {
  projectName: string
  projectAspect: string
  effectiveSeconds: number
  sources: SourceOption[]
  onCopyToChat: (text: string) => void
  onIngested?: (videoUrl: string) => void
  onToast: (msg: string) => void
  geometryBusy?: boolean
}

export default function VggtGeometryPanel({
  projectName,
  projectAspect,
  effectiveSeconds,
  sources,
  onCopyToChat,
  onIngested,
  onToast,
  geometryBusy,
}: Props) {
  const [available, setAvailable] = useState<boolean | null>(null)
  const [pick, setPick] = useState('')
  const [jobId, setJobId] = useState<string | null>(null)
  const [job, setJob] = useState<VggtJob | null>(null)
  const [submitting, setSubmitting] = useState(false)
  const [linkUrl, setLinkUrl] = useState('')
  const [ingesting, setIngesting] = useState(false)
  const [lastIngestUrl, setLastIngestUrl] = useState<string | null>(null)
  const fileRef = useRef<HTMLInputElement>(null)

  const options = useMemo(() => sources.filter((s) => s.url), [sources])

  useEffect(() => {
    void vggtWorkerStatus()
      .then((s) => setAvailable(Boolean(s.available)))
      .catch(() => setAvailable(false))
  }, [])

  useEffect(() => {
    if (!pick && options.length) setPick(`${options[0].kind}:${options[0].url}`)
  }, [options, pick])

  useEffect(() => {
    if (lastIngestUrl && options.some((o) => o.url === lastIngestUrl)) {
      setPick(`reference:${lastIngestUrl}`)
    }
  }, [lastIngestUrl, options])

  const selected = useMemo(() => {
    const [kind, ...rest] = pick.split(':')
    const url = rest.join(':')
    return options.find((o) => o.kind === kind && o.url === url) || null
  }, [pick, options])

  useEffect(() => {
    if (!jobId) return
    let cancelled = false
    const tick = async () => {
      const j = await getVggtJob(jobId)
      if (cancelled) return
      setJob(j)
      if (j?.status === 'pending' || j?.status === 'running') {
        setTimeout(tick, 800)
      }
    }
    void tick()
    return () => {
      cancelled = true
    }
  }, [jobId])

  const report: VggtReportV1 | undefined = job?.report

  const run = useCallback(async () => {
    if (!selected) {
      onToast('请先选择要分析的参考片或已渲染白模')
      return
    }
    setSubmitting(true)
    setJob(null)
    setJobId(null)
    try {
      const j = await submitVggtAnalyze({
        videoRef: selected.url,
        sourceKind: selected.kind,
        projectAspect,
        effectiveSeconds,
        maxFrames: 24,
      })
      setJobId(j.id)
      setJob(j)
    } catch (e) {
      onToast((e as Error).message || '提交失败')
    } finally {
      setSubmitting(false)
    }
  }, [selected, projectAspect, effectiveSeconds, onToast])

  const ingestLink = useCallback(async () => {
    const url = linkUrl.trim()
    if (!url) {
      onToast('请粘贴抖音/B 站等分享链接，或公网视频直链')
      return
    }
    setIngesting(true)
    try {
      const r = await ingestShot3dReference({ projectName, url })
      const u = r.videoUrl.split('?')[0]
      setLastIngestUrl(u)
      onIngested?.(u)
      setPick(`reference:${u}`)
      onToast(`已下载：${r.adapterLabel || r.adapter || '参考视频'}`)
    } catch (e) {
      onToast((e as Error).message || '下载失败')
    } finally {
      setIngesting(false)
    }
  }, [linkUrl, projectName, onToast])

  const ingestFile = useCallback(
    async (file: File) => {
      if (file.size > 200 * 1024 * 1024) {
        onToast('文件超过 200MB 上限')
        return
      }
      setIngesting(true)
      try {
        const data = await new Promise<string>((resolve, reject) => {
          const r = new FileReader()
          r.onload = () => resolve(String(r.result || ''))
          r.onerror = () => reject(new Error('读取文件失败'))
          r.readAsDataURL(file)
        })
        const r = await ingestShot3dReference({
          projectName,
          adapter: 'upload',
          name: file.name,
          data,
        })
        const u = r.videoUrl.split('?')[0]
        setLastIngestUrl(u)
        onIngested?.(u)
        setPick(`reference:${u}`)
        onToast('本地上传成功')
      } catch (e) {
        onToast((e as Error).message || '上传失败')
      } finally {
        setIngesting(false)
      }
    },
    [projectName, onToast],
  )

  const copySummary = useCallback(() => {
    if (!report?.motionSummaryZh) return
    if (report.confidence === 'low') {
      if (!window.confirm('置信度较低，几何轨可能不可靠。仍要复制到聊天？')) return
    }
    const block = [
      '【参考片几何建议（实验，未采纳为调度真相）】',
      report.motionSummaryZh,
      report.mappingNote,
      ...(report.warnings?.length ? [`注意：${report.warnings.join('；')}`] : []),
    ].join('\n')
    onCopyToChat(block)
    onToast('已填入聊天输入框，发送前请自行核对')
  }, [report, onCopyToChat, onToast])

  const running = submitting || job?.status === 'pending' || job?.status === 'running'
  const busy = ingesting || running || geometryBusy

  return (
    <div className="cw-vggt" data-vggt-panel>
      <details open className="cw-vggt-details">
        <summary>
          <b>参考视频 · 下载与几何（实验）</b>
          <span className="cw-vggt-tag">非调度真相</span>
        </summary>
        <p className="cw-vggt-note">
          粘贴抖音/B 站链接或上传文件，落盘到项目素材后供本会话几何分析；不写 sceneCode / 视频引用 / 镜头参考字段。解析配置与创意室「下载与摄取」共用。
        </p>

        <div className="cw-vggt-ingest">
          <label className="cw-vggt-field">
            <span>平台或直链</span>
            <input
              type="url"
              placeholder="https://v.douyin.com/… 或 B 站分享链"
              value={linkUrl}
              onChange={(e) => setLinkUrl(e.target.value)}
              disabled={busy}
              data-shot3d-ingest-url
            />
          </label>
          <div className="cw-vggt-ingest-actions">
            <button type="button" className="btn-mini" disabled={busy} onClick={() => void ingestLink()} data-shot3d-ingest-link>
              {ingesting ? '下载中…' : '下载到项目'}
            </button>
            <button type="button" className="btn-mini" disabled={busy} onClick={() => fileRef.current?.click()}>
              上传本地视频
            </button>
            <input
              ref={fileRef}
              type="file"
              accept="video/mp4,video/webm,video/quicktime,.mp4,.webm,.mov"
              hidden
              onChange={(e) => {
                const f = e.target.files?.[0]
                e.target.value = ''
                if (f) void ingestFile(f)
              }}
            />
          </div>
          {lastIngestUrl && (
            <div className="cw-vggt-ingest-result">
              <span className="mono" title={lastIngestUrl}>
                {lastIngestUrl.slice(-48)}
              </span>
              <button
                type="button"
                className="btn-mini"
                disabled={!available || busy}
                onClick={() => {
                  void (async () => {
                    setSubmitting(true)
                    setJob(null)
                    setJobId(null)
                    try {
                      const j = await submitVggtAnalyze({
                        videoRef: lastIngestUrl,
                        sourceKind: 'reference',
                        projectAspect,
                        effectiveSeconds,
                        maxFrames: 24,
                      })
                      setJobId(j.id)
                      setJob(j)
                      setPick(`reference:${lastIngestUrl}`)
                    } catch (e) {
                      onToast((e as Error).message || '分析失败')
                    } finally {
                      setSubmitting(false)
                    }
                  })()
                }}
                data-shot3d-ingest-analyze
              >
                加入并分析几何
              </button>
            </div>
          )}
        </div>

        {available === false && (
          <div className="cw-alert warn">未配置 VGGT Worker（见 README · VGGT 实验）。</div>
        )}
        {options.length === 0 && !lastIngestUrl ? (
          <div className="cw-alert warn">下载参考片并「加入几何分析」，或先渲染一条白模。</div>
        ) : options.length > 0 ? (
          <>
            <label className="cw-vggt-field">
              <span>分析来源</span>
              <select value={pick} onChange={(e) => setPick(e.target.value)} disabled={busy}>
                {options.map((o) => (
                  <option key={`${o.kind}:${o.url}`} value={`${o.kind}:${o.url}`}>
                    {o.label} · {o.url.slice(-32)}
                  </option>
                ))}
              </select>
            </label>
            {selected?.kind === 'schedule' && (
              <div className="cw-alert warn">当前为「已渲染条目」只读分析，不验收、不替换已发布的视频引用。</div>
            )}
            <button
              type="button"
              className="btn-mini"
              disabled={!available || busy || !selected}
              onClick={() => void run()}
              data-vggt-analyze
            >
              {running ? '分析中…' : '分析参考视频'}
            </button>
          </>
        ) : null}
        {job?.status === 'failed' && <div className="cw-alert danger">{job.error || '分析失败'}</div>}
        {report && (
          <div className="cw-vggt-result" data-vggt-confidence={report.confidence}>
            <MotionConfidenceLabel value={report.confidence} />
            <p>{report.motionSummaryZh}</p>
            <p className="cw-vggt-meta">{report.mappingNote}</p>
            {report.warnings?.length > 0 && (
              <ul className="cw-vggt-warn">
                {report.warnings.map((w) => (
                  <li key={w}>{w}</li>
                ))}
              </ul>
            )}
            <button type="button" className="btn-mini" onClick={copySummary} data-vggt-copy-chat>
              复制到聊天
            </button>
          </div>
        )}
        {running && geometryBusy && (
          <div className="cw-alert warn">渲染或采纳进行中；几何分析不会自动写入调度字段。</div>
        )}
      </details>
    </div>
  )
}

function MotionConfidenceLabel({ value }: { value: string }) {
  const label = value === 'high' ? '置信度：高' : value === 'medium' ? '置信度：中' : '置信度：低'
  return <div className="cw-vggt-conf">{label}</div>
}
