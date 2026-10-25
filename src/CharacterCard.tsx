import { useEffect, useRef, useState } from 'react'
import { generateImage, generateVoice, saveImageDataUrl, type VoiceOption } from './api'
import {
  DEFAULT_VOICE_SAMPLE_TEXT,
  TURNAROUND_SUFFIX,
  identityFingerprint,
  isVoiceSampleUsable,
  voiceSampleFingerprint,
  type CharacterExpressionSheet,
  type CharacterSheet,
  type VoiceSample,
} from './characters'
import { cropExpressionSheet } from './expressionCrop'
import {
  buildExpressionSheetCells,
  cellForEmotion,
  expressionSheetPrompt,
  isSheetUsable,
} from './expressionSheet'
import { EMOTION_OPTIONS } from './performance'
import { imageCost, money, type Pricing } from './pricing'
import { endTask, startTask } from './tasks'
import type { PerformanceEmotion } from './types'
import { VOICE_SOURCE_LABELS } from './voiceCatalog'

type Props = {
  c: CharacterSheet
  patch: (id: string, p: Partial<CharacterSheet>) => CharacterSheet[]
  canInject: boolean
  onInject: () => void
  voices: VoiceOption[]
  onDelete: () => void
  onRename: (name: string) => void
  viewModel?: string
  audioModelKey?: string
  price?: Pricing
  projectName: string
  onPersist: (next: CharacterSheet[]) => void
  onPublishSheet: () => void
  selectedShot: { id: string; no: string } | null
  selectedBudget?: { used: number; max: number; expression: boolean; omitted: number } | null
  missing: Set<string>
  onImageMissing: (ref: string) => void
}

type Tab = 'turnaround' | 'sheet' | 'voice'

function splitKeywords(value: string): string[] {
  return value
    .split(/[、,，]/)
    .map((s) => s.trim())
    .filter(Boolean)
}

function exprLabel(emotion: PerformanceEmotion): string {
  return EMOTION_OPTIONS.find((o) => o.value === emotion)?.label ?? emotion
}

export default function CharacterCard({
  c,
  patch,
  canInject,
  onInject,
  voices,
  onDelete,
  onRename,
  viewModel,
  audioModelKey,
  price,
  projectName,
  onPersist,
  onPublishSheet,
  selectedShot,
  selectedBudget,
  missing,
  onImageMissing,
}: Props) {
  const fileRef = useRef<HTMLInputElement>(null)
  const exprFileRef = useRef<HTMLInputElement>(null)
  const [tab, setTab] = useState<Tab>('turnaround')
  const [editing, setEditing] = useState(false)
  const [draft, setDraft] = useState({
    name: c.name,
    role: c.role,
    age: c.age ?? '',
    lookCn: c.lookCn,
    lookEn: c.lookEn,
    palette: c.palette,
    keywords: c.keywords.join('、'),
  })
  const [sampleText, setSampleText] = useState(c.voiceSample?.text || DEFAULT_VOICE_SAMPLE_TEXT)
  const [sampleBusy, setSampleBusy] = useState(false)
  const [sampleError, setSampleError] = useState('')
  const [sheetBusy, setSheetBusy] = useState(false)
  const [sheetError, setSheetError] = useState('')
  const [sheetErrors, setSheetErrors] = useState<string[]>([])
  const [previewEmotion, setPreviewEmotion] = useState<PerformanceEmotion>('neutral')

  useEffect(() => {
    setSampleText(c.voiceSample?.text || DEFAULT_VOICE_SAMPLE_TEXT)
  }, [c.id, c.voiceSample?.text])

  const candidates = c.candidates ?? []
  const activeIdx = c.activeIdx ?? 0
  const imageMissing = Boolean(c.image && missing.has(c.image))
  const identity = identityFingerprint(c)
  const sheet = c.expressionSheet
  const sheetImageMissing = Boolean(sheet?.image && missing.has(sheet.image))
  const sheetStale = Boolean(sheet && (sheet.stale || sheet.fingerprint !== identity))
  const sheetUsable = isSheetUsable(sheet, identity) && !sheetImageMissing
  const sheetCropCount = sheet?.cells.filter((cell) => Boolean(cell.cropUrl)).length ?? 0
  const hasUsableImage = Boolean(c.image && !imageMissing)
  const legacyCount = Object.values(c.expressions ?? {}).filter((e) => Boolean(e?.image)).length
  const expressionDone = sheet ? sheetCropCount : legacyCount
  const previewCell = sheet ? cellForEmotion(sheet, previewEmotion) : undefined
  const previewLabel = exprLabel(previewEmotion)
  const voiceLabel =
    voices.find((v) => v.id === c.voiceId)?.label || c.voiceId || '跟随镜头'
  const sampleStale = Boolean(
    c.voiceSample &&
      (c.voiceSample.stale ||
        sampleText !== c.voiceSample.text ||
        c.voiceSample.modelKey !== audioModelKey ||
        c.voiceSample.fingerprint !==
          voiceSampleFingerprint({
            url: c.voiceSample.url,
            text: c.voiceSample.text,
            voiceId: c.voiceSample.voiceId,
            modelKey: c.voiceSample.modelKey,
            engine: c.voiceSample.engine,
          })),
  )
  const sampleUsable = Boolean(c.voiceSample && isVoiceSampleUsable(c.voiceSample) && !sampleStale)

  const status = c.state === 'running'
    ? '生成中'
    : c.state === 'error'
      ? '错误'
      : imageMissing
        ? '缺图'
        : !hasUsableImage
          ? '待三视图'
          : sheetImageMissing
            ? '表情总图缺失'
            : sheetStale
              ? '表情需重生成'
              : sheetUsable
                ? '就绪'
                : '待表情总图'

  const primary = !hasUsableImage
    ? {
        label: c.image ? '重生成三视图' : '生成三视图',
        cost: price ? imageCost(price, 2) : 0,
        run: () => void generateTurnaround(),
        disabled: c.state === 'running',
      }
    : !sheetUsable
      ? {
          label: sheet ? '重生成表情总图' : '生成表情总图',
          cost: price ? imageCost(price, 1) : 0,
          run: () => void generateSheet(),
          disabled: sheetBusy || !c.lookEn.trim(),
        }
      : {
          label: '发布表情总图到画布',
          cost: 0,
          run: onPublishSheet,
          disabled: sheetImageMissing,
        }

  const openEdit = () => {
    setDraft({
      name: c.name,
      role: c.role,
      age: c.age ?? '',
      lookCn: c.lookCn,
      lookEn: c.lookEn,
      palette: c.palette,
      keywords: c.keywords.join('、'),
    })
    setSampleText(c.voiceSample?.text || DEFAULT_VOICE_SAMPLE_TEXT)
    setEditing(true)
  }

  const cancelEdit = () => {
    setDraft({
      name: c.name,
      role: c.role,
      age: c.age ?? '',
      lookCn: c.lookCn,
      lookEn: c.lookEn,
      palette: c.palette,
      keywords: c.keywords.join('、'),
    })
    setSampleText(c.voiceSample?.text || DEFAULT_VOICE_SAMPLE_TEXT)
    setEditing(false)
  }

  const saveEdit = () => {
    const fields: Partial<CharacterSheet> = {
      role: draft.role,
      age: draft.age,
      lookCn: draft.lookCn,
      lookEn: draft.lookEn,
      palette: draft.palette,
      keywords: splitKeywords(draft.keywords),
    }
    if (c.voiceSample && sampleText !== c.voiceSample.text) {
      fields.voiceSample = { ...c.voiceSample, text: sampleText, stale: true }
    }
    const next = patch(c.id, fields)
    onPersist(next)
    setEditing(false)
    const name = draft.name.trim()
    if (name && name !== c.name) onRename(name)
  }

  const generateTurnaround = async () => {
    if (!projectName) {
      patch(c.id, { state: 'error', error: '先选择项目再生成三视图' })
      return
    }
    if (!c.lookEn.trim()) {
      patch(c.id, { state: 'error', error: '先填英文外观锚点（lookEn）再生成' })
      return
    }
    patch(c.id, { state: 'running', error: undefined })
    const tid = startTask('image', `三视图 ${c.name}`, {
      cost: price ? imageCost(price, 2) : undefined,
    })
    try {
      const res = await generateImage({
        prompt: `${c.lookEn}, ${TURNAROUND_SUFFIX}`,
        ratio: '16:9',
        n: 2,
        cap: 'view',
        modelKey: viewModel,
        project: projectName,
      })
      const urls = res.urls?.length ? res.urls : [res.url]
      const next = patch(c.id, { candidates: urls, activeIdx: 0, image: urls[0], state: 'idle' })
      onPersist(next)
      endTask(tid)
    } catch (e) {
      patch(c.id, { state: 'error', error: (e as Error).message })
      endTask(tid, (e as Error).message)
    }
  }

  const generateSheet = async () => {
    if (!projectName) {
      setSheetError('先选择项目再生成表情总图')
      return
    }
    if (!c.lookEn.trim()) {
      setSheetError('先填英文外观锚点（lookEn）再生成表情总图')
      return
    }
    setSheetError('')
    setSheetErrors([])
    setSheetBusy(true)
    const tid = startTask('image', `表情总图 ${c.name}`, {
      cost: price ? imageCost(price, 1) : undefined,
    })
    try {
      const res = await generateImage({
        prompt: expressionSheetPrompt(c.lookEn),
        ratio: '16:9',
        n: 1,
        cap: 'view',
        modelKey: viewModel,
        project: projectName,
        ...(c.image ? { refImage: c.image } : {}),
      })
      const image = res.urls?.[0] || res.url
      const base: CharacterExpressionSheet = {
        image,
        columns: 4,
        rows: 2,
        cells: buildExpressionSheetCells(),
        source: 'generated',
        fingerprint: identity,
        ...(viewModel ? { modelKey: viewModel } : {}),
        createdAt: new Date().toISOString(),
      }
      let nextSheet = base
      let errors: string[] = []
      try {
        const cropped = await cropExpressionSheet(base, projectName)
        nextSheet = cropped.sheet
        errors = cropped.errors
      } catch (e) {
        errors = [(e as Error).message]
      }
      const next = patch(c.id, { expressionSheet: nextSheet })
      onPersist(next)
      setTab('sheet')
      setSheetErrors(errors)
      if (errors.length) setSheetError(`总图已生成，${errors.length} 格裁剪失败；对应情绪会回退文字表演`)
      endTask(tid)
    } catch (e) {
      const msg = (e as Error).message
      setSheetError(msg)
      endTask(tid, msg)
    } finally {
      setSheetBusy(false)
    }
  }

  const uploadTurnaround = async (file: File) => {
    if (!projectName) {
      patch(c.id, { state: 'error', error: '先选择项目再上传图片' })
      return
    }
    patch(c.id, { state: 'running', error: undefined })
    try {
      const dataUrl = await readFile(file)
      const url = await saveImageDataUrl(dataUrl, { project: projectName, prefix: 'char' })
      const next = patch(c.id, {
        image: url,
        candidates: undefined,
        activeIdx: undefined,
        state: 'idle',
        error: undefined,
      })
      onPersist(next)
    } catch (e) {
      patch(c.id, { state: 'error', error: (e as Error).message })
    }
  }

  const uploadSheet = async (file: File) => {
    if (!projectName) {
      setSheetError('先选择项目再上传表情总图')
      return
    }
    if (!file.type.startsWith('image/')) {
      setSheetError('请选择图片文件')
      return
    }
    setSheetError('')
    setSheetErrors([])
    setSheetBusy(true)
    try {
      const dataUrl = await readFile(file)
      const image = await saveImageDataUrl(dataUrl, { project: projectName, prefix: 'char-expr-sheet' })
      const base: CharacterExpressionSheet = {
        image,
        columns: 4,
        rows: 2,
        cells: buildExpressionSheetCells(),
        source: 'uploaded',
        fingerprint: identity,
        createdAt: new Date().toISOString(),
      }
      let nextSheet = base
      let errors: string[] = []
      try {
        const cropped = await cropExpressionSheet(base, projectName)
        nextSheet = cropped.sheet
        errors = cropped.errors
      } catch (e) {
        errors = [(e as Error).message]
      }
      const next = patch(c.id, { expressionSheet: nextSheet })
      onPersist(next)
      setTab('sheet')
      setSheetErrors(errors)
      if (errors.length) setSheetError(`总图已替换，${errors.length} 格裁剪失败；对应情绪会回退文字表演`)
    } catch (e) {
      setSheetError((e as Error).message)
    } finally {
      setSheetBusy(false)
    }
  }

  const generateSample = async () => {
    if (!projectName) {
      setSampleError('先选择项目再生成音色样本')
      return
    }
    if (!c.voiceId) {
      setSampleError('先给角色选择音色，再生成样本')
      return
    }
    setSampleBusy(true)
    setSampleError('')
    try {
      const r = await generateVoice({
        text: sampleText,
        voice: c.voiceId,
        project: projectName,
        purpose: 'character-sample',
        modelKey: audioModelKey,
      })
      const sample: VoiceSample = {
        url: r.url,
        text: sampleText,
        seconds: r.seconds,
        engine: r.engine,
        voiceId: c.voiceId,
        modelKey: audioModelKey,
        fingerprint: voiceSampleFingerprint({
          url: r.url,
          text: sampleText,
          voiceId: c.voiceId,
          modelKey: audioModelKey,
          engine: r.engine,
        }),
        stale: false,
        createdAt: new Date().toISOString(),
      }
      const next = patch(c.id, { voiceSample: sample })
      onPersist(next)
      if (r.seconds < 2 || r.seconds > 30) {
        setSampleError(`样本 ${r.seconds.toFixed(1)}s，需 2-30 秒；已保留供试听，但不能作参考`)
      }
    } catch (e) {
      setSampleError((e as Error).message)
    } finally {
      setSampleBusy(false)
    }
  }

  const clearImage = () => {
    const next = patch(c.id, {
      image: undefined,
      candidates: undefined,
      activeIdx: undefined,
      state: 'idle',
      error: undefined,
    })
    onPersist(next)
  }

  const setVoice = (voiceId: string) => {
    const chosen = voices.find((v) => v.id === voiceId)
    const next = patch(c.id, {
      voiceId: voiceId || undefined,
      voiceProvider: chosen?.provider,
      voiceModelKey: chosen?.modelKey,
    })
    onPersist(next)
  }

  const voiceOptions = (() => {
    const groups = new Map<string, VoiceOption[]>()
    for (const voice of voices) {
      const key = `${voice.provider || '当前渠道'} · ${VOICE_SOURCE_LABELS[voice.source || 'preset']}`
      const list = groups.get(key) || []
      list.push(voice)
      groups.set(key, list)
    }
    return [...groups.entries()].map(([label, list]) => (
      <optgroup key={label} label={label}>
        {list.map((voice) => (
          <option key={`${voice.provider || ''}:${voice.id}`} value={voice.id}>
            {voice.label}
            {voice.note ? ` · ${voice.note}` : ''}
          </option>
        ))}
      </optgroup>
    ))
  })()

  const renderTurnaround = () => (
    <>
      <div className="char-sheet">
        {imageMissing ? (
          <div className="char-empty char-missing">
            <span>图片文件缺失</span>
            <span className="char-empty-sub">文件已不在项目媒体目录，请重新生成或清除引用</span>
          </div>
        ) : c.image ? (
          <img src={c.image} alt={c.name} onError={() => c.image && onImageMissing(c.image)} />
        ) : (
          <div className="char-empty">
            <span>还没有三视图</span>
            <span className="char-empty-sub">先锁定外观，再生成一张 8 格表情总图</span>
            <button className="char-empty-cta" onClick={() => void generateTurnaround()}>
              生成三视图{price ? ` · ¥${money(imageCost(price, 2))}` : ''}
            </button>
          </div>
        )}
        {c.state === 'running' && (
          <div className="gen-overlay">
            <span className="spinner" />
            生成中
          </div>
        )}
        {candidates.length > 1 && (
          <div className="cand-bar">
            {candidates.map((url, i) => (
              <button
                key={url}
                className={`cand-dot ${i === activeIdx ? 'on' : ''}`}
                onClick={() => onPersist(patch(c.id, { activeIdx: i, image: url }))}
                title={`候选 ${i + 1}`}
              />
            ))}
          </div>
        )}
      </div>
      <div className="char-look">
        <span className="char-label">外观锚点</span>
        <p>{c.lookCn || '（未填）'}</p>
        <code className="char-en">{c.lookEn || '（未填，生成三视图前必须补）'}</code>
      </div>
      <div className="char-tags">
        {c.palette && <span className="char-palette">{c.palette}</span>}
        {c.keywords.map((k) => (
          <span key={k} className="char-tag">{k}</span>
        ))}
      </div>
    </>
  )

  const renderSheet = () => (
    <div className="char-sheet-pane">
      {!sheet ? (
        <div className="char-sheet char-sheet-empty">
          <div className="char-empty">
            <span>还没有表情总图</span>
            <span className="char-empty-sub">一张 4×2 图包含 8 个情绪；分镜只取裁出的单格</span>
            <button
              className="char-empty-cta"
              disabled={sheetBusy || !c.lookEn.trim()}
              onClick={() => void generateSheet()}
            >
              生成表情总图{price ? ` · 1 张 · ¥${money(imageCost(price, 1))}` : ''}
            </button>
            {legacyCount > 0 && (
              <span className="char-empty-sub">检测到 {legacyCount} 张旧表情单图，继续作为只读回退</span>
            )}
          </div>
        </div>
      ) : (
        <div className={`char-sheet expr-sheet ${sheetStale ? 'stale' : ''}`}>
          {sheetImageMissing ? (
            <div className="char-empty char-missing">
              <span>表情总图文件缺失</span>
              <span className="char-empty-sub">重新生成或上传一张 4×2 总图</span>
            </div>
          ) : (
            <img
              src={sheet.image}
              alt={`${c.name} 表情总图`}
              onError={() => onImageMissing(sheet.image)}
            />
          )}
          {!sheetImageMissing && (
            <div className="expr-grid" role="group" aria-label="表情总图格子">
              {EMOTION_OPTIONS.map((option) => {
                const cell = cellForEmotion(sheet, option.value)
                const selected = previewEmotion === option.value
                if (!cell) return null
                return (
                  <button
                    key={option.value}
                    type="button"
                    className={`expr-cell ${selected ? 'on' : ''} ${cell.cropUrl ? 'ready' : 'missing'}`}
                    style={{
                      left: `${cell.x * 100}%`,
                      top: `${cell.y * 100}%`,
                      width: `${cell.w * 100}%`,
                      height: `${cell.h * 100}%`,
                    }}
                    aria-pressed={selected}
                    aria-label={`${option.label}${cell.cropUrl ? '' : ' · 未裁剪'}`}
                    data-emotion={option.value}
                    onClick={() => setPreviewEmotion(option.value)}
                  >
                    <span>{option.label}</span>
                  </button>
                )
              })}
            </div>
          )}
          {sheetStale && <div className="expr-stale-badge">表情需重生成</div>}
        </div>
      )}

      <div className="char-expr-status">
        <span>当前预览：{previewLabel}{sheetStale ? ' · 已失效' : ''}</span>
        <span>{sheetCropCount}/8 格已裁剪</span>
      </div>
      {previewCell?.cropUrl && (
        <div className="char-expr-preview">
          <img src={previewCell.cropUrl} alt={`${previewLabel}预览`} />
          <span>分镜实际发送这一格，不发整张总图</span>
        </div>
      )}
      {sheet && (
        <div className="char-expr-actions">
          <button className="btn-mini" disabled={sheetBusy} onClick={() => void generateSheet()}>
            {sheetBusy ? '生成中…' : sheet ? '重生成总图' : '生成总图'}
            {price && !sheetBusy ? ` · 1 张 · ¥${money(imageCost(price, 1))}` : ''}
          </button>
          <button className="btn-mini ghost" onClick={() => exprFileRef.current?.click()}>
            上传 4×2 总图
          </button>
          <button className="btn-mini ghost" onClick={onPublishSheet}>
            发布到画布
          </button>
        </div>
      )}
      {!c.image && <div className="gen-note">当前没有三视图，生成总图只使用文字锚点，不保证长相一致。</div>}
      {sheetErrors.length > 0 && <div className="gen-warn">{sheetErrors.join('；')}</div>}
      {sheetError && <div className="gen-error">{sheetError}</div>}
      <input
        ref={exprFileRef}
        type="file"
        accept="image/*"
        hidden
        onChange={(e) => {
          const file = e.target.files?.[0]
          if (file) void uploadSheet(file)
          e.target.value = ''
        }}
      />
    </div>
  )

  const renderVoice = () => (
    <div className="char-voice-pane">
      {voices.length > 0 ? (
        <label className="char-voice">
          <span>音色</span>
          <select value={c.voiceId ?? ''} onChange={(e) => setVoice(e.target.value)}>
            <option value="">跟随镜头</option>
            {c.voiceId && !voices.some((v) => v.id === c.voiceId) && (
              <option value={c.voiceId}>未知/保留原值 · {c.voiceId}</option>
            )}
            {voiceOptions}
          </select>
        </label>
      ) : (
        <p className="st-hint">当前没有可用音色；先到设置页配置音频模型。</p>
      )}

      <div className="char-voice-sample">
        <div className="char-sample-head">
          <span>音色样本</span>
          <span className={sampleUsable ? 'char-sample-ok' : 'char-sample-bad'}>
            {c.voiceSample
              ? sampleStale
                ? '需要重生成'
                : sampleUsable
                  ? `${c.voiceSample.seconds.toFixed(1)}s · 可用`
                  : `${c.voiceSample.seconds.toFixed(1)}s · 不可用`
              : '未生成'}
          </span>
        </div>
        <div className="char-sample-actions">
          <button className="btn-mini" disabled={sampleBusy || !c.voiceId} onClick={() => void generateSample()}>
            {sampleBusy ? '生成中…' : c.voiceSample ? '重新生成样本' : '生成音色样本'}
          </button>
          {c.voiceSample && (
            <button className="btn-mini ghost" onClick={() => onPersist(patch(c.id, { voiceSample: undefined }))}>
              删除
            </button>
          )}
          <button className="btn-mini ghost" onClick={openEdit}>
            编辑试音稿
          </button>
        </div>
        {!c.voiceId && <span className="char-sample-hint">先选音色</span>}
        {c.voiceSample && <audio className="char-sample-audio" src={c.voiceSample.url} controls preload="metadata" />}
        {sampleStale && <div className="gen-warn">音色、音频模型或试音稿已变化，请重新生成样本。</div>}
        {c.voiceSample && !sampleStale && !isVoiceSampleUsable(c.voiceSample) && (
          <div className="gen-warn">样本需 2-30 秒才能作为 Seedance 音色参考。</div>
        )}
        {sampleError && <div className="gen-error">{sampleError}</div>}
      </div>
    </div>
  )

  return (
    <div className={`char-card char-card-v2 ${editing ? 'editing' : ''}`}>
      <div className="char-head">
        <span className="char-name">{c.name}</span>
        <span className="char-role">{c.role || '未定位'}</span>
        <span className="char-age">{c.age || '年龄未填'}</span>
        <span className={`char-status ${status === '就绪' ? 'ok' : status === '生成中' ? 'run' : 'warn'}`}>
          {status}
        </span>
        <span className="char-head-acts">
          <button className="btn-mini" onClick={openEdit} title="编辑身份锚点、试音稿">
            编辑
          </button>
          <button
            className="btn-mini danger"
            onClick={() => {
              if (window.confirm(`删除角色「${c.name}」？相关参考连线会一起解除`)) onDelete()
            }}
            title="删除这张角色卡"
          >
            删除
          </button>
        </span>
      </div>

      <div className="char-tabs" role="tablist" aria-label="角色资料">
        <button
          role="tab"
          aria-selected={tab === 'turnaround'}
          className={tab === 'turnaround' ? 'on' : ''}
          onClick={() => setTab('turnaround')}
        >
          三视图
        </button>
        <button
          role="tab"
          aria-selected={tab === 'sheet'}
          className={tab === 'sheet' ? 'on' : ''}
          onClick={() => setTab('sheet')}
        >
          表情总图
        </button>
        <button
          role="tab"
          aria-selected={tab === 'voice'}
          className={tab === 'voice' ? 'on' : ''}
          onClick={() => setTab('voice')}
        >
          音色
        </button>
      </div>

      <div className="char-main" role="tabpanel">
        {tab === 'turnaround' ? renderTurnaround() : tab === 'sheet' ? renderSheet() : renderVoice()}
      </div>

      <div className="char-summary">
        <span>音色：{voiceLabel}</span>
        <span>表情 {expressionDone}/8{!sheet && legacyCount ? '（旧）' : ''}</span>
        <span className="char-budget" title="视频参考最多 4 张；表情默认关闭，开启后只带说话角色一张">
          {selectedShot
            ? selectedBudget
              ? `本镜 ${selectedShot.no} · 参考 ${selectedBudget.used}/${selectedBudget.max} · 表情${selectedBudget.expression ? '开' : '关'}${selectedBudget.omitted ? ` · 省略 ${selectedBudget.omitted}` : ''}`
              : `本镜 ${selectedShot.no} · 视频表情默认关`
            : '未选中镜头'}
        </span>
      </div>

      <div className="char-primary">
        <button className="btn" disabled={primary.disabled} onClick={primary.run}>
          {primary.label}
          {price && primary.cost > 0 ? ` · ¥${money(primary.cost)}` : ''}
        </button>
      </div>

      <details className="char-more">
        <summary>更多</summary>
        <div className="char-more-body">
          <button className="btn-mini ghost" onClick={() => fileRef.current?.click()}>
            上传三视图
          </button>
          <button className="btn-mini ghost" onClick={onInject} disabled={!canInject}>
            注入镜头
          </button>
          {imageMissing && (
            <button className="btn-mini ghost" onClick={clearImage}>
              清除缺失引用
            </button>
          )}
          <input
            ref={fileRef}
            type="file"
            accept="image/*"
            hidden
            onChange={(e) => {
              const file = e.target.files?.[0]
              if (file) void uploadTurnaround(file)
              e.target.value = ''
            }}
          />
        </div>
      </details>

      {c.state === 'error' && c.error && <div className="gen-error">{c.error}</div>}

      {editing && (
        <div className="char-drawer-backdrop" onMouseDown={(e) => e.target === e.currentTarget && cancelEdit()}>
          <div className="char-drawer" role="dialog" aria-modal="true" aria-label={`编辑角色 ${c.name}`}>
            <header className="char-drawer-head">
              <b>编辑角色</b>
              <button className="btn-mini ghost" onClick={cancelEdit} aria-label="关闭编辑">
                关闭
              </button>
            </header>
            <div className="char-drawer-body">
              <div className="char-edit">
                <label>
                  <span>角色名</span>
                  <input data-char-field="name" value={draft.name} onChange={(e) => setDraft({ ...draft, name: e.target.value })} />
                </label>
                <label>
                  <span>定位</span>
                  <input data-char-field="role" value={draft.role} onChange={(e) => setDraft({ ...draft, role: e.target.value })} />
                </label>
                <label>
                  <span>年龄</span>
                  <input data-char-field="age" value={draft.age} onChange={(e) => setDraft({ ...draft, age: e.target.value })} />
                </label>
                <label className="wide">
                  <span>中文外观</span>
                  <textarea data-char-field="lookCn" rows={2} value={draft.lookCn} onChange={(e) => setDraft({ ...draft, lookCn: e.target.value })} />
                </label>
                <label className="wide">
                  <span>英文锚点（lookEn，注入提示词）</span>
                  <textarea data-char-field="lookEn" rows={3} value={draft.lookEn} onChange={(e) => setDraft({ ...draft, lookEn: e.target.value })} />
                </label>
                <label>
                  <span>配色</span>
                  <input data-char-field="palette" value={draft.palette} onChange={(e) => setDraft({ ...draft, palette: e.target.value })} />
                </label>
                <label>
                  <span>关键词（顿号/逗号分隔）</span>
                  <input data-char-field="keywords" value={draft.keywords} onChange={(e) => setDraft({ ...draft, keywords: e.target.value })} />
                </label>
                <label className="wide">
                  <span>试音稿</span>
                  <textarea data-char-field="sampleText" rows={3} value={sampleText} onChange={(e) => setSampleText(e.target.value)} />
                </label>
              </div>
            </div>
            <footer className="char-drawer-foot">
              <button className="btn-ghost" onClick={cancelEdit}>取消</button>
              <button className="btn" onClick={saveEdit}>保存</button>
            </footer>
          </div>
        </div>
      )}
    </div>
  )
}

function readFile(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => resolve(String(reader.result || ''))
    reader.onerror = () => reject(new Error('读取图片失败'))
    reader.readAsDataURL(file)
  })
}
