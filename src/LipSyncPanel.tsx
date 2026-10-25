import { useState } from 'react'
import type { AppSettings } from './api'
import { askVision, runLipSync, runLipSyncQa } from './api'
import { activeVideoUrl, lipSyncEligibility, lipSyncFingerprint, lipSyncStale, normalizeLipSyncState } from './lipSync'
import { parseDialogue } from './prompts'
import type { LipSyncFinding, LipSyncQaFrame, ShotData } from './types'

type Props = {
  data: ShotData
  onPatch: (patch: Partial<ShotData>) => void
  settings: AppSettings | null
  projectName: string
  nativeAudio?: boolean
}

export default function LipSyncPanel({ data, onPatch, settings, projectName, nativeAudio }: Props) {
  const state = normalizeLipSyncState(data.lipSync)
  const dialogue = parseDialogue(data.dialogue)
  const providerConfigured = settings?.lipSync?.provider === 'sync-labs'
  const stale = lipSyncStale(state, data.videoUrl, data.voiceUrl, dialogue)
  const eligible = lipSyncEligibility({
    mode: state.mode,
    dialogue,
    videoUrl: data.videoUrl,
    voiceUrl: data.voiceUrl,
    providerConfigured,
  })
  const [confirming, setConfirming] = useState(false)
  const [busy, setBusy] = useState(false)
  const [qaBusy, setQaBusy] = useState(false)
  const [error, setError] = useState('')
  const price = Math.max(0, Number(settings?.lipSync?.pricePerSecond) || 0)
  const estimate = price * Math.max(0, Number(data.seconds) || 0)

  const patchState = (patch: Partial<typeof state>) => {
    onPatch({ lipSync: { ...state, ...patch } })
  }

  const setMode = (mode: typeof state.mode) => {
    setError('')
    setConfirming(false)
    patchState({ mode })
  }

  const generate = async () => {
    setError('')
    if (!projectName) return setError('先选择项目')
    if (!data.videoUrl || !data.voiceUrl) return setError('需要已接受的视频和配音')
    setBusy(true)
    patchState({ mode: 'provider', status: 'running', error: undefined, sourceVideo: data.videoUrl, audio: data.voiceUrl })
    try {
      const r = await runLipSync({
        project: projectName,
        video: data.videoUrl,
        audio: data.voiceUrl,
      })
      patchState({
        status: 'done',
        outputVideo: r.outputVideo,
        provider: r.provider,
        adopted: false,
        sourceVideo: data.videoUrl,
        audio: data.voiceUrl,
        fingerprint: lipSyncFingerprint(data.videoUrl, data.voiceUrl, dialogue),
        error: undefined,
      })
      setConfirming(false)
    } catch (e) {
      setError((e as Error).message)
      patchState({ status: 'error', error: (e as Error).message })
    } finally {
      setBusy(false)
    }
  }

  const frameDataUrl = async (src: string): Promise<string> => {
    const r = await fetch(src)
    if (!r.ok) throw new Error(`读取验收帧失败：${r.status}`)
    const blob = await r.blob()
    return new Promise<string>((resolve, reject) => {
      const reader = new FileReader()
      reader.onload = () => resolve(String(reader.result || ''))
      reader.onerror = () => reject(new Error('读取验收帧失败'))
      reader.readAsDataURL(blob)
    })
  }

  const judgeQa = async () => {
    const frames = state.qa?.frames ?? []
    if (!frames.length) return
    setQaBusy(true)
    setError('')
    try {
      const nextFrames: LipSyncQaFrame[] = []
      const findings: LipSyncFinding[] = []
      for (const frame of frames) {
        const image = await frameDataUrl(frame.path)
        const res = await askVision({
          prompt: '只看人物的嘴部。判断这一帧嘴是张开还是闭合。只返回 JSON：{"mouth":"open"或"closed"}。不要判断情绪、身份或镜头。',
          image,
          json: true,
          maxTokens: 80,
        })
        const value = String((res.json as { mouth?: string } | undefined)?.mouth || res.text || '').toLowerCase()
        const mouth: 'open' | 'closed' | 'unknown' = /open|张/.test(value) ? 'open' : /closed|闭/.test(value) ? 'closed' : 'unknown'
        nextFrames.push({ ...frame, mouth, advisory: true })
        if (frame.kind === 'silence' && mouth === 'open') {
          findings.push({ at: frame.at, kind: 'silence-open', frame: frame.path })
        }
        if (frame.kind === 'speech' && mouth === 'closed') {
          findings.push({ at: frame.at, kind: 'speech-closed', frame: frame.path })
        }
      }
      patchState({
        qa: {
          ...state.qa!,
          frames: nextFrames,
          findings,
          pass: findings.length === 0,
        },
      })
    } catch (e) {
      setError((e as Error).message)
    } finally {
      setQaBusy(false)
    }
  }

  const qa = async () => {
    setError('')
    const video = activeVideoUrl(data)
    if (!video) return setError('没有可验收的视频')
    if (!data.voiceUrl) return setError('没有台词音频，不能做口型验收')
    setQaBusy(true)
    try {
      const r = await runLipSyncQa({ video, audio: data.voiceUrl })
      patchState({
        qa: {
          frames: r.frames,
          checkedAt: new Date().toISOString(),
          pass: undefined,
          findings: [],
          note: r.silenceIntervals.length ? `找到 ${r.silenceIntervals.length} 段静音` : '没有找到静音段',
        },
      })
    } catch (e) {
      setError((e as Error).message)
    } finally {
      setQaBusy(false)
    }
  }

  return (
    <div className="lip-sync-panel" data-lip-sync>
      <div className="lip-head">
        <span>口型</span>
        <select value={state.mode} onChange={(e) => setMode(e.target.value as typeof state.mode)}>
          <option value="off">关闭</option>
          <option value="prompt">提示词</option>
          <option value="provider" disabled={nativeAudio}>外部口型</option>
        </select>
        {state.adopted && <span className="lip-badge">已采用口型版</span>}
        {(stale || state.status === 'stale') && <span className="lip-badge warn">源或台词变了，需重做</span>}
      </div>

      {state.mode === 'prompt' && (
        <div className="lip-hint">
          {eligible.ok
            ? '提示词会写说话状态与嘴部动作；不调用外部服务，也不保证逐字同步。'
            : eligible.reason}
        </div>
      )}

      {state.mode === 'provider' && nativeAudio && (
        <div className="gen-warn">原生音频已包含声画，provider 口型入口已禁用；切回关闭后可继续使用。</div>
      )}

      {state.mode === 'provider' && !nativeAudio && (
        <div className="lip-provider">
          <div className="lip-hint">
            {eligible.ok
              ? `单说话人 · ${data.videoUrl ? '有视频' : '缺视频'} · ${data.voiceUrl ? '有配音' : '缺配音'}`
              : eligible.reason}
          </div>
          {!confirming && (
            <div className="lip-actions">
              <button
                className="btn-mini"
                disabled={busy || !eligible.ok}
                onClick={() => setConfirming(true)}
              >
                {state.status === 'running' ? '生成中…' : state.outputVideo ? '重新生成口型' : '生成口型'}
              </button>
              {state.outputVideo && !state.adopted && (
                <button className="btn-mini" onClick={() => patchState({ adopted: true })}>
                  采用口型版
                </button>
              )}
              {state.outputVideo && state.adopted && (
                <button className="btn-mini ghost" onClick={() => patchState({ adopted: false })}>
                  切回原版
                </button>
              )}
              <button className="btn-mini ghost" disabled={qaBusy} onClick={() => void qa()}>
                {qaBusy ? '抽帧中…' : '抽帧验收'}
              </button>
            </div>
          )}
          {confirming && (
            <div className="lip-confirm">
              <div>provider：Sync Labs</div>
              <div>源视频：{data.videoUrl || '（缺）'}</div>
              <div>台词音频：{data.voiceUrl || '（缺）'}</div>
              <div>预计按 {Math.max(0, Number(data.seconds) || 0).toFixed(1)}s 计费{price ? ` · 估算 ¥${estimate.toFixed(2)}` : ' · 未配置单价'}</div>
              <div className="lip-actions">
                <button className="btn-mini" disabled={busy} onClick={() => void generate()}>
                  {busy ? '提交中…' : '确认提交'}
                </button>
                <button className="btn-mini ghost" disabled={busy} onClick={() => setConfirming(false)}>
                  取消
                </button>
              </div>
            </div>
          )}
          {state.error && <div className="gen-error">{state.error}</div>}
        </div>
      )}

      {state.qa?.frames?.length ? (
        <div className="lip-qa">
          <div className="lip-qa-head">
            <span>
              验收帧 · 静音应闭嘴 / 发声应张嘴
              {state.qa.pass === true ? ' · 已通过' : state.qa.pass === false ? ' · 未通过' : ' · 待人工确认'}
              {state.qa.findings?.length ? ` · ${state.qa.findings.length} 个问题` : ''}
            </span>
          </div>
          <div className="lip-qa-grid">
            {state.qa.frames.map((frame) => (
              <figure key={`${frame.kind}-${frame.at}`}>
                <img src={frame.path} alt={`${frame.kind} ${frame.at}s`} />
                <figcaption>
                  {frame.kind === 'silence' ? '静音 · 应闭嘴' : '发声 · 应张嘴'} @{frame.at}s
                  {frame.mouth ? ` · ${frame.mouth}` : ''}
                </figcaption>
              </figure>
            ))}
          </div>
          <div className="lip-actions">
            <button className="btn-mini" disabled={qaBusy} onClick={() => void judgeQa()}>
              {qaBusy ? '判定中…' : '视觉自动判定（advisory）'}
            </button>
            <button className="btn-mini" onClick={() => patchState({ qa: { ...state.qa!, pass: true } })}>
              确认验收通过
            </button>
            <button
              className="btn-mini ghost"
              onClick={() => patchState({ qa: { ...state.qa!, pass: false } })}
            >
              标记不通过
            </button>
          </div>
        </div>
      ) : null}

      {error && <div className="gen-error">{error}</div>}
    </div>
  )
}
