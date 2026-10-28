import { useEffect, useMemo, useState } from 'react'
import {
  getSettings,
  saveSettings,
  testProvider,
  type AppSettings,
  type Cap,
  type ModelEntry,
  type ModelFeatureSet,
  type Provider,
  type ProviderCap,
  type ProviderKind,
  type ProviderTestResult,
  listVoices,
  generateVoice,
  type LipSyncSettings,
  type CustomVoice,
  type VoiceList,
  type VoiceOption,
  type RulePack,
  type Stage,
} from '../api'
import { CAP_LABELS, CAP_ORDER, isRunnableModel, modelCaps, modelCapsLabel, modelHasCap } from '../modelCaps'
import { normalizeRules } from '../skills/legacyPrompts'
import { getContract } from '../skills/contracts'
import { listSkillTexts, resetSkillOverride, saveSkillOverride } from '../skills/api'
import { composeSkillBody, parseSkillText } from '../skills/parse'
import type { Skill, SkillTextRecord } from '../skills/types'
import {
  AGENT_LIMIT_DEFAULTS,
  AGENT_LIMIT_RANGES,
  normalizeAgentLimits,
  type AgentLimitSettings,
} from '../agent/agentLimits'
import {
  CREATIVE_ANALYSIS_DEPTHS,
  CREATIVE_DEFAULTS,
  normalizeCreativeSettings,
  type CreativeAnalysisDepth,
  type CreativeSettings,
} from '../creative/settings'
import { listCreativeAdapters, type AdapterInfo } from '../creative/mediaApi'
import { findToolCapability, normalizeToolProtocol, type ToolProtocol } from '../agent/toolCapabilities'
import {
  DEFAULT_SCENE_AGENT_ENGINE,
  normalizeSceneAgentEngine,
  type SceneAgentEngine,
} from '../agent/sceneAgentEngine'
import { resolveStageModel, stageModelEntries, textModelEntries } from '../ModelSelect'
import { DEFAULT_PRICING, normalizePricing, type Pricing } from '../pricing'
import CatalogDialog, { type CatalogEntry } from './CatalogDialog'
import { fetchStockProviders } from '../stock/api'
import type { StockProviderId, StockSettings } from '../stock/types'
import { VOICE_SOURCE_LABELS } from '../voiceCatalog'
import ProjectManagerDialog from '../project/ProjectManagerDialog'

type Props = {
  toast: (m: string) => void
  onSaved?: () => void
  /** 项目删除成功：父级刷新项目列表与全局上下文 */
  onProjectsDeleted?: (names: string[]) => void | Promise<void>
}
type Section =
  | 'providers'
  | 'models'
  | 'routing'
  | 'agent'
  | 'creative'
  | 'stock'
  | 'pricing'
  | 'lipsync'
  | 'voices'
  | 'skills'
  | 'data'

const DEFAULT_LIP_SYNC: LipSyncSettings = {
  provider: 'off',
  baseUrl: 'https://api.sync.so',
  apiKey: '',
  pricePerSecond: 0,
}

function normalizeLipSyncSettings(raw?: LipSyncSettings): LipSyncSettings {
  return {
    provider: raw?.provider === 'sync-labs' ? 'sync-labs' : 'off',
    baseUrl: String(raw?.baseUrl || 'https://api.sync.so'),
    apiKey: String(raw?.apiKey || ''),
    pricePerSecond: Math.max(0, Number(raw?.pricePerSecond) || 0),
  }
}

const CAP_META: { cap: Cap; label: string; hint: string }[] = [
  { cap: 'text', label: '文本 · 常规', hint: '拆镜/提示词之外的批量生成' },
  { cap: 'textPro', label: '文本 · 高质量', hint: '拆镜 / 拆角色 / 长输出' },
  { cap: 'vision', label: '视觉 · 图像理解', hint: '3D 参考板 / 素材 brief；只选实际支持图像输入的模型' },
  { cap: 'videoVision', label: '视觉 · 视频理解', hint: '首次 3D 代码生成的视频理解；本地视频不支持时回退关键帧' },
  { cap: 'image', label: '图像 · 出画面', hint: '画布生成画面' },
  { cap: 'view', label: '图像 · 角色三视图', hint: '角色板生成三视图' },
  { cap: 'video', label: '视频 · 首帧出片', hint: '单图图生视频；2.0+ 可带视频参考' },
  { cap: 'videoRef', label: '视频 · 多参考图 / 视频参考', hint: 'reference_image 1~4 张；2.0+ 可带 reference_video' },
  { cap: 'audio', label: '音频 · 配音', hint: '台词合成' },
]

const CAP_TO_PC: Record<Cap, ProviderCap> = {
  text: 'text',
  textPro: 'text',
  vision: 'text',
  videoVision: 'text',
  image: 'image',
  view: 'image',
  video: 'video',
  videoRef: 'video',
  audio: 'audio',
}

const PROVIDER_CAPS: { pc: ProviderCap; label: string }[] = [
  { pc: 'text', label: '文本' },
  { pc: 'image', label: '图像' },
  { pc: 'video', label: '视频' },
  { pc: 'audio', label: '音频' },
]

const KIND_META: { kind: ProviderKind; label: string }[] = [
  { kind: 'apimart', label: 'APIMart（APIB）' },
  { kind: 'ark', label: '字节方舟（ARK）' },
  { kind: 'ark-plan', label: '字节方舟 · Agent Plan' },
  { kind: 'openai', label: 'OpenAI 兼容' },
  { kind: 'minimax', label: 'MiniMax' },
  { kind: 'elevenlabs', label: 'ElevenLabs' },
  { kind: 'volc-tts', label: '火山语音 · Seed TTS' },
]

const STAGE_META: { stage: Stage; label: string; hint: string }[] = [
  { stage: 'script', label: '剧本（拆集）', hint: '原著 → 分集剧本' },
  { stage: 'character', label: '角色（拆角色）', hint: '剧本/分镜 → 角色外观锚点' },
  { stage: 'asset', label: '素材（拆场景/道具）', hint: '剧本/分镜 → 场景空镜与关键道具' },
  { stage: 'shot', label: '镜头表（拆镜）', hint: '一集场次 → 镜头列表；3D 文本编排也用它' },
  { stage: 'prompt', label: '提示词（首帧/视频）', hint: '镜头 → keyframe_prompt / video_prompt' },
  { stage: 'sceneCode', label: '3D 代码（生成/聊天）', hint: '参考内容 → Blender Python 代码；空则沿用文本默认' },
  { stage: 'vision', label: '视觉（素材 brief）', hint: '选中图片/视频关键帧 → MediaBrief；未绑定则素材只给标签' },
  { stage: 'videoVision', label: '视频理解（首次 3D）', hint: '可选；本地视频不支持时回退关键帧，聊天不使用' },
  { stage: 'publish', label: '发布（发布助手）', hint: '发布台聊天助手；空则沿用文本默认' },
]

type AddPreset = Omit<Provider, 'apiKey' | 'keyAvailable'> & { custom?: boolean }

const PROVIDER_PRESETS: AddPreset[] = [
  {
    id: 'apimart',
    label: 'APIMart（APIB）',
    kind: 'apimart',
    baseUrl: 'https://api.apimart.ai/v1',
    note: '文本 / 图像 / 视频 / 配音；目录可同步全部模型',
    caps: ['text', 'image', 'video', 'audio'],
  },
  {
    id: 'ark',
    label: '字节 · 火山方舟',
    kind: 'ark',
    baseUrl: 'https://ark.cn-beijing.volces.com/api/v3',
    note: '文本 / Seedream 生图 / Seedance 视频',
    caps: ['text', 'image', 'video'],
  },
  {
    id: 'ark-plan',
    label: '字节 · Agent Plan',
    kind: 'ark-plan',
    baseUrl: 'https://ark.cn-beijing.volces.com/api/plan/v3',
    note: 'Agent Plan 专属 Key；文本/图片可用',
    caps: ['text', 'image'],
  },
  {
    id: 'deepseek',
    label: 'DeepSeek',
    kind: 'openai',
    baseUrl: 'https://api.deepseek.com/v1',
    note: 'OpenAI 兼容',
    caps: ['text'],
  },
  {
    id: 'minimax',
    label: 'MiniMax',
    kind: 'minimax',
    baseUrl: 'https://api.minimaxi.com/v1',
    note: '文本 + 配音',
    caps: ['text', 'audio'],
  },
  {
    id: 'openai',
    label: '第三方 · OpenAI 兼容',
    kind: 'openai',
    baseUrl: 'https://api.openai.com/v1',
    note: '中转站 / 自建服务',
    caps: ['text', 'image'],
  },
  {
    id: 'elevenlabs',
    label: 'ElevenLabs',
    kind: 'elevenlabs',
    baseUrl: 'https://api.elevenlabs.io',
    note: '配音',
    caps: ['audio'],
  },
  {
    id: 'volc-tts',
    label: '火山语音 · Seed TTS',
    kind: 'volc-tts',
    baseUrl: 'https://openspeech.bytedance.com/api/v3/plan',
    note: 'Agent Plan 语音',
    caps: ['audio'],
  },
  {
    id: '',
    label: '自定义渠道',
    kind: 'openai',
    baseUrl: 'https://',
    note: '自己填 Base URL 和用途',
    caps: ['text'],
    custom: true,
  },
]

const SECTION_META: { id: Section; label: string }[] = [
  { id: 'providers', label: '渠道' },
  { id: 'models', label: '模型' },
  { id: 'routing', label: '默认路由' },
]

const ADVANCED_META: { id: Section; label: string }[] = [
  { id: 'agent', label: 'Agent' },
  { id: 'creative', label: '创意' },
  { id: 'stock', label: '素材库' },
  { id: 'pricing', label: '计价' },
  { id: 'lipsync', label: '口型' },
  { id: 'voices', label: '音色' },
  { id: 'skills', label: '技能' },
  { id: 'data', label: '数据' },
]

type SkillRow = { record: SkillTextRecord; skill?: Skill; error?: string }

function toSkillRow(record: SkillTextRecord): SkillRow {
  try {
    return {
      record,
      skill: parseSkillText(record.id, record.text, record.source, record.builtinText),
    }
  } catch (e) {
    return { record, error: (e as Error).message || String(e) }
  }
}

function lockedContractText(skill: Skill): string {
  return skill.manifest.contracts
    .map((id) => {
      const c = getContract(id)
      return c?.lockedBlock ? `【${c.label}】\n${c.lockedBlock}` : ''
    })
    .filter(Boolean)
    .join('\n\n')
}

const capsOf = (p: Provider): ProviderCap[] => p.caps ?? ['text']

function cleanHash(input: {
  providers: Provider[]
  models: ModelEntry[]
  defaults: Partial<Record<Cap, string>>
  stageModels: Partial<Record<Stage, string>>
  pricing: Pricing
  agentLimits: Required<AgentLimitSettings>
  agentToolProtocol: ToolProtocol
  agentEngine: SceneAgentEngine
  creative?: CreativeSettings
  stock?: StockSettings
  lipSync: LipSyncSettings
  customVoices: CustomVoice[]
  apiKey: string
  rules: Record<string, RulePack>
}) {
  return JSON.stringify({
    ...input,
    providers: input.providers.map(({ keyAvailable: _k, ...p }) => p),
  })
}

function providerKeyPlaceholder(kind: ProviderKind): string {
  if (kind === 'ark') return '留空 = 沿用 .env 的 ARK_API_KEY'
  if (kind === 'ark-plan') return '留空 = 沿用 .env 的 ARK_AGENT_PLAN_API_KEY'
  if (kind === 'apimart') return '留空 = 沿用 .env 的 APIB_API_KEY / APIMART_API_KEY'
  if (kind === 'volc-tts') return '留空 = 沿用 .env 的 VOLC_TTS_API_KEY'
  if (kind === 'minimax') return '留空 = 沿用 .env 的 MINIMAX_API_KEY'
  if (kind === 'elevenlabs') return '留空 = 沿用 .env 的 ELEVENLABS_API_KEY'
  return '留空 = 沿用 .env 的 OPENAI_API_KEY'
}

export default function SettingsPage({ toast, onSaved, onProjectsDeleted }: Props) {
  const [providers, setProviders] = useState<Provider[]>([])
  const [models, setModels] = useState<ModelEntry[]>([])
  const [defaults, setDefaults] = useState<Partial<Record<Cap, string>>>({})
  const [stageModels, setStageModels] = useState<Partial<Record<Stage, string>>>({})
  const [pricing, setPricing] = useState<Pricing>(DEFAULT_PRICING)
  const [agentLimits, setAgentLimits] = useState<Required<AgentLimitSettings>>(() => normalizeAgentLimits(undefined))
  const [agentToolProtocol, setAgentToolProtocol] = useState<ToolProtocol>('auto')
  const [agentEngine, setAgentEngine] = useState<SceneAgentEngine>(() => normalizeSceneAgentEngine(undefined))
  const [creative, setCreative] = useState<CreativeSettings>(() => normalizeCreativeSettings(undefined))
  const [stock, setStock] = useState<StockSettings>({ providers: {} })
  const [stockStatus, setStockStatus] = useState<Record<string, { ok: boolean; reason?: string; keyFromEnv?: boolean }>>({})
  const [stockTesting, setStockTesting] = useState(false)
  const [adapters, setAdapters] = useState<AdapterInfo[] | null>(null)
  const [adapterError, setAdapterError] = useState('')
  const [lipSync, setLipSync] = useState<LipSyncSettings>(DEFAULT_LIP_SYNC)
  const [customVoices, setCustomVoices] = useState<CustomVoice[]>([])
  const [voiceModelKey, setVoiceModelKey] = useState('')
  const [voiceList, setVoiceList] = useState<VoiceList | null>(null)
  const [voiceLoading, setVoiceLoading] = useState(false)
  const [voiceError, setVoiceError] = useState('')
  const [voicePreview, setVoicePreview] = useState('')
  const [voiceForm, setVoiceForm] = useState({ label: '', voiceId: '', note: '' })
  const [apiKey, setApiKey] = useState('')
  const [rules, setRules] = useState<Record<string, RulePack>>(() => normalizeRules())
  const [skillRows, setSkillRows] = useState<SkillRow[]>([])
  const [skillEdits, setSkillEdits] = useState<Record<string, { role: string; task: string }>>({})
  const [skillBusy, setSkillBusy] = useState<Record<string, boolean>>({})
  const [dbFile, setDbFile] = useState('')
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [testing, setTesting] = useState<Record<string, boolean>>({})
  const [tested, setTested] = useState<Record<string, ProviderTestResult>>({})
  const [baseline, setBaseline] = useState('')
  const [section, setSection] = useState<Section>('providers')
  const [addMenu, setAddMenu] = useState(false)
  const [catalogProvider, setCatalogProvider] = useState<Provider | null>(null)
  const [modelSearch, setModelSearch] = useState('')
  const [providerFilter, setProviderFilter] = useState('all')
  const [capFilter, setCapFilter] = useState<'all' | Cap>('all')
  const [expandedModel, setExpandedModel] = useState('')

  const hash = cleanHash({
    providers,
    models,
    defaults,
    stageModels,
    pricing,
    agentLimits,
    agentToolProtocol,
    agentEngine,
    creative,
    stock,
    lipSync,
    customVoices,
    apiKey,
    rules,
  })
  const dirty = Boolean(baseline) && hash !== baseline

  const refreshVoices = async (force = false) => {
    if (!voiceModelKey) return
    setVoiceLoading(true)
    setVoiceError('')
    try {
      const list = await listVoices(voiceModelKey, force)
      setVoiceList(list)
      if (list.error) setVoiceError(list.error)
    } catch (e) {
      setVoiceError((e as Error).message)
    } finally {
      setVoiceLoading(false)
    }
  }

  useEffect(() => {
    if (voiceModelKey) void refreshVoices(false)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [voiceModelKey])

  useEffect(() => {
    getSettings()
      .then(({ settings, db }) => {
        const s = settings as AppSettings
        setProviders(s.providers || [])
        setModels(s.models || [])
        setDefaults(s.defaults || {})
        setStageModels(s.stageModels || {})
        setPricing(normalizePricing(s.pricing))
        setAgentLimits(normalizeAgentLimits(s.agentLimits))
        setAgentToolProtocol(normalizeToolProtocol(s.agentToolProtocol))
        setAgentEngine(normalizeSceneAgentEngine(s.agentEngine))
        setCreative(normalizeCreativeSettings(s.creative))
        setStock({ providers: { ...((s.stock?.providers || {}) as StockSettings['providers']) } })
        setLipSync(normalizeLipSyncSettings(s.lipSync))
        setCustomVoices(Array.isArray(s.customVoices) ? s.customVoices : [])
        setVoiceModelKey(s.defaults?.audio || '')
        setApiKey(s.apiKey || '')
        setRules(normalizeRules(s.rules))
        setDbFile(db || '')
        setBaseline(
          cleanHash({
            providers: s.providers || [],
            models: s.models || [],
            defaults: s.defaults || {},
            stageModels: s.stageModels || {},
            pricing: normalizePricing(s.pricing),
            agentLimits: normalizeAgentLimits(s.agentLimits),
            agentToolProtocol: normalizeToolProtocol(s.agentToolProtocol),
            agentEngine: normalizeSceneAgentEngine(s.agentEngine),
            creative: normalizeCreativeSettings(s.creative),
            stock: { providers: { ...((s.stock?.providers || {}) as StockSettings['providers']) } },
            lipSync: normalizeLipSyncSettings(s.lipSync),
            customVoices: Array.isArray(s.customVoices) ? s.customVoices : [],
            apiKey: s.apiKey || '',
            rules: normalizeRules(s.rules),
          }),
        )
      })
      .catch((e) => toast(e.message || '读取设置失败'))
      .finally(() => setLoading(false))
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

  const refreshSkills = async () => {
    try {
      const records = await listSkillTexts()
      const rows = records.map(toSkillRow)
      setSkillRows(rows)
      setSkillEdits(
        Object.fromEntries(
          rows
            .filter((row) => row.skill)
            .map((row) => [row.record.id, { role: row.skill!.role, task: row.skill!.task }]),
        ),
      )
    } catch (e) {
      toast((e as Error).message || '读取技能失败')
    }
  }

  useEffect(() => {
    void refreshSkills()
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

  const applySkillRecord = (record: SkillTextRecord) => {
    const row = toSkillRow(record)
    setSkillRows((prev) => prev.map((x) => (x.record.id === record.id ? row : x)))
    if (row.skill) {
      setSkillEdits((prev) => ({
        ...prev,
        [record.id]: { role: row.skill!.role, task: row.skill!.task },
      }))
    }
  }

  const patchSkillEdit = (id: string, field: 'role' | 'task', value: string) => {
    setSkillEdits((prev) => ({ ...prev, [id]: { ...(prev[id] || { role: '', task: '' }), [field]: value } }))
  }

  const saveOneSkill = async (row: SkillRow) => {
    const edit = skillEdits[row.record.id]
    if (!row.skill || !edit) return
    setSkillBusy((prev) => ({ ...prev, [row.record.id]: true }))
    try {
      const record = await saveSkillOverride(
        row.record.id,
        composeSkillBody(edit.role, edit.task),
        row.skill.manifest.version,
      )
      applySkillRecord(record)
      toast(`技能「${row.record.id}」已保存为用户覆盖`)
    } catch (e) {
      toast((e as Error).message || '保存技能失败')
    } finally {
      setSkillBusy((prev) => ({ ...prev, [row.record.id]: false }))
    }
  }

  const resetOneSkill = async (row: SkillRow) => {
    setSkillBusy((prev) => ({ ...prev, [row.record.id]: true }))
    try {
      const record = await resetSkillOverride(row.record.id)
      applySkillRecord(record)
      toast(`技能「${row.record.id}」已恢复内置默认`)
    } catch (e) {
      toast((e as Error).message || '恢复默认失败')
    } finally {
      setSkillBusy((prev) => ({ ...prev, [row.record.id]: false }))
    }
  }

  const save = async () => {
    setSaving(true)
    try {
      const saved = await saveSettings({
        providers,
        models,
        defaults,
        stageModels,
        pricing,
        agentLimits,
        agentToolProtocol,
        agentEngine,
        creative,
        stock,
        lipSync,
        customVoices,
        apiKey,
        rules,
      } as Partial<AppSettings>)
      const next = {
        providers: saved.providers || providers,
        models: saved.models || models,
        defaults: saved.defaults || defaults,
        stageModels: saved.stageModels || stageModels,
        pricing: normalizePricing(saved.pricing),
        agentLimits: normalizeAgentLimits(saved.agentLimits),
        agentToolProtocol: normalizeToolProtocol(saved.agentToolProtocol),
        agentEngine: normalizeSceneAgentEngine(saved.agentEngine),
        creative: normalizeCreativeSettings(saved.creative),
        stock: { providers: { ...((saved.stock?.providers || {}) as StockSettings['providers']) } },
        lipSync: normalizeLipSyncSettings(saved.lipSync),
        customVoices: Array.isArray(saved.customVoices) ? saved.customVoices : customVoices,
        apiKey: saved.apiKey || apiKey,
        rules: normalizeRules(saved.rules),
      }
      setProviders(next.providers)
      setModels(next.models)
      setDefaults(next.defaults)
      setStageModels(next.stageModels)
      setPricing(next.pricing)
      setAgentLimits(next.agentLimits)
      setAgentToolProtocol(next.agentToolProtocol)
      setAgentEngine(next.agentEngine)
      setCreative(next.creative as CreativeSettings)
      setStock(next.stock)
      setLipSync(next.lipSync)
      setCustomVoices(next.customVoices)
      setApiKey(next.apiKey)
      setRules(next.rules)
      setBaseline(cleanHash(next))
      toast('设置已保存（存入 SQLite），生成时立即生效')
      onSaved?.()
    } catch (e: any) {
      toast(e.message || '保存失败')
    } finally {
      setSaving(false)
    }
  }

  const patchProvider = (id: string, p: Partial<Provider>) =>
    setProviders((ps) => ps.map((x) => (x.id === id ? { ...x, ...p } : x)))

  const patchModel = (key: string, p: Partial<ModelEntry>) =>
    setModels((ms) => ms.map((x) => (x.key === key ? { ...x, ...p } : x)))

  const runTest = async (p: Provider) => {
    setTesting((t) => ({ ...t, [p.id]: true }))
    const r = await testProvider(p.id, p)
    setTesting((t) => ({ ...t, [p.id]: false }))
    setTested((t) => ({ ...t, [p.id]: r }))
    if (r.kind === 'billing') toast(`余额不足：${r.message || '充值后再试'}`)
  }

  const addProviderFromPreset = (preset: AddPreset) => {
    const id = preset.id || `custom-${Date.now().toString(36).slice(-4)}`
    if (providers.some((p) => p.id === id)) {
      toast(`渠道「${preset.label}」已存在`)
      setAddMenu(false)
      return
    }
    setProviders((ps) => [
      ...ps,
      {
        id,
        label: preset.label,
        kind: preset.kind,
        baseUrl: preset.baseUrl,
        note: preset.note,
        caps: preset.caps,
        apiKey: '',
        keyAvailable: false,
      },
    ])
    setAddMenu(false)
    setSection('providers')
  }

  const toggleProviderCap = (p: Provider, pc: ProviderCap) => {
    const cur = capsOf(p)
    if (cur.includes(pc)) {
      const affected = models.filter(
        (m) => m.provider === p.id && modelCaps(m).some((c) => CAP_TO_PC[c] === pc),
      ).length
      if (affected && !window.confirm(`该用途下有 ${affected} 个模型，取消后它们将不可选。继续？`)) return
      const next = cur.filter((x) => x !== pc)
      if (!next.length) {
        toast('至少保留一个用途')
        return
      }
      patchProvider(p.id, { caps: next })
      return
    }
    patchProvider(p.id, { caps: [...cur, pc] })
  }

  const removeProvider = (p: Provider) => {
    const affected = models.filter((m) => m.provider === p.id)
    if (!window.confirm(`删除渠道「${p.label}」会同时移除 ${affected.length} 个模型，继续？`)) return
    const removed = new Set(affected.map((m) => m.key))
    setProviders((ps) => ps.filter((x) => x.id !== p.id))
    setModels((ms) => ms.filter((m) => m.provider !== p.id))
    setDefaults((d) => {
      const next: Partial<Record<Cap, string>> = {}
      for (const [cap, key] of Object.entries(d)) {
        if (!key || !removed.has(key)) next[cap as Cap] = key
      }
      return next
    })
    setStageModels((s) => {
      const next: Partial<Record<Stage, string>> = {}
      for (const [stage, key] of Object.entries(s)) {
        if (!key || !removed.has(key)) next[stage as Stage] = key
      }
      return next
    })
  }

  const removeModel = (m: ModelEntry) => {
    if (!window.confirm(`删除模型「${m.label || m.model}」？`)) return
    setModels((ms) => ms.filter((x) => x.key !== m.key))
    setDefaults((d) => {
      const next: Partial<Record<Cap, string>> = {}
      for (const [cap, key] of Object.entries(d)) {
        if (key !== m.key) next[cap as Cap] = key
      }
      return next
    })
    setStageModels((s) => {
      const next: Partial<Record<Stage, string>> = {}
      for (const [stage, key] of Object.entries(s)) {
        if (key !== m.key) next[stage as Stage] = key
      }
      return next
    })
  }

  const toggleModelCap = (m: ModelEntry, cap: Cap) => {
    const cur = modelCaps(m)
    const next = cur.includes(cap) ? cur.filter((c) => c !== cap) : [...cur, cap]
    if (!next.length) {
      toast('至少保留一个能力')
      return
    }
    patchModel(m.key, { caps: next, cap: next.includes(m.cap) ? m.cap : next[0] })
  }

  const addModel = () => {
    const provider = providers[0]?.id || 'ark'
    const key = `m-${Date.now().toString(36).slice(-5)}`
    setModels((ms) => [
      ...ms,
      { key, label: '新模型', cap: 'text', caps: ['text'], provider, model: '', source: 'manual', runtime: 'ready' },
    ])
    setExpandedModel(key)
    setSection('models')
  }

  const openCatalog = (p?: Provider) => {
    const target = p || providers.find((x) => x.kind === 'apimart')
    if (!target) {
      toast('先添加一个 APIMart 渠道')
      return
    }
    if (target.kind !== 'apimart') {
      toast('只有 APIMart 渠道支持模型目录同步')
      return
    }
    setCatalogProvider(target)
  }

  const applyCatalog = (entries: CatalogEntry[]) => {
    const provider = catalogProvider
    if (!provider) return { added: 0, updated: 0, skipped: 0 }
    let added = 0
    let updated = 0
    let skipped = 0
    const next = [...models]
    for (const e of entries) {
      const caps = (e.suggestedCaps || []).filter((c): c is Cap => CAP_ORDER.includes(c))
      if (!caps.length) {
        skipped++
        continue
      }
      const idx = next.findIndex((m) => m.provider === provider.id && m.model === e.id)
      if (idx >= 0) {
        const cur = next[idx]
        next[idx] = {
          ...cur,
          caps,
          cap: caps.includes(cur.cap) ? cur.cap : caps[0],
          runtime: e.runtime,
          features: { ...cur.features, ...(e.features as ModelFeatureSet | undefined) },
          ...(e.runtime === 'catalog-only' && !cur.note
            ? { note: e.reason || '未接入运行时' }
            : {}),
        }
        updated++
        continue
      }
      const baseKey = `catalog-${provider.id}-${e.id}`.replace(/[^a-zA-Z0-9_-]+/g, '-').toLowerCase()
      let key = baseKey
      let n = 2
      while (next.some((m) => m.key === key)) key = `${baseKey}-${n++}`
      next.push({
        key,
        label: e.id,
        cap: caps[0],
        caps,
        provider: provider.id,
        model: e.id,
        source: 'catalog',
        runtime: e.runtime,
        features: e.features as ModelFeatureSet | undefined,
        ...(e.runtime === 'catalog-only'
          ? { note: e.reason || '未接入运行时' }
          : {}),
      })
      added++
    }
    setModels(next)
    return { added, updated, skipped }
  }

  const sceneResolution = useMemo(
    () => resolveStageModel({ providers, models, defaults, stageModels } as AppSettings, 'sceneCode'),
    [providers, models, defaults, stageModels],
  )
  const sceneCapability = sceneResolution.entry
    ? findToolCapability(
        providers.find((p) => p.id === sceneResolution.entry!.provider)?.id,
        sceneResolution.entry.model,
      )
    : undefined
  const sceneEngineText = !sceneResolution.entry
    ? '未配置 3D 代码模型，运行时无法选择引擎'
    : sceneCapability?.nativeTools
      ? agentEngine === 'pi'
        ? '当前模型支持原生工具调用，将使用 pi 引擎'
        : '当前模型支持原生工具调用，但已选择 LangGraph 引擎'
      : agentEngine === 'pi'
        ? '当前模型未声明原生工具调用，运行时会自动回退 LangGraph'
        : '当前模型未声明原生工具调用，将与 LangGraph 的 JSON action 回退配合'
  const sceneCapabilityText = !sceneResolution.entry
    ? '未配置 3D 代码模型'
    : sceneCapability?.nativeTools
      ? `当前 ${sceneResolution.entry.label} · 支持原生工具调用（thinking ${sceneCapability.thinking === 'disable' ? '关闭' : '不设置'}）`
      : `当前 ${sceneResolution.entry.label} · 未声明支持原生工具调用${
          agentToolProtocol === 'native' ? '；显式 native 会报错' : '，auto 将使用 JSON'
        }`

  const missingKeys = providers.filter((p) => p.keyAvailable === false)
  const billing = providers.filter((p) => tested[p.id] && !tested[p.id].ok && tested[p.id].kind === 'billing')
  const invalidDefaults = CAP_META.filter((c) => {
    const key = defaults[c.cap]
    if (!key) return false
    const m = models.find((x) => x.key === key)
    return !m || !modelHasCap(m, c.cap) || !isRunnableModel(m)
  })

  const filteredModels = useMemo(() => {
    const q = modelSearch.trim().toLowerCase()
    return models.filter((m) => {
      if (q && !`${m.label} ${m.model}`.toLowerCase().includes(q)) return false
      if (providerFilter !== 'all' && m.provider !== providerFilter) return false
      if (capFilter !== 'all' && !modelHasCap(m, capFilter)) return false
      return true
    })
  }, [models, modelSearch, providerFilter, capFilter])

  const settingsDraft = useMemo(
    () => ({ providers, models, defaults, stageModels } as AppSettings),
    [providers, models, defaults, stageModels],
  )

  if (loading) return <main className="settings"><div className="wb-empty">加载中…</div></main>

  const renderProviders = () => (
    <section className="st-sec">
      <header className="st-sec-head">
        <h3>渠道</h3>
        <span className="st-hint">每个渠道只出现一次；用途决定它能出现在哪些能力里。</span>
        <span className="spacer" />
        <div className="st-add-wrap">
          <button className="btn" onClick={() => setAddMenu((v) => !v)}>
            + 添加渠道
          </button>
          {addMenu && (
            <>
              <div className="st-menu-backdrop" onClick={() => setAddMenu(false)} />
              <div className="st-menu" role="menu">
                {PROVIDER_PRESETS.map((preset) => {
                  const exists = Boolean(preset.id) && providers.some((p) => p.id === preset.id)
                  return (
                    <button
                      key={preset.id || 'custom'}
                      role="menuitem"
                      disabled={exists}
                      onClick={() => addProviderFromPreset(preset)}
                    >
                      <b>{preset.label}</b>
                      <em>{preset.note}</em>
                      {exists && <span>已存在</span>}
                    </button>
                  )
                })}
              </div>
            </>
          )}
        </div>
      </header>

      <div className="st-providers">
        {providers.map((p) => {
          const result = tested[p.id]
          const badge = result
            ? result.ok
              ? '可用'
              : result.kind === 'billing'
                ? '余额不足'
                : result.kind === 'auth'
                  ? '鉴权失败'
                  : '不可用'
            : p.keyAvailable === false
              ? '缺 Key'
              : p.keyAvailable
                ? '已配置'
                : '未测试'
          const badgeClass = result
            ? result.ok
              ? 'ok'
              : 'bad'
            : p.keyAvailable === false
              ? 'bad'
              : p.keyAvailable
                ? 'ok'
                : 'muted'
          const count = models.filter((m) => m.provider === p.id).length
          const isPreset = PROVIDER_PRESETS.some((x) => x.id === p.id)
          return (
            <div key={p.id} className="st-prov" data-pid={p.id}>
              <div className="st-prov-head">
                <input
                  className="st-prov-name"
                  value={p.label}
                  onChange={(e) => patchProvider(p.id, { label: e.target.value })}
                />
                {isPreset ? null : (
                  <select
                    value={p.kind}
                    onChange={(e) => patchProvider(p.id, { kind: e.target.value as ProviderKind })}
                  >
                    {KIND_META.map((k) => (
                      <option key={k.kind} value={k.kind}>
                        {k.label}
                      </option>
                    ))}
                  </select>
                )}
                <span className={`st-badge ${badgeClass}`}>{badge}</span>
              </div>

              <label className="st-field">
                <span>Base URL</span>
                <input value={p.baseUrl} onChange={(e) => patchProvider(p.id, { baseUrl: e.target.value })} />
              </label>
              <label className="st-field">
                <span>API Key</span>
                <input
                  type="password"
                  value={p.apiKey || ''}
                  placeholder={providerKeyPlaceholder(p.kind)}
                  onChange={(e) => patchProvider(p.id, { apiKey: e.target.value, keyAvailable: undefined })}
                />
              </label>

              <div className="st-prov-caps">
                <span className="st-cap-label">用途</span>
                {PROVIDER_CAPS.map((x) => (
                  <button
                    key={x.pc}
                    className={`st-cap ${capsOf(p).includes(x.pc) ? 'on' : ''}`}
                    onClick={() => toggleProviderCap(p, x.pc)}
                    title={`这个渠道是否承接${x.label}`}
                  >
                    {x.label}
                  </button>
                ))}
              </div>

              <div className="st-prov-foot">
                <span className="st-hint">{count} 个模型</span>
                <span className="spacer" />
                {p.kind === 'apimart' && (
                  <button className="btn-mini" onClick={() => openCatalog(p)}>
                    同步目录
                  </button>
                )}
                <button
                  className="btn-mini"
                  disabled={!!testing[p.id]}
                  onClick={() => void runTest(p)}
                  title="用最轻的请求验证 Key / baseUrl"
                >
                  {testing[p.id] ? '测试中…' : '测试'}
                </button>
                <button className="btn-mini danger" onClick={() => removeProvider(p)} title="删除渠道及其模型">
                  ✕
                </button>
              </div>

              {result && (
                <div className={`st-test ${result.ok ? 'ok' : 'bad'}`}>
                  <b>{result.ok ? '可用' : '不可用'}</b>
                  {typeof result.latency === 'number' && result.latency > 0 ? ` · ${result.latency}ms` : ''}
                  {' · '}
                  {result.message}
                  {result.endpoint && <code className="st-test-ep">{result.endpoint}</code>}
                </div>
              )}
              {p.note && <em className="st-prov-note">{p.note}</em>}
            </div>
          )
        })}
        {providers.length === 0 && <div className="st-model-empty">还没有渠道，点「+ 添加渠道」</div>}
      </div>
    </section>
  )

  const renderModels = () => (
    <section className="st-sec">
      <header className="st-sec-head">
        <h3>模型库</h3>
        <span className="st-hint">一个模型一行；能力标签决定它能被哪些能力选中。</span>
      </header>
      <div className="st-toolbar">
        <input
          className="st-search"
          placeholder="搜索显示名 / 模型 ID"
          value={modelSearch}
          onChange={(e) => setModelSearch(e.target.value)}
        />
        <select value={providerFilter} onChange={(e) => setProviderFilter(e.target.value)}>
          <option value="all">全部渠道</option>
          {providers.map((p) => (
            <option key={p.id} value={p.id}>
              {p.label}
            </option>
          ))}
        </select>
        <select value={capFilter} onChange={(e) => setCapFilter(e.target.value as 'all' | Cap)}>
          <option value="all">全部能力</option>
          {CAP_ORDER.map((c) => (
            <option key={c} value={c}>
              {CAP_LABELS[c]}
            </option>
          ))}
        </select>
        <span className="spacer" />
        <button className="btn-mini" onClick={() => openCatalog()}>
          同步 APIMart 目录
        </button>
        <button className="btn-mini" onClick={addModel}>
          + 手动添加
        </button>
      </div>

      <div className="st-model-table">
        <div className="st-model-row st-model-row-head">
          <span>显示名</span>
          <span>渠道</span>
          <span>模型 ID</span>
          <span>能力</span>
          <span>来源 / 状态</span>
          <span />
        </div>
        {filteredModels.map((m) => {
          const provider = providers.find((p) => p.id === m.provider)
          const open = expandedModel === m.key
          return (
            <div key={m.key} className="st-model-item" data-model-key={m.key}>
              <div className="st-model-row">
                <input
                  className="st-model-label"
                  value={m.label}
                  placeholder="显示名"
                  onChange={(e) => patchModel(m.key, { label: e.target.value })}
                />
                <select
                  value={m.provider}
                  onChange={(e) => patchModel(m.key, { provider: e.target.value })}
                  title="所属渠道"
                >
                  {!provider && <option value={m.provider}>（渠道已删除）</option>}
                  {providers.map((p) => (
                    <option key={p.id} value={p.id}>
                      {p.label}
                    </option>
                  ))}
                </select>
                <input
                  className="st-model-id"
                  value={m.model}
                  placeholder="模型 ID"
                  onChange={(e) => patchModel(m.key, { model: e.target.value })}
                />
                <button className="st-model-caps-btn" onClick={() => setExpandedModel(open ? '' : m.key)}>
                  {modelCapsLabel(m)}
                </button>
                <span className="st-model-badges">
                  <b className="st-badge muted">{m.source === 'preset' ? '预设' : m.source === 'catalog' ? '同步' : m.source === 'manual' ? '手动' : '旧数据'}</b>
                  <b
                    className={`st-badge ${isRunnableModel(m) ? 'ok' : 'bad'}`}
                    title={isRunnableModel(m) ? undefined : m.note || '当前版本未接入运行时'}
                  >
                    {isRunnableModel(m) ? '可运行' : '未接入'}
                  </b>
                </span>
                <button className="btn-mini danger" onClick={() => removeModel(m)} title="删除模型">
                  ✕
                </button>
              </div>
              {open && (
                <div className="st-model-caps-editor">
                  <span className="st-hint">能力</span>
                  {CAP_ORDER.map((c) => (
                    <button
                      key={c}
                      className={`st-cap ${modelCaps(m).includes(c) ? 'on' : ''}`}
                      onClick={() => toggleModelCap(m, c)}
                    >
                      {CAP_LABELS[c]}
                    </button>
                  ))}
                  {m.note && <em className="st-prov-note">{m.note}</em>}
                </div>
              )}
              {modelCaps(m).includes('video') && (
                <div className="st-model-video-ref">
                  <label className="chk" title="只有声明支持参考视频的模型才能勾；本地参考视频需公网 URL">
                    <input
                      type="checkbox"
                      checked={Boolean(m.supportsVideoRef)}
                      onChange={(e) => patchModel(m.key, { supportsVideoRef: e.target.checked })}
                    />
                    支持视频参考
                  </label>
                  {m.supportsVideoRef && (
                    <select
                      value={m.videoRefTaskType || ''}
                      onChange={(e) =>
                        patchModel(m.key, {
                          videoRefTaskType: e.target.value === 'reference' ? 'reference' : undefined,
                        })
                      }
                      title="Seedance 2.5 建议显式指定，避免被判定成视频编辑/延长"
                    >
                      <option value="">任务类型：自动（2.0）</option>
                      <option value="reference">任务类型：参考生视频（2.5）</option>
                    </select>
                  )}
                </div>
              )}
            </div>
          )
        })}
        {filteredModels.length === 0 && <div className="st-model-empty">没有匹配的模型</div>}
      </div>
    </section>
  )

  const renderRouting = () => (
    <section className="st-sec">
      <header className="st-sec-head">
        <h3>默认路由</h3>
        <span className="st-hint">先选渠道，再选模型；批量生成走这里的默认，工作台里仍可临时改。</span>
      </header>

      <div className="st-routing">
        {CAP_META.map((c) => {
          const key = defaults[c.cap] || ''
          const model = models.find((m) => m.key === key)
          const providerId = model?.provider || ''
          const eligibleProviders = providers.filter((p) =>
            models.some((m) => m.provider === p.id && modelHasCap(m, c.cap) && isRunnableModel(m)),
          )
          const providerModels = models.filter(
            (m) => m.provider === providerId && modelHasCap(m, c.cap) && isRunnableModel(m),
          )
          const invalid = Boolean(key) && (!model || !modelHasCap(model, c.cap) || !isRunnableModel(model))
          const providerMissingKey = providers.find((p) => p.id === providerId)?.keyAvailable === false
          return (
            <div key={c.cap} className="st-routing-row" data-routing-cap={c.cap}>
              <div className="st-routing-label">
                <b>{c.label}</b>
                <em>{c.hint}</em>
              </div>
              <select
                value={providerId}
                onChange={(e) => {
                  const pid = e.target.value
                  const first = models.find(
                    (m) => m.provider === pid && modelHasCap(m, c.cap) && isRunnableModel(m),
                  )
                  setDefaults((d) => ({ ...d, [c.cap]: first?.key || '' }))
                }}
              >
                <option value="">（选择渠道）</option>
                {eligibleProviders.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.label}
                  </option>
                ))}
              </select>
              <select
                value={key}
                disabled={!providerId || providerModels.length === 0}
                onChange={(e) => setDefaults((d) => ({ ...d, [c.cap]: e.target.value }))}
              >
                <option value="">（未设置）</option>
                {providerModels.map((m) => (
                  <option key={m.key} value={m.key}>
                    {m.label} · {m.model || '未填模型 ID'}
                  </option>
                ))}
              </select>
              <span className={`st-routing-status ${invalid ? 'bad' : providerMissingKey ? 'warn' : key ? 'ok' : 'muted'}`}>
                {invalid ? '默认模型失效' : providerMissingKey ? '渠道缺 Key' : key ? '可用' : '未设置'}
              </span>
            </div>
          )
        })}
      </div>

      <h4 className="st-subhead">生成环节默认</h4>
      <p className="st-hint">
        文本环节空着 = 用「文本 · 常规」；视觉为空 = 素材只给标签；视频理解为空 = 回退关键帧。
      </p>
      <div className="st-stage-table">
        {STAGE_META.map((s) => {
          const options = stageModelEntries(settingsDraft, s.stage)
          const resolved = resolveStageModel(settingsDraft, s.stage, {})
          const current = stageModels[s.stage] || ''
          const invalidStage = Boolean(current) && !options.some((m) => m.key === current)
          const emptyLabel =
            s.stage === 'vision'
              ? '（未绑定 · 素材只给标签）'
              : s.stage === 'videoVision'
                ? '（未绑定 · 回退关键帧）'
                : '（跟随文本默认）'
          return (
            <label key={s.stage} className="st-stage-row" data-stage-row={s.stage}>
              <span>
                <b>{s.label}</b>
                <em>{s.hint}</em>
              </span>
              <select
                data-stage-model-select={s.stage}
                value={current}
                onChange={(e) => {
                  setStageModels((prev) => {
                    const next = { ...prev }
                    if (e.target.value) next[s.stage] = e.target.value
                    else delete next[s.stage]
                    return next
                  })
                }}
              >
                <option value="">{emptyLabel}</option>
                {invalidStage && <option value={current}>配置的模型不可用（{current}）</option>}
                {options.map((m) => (
                  <option key={m.key} value={m.key}>
                    {m.label} · {m.model || '未填模型 ID'}
                  </option>
                ))}
              </select>
              <em className="st-stage-resolved">
                {resolved.entry ? `当前：${resolved.entry.label}` : resolved.invalidKey ? '配置的模型不可用' : '未解析'}
              </em>
            </label>
          )
        })}
      </div>
      <div className="st-hint" style={{ marginTop: 8 }}>
        角色三视图使用上方「图像 · 角色三视图」默认；角色板里可以单独手选。
      </div>
    </section>
  )

  const renderAgent = () => (
    <section className="st-sec">
      <header className="st-sec-head">
        <h3>Agent 运行上限</h3>
        <span className="st-hint">
          3D 调度 agent 的总运行时长上限；超过会显示运行超时。线程按项目 + 镜头恢复，关闭工作台会释放 Blender
          沙箱并取消运行中的本轮。
        </span>
      </header>
      <div className="st-grid">
        <label className="st-field">
          <span>总运行时长（秒）</span>
          <input
            type="number"
            min={AGENT_LIMIT_RANGES.totalSeconds.min}
            max={AGENT_LIMIT_RANGES.totalSeconds.max}
            step="1"
            value={agentLimits.totalSeconds}
            onChange={(e) => {
              const raw = e.target.value
              setAgentLimits((prev) => ({
                ...prev,
                totalSeconds: raw.trim() === '' ? AGENT_LIMIT_DEFAULTS.totalSeconds : Number(raw),
              }))
            }}
            onBlur={() => setAgentLimits(normalizeAgentLimits(agentLimits))}
          />
          <em>默认 {AGENT_LIMIT_DEFAULTS.totalSeconds} 秒；范围 {AGENT_LIMIT_RANGES.totalSeconds.min}–{AGENT_LIMIT_RANGES.totalSeconds.max}</em>
        </label>
        <label className="st-field">
          <span>执行引擎</span>
          <select
            value={agentEngine}
            onChange={(e) => setAgentEngine(normalizeSceneAgentEngine(e.target.value))}
          >
            <option value="pi">pi（默认）：能力表内模型自动启用</option>
            <option value="langgraph">LangGraph：含 JSON action 回退</option>
          </select>
          <em>
            默认 {DEFAULT_SCENE_AGENT_ENGINE}；{sceneEngineText}
          </em>
        </label>
        <label className="st-field">
          <span>工具协议</span>
          <select
            value={agentToolProtocol}
            onChange={(e) => setAgentToolProtocol(normalizeToolProtocol(e.target.value))}
          >
            <option value="auto">自动：模型支持就用原生</option>
            <option value="native">原生 tool calls</option>
            <option value="json">JSON action（兼容 / 回退）</option>
          </select>
          <em>{sceneCapabilityText}</em>
        </label>
      </div>
      <h4 className="st-subhead">兼容字段</h4>
      <div className="st-grid">
        <label className="st-field">
          <span>ARK API Key（旧字段）</span>
          <input
            type="password"
            value={apiKey}
            placeholder="留空 = 沿用 ~/.canghe-skills/.env"
            onChange={(e) => setApiKey(e.target.value)}
          />
          <em>建议改在「渠道」里填；这里留作兼容</em>
        </label>
      </div>
    </section>
  )

  const refreshAdapters = async () => {
    setAdapterError('')
    try {
      const r = await listCreativeAdapters()
      setAdapters(r.adapters)
    } catch (e) {
      setAdapterError((e as Error).message || String(e))
    }
  }

  const setIngest = (patch: Partial<NonNullable<CreativeSettings['ingest']>>) => {
    setCreative((prev) => ({
      ...prev,
      ingest: {
        ...(prev.ingest || {}),
        ...patch,
        ytdlp: { ...(prev.ingest?.ytdlp || {}), ...(patch.ytdlp || {}) },
        dtk: { ...(prev.ingest?.dtk || {}), ...(patch.dtk || {}) },
      },
    }))
  }

  const STOCK_PROVIDERS: Array<{ id: StockProviderId; label: string; hint: string; requiresKey: boolean; envKey: string }> = [
    { id: 'pexels', label: 'Pexels', hint: '图片 + 视频', requiresKey: true, envKey: 'PEXELS_API_KEY' },
    { id: 'pixabay', label: 'Pixabay', hint: '图片 + 视频，中文检索更友好', requiresKey: true, envKey: 'PIXABAY_API_KEY' },
    { id: 'openverse', label: 'Openverse', hint: '图片 + 音频，CC 许可', requiresKey: false, envKey: 'OPENVERSE_API_KEY' },
  ]

  const patchStock = (id: StockProviderId, patch: Partial<NonNullable<StockSettings['providers'][StockProviderId]>>) =>
    setStock((prev) => ({
      providers: {
        ...prev.providers,
        [id]: { enabled: false, baseUrl: '', hasApiKey: false, ...(prev.providers[id] || {}), ...patch },
      },
    }))

  const testStock = async () => {
    setStockTesting(true)
    try {
      // 先保存，否则服务端读到的还是旧配置
      await saveSettings({ stock } as Partial<AppSettings>)
      const list = await fetchStockProviders()
      setStockStatus(Object.fromEntries(list.map((p) => [p.id, { ok: p.ok, reason: p.reason, keyFromEnv: p.keyFromEnv }])))
      const bad = list.filter((p) => !p.ok)
      toast(bad.length ? `${bad.length} 个来源不可用` : '全部来源可用')
    } catch (e) {
      toast((e as Error).message || '检测失败')
    } finally {
      setStockTesting(false)
    }
  }

  const CAP_BINDINGS: Array<{ cap: Cap; label: string; hint: string }> = [
    { cap: 'vision', label: '视觉理解', hint: '逐镜看证据帧' },
    { cap: 'videoVision', label: '视频理解', hint: '公网视频直读（可选）' },
    { cap: 'image', label: '生图', hint: '反推后的首帧' },
    { cap: 'view', label: '三视图', hint: '角色多视图' },
    { cap: 'video', label: '生视频', hint: '复刻片段' },
    { cap: 'videoRef', label: '视频参考', hint: '带参考视频出片' },
    { cap: 'audio', label: '配音', hint: '台词转语音' },
  ]

  const modelOptionsFor = (cap: Cap) =>
    models.filter((m) => (m.caps?.length ? m.caps.includes(cap) : m.cap === cap) && m.runtime !== 'catalog-only')

  const renderStock = () => (
    <section className="st-sec" data-settings-stock>
      <header className="st-sec-head">
        <h3>素材库</h3>
        <span className="st-hint">
          在线素材来自公开图库：检索在服务端完成，渲染出的结果会下载到当前项目。Key 只存本地设置库或环境变量，读取时不回传原文。
        </span>
        <span className="spacer" />
        <button type="button" className="btn" data-stock-test disabled={stockTesting} onClick={() => void testStock()}>
          {stockTesting ? '检测中…' : '检测可用性'}
        </button>
      </header>

      <div className="st-grid">
        {STOCK_PROVIDERS.map((p) => {
          const cfg = stock.providers[p.id] || { enabled: false, baseUrl: '', hasApiKey: false }
          const status = stockStatus[p.id]
          return (
            <div key={p.id} className="st-field st-stock-card" data-stock-provider-card={p.id}>
              <span>
                {p.label}
                <em>{p.hint}</em>
              </span>
              <label className="st-stock-row">
                <span>启用</span>
                <select
                  data-stock-enabled={p.id}
                  value={cfg.enabled ? 'on' : 'off'}
                  onChange={(e) => patchStock(p.id, { enabled: e.target.value === 'on' })}
                >
                  <option value="off">关闭</option>
                  <option value="on">启用</option>
                </select>
              </label>
              <label className="st-stock-row">
                <span>API Key</span>
                <input
                  type="password"
                  data-stock-key={p.id}
                  value={cfg.hasApiKey ? '' : ''}
                  placeholder={cfg.hasApiKey ? '已保存（留空保持不变）' : p.requiresKey ? `可留空沿用 ${p.envKey}` : `可选；留空沿用 ${p.envKey}`}
                  onChange={(e) => patchStock(p.id, { apiKey: e.target.value, hasApiKey: false })}
                />
              </label>
              <label className="st-stock-row">
                <span>Base URL</span>
                <input
                  data-stock-base={p.id}
                  value={cfg.baseUrl || ''}
                  placeholder={
                    p.id === 'pexels'
                      ? 'https://api.pexels.com'
                      : p.id === 'pixabay'
                        ? 'https://pixabay.com'
                        : 'https://api.openverse.org'
                  }
                  onChange={(e) => patchStock(p.id, { baseUrl: e.target.value })}
                />
              </label>
              <div className="st-status-row">
                {cfg.hasApiKey ? <span className="st-status-chip ok">已保存 Key</span> : null}
                {cfg.keyFromEnv ? <span className="st-status-chip ok">来自环境变量</span> : null}
                {status ? (
                  <span className={`st-status-chip ${status.ok ? 'ok' : 'warn'}`} title={status.reason || '可用'}>
                    {status.ok ? '可用' : `不可用：${status.reason || '未配置'}`}
                  </span>
                ) : null}
              </div>
            </div>
          )
        })}
      </div>
    </section>
  )

  const renderCreative = () => (
    <section className="st-sec" data-settings-creative>
      <header className="st-sec-head">
        <h3>创意会话</h3>
        <span className="st-hint">
          创意会话不绑定项目：下载与分析的源视频存本地 creatives/ 目录，只有「晋升项目」才写入项目数据。
          下载服务默认关闭，只保留本地上传与直链。
        </span>
      </header>

      <h4 className="st-subhead">下载与摄取</h4>
      <div className="st-grid">
        <label className="st-field">
          <span>yt-dlp 可执行文件</span>
          <input
            data-creative-ytdlp-bin
            value={creative.ingest?.ytdlp?.bin || ''}
            placeholder="/opt/homebrew/bin/yt-dlp"
            onChange={(e) => setIngest({ ytdlp: { bin: e.target.value } })}
          />
          <em>未安装可执行文件时该适配器显示为不可用，不影响上传与直链</em>
        </label>
        <label className="st-field">
          <span>启用 yt-dlp</span>
          <select
            data-creative-ytdlp-enabled
            value={creative.ingest?.ytdlp?.enabled ? 'on' : 'off'}
            onChange={(e) => {
              const on = e.target.value === 'on'
              // 禁止「启用但没路径」：那种状态只会在摄取时才报错
              if (on && !String(creative.ingest?.ytdlp?.bin || '').trim()) {
                toast('先填写 yt-dlp 可执行文件路径，再启用')
                return
              }
              setIngest({ ytdlp: { enabled: on } })
            }}
          >
            <option value="off">关闭</option>
            <option value="on">启用</option>
          </select>
          <em>用于抖音 / B 站 / TikTok 链接；失败不会静默改用其他适配器</em>
        </label>
        <label className="st-field">
          <span>读取浏览器 cookies</span>
          <select
            data-creative-ytdlp-cookies
            value={creative.ingest?.ytdlp?.cookiesFromBrowser || ''}
            onChange={(e) => setIngest({ ytdlp: { cookiesFromBrowser: e.target.value } })}
          >
            <option value="">不读取</option>
            <option value="chrome">Chrome</option>
            <option value="safari">Safari</option>
            <option value="edge">Edge</option>
            <option value="firefox">Firefox</option>
          </select>
          <em>抖音/TikTok 需要新鲜 cookies；只在本机读取，不上传不落盘。需先在浏览器登录过该平台</em>
        </label>
        <label className="st-field">
          <span>cookies 文件（可选）</span>
          <input
            data-creative-ytdlp-cookies-file
            value={creative.ingest?.ytdlp?.cookiesFile || ''}
            placeholder="导出的 Netscape cookies.txt 路径"
            onChange={(e) => setIngest({ ytdlp: { cookiesFile: e.target.value } })}
          />
          <em>填了浏览器来源时以浏览器为准</em>
        </label>
        <label className="st-field">
          <span>DTK 服务地址</span>
          <input
            data-creative-dtk-url
            value={creative.ingest?.dtk?.baseUrl || ''}
            placeholder="http://127.0.0.1:8000"
            onChange={(e) => setIngest({ dtk: { baseUrl: e.target.value } })}
          />
          <em>可选的独立下载服务；只用到 parse_url 与 download_media</em>
        </label>
        <label className="st-field">
          <span>DTK API Key</span>
          <input
            type="password"
            data-creative-dtk-key
            value={creative.ingest?.dtk?.apiKey || ''}
            placeholder={(creative.ingest?.dtk as { hasApiKey?: boolean })?.hasApiKey ? '已保存（留空保持不变）' : '可留空'}
            onChange={(e) => setIngest({ dtk: { apiKey: e.target.value } })}
          />
          <em>只存本地设置库；不写进聊天消息与日志</em>
        </label>
        <label className="st-field">
          <span>启用 DTK</span>
          <select
            data-creative-dtk-enabled
            value={creative.ingest?.dtk?.enabled ? 'on' : 'off'}
            onChange={(e) => setIngest({ dtk: { enabled: e.target.value === 'on' } })}
          >
            <option value="off">关闭</option>
            <option value="on">启用</option>
          </select>
          <em>需要自己部署 DTK（Postgres + Redis + 浏览器容器）</em>
        </label>
        <div className="st-field">
          <span>适配器状态</span>
          <div className="flex flex-wrap items-center gap-1.5" data-creative-adapters>
            {(adapters || []).map((a) => (
              <span
                key={a.id}
                className={`st-status-chip ${a.ok ? 'ok' : 'warn'}`}
                title={a.reason || '可用'}
              >
                {a.label}
                {a.ok ? '' : ' · 不可用'}
              </span>
            ))}
            <button type="button" className="btn" onClick={() => void refreshAdapters()} data-creative-test-adapters>
              检测可用性
            </button>
          </div>
          <em>{adapterError || '检测只读本地配置，不发起下载'}</em>
        </div>
      </div>

      <h4 className="st-subhead">能力绑定</h4>
      <span className="st-hint">
        每类能力单独绑模型；留空沿用全局默认。这里的选择不会改动全站默认路由。
      </span>
      <div className="st-grid">
        {CAP_BINDINGS.map(({ cap, label, hint }) => {
          const list = modelOptionsFor(cap)
          return (
            <label className="st-field" key={cap} data-creative-binding={cap}>
              <span>{label}</span>
              <select
                value={creative.models?.[cap] || ''}
                onChange={(e) =>
                  setCreative((prev) => {
                    const next = { ...(prev.models || {}) }
                    if (e.target.value) next[cap] = e.target.value
                    else delete next[cap]
                    return { ...prev, models: next }
                  })
                }
              >
                <option value="">
                  跟随全局 · {defaults[cap] || '未配置'}
                </option>
                {list.map((m) => (
                  <option key={m.key} value={m.key}>
                    {m.label} · {m.model}
                  </option>
                ))}
              </select>
              <em>{hint}</em>
            </label>
          )
        })}
      </div>

      <h4 className="st-subhead">分析与成本</h4>
      <div className="st-grid">
        <label className="st-field">
          <span>分析深度</span>
          <select
            data-creative-depth
            value={creative.analysis?.depth || CREATIVE_DEFAULTS.analysis.depth}
            onChange={(e) =>
              setCreative((prev) => ({
                ...prev,
                analysis: { ...(prev.analysis || {}), depth: e.target.value as CreativeAnalysisDepth },
              }))
            }
          >
            {CREATIVE_ANALYSIS_DEPTHS.map((d) => (
              <option key={d} value={d}>
                {d === 'quick' ? '快速（每镜 1 帧）' : d === 'standard' ? '标准' : '深度'}
              </option>
            ))}
          </select>
          <em>深度越大，视觉调用次数与费用越高</em>
        </label>
        <label className="st-field">
          <span>场景切分阈值</span>
          <input
            type="number"
            min={0.05}
            max={0.95}
            step="0.05"
            value={creative.analysis?.threshold ?? CREATIVE_DEFAULTS.analysis.threshold}
            onChange={(e) =>
              setCreative((prev) => ({
                ...prev,
                analysis: { ...(prev.analysis || {}), threshold: Number(e.target.value) },
              }))
            }
          />
          <em>越大越不敏感，切出的镜头越少</em>
        </label>
        <label className="st-field">
          <span>每镜证据帧</span>
          <input
            type="number"
            min={1}
            max={3}
            step="1"
            value={creative.analysis?.framesPerShot ?? CREATIVE_DEFAULTS.analysis.framesPerShot}
            onChange={(e) =>
              setCreative((prev) => ({
                ...prev,
                analysis: { ...(prev.analysis || {}), framesPerShot: Number(e.target.value) },
              }))
            }
          />
          <em>帧数直接影响视觉调用次数</em>
        </label>
        <label className="st-field">
          <span>付费调用前确认</span>
          <select
            data-creative-confirm
            value={creative.confirmCost === false ? 'off' : 'on'}
            onChange={(e) => setCreative((prev) => ({ ...prev, confirmCost: e.target.value === 'on' }))}
          >
            <option value="on">每次确认（推荐）</option>
            <option value="off">不确认（仍受轮次上限约束）</option>
          </select>
          <em>真实视频生成始终每次确认，不受此项影响</em>
        </label>
        <label className="st-field">
          <span>单轮付费调用上限</span>
          <input
            type="number"
            min={1}
            max={50}
            value={creative.limits?.maxPaidCallsPerTurn ?? CREATIVE_DEFAULTS.limits.maxPaidCallsPerTurn}
            onChange={(e) =>
              setCreative((prev) => ({
                ...prev,
                limits: { ...(prev.limits || {}), maxPaidCallsPerTurn: Number(e.target.value) },
              }))
            }
          />
          <em>超过后工具直接拒绝，不发请求</em>
        </label>
        <label className="st-field">
          <span>单会话镜头上限</span>
          <input
            type="number"
            min={1}
            max={200}
            value={creative.limits?.maxShots ?? CREATIVE_DEFAULTS.limits.maxShots}
            onChange={(e) =>
              setCreative((prev) => ({
                ...prev,
                limits: { ...(prev.limits || {}), maxShots: Number(e.target.value) },
              }))
            }
          />
          <em>切分结果超过上限会拒绝，提示把阈值调高</em>
        </label>
      </div>
    </section>
  )

  const renderPricing = () => (
    <section className="st-sec">
      <header className="st-sec-head">
        <h3>计价</h3>
        <span className="st-hint">默认值是估算；图片按张、视频按秒、配音按次。</span>
      </header>
      <div className="st-grid">
        <label className="st-field">
          <span>图片 · 每张</span>
          <input
            type="number"
            step="0.01"
            min="0"
            value={pricing.image}
            onChange={(e) => setPricing({ ...pricing, image: Number(e.target.value) || 0 })}
          />
          <em>Seedream 一次生成 N 张 = N × 单价</em>
        </label>
        <label className="st-field">
          <span>视频 · 480p 每秒</span>
          <input
            type="number"
            step="0.01"
            min="0"
            value={pricing.video480}
            onChange={(e) => setPricing({ ...pricing, video480: Number(e.target.value) || 0 })}
          />
          <em>方舟按 tokens 计费，秒单价是近似值</em>
        </label>
        <label className="st-field">
          <span>视频 · 720p 每秒</span>
          <input
            type="number"
            step="0.01"
            min="0"
            value={pricing.video720}
            onChange={(e) => setPricing({ ...pricing, video720: Number(e.target.value) || 0 })}
          />
          <em>720p 一般比 480p 贵一倍左右</em>
        </label>
        <label className="st-field">
          <span>配音 · 每次</span>
          <input
            type="number"
            step="0.01"
            min="0"
            value={pricing.audio}
            onChange={(e) => setPricing({ ...pricing, audio: Number(e.target.value) || 0 })}
          />
          <em>0 = 不计入</em>
        </label>
      </div>
    </section>
  )

  const renderLipSync = () => (
    <section className="st-sec">
      <header className="st-sec-head">
        <h3>口型</h3>
        <span className="st-hint">
          默认关闭。provider 模式只用于单说话人镜头，每次提交前还会再确认；Key 只存设置库，不写进项目。
        </span>
      </header>
      <div className="st-grid">
        <label className="st-field">
          <span>Provider</span>
          <select
            value={lipSync.provider}
            onChange={(e) => setLipSync({ ...lipSync, provider: e.target.value as LipSyncSettings['provider'] })}
          >
            <option value="off">关闭</option>
            <option value="sync-labs">Sync Labs</option>
          </select>
          <em>关闭时仍可使用 prompt 模式与本地抽帧验收</em>
        </label>
        <label className="st-field">
          <span>Base URL</span>
          <input
            value={lipSync.baseUrl ?? ''}
            onChange={(e) => setLipSync({ ...lipSync, baseUrl: e.target.value })}
            placeholder="https://api.sync.so"
          />
          <em>只用于 provider 模式</em>
        </label>
        <label className="st-field">
          <span>API Key</span>
          <input
            type="password"
            value={lipSync.apiKey ?? ''}
            onChange={(e) => setLipSync({ ...lipSync, apiKey: e.target.value })}
            placeholder="留空 = 沿用 .env 的 SYNC_LABS_API_KEY"
          />
          <em>不写入项目、日志和证据</em>
        </label>
        <label className="st-field">
          <span>估算 · 每秒</span>
          <input
            type="number"
            step="0.01"
            min="0"
            value={lipSync.pricePerSecond ?? 0}
            onChange={(e) => setLipSync({ ...lipSync, pricePerSecond: Number(e.target.value) || 0 })}
          />
          <em>0 = 不计入成本估算</em>
        </label>
      </div>
      <p className="st-hint" style={{ marginTop: 8 }}>
        多说话人镜头暂不支持 provider 口型；请拆成单人镜，或继续用 prompt 模式 + 抽帧人工验收。
      </p>
    </section>
  )


  const renderVoices = () => {
    const audioModels = models.filter((m) => modelHasCap(m, 'audio'))
    const voiceProviderId =
      models.find((m) => m.key === voiceModelKey)?.provider ||
      voiceList?.voices[0]?.provider ||
      ''
    const caps = voiceList?.capabilities
    const groups = new Map<string, VoiceOption[]>()
    for (const v of voiceList?.voices ?? []) {
      const key = `${v.provider || '当前渠道'} · ${VOICE_SOURCE_LABELS[v.source || 'preset']}`
      const list = groups.get(key) || []
      list.push(v)
      groups.set(key, list)
    }
    const myCustom = customVoices.filter((v) => !voiceProviderId || v.provider === voiceProviderId)
    const addCustom = () => {
      const voiceId = voiceForm.voiceId.trim()
      if (!voiceId) {
        setVoiceError('先填 voice_id')
        return
      }
      if (!voiceProviderId) {
        setVoiceError('当前模型没有渠道信息，不能添加自定义音色')
        return
      }
      const label = voiceForm.label.trim() || voiceId
      setCustomVoices((prev) => [
        ...prev.filter((v) => !(v.provider === voiceProviderId && v.voiceId === voiceId)),
        {
          id: `${voiceProviderId}:${voiceId}`,
          label,
          provider: voiceProviderId,
          modelKey: voiceModelKey,
          voiceId,
          ...(voiceForm.note.trim() ? { note: voiceForm.note.trim() } : {}),
          createdAt: new Date().toISOString(),
        },
      ])
      setVoiceForm({ label: '', voiceId: '', note: '' })
      setVoiceError('')
    }
    return (
      <section className="st-sec">
        <header className="st-sec-head">
          <h3>音色管理</h3>
          <span className="st-hint">
            每个渠道按自己的能力提供预置、账号、克隆/设计和自定义音色；不支持自定义的渠道不会出现新增入口。
          </span>
        </header>
        <div className="st-grid">
          <label className="st-field">
            <span>当前音频模型</span>
            <select value={voiceModelKey} onChange={(e) => setVoiceModelKey(e.target.value)}>
              <option value="">跟随设置默认</option>
              {audioModels.map((m) => (
                <option key={m.key} value={m.key}>{m.label}</option>
              ))}
            </select>
            <em>切换模型后目录和可新增能力会一起切换</em>
          </label>
          <label className="st-field">
            <span>目录状态</span>
            <button className="btn" onClick={() => void refreshVoices(true)} disabled={voiceLoading || !voiceModelKey}>
              {voiceLoading ? '刷新中…' : '刷新音色'}
            </button>
            <em>{voiceError || voiceList?.error || (voiceList ? `${voiceList.voices.length} 个音色` : '尚未加载')}</em>
          </label>
        </div>
        <p className="st-hint" style={{ marginTop: 8 }}>
          {caps?.supportsCustomVoiceId
            ? '该渠道支持自定义 voice_id：可在下方添加，保存设置后角色卡可选中。'
            : '该渠道只支持预置/系统音色，不提供应用内自定义音色。'}
          {caps?.supportsClone || caps?.supportsDesign
            ? ' 克隆/设计入口需按渠道能力单独接入。'
            : ''}
          {voiceList?.providerKind === 'elevenlabs' && (
            <>
              {' '}还没有账号音色时，可先到{' '}
              <a href="https://elevenlabs.io/app/voice-lab" target="_blank" rel="noreferrer">
                ElevenLabs VoiceLab
              </a>{' '}
              创建/克隆，再把 voice_id 填到下面。
            </>
          )}
        </p>

        <div className="st-rules">
          {[...groups.entries()].map(([label, list]) => (
            <div key={label} className="st-rule">
              <header><b>{label}</b><span className="st-src">{list.length} 个</span></header>
              {list.map((v) => (
                <div key={`${v.provider}:${v.id}`} className="st-field" style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                  <span style={{ flex: 1 }}>{v.label} <code>{v.id}</code></span>
                  {v.note && <em>{v.note}</em>}
                  <button
                    className="btn-mini"
                    onClick={async () => {
                      try {
                        const r = await generateVoice({ text: '这是一段音色试听。', voice: v.id, modelKey: voiceModelKey })
                        setVoicePreview(r.url)
                      } catch (e) {
                        setVoiceError((e as Error).message)
                      }
                    }}
                  >
                    试听
                  </button>
                </div>
              ))}
            </div>
          ))}
          {!voiceLoading && (voiceList?.voices.length ?? 0) === 0 && (
            <p className="st-hint">当前目录没有音色。检查 Key/账号音色，或使用预置渠道。</p>
          )}
        </div>

        {caps?.supportsCustomVoiceId && (
          <div className="st-rule" style={{ marginTop: 10 }}>
            <header><b>添加自定义音色</b><span className="st-src">设置库</span></header>
            <div className="st-grid">
              <label className="st-field">
                <span>显示名</span>
                <input value={voiceForm.label} onChange={(e) => setVoiceForm({ ...voiceForm, label: e.target.value })} placeholder="我的音色" />
              </label>
              <label className="st-field">
                <span>voice_id</span>
                <input value={voiceForm.voiceId} onChange={(e) => setVoiceForm({ ...voiceForm, voiceId: e.target.value })} placeholder="供应商的 voice id" />
              </label>
              <label className="st-field">
                <span>备注</span>
                <input value={voiceForm.note} onChange={(e) => setVoiceForm({ ...voiceForm, note: e.target.value })} placeholder="可选" />
              </label>
              <button className="btn" onClick={addCustom}>添加</button>
            </div>
            {myCustom.length > 0 && (
              <div style={{ marginTop: 8 }}>
                {myCustom.map((v) => (
                  <div key={v.id} className="st-field" style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                    <span style={{ flex: 1 }}>{v.label} <code>{v.voiceId}</code></span>
                    <button className="btn-mini danger" onClick={() => setCustomVoices((prev) => prev.filter((x) => x.id !== v.id))}>删除</button>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}

        {voicePreview && (
          <div style={{ marginTop: 8 }}>
            <span className="st-hint">试听</span>
            <audio src={voicePreview} controls preload="metadata" style={{ display: 'block', width: '100%', height: 32 }} />
          </div>
        )}
      </section>
    )
  }

  const renderSkills = () => (
    <section className="st-sec">
      <header className="st-sec-head">
        <h3>技能</h3>
        <span className="st-hint">
          每个工作台加载一份技能；来源与版本可审计，保存只写本机覆盖。锁定契约（工具、输出 schema、Blender
          ABI、安全规则）只读。
        </span>
      </header>
      <p className="st-hint" style={{ margin: '0 0 8px' }}>
        聊天里额外加载的技能只读，不会获得写工具；旧规则包只迁移一次成用户覆盖，恢复默认会删除覆盖。
      </p>
      <div className="st-rules">
        {skillRows.length === 0 && <p className="st-hint">正在读取技能…</p>}
        {skillRows.map((row) => {
          const skill = row.skill
          const edit = skillEdits[row.record.id]
          const locked = skill ? lockedContractText(skill) : ''
          const busy = Boolean(skillBusy[row.record.id])
          return (
            <div key={row.record.id} className="st-rule" data-skill={row.record.id}>
              <header>
                <span className="st-skill-name">{row.record.id}</span>
                <span className="st-src">
                  {row.record.source === 'override' ? '用户覆盖' : '内置'}
                  {skill ? ` · v${skill.manifest.version}` : ''}
                </span>
                <span className="spacer" />
                {row.record.source === 'override' && (
                  <button className="btn-mini" onClick={() => void resetOneSkill(row)} disabled={busy}>
                    恢复默认
                  </button>
                )}
                <button
                  className="btn-mini"
                  onClick={() => void saveOneSkill(row)}
                  disabled={busy || !skill || !edit}
                >
                  {busy ? '保存中…' : '保存技能'}
                </button>
              </header>
              {row.error ? (
                <div className="st-error">{row.error}</div>
              ) : (
                <>
                  <div className="st-hint">{skill?.manifest.description}</div>
                  <div className="st-skill-grid">
                    <label>
                      <span>角色与约束（system）</span>
                      <textarea
                        rows={7}
                        value={edit?.role ?? ''}
                        spellCheck={false}
                        onChange={(e) => patchSkillEdit(row.record.id, 'role', e.target.value)}
                      />
                    </label>
                    <label>
                      <span>任务模板（prompt）</span>
                      <textarea
                        rows={5}
                        value={edit?.task ?? ''}
                        spellCheck={false}
                        onChange={(e) => patchSkillEdit(row.record.id, 'task', e.target.value)}
                      />
                    </label>
                    {locked && (
                      <label>
                        <span>锁定契约（只读）</span>
                        <textarea
                          className="st-locked"
                          rows={Math.min(12, locked.split('\n').length + 1)}
                          value={locked}
                          readOnly
                          spellCheck={false}
                        />
                      </label>
                    )}
                  </div>
                </>
              )}
            </div>
          )
        })}
      </div>
    </section>
  )

  const renderData = () => (
    <section className="st-sec">
      <header className="st-sec-head">
        <h3>数据存储</h3>
      </header>
      <p className="st-hint">
        项目数据与设置都在 SQLite 单文件里：
        <code>{dbFile || '（首次访问项目数据时创建）'}</code>
        <br />
        原各项目目录下的 project.json 保留作为迁移前备份，之后不再回读。
        <br />
        删除项目会先写数据库快照到项目根下的 <code>.deleted/</code>；成片导出、发布包、
        生成图与配音在共享产物目录，不随项目删除。
      </p>

      <header className="st-sec-head">
        <h3>项目管理</h3>
      </header>
      <p className="st-hint">
        新建项目在顶栏项目选择器旁；这里用于清理不再需要的项目。删除会级联清理镜头、角色、
        素材、设定、聊天线程、成片与发布记录。
      </p>
      <ProjectManagerDialog
        variant="inline"
        onDeleted={async (names) => {
          await onProjectsDeleted?.(names)
          toast(names.length === 1 ? `已删除项目 ${names[0]}` : `已删除 ${names.length} 个项目`)
        }}
      />
    </section>
  )

  return (
    <main className="settings settings-shell">
      <aside className="st-nav" aria-label="设置分组">
        {SECTION_META.map((s) => (
          <button
            key={s.id}
            className={section === s.id ? 'on' : ''}
            onClick={() => setSection(s.id)}
          >
            {s.label}
            {s.id === 'providers' && <span>{providers.length}</span>}
            {s.id === 'models' && <span>{models.length}</span>}
          </button>
        ))}
        <div className="st-nav-sep">高级</div>
        {ADVANCED_META.map((s) => (
          <button
            key={s.id}
            className={section === s.id ? 'on' : ''}
            onClick={() => setSection(s.id)}
          >
            {s.label}
          </button>
        ))}
      </aside>

      <div className="st-main">
        <header className="st-topbar">
          <div>
            <h2>设置</h2>
            <span className="st-hint">渠道、模型与默认路由</span>
          </div>
          <span className="spacer" />
          {dirty && <span className="st-dirty">未保存</span>}
          <button className="btn primary" onClick={save} disabled={saving || !dirty}>
            {saving ? '保存中…' : '保存设置'}
          </button>
        </header>

        <div className="st-statusbar">
          {missingKeys.length === 0 && billing.length === 0 && invalidDefaults.length === 0 ? (
            <span className="st-status-ok">渠道与默认路由正常</span>
          ) : (
            <>
              {missingKeys.length > 0 && (
                <button className="st-status-chip bad" onClick={() => setSection('providers')}>
                  缺 Key {missingKeys.length}
                </button>
              )}
              {billing.length > 0 && (
                <button className="st-status-chip bad" onClick={() => setSection('providers')}>
                  余额不足 {billing.length}
                </button>
              )}
              {invalidDefaults.length > 0 && (
                <button className="st-status-chip warn" onClick={() => setSection('routing')}>
                  失效默认 {invalidDefaults.length}
                </button>
              )}
            </>
          )}
        </div>

        <div className="st-scroll">
          {section === 'providers' && renderProviders()}
          {section === 'models' && renderModels()}
          {section === 'routing' && renderRouting()}
          {section === 'agent' && renderAgent()}
          {section === 'creative' && renderCreative()}
          {section === 'stock' && renderStock()}
          {section === 'pricing' && renderPricing()}
          {section === 'lipsync' && renderLipSync()}
          {section === 'voices' && renderVoices()}
          {section === 'skills' && renderSkills()}
          {section === 'data' && renderData()}
        </div>
      </div>

      {catalogProvider && (
        <CatalogDialog
          provider={catalogProvider}
          models={models}
          onClose={() => setCatalogProvider(null)}
          onApply={applyCatalog}
        />
      )}
    </main>
  )
}
