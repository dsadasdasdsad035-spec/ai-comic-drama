import { useEffect, useMemo, useRef, useState } from 'react'
import { EditorState } from '@codemirror/state'
import { EditorView, keymap, lineNumbers, highlightActiveLine } from '@codemirror/view'
import { markdown } from '@codemirror/lang-markdown'
import { defaultKeymap, history, historyKeymap } from '@codemirror/commands'
import { ChatText } from '../chat-ui/ChatText'
import { markdownToSafeHtml } from './markedHtml'

export type MarkdownPaneLayout = 'preview' | 'source' | 'split'
export type MarkdownRenderer = 'remark' | 'marked-html'

type Props = {
  value: string
  onChange?: (next: string) => void
  readOnly?: boolean
  layout: MarkdownPaneLayout
  onLayoutChange: (layout: MarkdownPaneLayout) => void
  renderer: MarkdownRenderer
  onRendererChange: (r: MarkdownRenderer) => void
  /** 挂在预览根节点，便于验收 */
  previewDataAttr?: string
  /** 源码区底部提示（如分镜不落库） */
  editorHint?: string
  /** 收起工具条：由外部（阅读框的 ⋯ 菜单）驱动布局与渲染引擎 */
  hideToolbar?: boolean
}

export default function MarkdownDocumentPane({
  value,
  onChange,
  readOnly = false,
  layout,
  onLayoutChange,
  renderer,
  onRendererChange,
  previewDataAttr,
  editorHint,
  hideToolbar = false,
}: Props) {
  const hostRef = useRef<HTMLDivElement>(null)
  const viewRef = useRef<EditorView | null>(null)
  const [draft, setDraft] = useState(value)

  useEffect(() => {
    setDraft(value)
  }, [value])

  useEffect(() => {
    if (layout === 'preview' || !hostRef.current) return
    const state = EditorState.create({
      doc: draft,
      extensions: [
        lineNumbers(),
        highlightActiveLine(),
        history(),
        markdown(),
        EditorView.editable.of(!readOnly),
        EditorView.updateListener.of((u) => {
          if (!u.docChanged) return
          const next = u.state.doc.toString()
          setDraft(next)
          onChange?.(next)
        }),
        keymap.of([...defaultKeymap, ...historyKeymap]),
        EditorView.theme({
          '&': { height: '100%', fontSize: '13px' },
          '.cm-scroller': { fontFamily: 'var(--font-mono, ui-monospace, monospace)', lineHeight: '1.55' },
          '.cm-content': { padding: '12px 0' },
          '&.cm-focused': { outline: 'none' },
        }),
      ],
    })
    const view = new EditorView({ state, parent: hostRef.current })
    viewRef.current = view
    return () => {
      view.destroy()
      viewRef.current = null
    }
    // 仅在布局切入源码/分栏时挂载；不把 draft 列入 deps，避免每次键入重建 Editor
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [layout, readOnly])

  useEffect(() => {
    const view = viewRef.current
    if (!view) return
    const cur = view.state.doc.toString()
    if (cur === draft) return
    view.dispatch({ changes: { from: 0, to: view.state.doc.length, insert: draft } })
  }, [draft])

  const html = useMemo(
    () => (renderer === 'marked-html' ? markdownToSafeHtml(draft) : ''),
    [draft, renderer],
  )

  const showPreview = layout === 'preview' || layout === 'split'
  const showSource = layout === 'source' || layout === 'split'

  return (
    <div className="md-pane" data-md-pane-layout={layout} data-md-pane-renderer={renderer}>
      <div className="md-pane-toolbar" hidden={hideToolbar}>
        <div className="md-pane-seg" role="group" aria-label="布局">
          {(
            [
              ['preview', '预览'],
              ['source', '源码'],
              ['split', '分栏'],
            ] as const
          ).map(([id, label]) => (
            <button
              key={id}
              type="button"
              className={`md-pane-seg-btn${layout === id ? ' on' : ''}`}
              data-md-layout={id}
              onClick={() => onLayoutChange(id)}
            >
              {label}
            </button>
          ))}
        </div>
        <div className="md-pane-seg" role="group" aria-label="渲染引擎">
          <button
            type="button"
            className={`md-pane-seg-btn${renderer === 'remark' ? ' on' : ''}`}
            data-md-renderer="remark"
            onClick={() => onRendererChange('remark')}
            title="react-markdown + remark-gfm（默认，无原始 HTML）"
          >
            Markdown
          </button>
          <button
            type="button"
            className={`md-pane-seg-btn${renderer === 'marked-html' ? ' on' : ''}`}
            data-md-renderer="marked-html"
            onClick={() => onRendererChange('marked-html')}
            title="marked 直出 HTML + DOMPurify 消毒"
          >
            HTML
          </button>
        </div>
      </div>

      <div className={`md-pane-body${layout === 'split' ? ' is-split' : ''}`}>
        {showPreview ? (
          <div
            className={`script-md-preview md-pane-preview${renderer === 'marked-html' ? ' is-html' : ''}`}
            data-script-md-preview={previewDataAttr}
          >
            {renderer === 'remark' ? (
              <ChatText text={draft} />
            ) : (
              <div className="md-pane-html" dangerouslySetInnerHTML={{ __html: html }} />
            )}
          </div>
        ) : null}
        {showSource ? (
          <div className="md-pane-editor-wrap" data-md-source>
            <div ref={hostRef} className="md-pane-editor" />
            {editorHint ? <p className="md-pane-editor-hint">{editorHint}</p> : null}
            {readOnly ? <p className="md-pane-editor-hint">只读源码</p> : null}
          </div>
        ) : null}
      </div>
    </div>
  )
}