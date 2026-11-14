import { useState } from 'react'
import { BoardListToolbar } from './BoardListToolbar'
import { BOARD_LIST_PAGE_SIZE, characterListMatch, useBoardListFilter } from './boardListFilter'
import { type AppSettings, type Stage } from './api'
import type { Pricing } from './pricing'
import { type CharacterSheet } from './characters'
import CharacterCard from './CharacterCard'
import { CapModelSelect, hasTextModels, StageModelSelect, type StagePick } from './ModelSelect'
import WorkbenchBar from './WorkbenchBar'

export type CharacterBoardProps = {
  characters: CharacterSheet[]
  patch: (id: string, p: Partial<CharacterSheet>) => CharacterSheet[]
  selectedShot: { id: string; no: string } | null
  selectedShotBudget?: { used: number; max: number | null; expression: boolean; omitted: number } | null
  onInject: (charId: string) => void
  onAdd: () => void
  onDelete: (charId: string) => void
  onRename: (oldId: string, name: string) => void
  viewModel?: string
  onPickViewModel: (key: string) => void
  settings: AppSettings | null
  stagePick: StagePick
  onPickStage: (stage: Stage, key: string) => void
  price?: Pricing
  projectName: string
  onPersist: (next: CharacterSheet[]) => void
  onPublishSheet: (charId: string) => void
  toast: (message: string) => void
  missing: Set<string>
  onImageMissing: (ref: string) => void
  charsOn: boolean
  onToggleChars: () => void
  /** 嵌入素材页：不重复顶栏，由 AssetBoard 的 WorkbenchBar 承载动作 */
  embedded?: boolean
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
  viewModel,
  onPickViewModel,
  settings,
  stagePick,
  onPickStage,
  projectName,
  onPersist,
  onPublishSheet,
  toast,
  missing,
  onImageMissing,
  charsOn,
  onToggleChars,
  embedded,
}: CharacterBoardProps) {
  const [tipOpen, setTipOpen] = useState(true)
  const list = useBoardListFilter(characters, characterListMatch)

  const scopeDetail = (
    <span className="board-hint">
      项目级 · {characters.length} 个角色 ·{' '}
      {selectedShot ? `当前镜头 ${selectedShot.no}` : '未选镜头（到画布选镜后可注入）'}
    </span>
  )

  const body = (
    <>
      {characters.length > 0 ? (
        <BoardListToolbar
          query={list.query}
          onQueryChange={list.setQuery}
          placeholder="搜索名称、角色、lookEn、关键词…"
          ariaLabel="搜索角色"
          filteredCount={list.filteredCount}
          totalCount={list.totalCount}
          page={list.page}
          totalPages={list.totalPages}
          onPageChange={list.setPage}
          pageSize={BOARD_LIST_PAGE_SIZE}
        />
      ) : null}

      <div className="char-grid">
        {characters.length > 0 && list.filteredCount === 0 ? (
          <div className="char-empty-board">没有匹配的角色，换个关键词试试。</div>
        ) : null}
        {list.slice.map((c) => (
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
                <span>
                  还没有角色。三视图锁定外观，lookEn 会原样注入到每个镜头的提示词，保证多镜头长相一致。
                </span>
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
    </>
  )

  if (embedded) {
    return <div className="board-character-embedded">{body}</div>
  }

  return (
    <div className="board">
      <WorkbenchBar
        scope={<span className="wb-bar-title">角色</span>}
        scopeDetail={scopeDetail}
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
              className={characters.length === 0 ? 'btn primary' : 'btn'}
              onClick={onAdd}
              title="新建一张角色卡"
            >
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

      {body}
    </div>
  )
}
