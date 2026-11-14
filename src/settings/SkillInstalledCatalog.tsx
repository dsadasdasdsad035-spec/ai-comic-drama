import { useMemo, useState } from 'react'
import type { Skill } from '../skills/types'
import type { SkillTextRecord } from '../skills/types'
import { SkillInstalledDetailDialog, type SkillCatalogRow } from './SkillInstalledDetailDialog'
import { SkillMarketIcon } from './skillMarketUi'

type Props = {
  rows: SkillCatalogRow[]
  skillEdits: Record<string, { role: string; task: string }>
  skillBusy: Record<string, boolean>
  sourceLabel: (source: SkillTextRecord['source']) => string
  lockedContract: (skill: Skill) => string
  onPatchEdit: (id: string, field: 'role' | 'task', value: string) => void
  onSave: (row: SkillCatalogRow) => void
  onReset: (row: SkillCatalogRow) => void
  onUninstall: (row: SkillCatalogRow) => void
}

function matchRow(row: SkillCatalogRow, q: string): boolean {
  const hay = [
    row.record.id,
    row.skill?.manifest.description || '',
    row.skill?.manifest.stage || '',
    row.record.source,
    row.record.skillhub?.slug || '',
    row.record.skillhub?.namespace || '',
  ]
    .join(' ')
    .toLowerCase()
  return hay.includes(q)
}

export function SkillInstalledCatalog({
  rows,
  skillEdits,
  skillBusy,
  sourceLabel,
  lockedContract,
  onPatchEdit,
  onSave,
  onReset,
  onUninstall,
}: Props) {
  const [query, setQuery] = useState('')
  const [active, setActive] = useState<SkillCatalogRow | null>(null)

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase()
    if (!q) return rows
    return rows.filter((r) => matchRow(r, q))
  }, [rows, query])

  const activeEdit = active ? skillEdits[active.record.id] : undefined
  const activeLocked = active?.skill ? lockedContract(active.skill) : ''
  const activeBusy = active ? Boolean(skillBusy[active.record.id]) : false

  return (
    <div className="skill-installed-catalog" data-skill-installed-catalog>
      <p className="st-hint skill-installed-hint">
        创意 Pi 宿主<strong>仅</strong> SkillHub / 上传的 Agent 包；平台 read/submit 为内置工具。点卡片查看正文或编辑内置覆盖。
      </p>

      {rows.length > 0 ? (
        <div className="skill-market-toolbar">
          <input
            type="search"
            className="st-input skill-market-search"
            placeholder="搜索已安装技能 id、说明、来源…"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            aria-label="搜索已安装技能"
          />
          <span className="st-hint board-list-toolbar-meta">
            {query.trim() ? `匹配 ${filtered.length} / ${rows.length}` : `共 ${rows.length} 个`}
          </span>
        </div>
      ) : null}

      {rows.length === 0 ? (
        <p className="st-hint">
          还没有已安装技能。请在「SkillHub 市场」安装，或上传包含 SKILL.md 的 zip（技能 id 取自 frontmatter 的 name）。
        </p>
      ) : filtered.length === 0 ? (
        <p className="st-hint">没有匹配的技能，换个关键词试试。</p>
      ) : (
        <div className="skill-market-grid" data-skill-installed-grid>
          {filtered.map((row) => {
            const skill = row.skill
            const desc = row.error
              ? row.error
              : skill?.manifest.description || '（无简介）'
            return (
              <article
                key={row.record.id}
                className={`skill-market-card skill-catalog-card${row.error ? ' has-error' : ''}`}
                data-skill={row.record.id}
                role="button"
                tabIndex={0}
                aria-label={`查看技能 ${row.record.id}`}
                onClick={() => setActive(row)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' || e.key === ' ') {
                    e.preventDefault()
                    setActive(row)
                  }
                }}
              >
                <div className="skill-market-card-head">
                  <SkillMarketIcon name={row.record.id} />
                  <div className="skill-market-card-titles">
                    <span className="st-skill-name skill-market-card-name">{row.record.id}</span>
                    <span className="skill-catalog-badge">{sourceLabel(row.record.source)}</span>
                  </div>
                </div>
                <p className="skill-market-card-desc">{desc}</p>
                <div className="skill-market-card-meta">
                  <span className="st-hint">
                    {skill ? `v${skill.manifest.version} · ${skill.manifest.stage}` : '解析异常'}
                  </span>
                  <span className="st-hint skill-catalog-open">查看</span>
                </div>
              </article>
            )
          })}
        </div>
      )}

      {active ? (
        <SkillInstalledDetailDialog
          row={active}
          sourceLabel={sourceLabel(active.record.source)}
          edit={activeEdit}
          locked={activeLocked}
          busy={activeBusy}
          onClose={() => setActive(null)}
          onPatchEdit={(field, value) => onPatchEdit(active.record.id, field, value)}
          onSave={() => onSave(active)}
          onReset={() => onReset(active)}
          onUninstall={() => onUninstall(active)}
        />
      ) : null}
    </div>
  )
}