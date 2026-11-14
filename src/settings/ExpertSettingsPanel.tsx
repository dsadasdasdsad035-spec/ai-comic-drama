import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { builtinPlatformToolNames } from '../agent/builtinPlatformTools'
import { expertExportZipUrl, fetchExperts, importExpertsZip, saveCustomExperts } from '../creative/expertApi'
import {
  buildExpertExportBundle,
  cloneExpertAsCustom,
  downloadExpertBundle,
  downloadExpertZipFromUrl,
  downloadExpertsZipBundle,
  mergeCustomExpertRows,
  notifyCreativeExpertsChanged,
  parseExpertImportBundle,
} from '../creative/expertExport'
import { fetchCreativeMcpToolDescriptors, type McpToolDescriptor } from '../mcp/mcpApi'
import {
  DEFAULT_EXPERT_PLATFORM_TOOLS,
  EXPERT_TOOL_GROUP_LABEL,
  groupExpertPlatformTools,
} from '../creative/expertToolGroups'
import { EXPERT_SKILL_WILDCARD, type CreativeExpert } from '../creative/expertTypes'
import { expertCardIconAlt, expertCardIconUrl } from '../creative/expertUi'
import { SkillMarketIcon } from './skillMarketUi'
import {
  soulSkillReadWithoutWhitelist,
  soulToolsMissingFromWhitelist,
} from '../creative/expertSoulHints'
import { listSkillTexts } from '../skills/api'
import type { SkillTextRecord } from '../skills/types'
import {
  SkillDetailBody,
  SkillDetailClose,
  SkillDetailModal,
  SkillDetailPanel,
  SkillDetailTabs,
} from './skillDetailShell'

const ALL_PLATFORM_TOOLS = builtinPlatformToolNames().filter((n) => n !== 'list_experts')
const DEFAULT_TOOLS = DEFAULT_EXPERT_PLATFORM_TOOLS.filter((n) => ALL_PLATFORM_TOOLS.includes(n))
const GROUPED_TOOLS = groupExpertPlatformTools(ALL_PLATFORM_TOOLS)

type DetailTab = 'overview' | 'soul' | 'skills' | 'tools' | 'advanced'

type Props = {
  toast: (message: string) => void
}

function draftFingerprint(e: CreativeExpert): string {
  return JSON.stringify({
    id: e.id,
    name: e.name,
    description: e.description,
    iconUrl: e.iconUrl || '',
    imageDescription: e.imageDescription || '',
    soul: e.soul,
    skillIds: [...e.skillIds].sort(),
    toolIds: [...e.toolIds].sort(),
  })
}

function emptyCustom(): CreativeExpert {
  return {
    id: '',
    name: '',
    description: '',
    iconUrl: '',
    imageDescription: '',
    soul: '你是创意助手。\n\n可用占位符：{{projectName}}、{{epNo}}、{{skillIds}}。',
    skillIds: [],
    toolIds: [...DEFAULT_TOOLS],
    source: 'custom',
  }
}

/** 设置 → 创意专家 */
export function ExpertSettingsPanel({ toast }: Props) {
  const [experts, setExperts] = useState<CreativeExpert[]>([])
  const [installedSkills, setInstalledSkills] = useState<SkillTextRecord[]>([])
  const [loading, setLoading] = useState(true)
  const [busy, setBusy] = useState(false)
  const [detail, setDetail] = useState<CreativeExpert | null>(null)
  const [draft, setDraft] = useState<CreativeExpert | null>(null)
  const [keyword, setKeyword] = useState('')
  const [tab, setTab] = useState<DetailTab>('overview')
  const [skillFilter, setSkillFilter] = useState('')
  const [mcpTools, setMcpTools] = useState<McpToolDescriptor[]>([])
  const [savedFingerprint, setSavedFingerprint] = useState('')
  const importRef = useRef<HTMLInputElement>(null)
  const importZipRef = useRef<HTMLInputElement>(null)

  const refresh = useCallback(async () => {
    setLoading(true)
    try {
      const [list, skills, mcp] = await Promise.all([
        fetchExperts(),
        listSkillTexts().catch(() => []),
        fetchCreativeMcpToolDescriptors().catch(() => []),
      ])
      setExperts(list)
      setInstalledSkills(skills)
      setMcpTools(mcp.filter((t) => !t.error))
    } catch (e) {
      toast((e as Error).message || String(e))
      setExperts([])
    } finally {
      setLoading(false)
    }
  }, [toast])

  useEffect(() => {
    void refresh()
  }, [refresh])

  const customExperts = useMemo(() => experts.filter((e) => e.source === 'custom'), [experts])

  const visibleExperts = useMemo(() => {
    const q = keyword.trim().toLowerCase()
    if (!q) return experts
    return experts.filter((e) => `${e.id} ${e.name} ${e.description}`.toLowerCase().includes(q))
  }, [experts, keyword])

  const openDetail = (expert: CreativeExpert, startTab: DetailTab = 'overview') => {
    const next = {
      ...expert,
      skillIds: [...expert.skillIds],
      toolIds: [...expert.toolIds],
    }
    setDetail(expert)
    setDraft(next)
    setSavedFingerprint(draftFingerprint(next))
    setTab(startTab)
    setSkillFilter('')
  }

  const dirty = useMemo(() => {
    if (!draft || draft.source !== 'custom') return false
    return savedFingerprint !== draftFingerprint(draft)
  }, [draft, savedFingerprint])

  const closeDetail = () => {
    setDetail(null)
    setDraft(null)
    setSavedFingerprint('')
    setTab('overview')
  }

  const requestCloseDetail = () => {
    if (dirty && !window.confirm('有未保存的修改，确定关闭？')) return
    closeDetail()
  }

  useEffect(() => {
    if (!dirty) return
    const onBeforeUnload = (e: BeforeUnloadEvent) => {
      e.preventDefault()
    }
    window.addEventListener('beforeunload', onBeforeUnload)
    return () => window.removeEventListener('beforeunload', onBeforeUnload)
  }, [dirty])

  const openNew = () => openDetail(emptyCustom(), 'overview')

  /** 内置专家：fork 为可编辑自定义副本（不修改仓库 experts/ 内置） */
  const forkBuiltinToCustom = useCallback(
    (src: CreativeExpert, startTab: DetailTab = 'soul'): CreativeExpert => {
      const fork = cloneExpertAsCustom(src, experts)
      setDetail(fork)
      setDraft(fork)
      setSavedFingerprint(draftFingerprint(fork))
      setTab(startTab)
      toast(`已转为可编辑副本「${fork.id}」。保存后请在创意顶栏选用；内置「${src.name}」不变。`)
      return fork
    },
    [experts, toast],
  )

  /** 内置只读：改技能/工具时先 fork，避免勾选无反应 */
  const ensureCustomDraft = useCallback((): CreativeExpert | null => {
    if (!draft) return null
    if (draft.source === 'custom') return draft
    return forkBuiltinToCustom(draft, tab)
  }, [draft, tab, forkBuiltinToCustom])

  const toggleTool = (name: string) => {
    const base = ensureCustomDraft()
    if (!base) return
    const has = base.toolIds.includes(name)
    setDraft({
      ...base,
      toolIds: has ? base.toolIds.filter((x) => x !== name) : [...base.toolIds, name],
    })
  }

  /** 技能通配（*）表示全部已安装技能都可读 */
  const skillWildcard = Boolean(draft?.skillIds.includes(EXPERT_SKILL_WILDCARD))

  const toggleSkill = (id: string) => {
    const base = ensureCustomDraft()
    if (!base) return
    // 通配态下取消单个技能：先展开成「全部已安装 - 该 id」
    if (base.skillIds.includes(EXPERT_SKILL_WILDCARD)) {
      setDraft({
        ...base,
        skillIds: installedSkills.map((s) => s.id).filter((x) => x !== id),
      })
      return
    }
    const has = base.skillIds.includes(id)
    setDraft({
      ...base,
      skillIds: has ? base.skillIds.filter((x) => x !== id) : [...base.skillIds, id],
    })
  }

  const setSkillWildcard = (on: boolean) => {
    const base = ensureCustomDraft()
    if (!base) return
    setDraft({
      ...base,
      skillIds: on
        ? [EXPERT_SKILL_WILDCARD]
        : base.skillIds.filter((x) => x !== EXPERT_SKILL_WILDCARD),
    })
  }

  const mergeSkillIds = (ids: string[]) => {
    const base = ensureCustomDraft()
    if (!base) return
    if (base.skillIds.includes(EXPERT_SKILL_WILDCARD)) return
    const merged = new Set([...base.skillIds, ...ids.map((x) => String(x).trim()).filter(Boolean)])
    setDraft({ ...base, skillIds: [...merged] })
  }

  const setSkillIdsExact = (ids: string[]) => {
    const base = ensureCustomDraft()
    if (!base) return
    setDraft({
      ...base,
      skillIds: [...new Set(ids.map((x) => String(x).trim()).filter((x) => x && x !== EXPERT_SKILL_WILDCARD))],
    })
  }

  const mergeToolIds = (names: string[]) => {
    const base = ensureCustomDraft()
    if (!base) return
    const merged = new Set([...base.toolIds, ...names])
    setDraft({ ...base, toolIds: [...merged] })
  }

  const setToolIdsExact = (names: string[]) => {
    const base = ensureCustomDraft()
    if (!base) return
    setDraft({ ...base, toolIds: [...new Set(names)] })
  }

  const allMcpToolNames = useMemo(() => mcpTools.map((t) => t.externalName), [mcpTools])

  const persistCustomList = async (rows: CreativeExpert[]) => {
    setBusy(true)
    try {
      await saveCustomExperts(rows)
      notifyCreativeExpertsChanged()
      toast('专家已保存')
      await refresh()
    } catch (e) {
      toast((e as Error).message || String(e))
    } finally {
      setBusy(false)
    }
  }

  const persistCustom = async () => {
    if (!draft || draft.source !== 'custom') return
    const id = draft.id.trim()
    const name = draft.name.trim()
    if (!id || !name) {
      toast('自定义专家需要 id 与名称')
      return
    }
    if (!/^[a-z][a-z0-9-]{0,47}$/.test(id)) {
      toast('id 须为小写字母开头、仅含小写字母数字连字符')
      return
    }
    const next: CreativeExpert = { ...draft, id, name }
    const others = customExperts.filter((e) => e.id !== id)
    await persistCustomList([...others, next])
    setSavedFingerprint(draftFingerprint(next))
    closeDetail()
  }

  const removeCustom = async (id: string) => {
    if (!window.confirm(`删除自定义专家「${id}」？已绑定该专家的会话需手动重选专家。`)) return
    setBusy(true)
    try {
      await saveCustomExperts(customExperts.filter((e) => e.id !== id))
      notifyCreativeExpertsChanged()
      toast('已删除自定义专家')
      if (detail?.id === id) closeDetail()
      await refresh()
    } catch (e) {
      toast((e as Error).message || String(e))
    } finally {
      setBusy(false)
    }
  }

  const copyId = async (id: string) => {
    try {
      await navigator.clipboard.writeText(id)
      toast(`已复制 ${id}`)
    } catch {
      toast(id)
    }
  }

  const knownToolNames = useMemo(
    () => [...ALL_PLATFORM_TOOLS, ...mcpTools.map((t) => t.externalName)],
    [mcpTools],
  )

  const soulHints = useMemo(() => {
    if (!draft) return { missingTools: [] as string[], skillRead: false }
    return {
      missingTools: soulToolsMissingFromWhitelist(draft.soul, draft.toolIds, knownToolNames),
      skillRead: soulSkillReadWithoutWhitelist(draft.soul, draft.skillIds),
    }
  }, [draft, knownToolNames])

  const exportCustomJson = () => {
    if (!customExperts.length) {
      toast('没有可导出的自定义专家')
      return
    }
    downloadExpertBundle(buildExpertExportBundle(customExperts))
    toast(`已导出 ${customExperts.length} 个自定义专家（JSON）`)
  }

  const exportCustomZip = () => {
    if (!customExperts.length) {
      toast('没有可导出的自定义专家')
      return
    }
    downloadExpertsZipBundle(customExperts)
    toast(`已打包 ${customExperts.length} 个专家 zip`)
  }

  const onImportZip = async (file: File | undefined) => {
    if (!file) return
    setBusy(true)
    try {
      await importExpertsZip(file)
      notifyCreativeExpertsChanged()
      toast('已从 zip 导入专家（合并）')
      await refresh()
    } catch (e) {
      toast((e as Error).message || 'zip 导入失败')
    } finally {
      setBusy(false)
      if (importZipRef.current) importZipRef.current.value = ''
    }
  }

  const onImportFile = async (file: File | undefined) => {
    if (!file) return
    try {
      const parsed = parseExpertImportBundle(JSON.parse(await file.text()))
      const merged = mergeCustomExpertRows(customExperts, parsed, 'merge')
      await persistCustomList(merged)
    } catch (e) {
      toast((e as Error).message || '导入失败')
    } finally {
      if (importRef.current) importRef.current.value = ''
    }
  }

  const filteredSkills = useMemo(() => {
    const q = skillFilter.trim().toLowerCase()
    const sorted = [...installedSkills].sort((a, b) => a.id.localeCompare(b.id))
    if (!q) return sorted
    return sorted.filter((s) => s.id.toLowerCase().includes(q))
  }, [installedSkills, skillFilter])

  const platformPicked = draft ? draft.toolIds.filter((n) => !n.startsWith('mcp.')).length : 0
  const mcpPicked = draft ? draft.toolIds.filter((n) => n.startsWith('mcp.')).length : 0
  const toolCountLabel = draft
    ? `平台 ${platformPicked}/${ALL_PLATFORM_TOOLS.length} · MCP ${mcpPicked}/${mcpTools.length}（list_experts 始终注入）`
    : undefined

  const canSaveCustom =
    draft?.source === 'custom' &&
    /^[a-z][a-z0-9-]{0,47}$/.test(draft.id.trim()) &&
    Boolean(draft.name.trim())

  return (
    <div className="expert-settings" data-settings-experts>
      <p className="st-hint">
        创意顶栏可选专家：选中后 Pi 仅使用专家 soul、技能白名单与工具白名单；<code>list_experts</code> 由系统始终注入。
      </p>
      <div className="skill-market-toolbar" style={{ marginBottom: 12 }}>
        <input
          type="search"
          className="skill-market-search"
          placeholder="搜索名称、id、说明…"
          value={keyword}
          onChange={(e) => setKeyword(e.target.value)}
          aria-label="搜索专家"
        />
        <span className="st-hint" style={{ margin: '0 auto 0 8px' }}>
          共 {visibleExperts.length} 个
        </span>
        <button type="button" className="btn" onClick={() => void refresh()} disabled={loading}>
          {loading ? '加载中…' : '刷新'}
        </button>
        <button type="button" className="btn" onClick={exportCustomJson} disabled={!customExperts.length}>
          导出 JSON
        </button>
        <button type="button" className="btn" onClick={exportCustomZip} disabled={!customExperts.length}>
          导出 zip 包
        </button>
        <button type="button" className="btn" onClick={() => importRef.current?.click()}>
          导入 JSON
        </button>
        <button type="button" className="btn" onClick={() => importZipRef.current?.click()}>
          导入 zip
        </button>
        <input
          ref={importRef}
          type="file"
          accept="application/json,.json"
          hidden
          onChange={(e) => void onImportFile(e.target.files?.[0])}
        />
        <input
          ref={importZipRef}
          type="file"
          accept="application/zip,.zip"
          hidden
          onChange={(e) => void onImportZip(e.target.files?.[0])}
        />
        <button type="button" className="btn primary" onClick={openNew}>
          新建专家
        </button>
      </div>

      <div className="skill-market-grid">
        {visibleExperts.map((expert) => (
          <div key={expert.id} className="skill-market-card expert-market-card">
            <button type="button" className="expert-market-card-main" onClick={() => openDetail(expert)}>
              <div className="skill-market-card-head">
                <SkillMarketIcon
                  name={expert.name}
                  iconUrl={expertCardIconUrl(expert)}
                  alt={expertCardIconAlt(expert)}
                />
                <div className="skill-market-card-titles">
                  <span className="skill-market-card-name">{expert.name}</span>
                  <span className="st-hint">{expert.id}</span>
                </div>
              </div>
              <p className="skill-market-card-desc">{expert.description || '（无简介）'}</p>
              <div className="skill-market-card-meta">
                <span className="st-hint">
                  {expert.source === 'builtin' ? '内置' : '自定义'} · {expert.toolIds.length} 工具 ·{' '}
                  {expert.skillIds.includes(EXPERT_SKILL_WILDCARD)
                    ? '全部技能'
                    : `${expert.skillIds.length} 技能`}
                </span>
              </div>
            </button>
            <button
              type="button"
              className="btn expert-market-card-edit"
              onClick={() =>
                expert.source === 'builtin' ? forkBuiltinToCustom(expert) : openDetail(expert, 'soul')
              }
            >
              编辑
            </button>
          </div>
        ))}
      </div>

      {!loading && experts.length === 0 ? <p className="st-hint">暂无专家定义；检查仓库 experts/ 目录。</p> : null}

      {detail && draft ? (
        <SkillDetailModal ariaLabel={draft.name || '专家详情'} className="expert-detail-modal" onClose={requestCloseDetail}>
          <div className="skill-market-detail-head">
            <div className="skill-market-detail-titles expert-detail-head-titles">
              <SkillMarketIcon
                name={draft.name || draft.id}
                iconUrl={expertCardIconUrl(draft)}
                alt={expertCardIconAlt(draft)}
                large
              />
              <div>
                <h3>{draft.name || '专家详情'}</h3>
                <span className="st-hint">
                  {draft.source === 'builtin' ? '内置（只读）' : '自定义'} · id: {draft.id || '（新建）'}
                </span>
              </div>
            </div>
            <SkillDetailClose onClose={requestCloseDetail} busy={busy} />
          </div>

          <SkillDetailTabs
            active={tab}
            onChange={(id) => setTab(id as DetailTab)}
            tabs={[
              { id: 'overview', label: '概览' },
              { id: 'soul', label: 'Soul' },
              {
                id: 'skills',
                label: `技能${
                  draft.skillIds.includes(EXPERT_SKILL_WILDCARD)
                    ? ' · 全部'
                    : draft.skillIds.length
                      ? ` · ${draft.skillIds.length}`
                      : ''
                }`,
              },
              { id: 'tools', label: `工具 · ${draft.toolIds.length}` },
              { id: 'advanced', label: '高级' },
            ]}
          />

          <SkillDetailBody>
            {tab === 'overview' ? (
              <SkillDetailPanel hint="内置专家请点「编辑」另存为自定义；自定义专家可直接改并保存。">
                {draft.source === 'custom' && !customExperts.some((e) => e.id === draft.id) ? (
                  <label className="st-field">
                    <span>id</span>
                    <input
                      value={draft.id}
                      onChange={(e) => setDraft({ ...draft, id: e.target.value })}
                      placeholder="expert-my-flow"
                    />
                  </label>
                ) : null}
                {draft.source === 'custom' ? (
                  <>
                    <label className="st-field">
                      <span>名称</span>
                      <input value={draft.name} onChange={(e) => setDraft({ ...draft, name: e.target.value })} />
                    </label>
                    <label className="st-field">
                      <span>说明</span>
                      <input
                        value={draft.description}
                        onChange={(e) => setDraft({ ...draft, description: e.target.value })}
                      />
                    </label>
                    <label className="st-field">
                      <span>图标 URL</span>
                      <input
                        value={draft.iconUrl || ''}
                        onChange={(e) => setDraft({ ...draft, iconUrl: e.target.value })}
                        placeholder="https://… 或留空使用首字头像"
                      />
                    </label>
                    <label className="st-field">
                      <span>图像描述</span>
                      <input
                        value={draft.imageDescription || ''}
                        onChange={(e) => setDraft({ ...draft, imageDescription: e.target.value })}
                        placeholder="卡片图标的无障碍说明"
                      />
                    </label>
                  </>
                ) : (
                  <>
                    <p className="st-hint">{draft.description || '（无说明）'}</p>
                    {draft.imageDescription ? (
                      <p className="st-hint">图像描述：{draft.imageDescription}</p>
                    ) : null}
                  </>
                )}
                {draft.source === 'builtin' ? (
                  <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginTop: 8 }}>
                    <button type="button" className="btn primary" onClick={() => forkBuiltinToCustom(draft)}>
                      编辑（另存为自定义）
                    </button>
                    <button type="button" className="btn" onClick={() => void copyId(draft.id)}>
                      复制 id
                    </button>
                  </div>
                ) : null}
              </SkillDetailPanel>
            ) : null}

            {tab === 'soul' ? (
              <SkillDetailPanel
                title="Soul（= 专家模式 system）"
                hint="占位符：{{projectName}}、{{epNo}}、{{expertName}}、{{expertId}}、{{skillIds}}"
              >
                {soulHints.missingTools.length ? (
                  <p className="creative-header-alert" role="status" data-expert-soul-tool-hint>
                    Soul 提到但未勾选工具：{soulHints.missingTools.join('、')}（请在「工具」Tab 勾选，或改 soul 文案）
                  </p>
                ) : null}
                {soulHints.skillRead ? (
                  <p className="creative-header-hint" role="status">
                    Soul 提到 read_skill*，但技能白名单为空；模型将无法读技能包。
                  </p>
                ) : null}
                {draft.source === 'builtin' ? (
                  <div className="expert-soul-readonly-wrap">
                    <textarea
                      className="st-field"
                      rows={16}
                      readOnly
                      value={draft.soul}
                      style={{ width: '100%', fontFamily: 'var(--font-mono, monospace)', fontSize: 12 }}
                    />
                    <button type="button" className="btn primary" onClick={() => forkBuiltinToCustom(draft, 'soul')}>
                      编辑 Soul
                    </button>
                  </div>
                ) : (
                  <textarea
                    className="st-field"
                    rows={16}
                    value={draft.soul}
                    onChange={(e) => setDraft({ ...draft, soul: e.target.value })}
                    style={{ width: '100%', fontFamily: 'var(--font-mono, monospace)', fontSize: 12 }}
                  />
                )}
              </SkillDetailPanel>
            ) : null}

            {tab === 'skills' ? (
              <SkillDetailPanel title="可读技能" hint="Pi 只能对勾选的 id 调用 read_skill / read_skill_text。">
                {draft.source === 'builtin' ? (
                  <p className="creative-header-hint" role="status">
                    内置专家不能直接改仓库配置。勾选技能会自动另存为自定义副本，点底部「保存」后在创意顶栏选用新 id。
                  </p>
                ) : null}
                <input
                  type="search"
                  className="skill-market-search"
                  placeholder="筛选技能 id…"
                  value={skillFilter}
                  onChange={(e) => setSkillFilter(e.target.value)}
                  style={{ marginBottom: 8 }}
                />
                <label
                  className="expert-skill-pick-row"
                  style={{ gridTemplateColumns: 'auto 1fr', marginBottom: 8, fontWeight: 600 }}
                >
                  <input
                    type="checkbox"
                    checked={skillWildcard}
                    onChange={(e) => setSkillWildcard(e.target.checked)}
                  />
                  <span>
                    全部技能（*）
                    <span className="st-hint"> · 无需逐个勾选，未来新装技能也自动可读</span>
                  </span>
                </label>
                {installedSkills.length > 0 ? (
                  <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginBottom: 8 }}>
                    <button
                      type="button"
                      className="btn"
                      disabled={skillWildcard}
                      onClick={() => mergeSkillIds(installedSkills.map((s) => s.id))}
                    >
                      全选已安装
                    </button>
                    {skillFilter.trim() ? (
                      <button
                        type="button"
                        className="btn"
                        disabled={skillWildcard || !filteredSkills.length}
                        onClick={() => mergeSkillIds(filteredSkills.map((s) => s.id))}
                      >
                        全选当前筛选
                      </button>
                    ) : null}
                    <button type="button" className="btn-ghost" onClick={() => setSkillIdsExact([])}>
                      清空技能
                    </button>
                  </div>
                ) : null}
                {!filteredSkills.length ? (
                  <p className="st-hint">尚未安装技能；请先到 SkillHub 安装 Agent 包。</p>
                ) : (
                  <div className="expert-skill-pick" style={{ maxHeight: 280, overflow: 'auto' }}>
                    {filteredSkills.map((s) => (
                      <label key={s.id} className="expert-skill-pick-row">
                        <input
                          type="checkbox"
                          checked={skillWildcard || draft.skillIds.includes(s.id)}
                          onChange={() => toggleSkill(s.id)}
                        />
                        <span>{s.id}</span>
                        <span className="st-hint">{s.source}</span>
                      </label>
                    ))}
                  </div>
                )}
              </SkillDetailPanel>
            ) : null}

            {tab === 'tools' ? (
              <SkillDetailPanel title="工具白名单" hint={toolCountLabel}>
                {draft.source === 'builtin' ? (
                  <p className="creative-header-hint" role="status">
                    内置专家只读；勾选工具会先另存为自定义副本（与「技能」Tab 相同）。
                  </p>
                ) : null}
                {soulHints.missingTools.length ? (
                  <p className="creative-header-alert" role="status">
                    Soul 引用未勾选：{soulHints.missingTools.join('、')}
                  </p>
                ) : null}
                <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginBottom: 8 }}>
                  <button
                    type="button"
                    className="btn primary"
                    onClick={() => setToolIdsExact([...ALL_PLATFORM_TOOLS, ...allMcpToolNames])}
                  >
                    全部勾选
                  </button>
                  <button type="button" className="btn" onClick={() => setToolIdsExact([...ALL_PLATFORM_TOOLS])}>
                    全选平台工具
                  </button>
                  <button
                    type="button"
                    className="btn"
                    disabled={!allMcpToolNames.length}
                    onClick={() => mergeToolIds(allMcpToolNames)}
                  >
                    全选 MCP
                  </button>
                  <button
                    type="button"
                    className="btn"
                    onClick={() => {
                      const base = ensureCustomDraft()
                      if (!base) return
                      setDraft({ ...base, toolIds: [...DEFAULT_TOOLS] })
                    }}
                  >
                    恢复平台默认
                  </button>
                  <button type="button" className="btn-ghost" onClick={() => setToolIdsExact(['read_source'])}>
                    清空（保留 read_source）
                  </button>
                </div>
                {Object.entries(GROUPED_TOOLS).map(([group, names]) =>
                  names.length ? (
                    <fieldset key={group} className="st-field">
                      <legend>
                        {EXPERT_TOOL_GROUP_LABEL[group] || group}
                        <button
                          type="button"
                          className="btn-mini ghost"
                          style={{ marginLeft: 8, fontWeight: 400 }}
                          onClick={() => mergeToolIds(names)}
                        >
                          全选本组
                        </button>
                      </legend>
                      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
                        {names.map((name) => (
                          <label key={name} style={{ display: 'flex', gap: 4, alignItems: 'center', fontSize: 12 }}>
                            <input
                              type="checkbox"
                              checked={draft.toolIds.includes(name)}
                              onChange={() => toggleTool(name)}
                            />
                            {name}
                          </label>
                        ))}
                      </div>
                    </fieldset>
                  ) : null,
                )}
                <fieldset className="st-field">
                  <legend>MCP（创意聊天）</legend>
                  {!mcpTools.length ? (
                    <p className="st-hint">暂无 MCP：请到设置 → MCP 安装并勾选「创意聊天」。</p>
                  ) : (
                    <div style={{ display: 'flex', flexDirection: 'column', gap: 4, maxHeight: 200, overflow: 'auto' }}>
                      {mcpTools.map((t) => (
                        <label key={t.externalName} className="expert-skill-pick-row" style={{ gridTemplateColumns: 'auto 1fr' }}>
                          <input
                            type="checkbox"
                            checked={draft.toolIds.includes(t.externalName)}
                            onChange={() => toggleTool(t.externalName)}
                          />
                          <span title={t.description || undefined}>
                            {t.externalName}
                            <span className="st-hint"> · {t.serverId}/{t.name}</span>
                          </span>
                        </label>
                      ))}
                    </div>
                  )}
                </fieldset>
              </SkillDetailPanel>
            ) : null}

            {tab === 'advanced' ? (
              <SkillDetailPanel title="高级">
                <p className="st-hint">
                  支持 JSON / zip（<code>id/manifest.json</code> + <code>soul.md</code>）导入导出，同 id 合并覆盖。
                </p>
                <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                  <button
                    type="button"
                    className="btn"
                    onClick={() => {
                      downloadExpertZipFromUrl(expertExportZipUrl(draft.id), `${draft.id}.zip`)
                      toast('已开始下载 zip')
                    }}
                  >
                    导出 zip
                  </button>
                  <button type="button" className="btn" onClick={() => void copyId(draft.id)}>
                    复制 id
                  </button>
                  {draft.source === 'custom' && customExperts.some((e) => e.id === draft.id) ? (
                    <button
                      type="button"
                      className="btn danger"
                      disabled={busy}
                      onClick={() => void removeCustom(draft.id)}
                    >
                      删除此专家
                    </button>
                  ) : null}
                </div>
              </SkillDetailPanel>
            ) : null}
          </SkillDetailBody>

          <footer className="st-modal-foot" style={{ marginTop: 12, gap: 8, alignItems: 'center' }}>
            {draft.source === 'custom' ? (
              <>
                {dirty ? <span className="st-dirty">未保存</span> : <span className="st-hint">已同步</span>}
                <button
                  type="button"
                  className="btn primary"
                  disabled={busy || !canSaveCustom}
                  onClick={() => void persistCustom()}
                >
                  {busy ? '保存中…' : '保存'}
                </button>
              </>
            ) : (
              <button type="button" className="btn primary" onClick={() => forkBuiltinToCustom(draft)}>
                编辑（另存为自定义）
              </button>
            )}
          </footer>
        </SkillDetailModal>
      ) : null}
    </div>
  )
}