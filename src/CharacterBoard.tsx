import { useState } from 'react'
import { type AppSettings, type Stage } from './api'
import type { Pricing } from './pricing'
import { type CharacterSheet } from './characters'
import CharacterCard from './CharacterCard'
import { CapModelSelect, hasTextModels, StageModelSelect, type StagePick } from './ModelSelect'
import { type BuiltinResult } from './agent/workbenchChat'
import WorkbenchBar from './WorkbenchBar'

type Props = {
  characters: CharacterSheet[]
  patch: (id: string, p: Partial<CharacterSheet>) => CharacterSheet[]
  selectedShot: { id: string; no: string } | null
  selectedShotBudget?: { used: number; max: number | null; expression: boolean; omitted: number } | null
  onInject: (charId: string) => void
  onAdd: () => void
  onDelete: (charId: string) => void
  onRename: (oldId: string, name: string) => void
  onExtract: (scope: 'episode' | 'project', signal?: AbortSignal) => Promise<BuiltinResult>
  extracting: '' | 'episode' | 'project'
  viewModel?: string
  onPickViewModel: (key: string) => void
  settings: AppSettings | null
  stagePick: StagePick
  onPickStage: (stage: Stage, key: string) => void
  price?: Pricing
  projectName: string
  onPersist: (next: CharacterSheet[]) => void
  onPublishSheet: (charId: string) => void
  epNo: number
  toast: (message: string) => void
  missing: Set<string>
  onImageMissing: (ref: string) => void
  charsOn: boolean
  onToggleChars: () => void
}

export default function CharacterBoard({
  characters,
  patch,
  selectedShot,
  selectedShotBudget,
  onInject,
  onAdd,
  onDelete,
  onRename,
  onExtract,
  extracting,
  viewModel,
  onPickViewModel,
  settings,
  stagePick,
  onPickStage,
  projectName,
  onPersist,
  onPublishSheet,
  epNo,
  toast,
  missing,
  onImageMissing,
  charsOn,
  onToggleChars,
}: Props) {
  const [tipOpen, setTipOpen] = useState(true)

  const runExtract = async (scope: 'episode' | 'project') => {
    const r = await onExtract(scope)
    if (!r.ok) {
      if (!r.cancelled) toast(r.error || '拆角色失败')
      return
    }
    toast(r.summary)
  }

  return (
    <div className="board">
      <WorkbenchBar
        scope={<span className="wb-bar-title">角色</span>}
        scopeDetail={
          <span className="board-hint">
            E{String(epNo).padStart(2, '0')} · {characters.length} 个角色 ·{' '}
            {selectedShot ? `当前镜头 ${selectedShot.no}` : '未选镜头'}
          </span>
        }
        settings={
          <>
            <StageModelSelect
              stage="character"
              label="拆角色模型"
              settings={settings}
              pick={stagePick}
              onChange={onPickStage}
              compact
            />
            <CapModelSelect
              cap="view"
              label="三视图模型"
              settings={settings}
              value={viewModel}
              onChange={onPickViewModel}
              className="wb-field"
            />
          </>
        }
        actions={
          <>
            <button
              className="btn-ghost"
              disabled={!!extracting || !projectName}
              onClick={() => void runExtract('project')}
              title="用大模型从全剧原文梗概与分集场次里拆出角色"
            >
              {extracting === 'project' ? '拆解中…' : '从全剧拆'}
            </button>
            <button
              className={characters.length === 0 ? 'btn primary' : 'btn-ghost'}
              disabled={!!extracting || !projectName}
              onClick={() => void runExtract('episode')}
              title="用大模型从本集场次 + 本集分镜里拆出角色，自动写外观锚点"
            >
              {extracting === 'episode' ? '拆解中…' : '从本集拆角色'}
            </button>
            <button className="btn" onClick={onAdd} title="新建一张角色卡">
              + 新建角色
            </button>
            {characters.length > 0 && (
              <button
                className={charsOn ? 'btn-ghost' : 'btn primary'}
                onClick={onToggleChars}
                title="把角色卡显示到画布上（画布视图可见，可拖到分镜旁）"
              >
                {charsOn ? '角色已在画布' : '全部上画布'}
              </button>
            )}
          </>
        }
      />

      <div className="char-grid">
        {characters.map((c) => (
          <CharacterCard
            key={c.id}
            c={c}
            patch={patch}
            canInject={Boolean(selectedShot)}
            onInject={() => onInject(c.id)}
            settings={settings}
            onDelete={() => onDelete(c.id)}
            onRename={(name) => onRename(c.id, name)}
            viewModel={viewModel}
            projectName={projectName}
            onPersist={onPersist}
            onPublishSheet={() => onPublishSheet(c.id)}
            selectedShot={selectedShot}
            selectedBudget={selectedShotBudget}
            missing={missing}
            onImageMissing={onImageMissing}
          />
        ))}
        {characters.length === 0 && (
          <div className="char-empty-board">
            {tipOpen ? (
              <>
                <span>还没有角色。三视图锁定外观，lookEn 会原样注入到每个镜头的提示词，保证多镜头长相一致。</span>
                <button className="btn-mini ghost" onClick={() => setTipOpen(false)}>
                  知道了
                </button>
              </>
            ) : (
              '还没有角色，点右上角「+ 新建角色」开始'
            )}
          </div>
        )}
      </div>
    </div>
  )
}
