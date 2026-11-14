import { useEffect, useMemo, useRef, useState } from 'react'
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
import { uninstallSkill } from '../skills/skillhubApi'
import { reloadSkills } from '../skills/registry'
import { tryAgentPackSkill } from '../skills/agentPack'
import { composeSkillBody } from '../skills/parse'
import { LEGACY_RUNTIME_SKILL_IDS } from '../skills/validate'
import { parseSkillText } from '../skills/parse'
import type { Skill, SkillTextRecord } from '../skills/types'
import {
  AGENT_LIMIT_DEFAULTS,
  AGENT_LIMIT_RANGES,
  normalizeAgentLimits,
  type AgentLimitSettings,
} from '../agent/agentLimits'
import { normalizeAgentHostMode, type AgentHostMode } from '../agent/agentHostMode'
import { normalizeCreativeSettings, type CreativeSettings } from '../creative/settings'
import { listCreativeAdapters, type AdapterInfo } from '../creative/mediaApi'
import { findToolCapability } from '../agent/toolCapabilities'
import { resolveStageModel, stageModelEntries, textModelEntries } from '../ModelSelect'
import { DEFAULT_PRICING, normalizePricing, type Pricing } from '../pricing'
import { type CatalogEntry } from './CatalogDialog'
import { fetchStockProviders } from '../stock/api'
import type { StockProviderId, StockSettings } from '../stock/types'
import { VOICE_SOURCE_LABELS } from '../voiceCatalog'
import {
  fetchAuthMe,
  fetchBillingSettingsAdmin,
  fetchEmailStatus,
  fetchLedger,
  fetchRechargePacks,
  fetchReconciliationReport,
  type BillingUser,
  type BillingWallet,
  type EmailStatus,
  type RechargePack,
} from '../billingApi'
import {
  LEGACY_SECTION_TO_NAV,
  hubDefaultPane,
  type SettingsHub,
  type SettingsInitialSection,
  type SettingsPane,
} from './settingsNav'
import {
  DEFAULT_LIP_SYNC,
  cleanHash,
  normalizeLipSyncSettings,
  toSkillRow,
  type SkillRow,
  CAP_META,
  PROVIDER_PRESETS,
  type AddPreset,
  capsOf,
  CAP_TO_PC,
} from './settingsMeta'

export type SettingsWorkbenchProps = {
  toast: (m: string) => void
  onSaved?: () => void
  onProjectsDeleted?: (names: string[]) => void | Promise<void>
  currentProjectName?: string
  initialSection?: SettingsInitialSection
}

export function useSettingsWorkbench({
  toast,
  onSaved,
  onProjectsDeleted,
  currentProjectName = '',
  initialSection,
}: SettingsWorkbenchProps) {
  const [providers, setProviders] = useState<Provider[]>([])
  const [models, setModels] = useState<ModelEntry[]>([])
  const [defaults, setDefaults] = useState<Partial<Record<Cap, string>>>({})
  const [stageModels, setStageModels] = useState<Partial<Record<Stage, string>>>({})
  const [pricing, setPricing] = useState<Pricing>(DEFAULT_PRICING)
  const [agentLimits, setAgentLimits] = useState<Required<AgentLimitSettings>>(() => normalizeAgentLimits(undefined))
  const [agentHostMode, setAgentHostMode] = useState<AgentHostMode>('full_host')
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
  const [skillsSubview, setSkillsSubview] = useState<'catalog' | 'market'>('catalog')
  const [dbFile, setDbFile] = useState('')
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [testing, setTesting] = useState<Record<string, boolean>>({})
  const [tested, setTested] = useState<Record<string, ProviderTestResult>>({})
  const [baseline, setBaseline] = useState('')
  const [hub, setHub] = useState<SettingsHub>('connections')
  const [pane, setPane] = useState<SettingsPane>('providers')

  const openHub = (next: SettingsHub) => {
    setHub(next)
    setPane(hubDefaultPane(next))
  }

  const openSettingsPane = (next: SettingsPane) => {
    if (next === 'overview') {
      setHub('extensions')
      setPane('overview')
      return
    }
    const nav = LEGACY_SECTION_TO_NAV[next]
    setHub(nav.hub)
    setPane(nav.pane)
  }
  const [billUser, setBillUser] = useState<BillingUser | null>(null)
  const [billWallet, setBillWallet] = useState<BillingWallet | null>(null)
  const [billPacks, setBillPacks] = useState<RechargePack[]>([])
  const [billLedger, setBillLedger] = useState<unknown[]>([])
  const [billAuthEmail, setBillAuthEmail] = useState('')
  const [billAuthPassword, setBillAuthPassword] = useState('')
  const [billAdminSettings, setBillAdminSettings] = useState<Record<string, unknown> | null>(null)
  const [billReconcile, setBillReconcile] = useState<Record<string, unknown> | null>(null)
  const [billEmailStatus, setBillEmailStatus] = useState<EmailStatus | null>(null)
  const [billBusy, setBillBusy] = useState(false)
  const billRechargePollGen = useRef(0)

  const refreshBilling = async () => {
    try {
      const me = await fetchAuthMe()
      setBillUser(me.user)
      setBillWallet(me.wallet || null)
      if (me.user) {
        const [packs, led] = await Promise.all([fetchRechargePacks(), fetchLedger(20)])
        setBillPacks(packs)
        setBillLedger(led.entries)
        if (me.user.is_admin) {
          const [adm, rec, mail] = await Promise.all([
            fetchBillingSettingsAdmin(),
            fetchReconciliationReport(),
            fetchEmailStatus().catch(() => null),
          ])
          setBillAdminSettings(adm.settings)
          setBillReconcile(rec.report as Record<string, unknown>)
          setBillEmailStatus(mail)
        }
      }
    } catch (e) {
      toast((e as Error).message)
    }
  }

  useEffect(() => {
    if (initialSection) {
      const nav = LEGACY_SECTION_TO_NAV[initialSection]
      setHub(nav.hub)
      setPane(nav.pane)
      if (initialSection === 'skills') setSkillsSubview('market')
    }
  }, [initialSection])

  useEffect(() => {
    if (pane === 'billing') void refreshBilling()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pane])

  useEffect(() => {
    return () => {
      billRechargePollGen.current += 1
    }
  }, [pane])
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
    agentHostMode,
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
        setAgentHostMode(normalizeAgentHostMode(s.agentHostMode))
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
            agentHostMode: normalizeAgentHostMode(s.agentHostMode),
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
    setSkillRows((prev) => {
      const i = prev.findIndex((x) => x.record.id === record.id)
      if (i >= 0) {
        const next = [...prev]
        next[i] = row
        return next
      }
      return [...prev, row].sort((a, b) => a.record.id.localeCompare(b.record.id))
    })
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

  const uninstallOneSkill = async (row: SkillRow) => {
    if (row.record.source !== 'skillhub' && row.record.source !== 'upload') return
    setSkillBusy((prev) => ({ ...prev, [row.record.id]: true }))
    try {
      await uninstallSkill(row.record.id)
      await reloadSkills()
      await refreshSkills()
      toast(`已卸载技能「${row.record.id}」`)
    } catch (e) {
      toast((e as Error).message || '卸载失败')
    } finally {
      setSkillBusy((prev) => ({ ...prev, [row.record.id]: false }))
    }
  }

  const saveOneSkill = async (row: SkillRow) => {
    if (row.record.source === 'skillhub' || row.record.source === 'upload') {
      toast('市场来源技能只读，请卸载后重新安装或更新版本')
      return
    }
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
        agentHostMode,
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
        agentHostMode: normalizeAgentHostMode(saved.agentHostMode),
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
      setAgentHostMode(next.agentHostMode)
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
    openSettingsPane('providers')
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
    openSettingsPane('models')
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
  const sceneCapabilityText = !sceneResolution.entry
    ? '未配置白模 3D 代码模型'
    : sceneCapability?.nativeTools
      ? `当前 ${sceneResolution.entry.label} · 支持原生工具调用（thinking ${sceneCapability.thinking === 'disable' ? '关闭' : '不设置'}）`
      : `当前 ${sceneResolution.entry.label} · 未验证，聊天不可用`

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

  const installedSkillIds = useMemo(() => new Set(skillRows.map((r) => r.record.id)), [skillRows])
  const installedSkillSlugs = useMemo(() => {
    const s = new Set<string>()
    for (const r of skillRows) {
      const h = r.record.skillhub
      if (h?.slug) s.add(`${h.namespace || ''}:${h.slug}`)
    }
    return s
  }, [skillRows])

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

  const skillSourceLabel = (source: SkillTextRecord['source']) => {
    if (source === 'override') return '用户覆盖'
    if (source === 'skillhub') return 'SkillHub'
    if (source === 'upload') return '本地上传'
    return '内置'
  }

  return {
    providers,
    setProviders,
    models,
    setModels,
    defaults,
    setDefaults,
    stageModels,
    setStageModels,
    pricing,
    setPricing,
    agentLimits,
    setAgentLimits,
    agentHostMode,
    setAgentHostMode,
    creative,
    setCreative,
    stock,
    setStock,
    stockStatus,
    setStockStatus,
    stockTesting,
    setStockTesting,
    adapters,
    setAdapters,
    adapterError,
    setAdapterError,
    lipSync,
    setLipSync,
    customVoices,
    setCustomVoices,
    voiceModelKey,
    setVoiceModelKey,
    voiceList,
    setVoiceList,
    voiceLoading,
    setVoiceLoading,
    voiceError,
    setVoiceError,
    voicePreview,
    setVoicePreview,
    voiceForm,
    setVoiceForm,
    apiKey,
    setApiKey,
    rules,
    setRules,
    skillRows,
    setSkillRows,
    skillEdits,
    setSkillEdits,
    skillBusy,
    setSkillBusy,
    skillsSubview,
    setSkillsSubview,
    skillSourceLabel,
    dbFile,
    setDbFile,
    loading,
    setLoading,
    saving,
    setSaving,
    testing,
    setTesting,
    tested,
    setTested,
    baseline,
    setBaseline,
    hub,
    setHub,
    pane,
    setPane,
    openHub,
    openSettingsPane,
    addMenu,
    setAddMenu,
    catalogProvider,
    setCatalogProvider,
    modelSearch,
    setModelSearch,
    providerFilter,
    setProviderFilter,
    capFilter,
    setCapFilter,
    expandedModel,
    setExpandedModel,
    billUser,
    setBillUser,
    billWallet,
    setBillWallet,
    billPacks,
    setBillPacks,
    billLedger,
    setBillLedger,
    billAuthEmail,
    setBillAuthEmail,
    billAuthPassword,
    setBillAuthPassword,
    billAdminSettings,
    setBillAdminSettings,
    billReconcile,
    setBillReconcile,
    billEmailStatus,
    setBillEmailStatus,
    billBusy,
    setBillBusy,
    billRechargePollGen,
    refreshBilling,
    refreshVoices,
    refreshSkills,
    applySkillRecord,
    patchSkillEdit,
    saveOneSkill,
    resetOneSkill,
    uninstallOneSkill,
    save,
    patchProvider,
    patchModel,
    runTest,
    addProviderFromPreset,
    toggleProviderCap,
    removeProvider,
    removeModel,
    toggleModelCap,
    addModel,
    openCatalog,
    applyCatalog,
    refreshAdapters,
    setIngest,
    patchStock,
    testStock,
    sceneResolution,
    sceneCapability,
    sceneCapabilityText,
    missingKeys,
    billing,
    invalidDefaults,
    filteredModels,
    settingsDraft,
    installedSkillIds,
    installedSkillSlugs,
    dirty,
    hash,
    currentProjectName,
    onProjectsDeleted,
    toast,
    onSaved,
    initialSection,
  }
}

export type SettingsWorkbench = ReturnType<typeof useSettingsWorkbench>
