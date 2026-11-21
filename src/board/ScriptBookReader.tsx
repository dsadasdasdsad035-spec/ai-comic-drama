import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import type { ProjectEpisode } from '../api'
import { formatEpisodeLabel } from '../shotRows'
import { MarkdownBody } from '../chat-ui/ChatText'
import type { Components } from 'react-markdown'
import ReaderTypeMenu from './ReaderTypeMenu'
import {
  readReaderPrefs,
  readerCssVars,
  writeReaderPrefs,
  type ReaderPrefs,
} from './readerPrefs'

/** 从 React 子树里拼出纯文本，用于判断段落是否含超长拉丁串 */
function textOf(node: ReactNode): string {
  if (node == null || node === false) return ''
  if (typeof node === 'string' || typeof node === 'number') return String(node)
  if (Array.isArray(node)) return node.map(textOf).join('')
  if (typeof node === 'object' && 'props' in (node as never)) {
    return textOf((node as { props?: { children?: ReactNode } }).props?.children)
  }
  return ''
}

/**
 * 含 24 个以上连续拉丁字母/数字的段落不打散对齐。
 * 两端对齐遇到无法断行的长串时会把其余字距拉得很开，
 * 这种段落改用左对齐，中文段落不受影响。
 */
const PlainParagraph: NonNullable<Components['p']> = ({ node: _node, children, ...rest }) => {
  const longToken = /[A-Za-z0-9]{24,}/.test(textOf(children))
  return (
    <p className={longToken ? 'reader-md-plain' : undefined} {...rest}>
      {children}
    </p>
  )
}

export type ReaderScene = {
  no: number
  place: string
  time: string
  space: string
}

type Props = {
  epNo: number
  title: string
  scenes: ReaderScene[]
  /** short-drama 剧本 Markdown（buildScriptEpisodeMarkdown 输出） */
  markdown: string
  /** 预览根节点的验收标记：剧本 tab 为 script，分镜 tab 为 shots */
  previewAttr?: 'script' | 'shots'
  onProgressChange?: (sceneNo: number, percent: number) => void
}

/** 从 episodes 结构取目录所需的场次摘要；与 Markdown 的 h2 顺序一致 */
export function readerScenesOf(episode: ProjectEpisode | null): ReaderScene[] {
  return (episode?.scenes ?? [])
    .slice()
    .sort((a, b) => (Number(a.no) || 0) - (Number(b.no) || 0))
    .map((sc, i) => ({
      no: Number(sc.no) || i + 1,
      place: String(sc.place ?? '').trim() || '未命名地点',
      time: String(sc.time ?? '').trim() || '未注明时间',
      space: String(sc.space ?? '').trim() || '内',
    }))
}

/**
 * 剧本阅读框：目录栏 + 居中书页。
 *
 * 锚点不依赖 slug 插件——渲染后按 DOM 顺序给 `.reader-md h2` 赋 id，
 * 目录项来自 `episode.scenes`，因此目录数与场次数天然一致。
 */
export default function ScriptBookReader({
  epNo,
  title,
  scenes,
  markdown,
  previewAttr = 'script',
  onProgressChange,
}: Props) {
  const pageRef = useRef<HTMLDivElement>(null)
  const bodyRef = useRef<HTMLDivElement>(null)
  const [prefs, setPrefs] = useState<ReaderPrefs>(() => readReaderPrefs())
  const [current, setCurrent] = useState(1)
  const [percent, setPercent] = useState(0)
  const [tocOpen, setTocOpen] = useState(false)

  const vars = useMemo(() => readerCssVars(prefs), [prefs])

  const updatePrefs = useCallback((next: ReaderPrefs) => {
    setPrefs(next)
    writeReaderPrefs(next)
  }, [])

  // 渲染后按顺序给场次标题赋 id，供目录跳转
  useEffect(() => {
    const body = bodyRef.current
    if (!body) return
    const headings = body.querySelectorAll('h2')
    headings.forEach((h, i) => {
      h.id = `script-scene-${i + 1}`
    })
  }, [markdown, prefs.size, prefs.leading])

  const scrollToScene = useCallback((sceneNo: number) => {
    const body = bodyRef.current
    if (!body) return
    const idx = scenes.findIndex((s) => s.no === sceneNo)
    const target = body.querySelectorAll('h2')[idx < 0 ? 0 : idx]
    target?.scrollIntoView({ block: 'start', behavior: 'smooth' })
    setTocOpen(false)
  }, [scenes])

  // 滚动高亮 + 阅读百分比：判定带取视口上 1/3
  useEffect(() => {
    const page = pageRef.current
    const body = bodyRef.current
    if (!page || !body) return
    let raf = 0
    const measure = () => {
      const headings = [...body.querySelectorAll('h2')]
      const band = page.getBoundingClientRect().top + page.clientHeight / 3
      let idx = 0
      headings.forEach((h, i) => {
        if (h.getBoundingClientRect().top <= band) idx = i
      })
      const nextSceneNo = scenes[idx]?.no ?? scenes[0]?.no ?? 1
      setCurrent(nextSceneNo)
      const total = page.scrollHeight - page.clientHeight
      const p = total > 0 ? Math.min(100, Math.max(0, Math.round((page.scrollTop / total) * 100))) : 100
      setPercent(p)
      onProgressChange?.(nextSceneNo, p)
    }
    const onScroll = () => {
      cancelAnimationFrame(raf)
      raf = requestAnimationFrame(measure)
    }
    page.addEventListener('scroll', onScroll, { passive: true })
    measure()
    return () => {
      page.removeEventListener('scroll', onScroll)
      cancelAnimationFrame(raf)
    }
  }, [scenes, markdown, onProgressChange])

  return (
    <div
      className="script-reader"
      data-script-reader
      data-reader-family={prefs.family}
      data-reader-align={prefs.align}
      data-reader-indent={prefs.indent ? 'on' : 'off'}
      style={vars}
    >
      <nav className={`script-reader-toc${tocOpen ? ' is-open' : ''}`} aria-label="场次目录">
        <button
          type="button"
          className="script-reader-toc-toggle"
          data-reader-toc-toggle
          aria-expanded={tocOpen}
          onClick={() => setTocOpen((v) => !v)}
        >
          场次目录 · {scenes.length} 场
        </button>
        <div className="script-reader-toc-body">
          <p className="script-reader-toc-head">场次目录</p>
          {scenes.length === 0 ? (
            <p className="script-reader-toc-empty">本集尚未填写场次</p>
          ) : (
            <ol className="script-reader-toc-list">
              {scenes.map((sc) => (
                <li key={sc.no}>
                  <button
                    type="button"
                    className={`script-reader-toc-item${current === sc.no ? ' is-current' : ''}`}
                    data-reader-toc-item={sc.no}
                    aria-current={current === sc.no ? 'true' : undefined}
                    onClick={() => scrollToScene(sc.no)}
                  >
                    <span className="script-reader-toc-no">{String(sc.no).padStart(2, '0')}</span>
                    <span className="script-reader-toc-place">
                      {sc.space} · {sc.place}
                    </span>
                    <span className="script-reader-toc-time">{sc.time}</span>
                  </button>
                </li>
              ))}
            </ol>
          )}
          <div className="script-reader-facts">
            <p>
              本集资料
              <span>{scenes.length} 场</span>
            </p>
            <p>
              阅读偏好
              <span>
                {prefs.family === 'serif' ? '宋体' : '黑体'} · {prefs.size}/{prefs.leading.toFixed(1)}
              </span>
            </p>
          </div>
        </div>
      </nav>

      <div className="script-reader-pagewrap">
        <div className="script-reader-page" ref={pageRef} data-script-reader-page>
          <header className="script-reader-running">
            <span className="script-reader-running-no">
              {formatEpisodeLabel(epNo)} · 第 {epNo} 集
            </span>
            <span className="script-reader-running-title">{title || '未命名'}</span>
          </header>

          <div className="script-reader-body" ref={bodyRef}>
            {/* 题记不在这里渲染：hook 已由 buildScriptEpisodeMarkdown 写成引用块，
                再单独渲染一次会重复。 */}
            <div className="reader-md" data-script-md-preview={previewAttr} data-reader-md>
              <MarkdownBody text={markdown} components={{ p: PlainParagraph }} />
            </div>
          </div>
          <footer className="script-reader-running-foot">
            <span data-reader-progress>
              第 {current} / {scenes.length || 1} 场
            </span>
            <span data-reader-percent>{percent}%</span>
          </footer>
        </div>
      </div>

      <div className="script-reader-tools">
        <ReaderTypeMenu prefs={prefs} onChange={updatePrefs} />
      </div>
    </div>
  )
}
