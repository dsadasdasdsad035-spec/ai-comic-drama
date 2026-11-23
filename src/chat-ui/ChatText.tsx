import { isValidElement, useEffect, useRef, useState, type ReactNode } from 'react'
import Markdown, { type Components } from 'react-markdown'
import remarkBreaks from 'remark-breaks'
import remarkGfm from 'remark-gfm'
import { ChatCodeBlock } from '@/chat-ui/ChatCodeBlock'
import MermaidBlock, { isSupportedDiagram, MermaidUnsupported } from '@/chat-ui/MermaidBlock'
import ZoomLayer from '@/chat-ui/ZoomLayer'
import type { ReaderTheme } from '../board/readerPrefs'

/** 从 <pre> 的 code 子节点里取出语言与源码文本；取不到就按无语言处理。 */
function readFence(children: ReactNode): { language: string; code: string } | null {
  const child = Array.isArray(children) ? children[0] : children
  if (!isValidElement<{ className?: string; children?: ReactNode }>(child)) return null
  const language = /language-([\w-]+)/.exec(child.props.className || '')?.[1] || ''
  const raw = child.props.children
  const code =
    typeof raw === 'string'
      ? raw
      : Array.isArray(raw)
        ? raw.filter((part): part is string => typeof part === 'string').join('')
        : ''
  // 围栏代码末尾带一个换行，交给 ChatCodeBlock 前去掉，行数统计才准。
  return { language, code: code.replace(/\n$/, '') }
}

/**
 * 围栏代码分派：mermaid 交给图表组件，其余走折叠代码块。
 *
 * 为什么在这里分派而不是在 `code` 组件里：块级与行内的判定不依赖 `inline` 参数，
 * 而 `pre` 是唯一的块级入口。`code` 只处理行内。
 */
const Pre: NonNullable<Components['pre']> = ({ node: _node, children }) => {
  const fence = readFence(children)
  if (!fence) return <pre>{children}</pre>
  if (fence.language === 'mermaid') {
    // 白名单外的类型降级为代码块并说明，不静默吞掉内容
    return isSupportedDiagram(fence.code) ? (
      <MermaidRenderer code={fence.code} />
    ) : (
      <MermaidUnsupported code={fence.code} />
    )
  }
  return <ChatCodeBlock code={fence.code} language={fence.language} />
}

/**
 * 图表需要当前的纸张主题才能选对配色，而主题是**阅读器局部**的状态
 * （`ScriptBookReader` 的 prefs），不在 React context 里。
 *
 * 用 CSS 变量读不到——mermaid 不解析 CSS。所以从最近的
 * `[data-reader-theme]` 祖先上读：阅读器渲染时已把它写在根节点上。
 * 聊天消息里没有这个祖先，回落到书页白（与应用暗色主题配合仍可读，
 * 且聊天里的图表本来就是附带能力）。
 */
function MermaidRenderer({ code }: { code: string }) {
  const hostRef = useRef<HTMLDivElement>(null)
  const [theme, setTheme] = useState<ReaderTheme>('paper')
  const [zoomSvg, setZoomSvg] = useState('')

  useEffect(() => {
    const host = hostRef.current
    const root = host?.closest<HTMLElement>('[data-reader-theme]')
    const value = root?.dataset.readerTheme
    if (value === 'paper' || value === 'parchment' || value === 'ink' || value === 'terminal') {
      setTheme(value)
    }
  }, [])

  return (
    <div ref={hostRef} className="md-diagram-host">
      <MermaidBlock code={code} theme={theme} onZoom={setZoomSvg} />
      {zoomSvg ? (
        <ZoomLayer label="图表大图" onClose={() => setZoomSvg('')}>
          <div className="md-diagram-zoom-body" dangerouslySetInnerHTML={{ __html: zoomSvg }} />
        </ZoomLayer>
      ) : null}
    </div>
  )
}

/** 行内代码：块级代码已经被 Pre 接管，这里只会命中行内。 */
const Code: NonNullable<Components['code']> = ({ node: _node, children, className, ...rest }) => (
  <code className={['chat-md-inline-code', className].filter(Boolean).join(' ')} {...rest}>
    {children}
  </code>
)

/** 外链统一新窗口打开，避免在 Electron 内嵌页面里顶掉当前会话。 */
const Anchor: NonNullable<Components['a']> = ({ node: _node, children, ...rest }) => (
  <a {...rest} target="_blank" rel="noreferrer">
    {children}
  </a>
)

/** 表格外层滚动：窄栏里整体横向滚动，不撑破消息容器。 */
const Table: NonNullable<Components['table']> = ({ node: _node, children, ...rest }) => (
  <div className="chat-md-table-wrap max-w-full overflow-x-auto">
    <table className="chat-md-table min-w-max" {...rest}>
      {children}
    </table>
  </div>
)

/** 会话消息文本统一渲染入口：三处工作台会话共用。 */
export function ChatText({ text }: { text: string }) {
  return (
    <div className="chat-md" data-chat-md>
      <MarkdownBody text={text} />
    </div>
  )
}

/**
 * 纯 Markdown 渲染体：不包作用域类，由调用方决定排版域。
 * 剧本阅读页用 `.reader-md`，聊天消息用 `.chat-md`，两者共用同一套
 * remark 插件与元素覆盖，避免渲染逻辑分叉。
 */
export function MarkdownBody({
  text,
  components,
}: {
  text: string
  components?: Components
}) {
  return (
    <Markdown
      remarkPlugins={[remarkGfm, remarkBreaks]}
      components={{ pre: Pre, code: Code, a: Anchor, table: Table, ...components }}
    >
      {text}
    </Markdown>
  )
}
