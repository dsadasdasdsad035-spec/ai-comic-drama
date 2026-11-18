import { useEffect, useMemo, useState } from 'react'
import type { Skill } from '../skills/types'
import type { SkillTextRecord } from '../skills/types'
import { isAgentPackSkill } from '../skills/agentPack'
import { SkillMarketIcon } from './skillMarketUi'
import {
  SkillDetailBadge,
  SkillDetailBody,
  SkillDetailFoot,
  SkillDetailHero,
  SkillDetailModal,
  SkillDetailPanel,
  SkillDetailStat,
  SkillDetailTabs,
} from './skillDetailShell'

export type SkillCatalogRow = { record: SkillTextRecord; skill?: Skill; error?: string }

/** 附件大小展示：超过 10KB 用 KB，避免详情页出现长串字节数 */
function formatBytes(bytes: number): string {
  const n = Number(bytes)
  if (!Number.isFinite(n) || n <= 0) return '0 B'
  if (n < 1024) return `${n} B`
  if (n < 10 * 1024) return `${(n / 1024).toFixed(1)} KB`
  return `${Math.round(n / 1024)} KB`
}

type Props = {
  row: SkillCatalogRow
  sourceLabel: string
  edit?: { role: string; task: string }
  locked: string
  busy: boolean
  onClose: () => void
  onPatchEdit: (field: 'role' | 'task', value: string) => void
  onSave: () => void
  onReset: () => void
  onUninstall: () => void
}

type TabId = 'overview' | 'content' | 'contract'

export function SkillInstalledDetailDialog({
  row,
  sourceLabel,
  edit,
  locked,
  busy,
  onClose,
  onPatchEdit,
  onSave,
  onReset,
  onUninstall,
}: Props) {
  const skill = row.skill
  const agentPack = skill && isAgentPackSkill(skill)
  // Agent 包的详情没有可编辑分区（只有 SKILL.md 只读视图），保存按钮不能出现，
  // 否则点下去提交的是用户看不到的 role/task 草稿
  const canSave =
    Boolean(skill && edit) && !agentPack && row.record.source !== 'skillhub' && row.record.source !== 'upload'
  const canUninstall = row.record.source === 'skillhub' || row.record.source === 'upload'
  const canReset = row.record.source === 'override'
  const readOnly = row.record.source === 'skillhub' || row.record.source === 'upload'

  const [tab, setTab] = useState<TabId>('overview')

  useEffect(() => {
    setTab('overview')
  }, [row.record.id])

  const tabs = useMemo(() => {
    if (!skill) return [{ id: 'overview', label: '概览' }]
    if (agentPack) {
      return [
        { id: 'overview', label: '概览' },
        { id: 'content', label: 'SKILL.md' },
      ]
    }
    return [
      { id: 'overview', label: '概览' },
      { id: 'content', label: readOnly ? '正文' : '编辑' },
      { id: 'contract', label: '锁定契约', hidden: !locked },
    ]
  }, [skill, agentPack, readOnly, locked])

  const tools = skill?.manifest.tools?.length ?? 0
  const contracts = skill?.manifest.contracts?.length ?? 0
  const attachments = row.record.attachments ?? []
  const fileCount = row.record.fileCount ?? attachments.length

  return (
    <SkillDetailModal ariaLabel={`技能 ${row.record.id}`} onClose={onClose} dismissOnBackdrop={!busy}>
      <SkillDetailHero
        icon={<SkillMarketIcon name={row.record.id} large />}
        title={row.record.id}
        slug={row.record.skillhub?.namespace ? `${row.record.skillhub.namespace}/${row.record.skillhub.slug}` : undefined}
        onClose={onClose}
        busy={busy}
        badges={
          <>
            <SkillDetailBadge tone={readOnly ? 'accent' : 'default'}>{sourceLabel}</SkillDetailBadge>
            {skill ? <SkillDetailBadge tone="muted">v{skill.manifest.version}</SkillDetailBadge> : null}
            {skill ? <SkillDetailBadge tone="muted">{skill.manifest.stage}</SkillDetailBadge> : null}
            {agentPack ? <SkillDetailBadge tone="accent">Agent 包</SkillDetailBadge> : null}
          </>
        }
        stats={
          skill ? (
            <>
              <SkillDetailStat label="运行时" value={skill.manifest.runtime} />
              <SkillDetailStat label="工具" value={tools} />
              <SkillDetailStat label="契约" value={contracts} />
              <SkillDetailStat label="包内文件" value={fileCount} />            </>
          ) : null
        }
      />

      {row.error ? <div className="st-modal-error">{row.error}</div> : null}

      <SkillDetailTabs tabs={tabs} active={tab} onChange={(id) => setTab(id as TabId)} />

      <SkillDetailBody>
        {tab === 'overview' ? (
          <>
            {skill ? (
              <SkillDetailPanel title="说明">
                <p className="skill-detail-prose">{skill.manifest.description || '（无说明）'}</p>
              </SkillDetailPanel>
            ) : (
              <p className="st-hint">无法解析技能正文，请检查 SKILL.md 格式。</p>
            )}
            {skill ? (
              <div className="skill-detail-manifest">
                <SkillDetailStat label="输出" value={skill.manifest.output || '—'} />
                <SkillDetailStat label="输入字段" value={skill.manifest.inputs?.join('、') || '—'} />
                {row.record.skillhub?.version ? (
                  <SkillDetailStat label="SkillHub 版本" value={row.record.skillhub.version} />
                ) : null}
              </div>
            ) : null}
            {agentPack ? (
              <p className="st-hint skill-detail-callout">
                Agent 包为只读安装。Pi 用 <code>list_installed_skills</code> 查目录、<code>read_skill_text</code> 读全文；写项目数据用内置 <code>submit_*</code>。
              </p>
            ) : readOnly ? (
              <p className="st-hint skill-detail-callout">市场 / 上传来源不可直接改正文。如需更新请卸载后重装新版本。</p>
            ) : (
              <p className="st-hint skill-detail-callout">保存后会写入用户覆盖层，不影响仓库内置副本。</p>
            )}

            <SkillDetailPanel
              title="包内文件"
              hint={
                row.record.filesMissing
                  ? '包内文件缺失 · 需重新安装'
                  : fileCount
                    ? `${fileCount} 个附加文件 · Pi 用 read_skill_file 按需读取`
                    : '无附加文件'
              }
            >
              {row.record.filesMissing && !attachments.length ? (
                <p className="st-hint" data-skill-files-missing>
                  该技能的安装记录还在，但包内文件不在磁盘上（较早版本安装留下的记录，只存了正文）。
                  正文仍可读；references / scripts / assets 需要重新安装这个技能才会补齐。
                </p>
              ) : attachments.length ? (
                <ul className="skill-detail-files" data-skill-attachments>
                  {attachments.map((f) => (
                    <li key={f.path}>
                      <code>{f.path}</code>
                      <span className="st-hint">{formatBytes(f.bytes)}</span>
                    </li>
                  ))}
                </ul>
              ) : (
                <p className="st-hint" data-skill-no-attachments>
                  本包只有 SKILL.md，没有 references / scripts / assets。模型读到的正文若引用包内文件，会指向不存在的路径。
                </p>
              )}
            </SkillDetailPanel>
          </>
        ) : null}

        {tab === 'content' && skill ? (
          agentPack ? (
            <SkillDetailPanel title="SKILL.md" hint="只读 · 完整技能包正文">
              <textarea className="skill-detail-editor st-locked" value={row.record.text} readOnly spellCheck={false} />
            </SkillDetailPanel>
          ) : (
            <SkillDetailPanel title={readOnly ? '技能正文' : '编辑 system / prompt'} hint={readOnly ? '只读' : '修改后点右下角保存'}>
              <label className="skill-detail-field">
                <span>角色与约束（system）</span>
                <textarea
                  className={`skill-detail-editor${readOnly ? ' st-locked' : ''}`}
                  rows={8}
                  value={edit?.role ?? ''}
                  spellCheck={false}
                  readOnly={readOnly}
                  onChange={(e) => onPatchEdit('role', e.target.value)}
                />
              </label>
              <label className="skill-detail-field">
                <span>任务模板（prompt）</span>
                <textarea
                  className={`skill-detail-editor${readOnly ? ' st-locked' : ''}`}
                  rows={6}
                  value={edit?.task ?? ''}
                  spellCheck={false}
                  readOnly={readOnly}
                  onChange={(e) => onPatchEdit('task', e.target.value)}
                />
              </label>
            </SkillDetailPanel>
          )
        ) : null}

        {tab === 'contract' && locked ? (
          <SkillDetailPanel title="锁定契约" hint="解析器强制保留，不可编辑">
            <pre className="skill-detail-code">{locked}</pre>
          </SkillDetailPanel>
        ) : null}
      </SkillDetailBody>

      <SkillDetailFoot
        start={
          <>
            {canReset ? (
              <button type="button" className="btn-mini" disabled={busy} onClick={onReset}>
                恢复默认
              </button>
            ) : null}
            {canUninstall ? (
              <button type="button" className="btn-mini danger" disabled={busy} onClick={onUninstall}>
                卸载
              </button>
            ) : null}
          </>
        }
        end={
          <>
            <button type="button" className="btn-mini" disabled={busy} onClick={onClose}>
              关闭
            </button>
            {canSave ? (
              <button type="button" className="btn primary" disabled={busy} onClick={onSave}>
                {busy ? '保存中…' : '保存覆盖'}
              </button>
            ) : null}
          </>
        }
      />
    </SkillDetailModal>
  )
}