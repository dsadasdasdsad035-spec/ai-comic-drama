import type { AppSettings, Stage } from './api'
import SkillChat from './agent/SkillChat'
import type { WorkbenchChatAdapter } from './agent/workbenchChat'
import type { StagePick } from './ModelSelect'

/** 出片九段改稿：Pi 聊天 + 检查器（SkillChat 内置） */
export default function PromptRefineModal({
  open,
  onClose,
  adapter,
  settings,
  stagePick,
  onPickStage,
  onToast,
}: {
  open: boolean
  onClose: () => void
  adapter: WorkbenchChatAdapter
  settings: AppSettings | null
  stagePick: StagePick
  onPickStage: (stage: Stage, key: string) => void
  onToast?: (msg: string) => void
}) {
  if (!open) return null
  return (
    <div className="vp-refine-backdrop" role="presentation" onClick={onClose}>
      <div
        className="vp-refine-modal"
        role="dialog"
        aria-modal="true"
        aria-label="出片提示词改稿"
        onClick={(e) => e.stopPropagation()}
      >
        <header className="vp-refine-head">
          <div className="vp-refine-head-text">
            <h3>{adapter.chatTitle?.() || '出片改稿'}</h3>
            <p className="vp-refine-sub">
              {(() => {
                try {
                  return adapter.scope?.() || ''
                } catch {
                  return ''
                }
              })()}
            </p>
          </div>
          <button type="button" className="btn-mini vp-refine-close" onClick={onClose}>
            关闭
          </button>
        </header>
        <div className="vp-refine-body">
          <SkillChat
            adapter={adapter}
            settings={settings}
            stagePick={stagePick}
            onPickStage={onPickStage}
            onToast={onToast}
            onClose={onClose}
          />
        </div>
      </div>
    </div>
  )
}
