import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import type { ProjectEpisode } from '../api'
import { formatEpisodeLabel } from '../shotRows'
import { MarkdownBody } from '../chat-ui/ChatText'
import ZoomLayer from '../chat-ui/ZoomLayer'
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

/**
 * 正文图片可点击放大。
 *
 * 复制 `src` 而不是直接放大原元素：原元素在书页里受 `max-width: 100%` 约束，
 * 直接改样式会撑破版心，而版心宽度是书页的核心约束。
 */
const ZoomImage: NonNullable<Components['img']> = ({ node: _node, src, alt, ...rest }) => {
  const [zoom, setZoom] = useState(false)
  if (!src) return null
  return (
    <>
      <img
        {...rest}
        src={src}
        alt={alt || ''}
        loading="lazy"
        onClick={() => setZoom(true)}
        onKeyDown={(e) => {
          if (e.key === 'Enter' || e.key === ' ') setZoom(true)
        }}
        tabIndex={0}
        role="button"
        aria-label={alt ? `放大图片：${alt}` : '放大图片'}
      />
      {zoom ? (
        <ZoomLayer label={alt || '图片大图'} onClose={() => setZoom(false)}>
          <img className="reader-md-zoom-img" src={src} alt={alt || ''} />
        </ZoomLayer>
      ) : null}
    </>
  )
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

  /**
   * 给场次标题赋锚点。
   *
   * 优先用场次号匹配标题文本（`## EP001-SC003 内 · 地点 · 时间` 这类格式里含场次标签），
   * 匹配不到再按顺序索引兜底。
   *
   * 为什么不能只按顺序：`buildScriptEpisodeMarkdown` 的 h2 与 `episode.scenes`
   * 一一对应，但用户可能在 beats 里写自己的 `## 小标题`，一旦多出 h2，
   * 顺序索引就会把后面的场次全部错位一位。
   */
  useEffect(() => {
    const body = bodyRef.current
    if (!body) return
    const headings = [...body.querySelectorAll('h2')]
    // 先按标题里出现的场次标签匹配；标签形态来自 sceneTag / slug
    const claimed = new Set<number>()
    for (const sc of scenes) {
      const tag = String(sc.no).padStart(3, '0')
      const hit = headings.findIndex((h, i) => {
        if (claimed.has(i)) return false
        const text = h.textContent || ''
        // 匹配 SC003 / SC003 结尾 / 场次号出现在开头段
        return new RegExp(`SC0*${sc.no}\\b`).test(text) || new RegExp(`^\\s*${sc.no}\\s*[.、]`).test(text)
      })
      const idx = hit >= 0 ? hit : -1
      if (idx >= 0) {
        claimed.add(idx)
        headings[idx].id = `script-scene-${tag}`
        headings[idx].dataset.readerScene = String(sc.no)
      }
    }
    // 未匹配到的场次按顺序补（保留旧行为的兜底）
    let cursor = 0
    for (const sc of scenes) {
      const already = headings.findIndex((h) => h.dataset.readerScene === String(sc.no))
      if (already >= 0) continue
      while (cursor < headings.length && claimed.has(cursor)) cursor += 1
      if (cursor >= headings.length) break
      const tag = String(sc.no).padStart(3, '0')
      headings[cursor].id = `script-scene-${tag}`
      headings[cursor].dataset.readerScene = String(sc.no)
      claimed.add(cursor)
      cursor += 1
    }
    // 不属于任何场次的 h2（用户自定义小标题）不赋值，目录也不会指向它
  }, [markdown, prefs.size, prefs.leading, scenes])

  const scrollToScene = useCallback((sceneNo: number) => {
    const body = bodyRef.current
    if (!body) return
    const tagged = body.querySelector<HTMLElement>(`h2[data-reader-scene="${sceneNo}"]`)
    if (tagged) {
      tagged.scrollIntoView({ block: 'start', behavior: 'smooth' })
      setTocOpen(false)
      return
    }
    // 兜底：结构里有场次但正文没渲染出对应标题（例如 beats 为空）
    const headings = body.querySelectorAll('h2')
    const idx = scenes.findIndex((s) => s.no === sceneNo)
    headings[idx < 0 ? 0 : idx]?.scrollIntoView({ block: 'start', behavior: 'smooth' })
    setTocOpen(false)
  }, [scenes])

  // 滚动高亮 + 阅读百分比：判定带取视口上 1/3
  useEffect(() => {
    const page = pageRef.current
    const body = bodyRef.current
    if (!page || !body) return
    let raf = 0
    const measure = () => {
      const headings = [...body.querySelectorAll('h2[data-reader-scene]')]
      const band = page.getBoundingClientRect().top + page.clientHeight / 3
      let sceneNo = scenes[0]?.no ?? 1
      for (const h of headings) {
        if (h.getBoundingClientRect().top <= band) {
          sceneNo = Number((h as HTMLElement).dataset.readerScene) || sceneNo
        }
      }
      // 触底时直接认定最后一场：最后一段的标题可能永远进不了判定带
      // （内容短、或它就在页尾），否则「读到最后一场」永远不会被点亮。
      const atBottom = page.scrollTop + page.clientHeight >= page.scrollHeight - 4
      if (atBottom) {
        const last = headings[headings.length - 1] as HTMLElement | undefined
        const lastNo = Number(last?.dataset.readerScene)
        if (Number.isFinite(lastNo) && lastNo > 0) sceneNo = lastNo
      }
      setCurrent(sceneNo)
      const total = page.scrollHeight - page.clientHeight
      const p = total > 0 ? Math.min(100, Math.max(0, Math.round((page.scrollTop / total) * 100))) : 100
      setPercent(p)
      onProgressChange?.(sceneNo, p)
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
      data-reader-theme={prefs.theme}
      style={vars}
    >
      {/* 窄屏目录入口：单独一个按钮，不能放进目录面板里——
          面板在被隐藏时，里面的按钮也一起消失，用户就没有打开的路径了。 */}
      <button
        type="button"
        className="script-reader-toc-open"
        data-reader-toc-open
        aria-expanded={tocOpen}
        onClick={() => setTocOpen((v) => !v)}
      >
        场次目录 · {scenes.length} 场
      </button>
      <nav className={`script-reader-toc${tocOpen ? ' is-open' : ''}`} aria-label="场次目录">
        <div className="script-reader-toc-body">
          <div className="script-reader-toc-headline">
            <p className="script-reader-toc-head">场次目录</p>
            <button
              type="button"
              className="reader-type-btn"
              aria-label="关闭场次目录"
              onClick={() => setTocOpen(false)}
            >
              关闭
            </button>
          </div>
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
        {/* 书脊：一条窄竖条表达「这是一本合着的书翻开了」，纯装饰 */}
        <div className="script-reader-spine" aria-hidden>
          <span className="script-reader-spine-no">{formatEpisodeLabel(epNo)}</span>
        </div>
        <div className="script-reader-page" ref={pageRef} data-script-reader-page>
          {/* 书签：当前场次号，点击收起/展开目录。不遮挡正文——绝对定位在页外右沿 */}
          <button
            type="button"
            className="script-reader-bookmark"
            data-reader-bookmark
            aria-label={tocOpen ? '收起场次目录' : '展开场次目录'}
            aria-expanded={tocOpen}
            onClick={() => setTocOpen((v) => !v)}
            title="场次目录（书签）"
          >
            <span className="script-reader-bookmark-no">{String(current).padStart(2, '0')}</span>
          </button>
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
              <MarkdownBody text={markdown} components={{ p: PlainParagraph, img: ZoomImage }} />
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
