import { lazy, Suspense, useCallback, useMemo, useState } from 'react'
import {
  getProject,
  patchProject,
  type AppSettings,
} from './api'
import { StageModelSelect, type StagePick } from './ModelSelect'
import {
  lexiconSheetToEntry,
  newLexiconWhiteboxSheet,
  type LexiconWhiteboxSheet,
} from './lexiconWhitebox'
import { applyLexiconRender, applyLexiconSave } from './lexiconWhiteboxPatch'
import type { CodeEditorRendered, CodeEditorSave } from './SceneCodeWorkbench'

const LazySceneCodeWorkbench = lazy(() => import('./SceneCodeWorkbench'))

type Props = {
  projectName: string
  projectAspect: string
  sheets: LexiconWhiteboxSheet[]
  onSheetsChange: (next: LexiconWhiteboxSheet[]) => void
  settings: AppSettings | null
  stagePick: StagePick
  onPickStage: (stage: import('./api').Stage, key: string) => void
  onPublishAsset?: (input: { title: string; kind: string; url: string }) => void
  onEditorDirtyChange?: (dirty: boolean) => void
  toast: (m: string) => void
}

function codeLabel(s: LexiconWhiteboxSheet): string {
  const hash = s.sceneCodeMeta?.codeHash ?? s.sceneCode?.codeHash
  if (hash) return hash.length > 8 ? hash.slice(0, 8) : hash
  if (s.sceneCode?.code?.trim()) return '已保存'
  return '无代码'
}

export default function LexiconWhiteboxStudio({
  projectName,
  projectAspect,
  sheets,
  onSheetsChange,
  settings,
  stagePick,
  onPickStage,
  onPublishAsset,
  onEditorDirtyChange,
  toast,
}: Props) {
  const [editorId, setEditorId] = useState<string | null>(null)
  const [editorDirty, setEditorDirty] = useState(false)

  const editorSheet = useMemo(
    () => (editorId ? sheets.find((s) => s.id === editorId) ?? null : null),
    [editorId, sheets],
  )

  const editorEntry = useMemo(
    () => (editorSheet ? lexiconSheetToEntry(editorSheet) : null),
    [editorSheet],
  )

  const persistSheets = useCallback(
    async (next: LexiconWhiteboxSheet[]) => {
      if (!projectName) throw new Error('先选择项目')
      onSheetsChange(next)
      await patchProject(projectName, { lexiconWhitebox: next })
    },
    [onSheetsChange, projectName],
  )

  const openEditor = (id: string) => {
    if (editorDirty && editorId && editorId !== id) {
      if (!window.confirm('白模工作台有未保存修改，切换会关闭当前编辑。继续？')) return
    }
    setEditorId(id)
    setEditorDirty(false)
    onEditorDirtyChange?.(false)
  }

  const closeEditor = () => {
    setEditorId(null)
    setEditorDirty(false)
    onEditorDirtyChange?.(false)
  }

  const addSheet = async () => {
    if (!projectName) {
      toast('请先选择项目')
      return
    }
    const sheet = newLexiconWhiteboxSheet()
    const next = [...sheets, sheet]
    try {
      await persistSheets(next)
      openEditor(sheet.id)
    } catch (e) {
      toast((e as Error).message || '创建失败')
    }
  }

  const removeSheet = async (id: string) => {
    if (!window.confirm('删除这条自定义白模？代码与视频引用会从项目中移除。')) return
    const next = sheets.filter((s) => s.id !== id)
    try {
      await persistSheets(next)
      if (editorId === id) closeEditor()
      toast('已删除')
    } catch (e) {
      toast((e as Error).message || '删除失败')
    }
  }

  const saveEditor = async (input: CodeEditorSave) => {
    if (!editorSheet) return
    const next = applyLexiconSave(sheets, editorSheet.id, input)
    await persistSheets(next)
  }

  const renderEditor = async (input: CodeEditorRendered) => {
    if (!editorSheet) return
    const next = applyLexiconRender(sheets, editorSheet.id, input)
    await persistSheets(next)
    await getProject(projectName).catch(() => {})
  }

  const handleDirty = (dirty: boolean) => {
    setEditorDirty(dirty)
    onEditorDirtyChange?.(dirty)
  }

  return (
    <section className="lex-custom-wb" aria-label="自定义镜头语言白模">
      <header className="lex-custom-head">
        <div>
          <h3>自定义白模</h3>
          <p>
            用 Blender 代码生成运镜白膜 MP4，发布为素材卡后可在分镜里当{' '}
            <code>reference_video</code>；与预置 132 段库并列，可自由命名与迭代。
          </p>
        </div>
        <div className="lex-custom-head-actions">
          <StageModelSelect
            stage="sceneCode"
            label="白模 3D 代码模型"
            settings={settings}
            pick={stagePick}
            onChange={onPickStage}
            compact
          />
          <button type="button" className="btn primary" disabled={!projectName} onClick={() => void addSheet()}>
            + 新建白模
          </button>
        </div>
      </header>

      {!projectName ? (
        <div className="lex-empty">
          <p>请先在顶栏选择项目</p>
        </div>
      ) : sheets.length === 0 ? (
        <div className="lex-empty">
          <p>还没有自定义白模</p>
          <button type="button" className="btn" onClick={() => void addSheet()}>
            创建第一条
          </button>
        </div>
      ) : (
        <div className="lex-custom-grid" role="list">
          {sheets.map((s) => (
            <article key={s.id} className="lex-custom-card" role="listitem">
              <div className="lex-custom-thumb">
                {s.video ? (
                  <video src={s.video} muted playsInline preload="metadata" />
                ) : (
                  <span className="lex-custom-thumb-placeholder">待渲染</span>
                )}
              </div>
              <h4 className="lex-custom-title">{s.title}</h4>
              <p className="lex-custom-meta mono">
                代码 {codeLabel(s)}
                {s.video ? ' · 已有 MP4' : ''}
              </p>
              <p className="lex-custom-motion">
                {(s.motionNote || s.sceneCode?.motionNote || '—').slice(0, 120)}
              </p>
              <div className="lex-custom-actions">
                <button type="button" className="btn primary" onClick={() => openEditor(s.id)}>
                  编辑 / 渲染
                </button>
                {s.video && onPublishAsset && (
                  <button
                    type="button"
                    className="btn-ghost"
                    onClick={() => {
                      onPublishAsset({
                        title: s.title,
                        kind: 'video',
                        url: s.video!,
                      })
                      toast('已发布运镜参照素材卡')
                    }}
                  >
                    发布素材卡
                  </button>
                )}
                <button type="button" className="btn-mini ghost" onClick={() => void removeSheet(s.id)}>
                  删除
                </button>
              </div>
            </article>
          ))}
        </div>
      )}

      {editorEntry && (
        <Suspense fallback={<div className="sb-chat-placeholder">正在加载白模工作台…</div>}>
          <LazySceneCodeWorkbench
            projectName={projectName}
            entry={editorEntry}
            projectAspect={projectAspect}
            settings={settings}
            stagePick={stagePick}
            onPickStageModel={onPickStage}
            onClose={closeEditor}
            onSave={saveEditor}
            onRendered={renderEditor}
            onDirtyChange={handleDirty}
            toast={toast}
          />
        </Suspense>
      )}
    </section>
  )
}
