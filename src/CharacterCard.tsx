import { useEffect, useRef, useState } from 'react'
import { generateImage, generateVoice, listVoicesCached, type AppSettings, type VoiceOption } from './api'
import { ACCEPT_ATTR, uploadImageFile } from './mediaUpload'
import {
  DEFAULT_VOICE_SAMPLE_TEXT,
  TURNAROUND_SUFFIX,
  identityFingerprint,
  isVoiceSampleUsable,
  voiceSampleFingerprint,
  REFERENCE_LIMIT,
  type CharacterExpressionSheet,
  type CharacterSheet,
  type VoiceSample,
} from './characters'
import { cropExpressionSheet } from './expressionCrop'
import {
  buildExpressionSheetCells,
  canGenerateExpressionSheet,
  cellForEmotion,
  expressionSheetPrompt,
  isSheetUsable,
} from './expressionSheet'
import { EMOTION_OPTIONS } from './performance'
import { imageCost, money, type Pricing } from './pricing'
import { endTask, startTask } from './tasks'
import type { PerformanceEmotion } from './types'
import {
  providerIdForAudioModelKey,
  resolveCharacterAudioModelKey,
  VOICE_SOURCE_LABELS,
} from './voiceCatalog'
import { CapModelSelect } from './ModelSelect'
import { CharacterImageCropModal } from './CharacterImageCropModal'
import type { MaterialCropPlan } from './imageMaterialCrop'
import {
  materialUploadGateFromFile,
  materialUploadGateFromUrl,
  releaseMaterialCropPlan,
} from './materialImageGate'
import {
  resolveVoiceUiState,
  voiceIdInCatalog,
  voiceSummaryLine,
  type VoiceUiInput,
} from './voiceUiState'

type CropPending = {
  plan: MaterialCropPlan
  kind: 'ref' | 'turnaround' | 'promote' | 'sheet' | 'generated'
  /** 生成三视图返回的多张候选；裁切确认后写回 */
  pendingUrls?: string[]
  candIdx?: number
}

type Props = {
  c: CharacterSheet
  patch: (id: string, p: Partial<CharacterSheet>) => CharacterSheet[]
  canInject: boolean
  onInject: () => void
  settings: AppSettings | null
  onDelete: () => void
  onRename: (name: string) => void
  viewModel?: string
  price?: Pricing
  projectName: string
  onPersist: (next: CharacterSheet[]) => void
  onPublishSheet: () => void
  selectedShot: { id: string; no: string } | null
  selectedBudget?: { used: number; max: number | null; expression: boolean; omitted: number } | null
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
  settings,
  onDelete,
  onRename,
  viewModel,
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
  const refFileRef = useRef<HTMLInputElement>(null)
  const voiceSelectRef = useRef<HTMLSelectElement>(null)
  const [refBusy, setRefBusy] = useState(false)
  const [refError, setRefError] = useState('')
  const [cropPending, setCropPending] = useState<CropPending | null>(null)
  const [cropBusy, setCropBusy] = useState(false)
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
  const [voices, setVoices] = useState<VoiceOption[]>([])
  const [engineSwitchHint, setEngineSwitchHint] = useState(false)
  const characterAudioModelKey = resolveCharacterAudioModelKey(c, settings)

  useEffect(() => {
    setSampleText(c.voiceSample?.text || DEFAULT_VOICE_SAMPLE_TEXT)
  }, [c.id, c.voiceSample?.text])

  useEffect(() => {
    let alive = true
    listVoicesCached(characterAudioModelKey || undefined).then((v) => {
      if (!alive) return
      setVoices(v.voices)
    })
    return () => {
      alive = false
    }
  }, [characterAudioModelKey])

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
  const canGenExpressionSheet = canGenerateExpressionSheet(c, { imageMissing })
  const legacyCount = Object.values(c.expressions ?? {}).filter((e) => Boolean(e?.image)).length
  const expressionDone = sheet ? sheetCropCount : legacyCount
  const previewCell = sheet ? cellForEmotion(sheet, previewEmotion) : undefined
  const previewLabel = exprLabel(previewEmotion)
  const voiceLabel =
    voices.find((v) => v.id === c.voiceId)?.label || c.voiceId || '未选音色'
  const sampleStale = Boolean(
    c.voiceSample &&
      (c.voiceSample.stale ||
        sampleText !== c.voiceSample.text ||
        c.voiceSample.modelKey !== characterAudioModelKey ||
        c.voiceSample.fingerprint !==
          voiceSampleFingerprint({
            url: c.voiceSample.url,
            text: c.voiceSample.text,
            voiceId: c.voiceSample.voiceId,
            modelKey: c.voiceSample.modelKey,
            engine: c.voiceSample.engine,
          })),
  )
  const voiceUiInput: VoiceUiInput = {
    projectName,
    character: c,
    settings,
    voicesCount: voices.length,
    sampleStale,
    sampleText,
    voiceSample: c.voiceSample,
  }
  const voiceUi = resolveVoiceUiState(voiceUiInput)
  const voiceSummary = voiceSummaryLine(voiceUiInput)
  const samplePreview =
    sampleText.trim().split(/\n/).slice(0, 2).join(' ').trim().slice(0, 120) ||
    DEFAULT_VOICE_SAMPLE_TEXT.slice(0, 80)

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
          disabled: sheetBusy || !canGenExpressionSheet,
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
      const refs = c.referenceImages ?? []
      const res = await generateImage({
        prompt: `${c.lookEn}, ${TURNAROUND_SUFFIX}`,
        ratio: '16:9',
        n: 2,
        cap: 'view',
        modelKey: viewModel,
        project: projectName,
        // 参考图作为身份输入；没有就不传，保持与旧行为一致
        ...(refs.length ? { refImages: refs } : {}),
      })
      const urls = res.urls?.length ? res.urls : [res.url]
      const gate = await materialUploadGateFromUrl(urls[0], 'char-gen')
      if (gate.mode === 'crop') {
        setCropPending({ plan: gate.plan, kind: 'generated', pendingUrls: urls })
        patch(c.id, { state: 'idle' })
        endTask(tid)
        return
      }
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
    if (!canGenerateExpressionSheet(c, { imageMissing })) {
      setSheetError('先填英文外观锚点（lookEn），或上传/生成三视图及参考图后再生成表情总图')
      return
    }
    setSheetError('')
    setSheetErrors([])
    setSheetBusy(true)
    const tid = startTask('image', `表情总图 ${c.name}`, {
      cost: price ? imageCost(price, 1) : undefined,
    })
    try {
      const refs = c.referenceImages ?? []
      const refOnly = !c.lookEn.trim()
      const refNote = refOnly
        ? '外观以参考图为准；只按格位变化表情，不要换成另一个人。'
        : refs.length
          ? '图 1 是当前三视图，其余是同一角色的其他参考；不要把它们当成不同人物。'
          : ''
      const res = await generateImage({
        prompt: `${expressionSheetPrompt(c.lookEn)}${refNote ? ` ${refNote}` : ''}`,
        ratio: '16:9',
        n: 1,
        cap: 'view',
        modelKey: viewModel,
        project: projectName,
        ...(c.image ? { refImage: c.image } : {}),
        ...(refs.length ? { refImages: refs } : {}),
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

  const releaseCropPlan = (plan: MaterialCropPlan | null | undefined) => {
    releaseMaterialCropPlan(plan)
  }

  const cancelCrop = () => {
    releaseCropPlan(cropPending?.plan)
    setCropPending(null)
    setCropBusy(false)
  }

  const persistTurnaroundUrl = (url: string) => {
    const next = patch(c.id, {
      image: url,
      candidates: undefined,
      activeIdx: undefined,
      state: 'idle',
      error: undefined,
    })
    onPersist(next)
  }

  const uploadTurnaroundFile = async (file: File) => {
    if (!projectName) {
      patch(c.id, { state: 'error', error: '先选择项目再上传图片' })
      return
    }
    patch(c.id, { state: 'running', error: undefined })
    try {
      const url = await uploadImageFile(file, { project: projectName, prefix: 'char' })
      persistTurnaroundUrl(url)
    } catch (e) {
      patch(c.id, { state: 'error', error: (e as Error).message })
    }
  }

  const uploadTurnaround = async (file: File) => {
    const gate = await materialUploadGateFromFile(file)
    if (!gate.ok) {
      patch(c.id, { state: 'error', error: gate.reason })
      return
    }
    if (gate.mode === 'crop') {
      setCropPending({ plan: gate.plan, kind: 'turnaround' })
      return
    }
    await uploadTurnaroundFile(gate.file)
  }

  const persistReferenceUrl = (url: string) => {
    const refs = [...(c.referenceImages ?? []), url].slice(0, REFERENCE_LIMIT)
    onPersist(patch(c.id, { referenceImages: refs }))
  }

  /** 上传参考图：保存成功才写状态；不依赖英文锚点 */
  const uploadReferenceFile = async (file: File) => {
    if (!projectName) {
      setRefError('先选择项目再上传参考图')
      return
    }
    setRefError('')
    setRefBusy(true)
    try {
      const url = await uploadImageFile(file, { project: projectName, prefix: 'char-ref' })
      persistReferenceUrl(url)
    } catch (e) {
      setRefError((e as Error).message || '上传失败')
    } finally {
      setRefBusy(false)
    }
  }

  const uploadReference = async (file: File) => {
    const gate = await materialUploadGateFromFile(file)
    if (!gate.ok) {
      setRefError(gate.reason)
      return
    }
    if (gate.mode === 'crop') {
      setCropPending({ plan: gate.plan, kind: 'ref' })
      return
    }
    await uploadReferenceFile(gate.file)
  }

  const confirmCropUpload = async () => {
    if (!cropPending) return
    const { plan, kind, pendingUrls, candIdx } = cropPending
    setCropBusy(true)
    try {
      const file = plan.croppedFile
      if (kind === 'ref') {
        await uploadReferenceFile(file)
      } else if (kind === 'sheet') {
        await persistExpressionSheetUpload(file)
      } else if (kind === 'generated') {
        if (!projectName) {
          patch(c.id, { state: 'error', error: '先选择项目' })
          return
        }
        const url = await uploadImageFile(file, { project: projectName, prefix: 'char' })
        const rest = pendingUrls?.slice(1) ?? []
        onPersist(
          patch(c.id, { candidates: [url, ...rest], activeIdx: 0, image: url, state: 'idle', error: undefined }),
        )
      } else if (kind === 'turnaround' && candIdx !== undefined) {
        if (!projectName) {
          patch(c.id, { state: 'error', error: '先选择项目' })
          return
        }
        const url = await uploadImageFile(file, { project: projectName, prefix: 'char' })
        const prev = [...(c.candidates ?? [])]
        if (candIdx >= 0 && candIdx < prev.length) prev[candIdx] = url
        else prev.push(url)
        onPersist(patch(c.id, { image: url, candidates: prev, activeIdx: candIdx, state: 'idle', error: undefined }))
      } else if (kind === 'turnaround') {
        await uploadTurnaroundFile(file)
      } else {
        if (!projectName) {
          setRefError('先选择项目')
          return
        }
        setRefBusy(true)
        const url = await uploadImageFile(file, { project: projectName, prefix: 'char' })
        persistTurnaroundUrl(url)
        setRefBusy(false)
      }
      releaseCropPlan(plan)
      setCropPending(null)
    } catch (e) {
      const msg = (e as Error).message || '上传失败'
      if (kind === 'ref') setRefError(msg)
      else if (kind === 'sheet') setSheetError(msg)
      else patch(c.id, { state: 'error', error: msg })
    } finally {
      setCropBusy(false)
      setRefBusy(false)
    }
  }

  /** 设为三视图：该图成为当前 image 并进入候选；参考图列表保留它作为输入记录 */
  const promoteReference = async (url: string) => {
    const gate = await materialUploadGateFromUrl(url, 'char-promote')
    if (gate.mode === 'crop') {
      setCropPending({ plan: gate.plan, kind: 'promote' })
      return
    }
    const candidates = [...new Set([...(c.candidates ?? []), url])]
    onPersist(
      patch(c.id, {
        image: url,
        candidates,
        activeIdx: candidates.indexOf(url),
        state: 'idle',
        error: undefined,
      }),
    )
  }

  const persistExpressionSheetUpload = async (file: File) => {
    if (!projectName) {
      setSheetError('先选择项目再上传表情总图')
      return
    }
    setSheetError('')
    setSheetErrors([])
    setSheetBusy(true)
    try {
      const image = await uploadImageFile(file, { project: projectName, prefix: 'char-expr-sheet' })
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

  const uploadSheet = async (file: File) => {
    const gate = await materialUploadGateFromFile(file)
    if (!gate.ok) {
      setSheetError(gate.reason)
      return
    }
    if (gate.mode === 'crop') {
      setCropPending({ plan: gate.plan, kind: 'sheet' })
      return
    }
    await persistExpressionSheetUpload(gate.file)
  }

  const selectTurnaroundCandidate = async (url: string, i: number) => {
    const gate = await materialUploadGateFromUrl(url, 'char-cand')
    if (gate.mode === 'crop') {
      setCropPending({ plan: gate.plan, kind: 'turnaround', candIdx: i })
      return
    }
    onPersist(patch(c.id, { activeIdx: i, image: url }))
  }

  const generateSample = async () => {
    if (!voiceUi.canGenerateSample) {
      setSampleError(voiceUi.message)
      return
    }
    const voiceId = c.voiceId?.trim()
    if (!voiceId) {
      setSampleError('请先选择说话音色')
      return
    }
    setSampleBusy(true)
    setSampleError('')
    try {
      const r = await generateVoice({
        text: sampleText,
        voice: voiceId,
        project: projectName,
        purpose: 'character-sample',
        modelKey: characterAudioModelKey || undefined,
      })
      const sample: VoiceSample = {
        url: r.url,
        text: sampleText,
        seconds: r.seconds,
        engine: r.engine,
        voiceId,
        modelKey: characterAudioModelKey || undefined,
        fingerprint: voiceSampleFingerprint({
          url: r.url,
          text: sampleText,
          voiceId,
          modelKey: characterAudioModelKey || undefined,
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
    const modelKey = characterAudioModelKey || undefined
    const provider = providerIdForAudioModelKey(settings, modelKey || '') || chosen?.provider
    setEngineSwitchHint(false)
    const next = patch(c.id, {
      voiceId: voiceId || undefined,
      voiceProvider: provider,
      voiceModelKey: modelKey,
    })
    onPersist(next)
  }

  const setAudioModel = (key: string) => {
    void (async () => {
      const trimmed = key.trim()
      const resolvedKey = trimmed || String(settings?.defaults?.audio || '').trim()
      const provider = providerIdForAudioModelKey(settings, resolvedKey)
      const list = await listVoicesCached(resolvedKey || undefined, true)
      setVoices(list.voices)
      const fields: Partial<CharacterSheet> = {
        voiceModelKey: trimmed || undefined,
      }
      const inCatalog = voiceIdInCatalog(c.voiceId, list.voices)
      if (c.voiceId && !inCatalog) {
        fields.voiceId = undefined
        fields.voiceProvider = provider || undefined
        if (c.voiceSample) fields.voiceSample = { ...c.voiceSample, stale: true }
        setEngineSwitchHint(true)
      } else {
        fields.voiceProvider = provider || undefined
        if (
          c.voiceSample &&
          provider &&
          c.voiceProvider &&
          provider !== c.voiceProvider
        ) {
          fields.voiceSample = { ...c.voiceSample, stale: true }
        }
        setEngineSwitchHint(false)
      }
      onPersist(patch(c.id, fields))
    })()
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

  /**
   * 参考图区：只作为生成三视图/表情总图的身份输入，不进入分镜参考预算。
   * 要让它参与分镜，必须显式「设为三视图」。
   */
  const renderReferenceImages = () => {
    const refs = c.referenceImages ?? []
    const full = refs.length >= REFERENCE_LIMIT
    return (
      <div className="char-refs" data-char-refs>
        <div className="char-refs-head">
          <span className="char-label">参考图</span>
          <span className="char-refs-count">
            {refs.length}/{REFERENCE_LIMIT}
          </span>
          <span className="char-refs-hint">
            只用于生成三视图与表情总图，不进分镜参考；过竖/过宽图上传时会提示中心裁切（适配视频参考）
          </span>
        </div>
        {refs.length > 0 ? (
          <div className="char-refs-grid">
            {refs.map((url) => {
              const inCandidates = (c.candidates ?? []).includes(url) || c.image === url
              return (
                <figure className="char-ref" key={url}>
                  <img src={url} alt="角色参考图" onError={() => onImageMissing(url)} />
                  <figcaption>
                    {inCandidates ? (
                      <span className="char-ref-flag">已在候选</span>
                    ) : (
                      <button
                        className="btn-mini"
                        onClick={() => void promoteReference(url)}
                        title="把这张设成当前三视图，此后它才会进入分镜参考"
                      >
                        设为三视图
                      </button>
                    )}
                    <button
                      className="btn-mini danger"
                      onClick={() => onPersist(patch(c.id, { referenceImages: refs.filter((r) => r !== url) }))}
                      title="只从参考图列表移除，不删文件"
                    >
                      移除
                    </button>
                  </figcaption>
                </figure>
              )
            })}
          </div>
        ) : (
          <p className="char-refs-empty">还没有参考图。上传同一角色、同一画风的照片可帮助锁定长相。</p>
        )}
        <div className="char-refs-actions">
          <button
            className="btn-mini ghost"
            disabled={full || refBusy}
            onClick={() => refFileRef.current?.click()}
            title={full ? `最多 ${REFERENCE_LIMIT} 张` : '上传本地图片作为参考图'}
          >
            {refBusy ? '上传中…' : full ? `已达 ${REFERENCE_LIMIT} 张上限` : '上传参考图'}
          </button>
        </div>
        {refError ? <div className="gen-error">{refError}</div> : null}
        <input
          ref={refFileRef}
          type="file"
          accept={ACCEPT_ATTR}
          hidden
          onChange={(e) => {
            const file = e.target.files?.[0]
            if (file) void uploadReference(file)
            e.target.value = ''
          }}
        />
      </div>
    )
  }

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
                onClick={() => void selectTurnaroundCandidate(url, i)}
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
      {renderReferenceImages()}
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
              disabled={sheetBusy || !canGenExpressionSheet}
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
      {!c.image && !c.lookEn.trim() && !(c.referenceImages ?? []).length && (
        <div className="gen-note">没有三视图与参考图时，需先补 lookEn；仅有参考图时可仅凭图生成。</div>
      )}
      {!c.image && (c.lookEn.trim() || (c.referenceImages ?? []).length) && (
        <div className="gen-note">
          {c.lookEn.trim()
            ? '当前没有三视图，生成总图只使用文字锚点与参考图，不保证长相一致。'
            : '未填 lookEn，生成总图以参考图为准。'}
        </div>
      )}
      {sheetErrors.length > 0 && <div className="gen-warn">{sheetErrors.join('；')}</div>}
      {sheetError && <div className="gen-error">{sheetError}</div>}
      <input
        ref={exprFileRef}
        type="file"
        accept={ACCEPT_ATTR}
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
    <div className="char-voice-pane" data-char-voice-pane>
      <details className="char-voice-status-wrap" open>
        <summary className="char-voice-status-label">状态</summary>
        <div
          className={`char-voice-status tone-${voiceUi.tone}`}
          data-char-voice-status
          data-voice-ui-kind={voiceUi.kind}
        >
          <p className="char-voice-status-msg">{voiceUi.message}</p>
          {voiceUi.primaryAction === 'pick_voice' && (
            <button
              type="button"
              className="btn-mini"
              onClick={() => voiceSelectRef.current?.focus()}
            >
              重选音色
            </button>
          )}
          {voiceUi.primaryAction === 'generate_sample' && voiceUi.canGenerateSample && (
            <button type="button" className="btn-mini" disabled={sampleBusy} onClick={() => void generateSample()}>
              {sampleBusy ? '生成中…' : '生成试音'}
            </button>
          )}
        </div>
      </details>

      {engineSwitchHint && (
        <p className="char-voice-inline-hint">配音引擎已切换，请重新选择音色后再生成试音。</p>
      )}

      <section className="char-voice-block" data-char-voice-block="engine">
        <h4 className="char-voice-block-title">配音引擎</h4>
        <CapModelSelect
          cap="audio"
          label="引擎"
          settings={settings}
          value={c.voiceModelKey || ''}
          onChange={setAudioModel}
          className="char-voice-model wb-field"
        />
      </section>

      <section className="char-voice-block" data-char-voice-block="voice">
        <h4 className="char-voice-block-title">说话音色</h4>
        {voices.length > 0 ? (
          <label className="char-voice">
            <span>音色</span>
            <select
              ref={voiceSelectRef}
              value={c.voiceId ?? ''}
              onChange={(e) => setVoice(e.target.value)}
            >
              <option value="">跟随镜头（试音需固定音色）</option>
              {c.voiceId && !voices.some((v) => v.id === c.voiceId) && (
                <option value={c.voiceId}>未知/保留原值 · {c.voiceId}</option>
              )}
              {voiceOptions}
            </select>
          </label>
        ) : (
          <p className="st-hint">当前引擎没有可用音色；请到设置页检查 Key 或更换引擎。</p>
        )}
      </section>

      <section className="char-voice-block char-voice-sample gen-box voice-box" data-char-voice-block="sample">
        <h4 className="char-voice-block-title">试音样本</h4>
        <p className="char-sample-script">
          <span className="char-sample-script-text">{samplePreview}</span>
          <button type="button" className="btn-mini ghost" onClick={openEdit}>
            编辑试音稿
          </button>
        </p>
        {c.voiceSample && (
          <audio className="char-sample-audio" src={c.voiceSample.url} controls preload="metadata" />
        )}
        <div className="char-sample-actions">
          <button
            type="button"
            className="btn primary char-sample-generate"
            data-char-generate-sample
            disabled={sampleBusy || !voiceUi.canGenerateSample}
            onClick={() => void generateSample()}
          >
            {sampleBusy ? '生成中…' : c.voiceSample ? '重新生成试音' : '生成试音'}
          </button>
          {c.voiceSample && (
            <button
              type="button"
              className="btn-mini ghost"
              onClick={() => onPersist(patch(c.id, { voiceSample: undefined }))}
            >
              删除样本
            </button>
          )}
        </div>
        {sampleError && <div className="gen-error">{sampleError}</div>}
      </section>

      <p className="char-voice-footnote">
        镜头台词在分镜 Inspector「更多」编辑；有声成片依赖视频音轨。本页配置角色声线与试音参考。
      </p>
    </div>
  )

  return (
    <div className={`char-card char-card-v2 ${editing ? 'editing' : ''}`} data-char-card={c.id}>
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
          data-char-tab="voice"
          data-voice-ready={voiceUi.tabDot}
          onClick={() => setTab('voice')}
        >
          声音
        </button>
      </div>

      <div className="char-main" role="tabpanel">
        {tab === 'turnaround' ? renderTurnaround() : tab === 'sheet' ? renderSheet() : renderVoice()}
      </div>

      <div className="char-summary">
        <span className="char-voice-summary" title={voiceLabel}>
          声音：{voiceSummary}
        </span>
        <span>表情 {expressionDone}/8{!sheet && legacyCount ? '（旧）' : ''}</span>
        <span className="char-budget" title="视频参考图随连线提交；表情默认关闭，开启后只带说话角色一张">
          {selectedShot
            ? selectedBudget
              ? `本镜 ${selectedShot.no} · 参考 ${selectedBudget.used}${selectedBudget.max != null ? `/${selectedBudget.max}` : ''} · 表情${selectedBudget.expression ? '开' : '关'}${selectedBudget.omitted ? ` · 省略 ${selectedBudget.omitted}` : ''}`
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
            accept={ACCEPT_ATTR}
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

      <CharacterImageCropModal
        open={Boolean(cropPending)}
        title={
          cropPending?.kind === 'ref'
            ? '裁切参考图'
            : cropPending?.kind === 'promote'
              ? '裁切后设为三视图'
              : cropPending?.kind === 'sheet'
                ? '裁切表情总图'
                : cropPending?.kind === 'generated'
                  ? '裁切生成的三视图'
                  : '裁切三视图'
        }
        plan={cropPending?.plan ?? null}
        busy={cropBusy || refBusy}
        onConfirm={() => void confirmCropUpload()}
        onCancel={cancelCrop}
      />

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

