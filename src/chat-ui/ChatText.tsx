import { isValidElement, type ReactNode } from 'react'
import Markdown, { type Components } from 'react-markdown'
import remarkBreaks from 'remark-breaks'
import remarkGfm from 'remark-gfm'
import { ChatCodeBlock } from '@/chat-ui/ChatCodeBlock'

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

/** 围栏代码整体交给既有折叠块，块级与行内的判定不依赖 code 组件的 inline 参数。 */
const Pre: NonNullable<Components['pre']> = ({ node: _node, children }) => {
  const fence = readFence(children)
  if (!fence) return <pre>{children}</pre>
  return <ChatCodeBlock code={fence.code} language={fence.language} />
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
      <Markdown
        remarkPlugins={[remarkGfm, remarkBreaks]}
        components={{ pre: Pre, code: Code, a: Anchor, table: Table }}
      >
        {text}
      </Markdown>
    </div>
  )
}
