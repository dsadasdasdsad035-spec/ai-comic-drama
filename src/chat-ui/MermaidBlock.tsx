/**
 * Markdown 里的流程图围栏渲染。
 *
 * 三个必须同时成立的条件，缺一个就有实际问题：
 *
 * 1. **白名单**。mermaid 支持二十多种图，不认识的类型交给它只会得到内部报错
 *    （对用户无意义）。白名单外提前拦下，降级成代码块 + 一句人话，内容不丢。
 *
 * 2. **`securityLevel: 'strict'` + `htmlLabels: false`**。只设前者不够：
 *    mermaid 默认 `htmlLabels: true` 会把节点标签当 HTML 渲染，而剧本内容来自
 *    用户导入或 Agent 生成，一段 `<img onerror=…>` 就足以执行。
 *
 * 3. **懒加载**。mermaid 压缩后约 2.9MB / gzip 约 900KB。`import()` 让 Vite 切成
 *    独立 chunk，只在首次遇到围栏时拉取，不让每个打开剧本的人都下载。
 *
 * 主题：mermaid 不读 CSS 变量，必须显式传 `themeVariables`。映射来自
 * `readerPrefs.ts` 的 `READER_THEME_SPECS`（与纸张主题同源），否则会出现
 * 「羊皮纸上画着深色流程图」。
 */
import { useEffect, useRef, useState } from 'react'
import { themeSpec, type ReaderTheme } from '../board/readerPrefs'

/** 允许渲染的图类型（mermaid 语法首词） */
const ALLOWED = new Set([
  'flowchart',
  'graph',
  'sequencediagram',
  'statediagram',
  'statediagram-v2',
  'classdiagram',
  'erdiagram',
  'gantt',
  'pie',
])

/** 从围栏正文取首个非空行的类型词；取不到就是空串 */
function diagramKind(code: string): string {
  for (const raw of String(code || '').split('\n')) {
    const line = raw.trim()
    if (!line || line.startsWith('%%') || line.startsWith('---')) continue
    // `graph TD` / `sequenceDiagram` / `stateDiagram-v2` 都是取首词
    return line.split(/[\s;]/)[0].toLowerCase()
  }
  return ''
}

export function isSupportedDiagram(code: string): boolean {
  return ALLOWED.has(diagramKind(code))
}

export function diagramKindOf(code: string): string {
  return diagramKind(code)
}

type MermaidApi = {
  initialize: (config: Record<string, unknown>) => void
  render: (id: string, code: string) => Promise<{ svg: string }>
}

let loader: Promise<MermaidApi> | null = null
/** 惰性单例：并发渲染共用一次 import */
function loadMermaid(): Promise<MermaidApi> {
  if (!loader) {
    loader = import('mermaid').then((mod) => (mod.default ?? mod) as unknown as MermaidApi)
  }
  return loader
}

let seq = 0
function nextId(): string {
  seq += 1
  return `md-diagram-${seq}`
}

/** 当前纸张主题 → mermaid 初始化配置 */
function configFor(theme: ReaderTheme): Record<string, unknown> {
  const spec = themeSpec(theme)
  return {
    startOnLoad: false,
    // 关脚本执行
    securityLevel: 'strict',
    // 关键：关掉 HTML 标签渲染，节点文本按纯文本处理
    htmlLabels: false,
    theme: 'base',
    fontFamily: "'Songti SC', 'SimSun', 'Noto Serif CJK SC', sans-serif",
    themeVariables: {
      ...spec.diagram,
      // mermaid 的这些键在部分图类型里仍会被读取，补齐以免回落到默认深色
      fontFamily: "'Songti SC', 'SimSun', 'Noto Serif CJK SC', sans-serif",
      fontSize: '13px',
    },
  }
}

/**
 * 渲染结果容器。
 *
 * mermaid 产出的是 SVG 字符串。用 `dangerouslySetInnerHTML` 是唯一路径，
 * 但内容来自 `securityLevel: 'strict'` + `htmlLabels: false` 的输出，
 * 且我们额外做一次「不含 script / 事件属性」的自检——宁可显示降级提示，
 * 也不把未经验证的标记塞进 DOM。
 */
function looksSafe(svg: string): boolean {
  const bad = /<script[\s>]|\son[a-z]+\s*=|javascript:/i
  return !bad.test(svg)
}

export default function MermaidBlock({
  code,
  theme,
  onZoom,
}: {
  code: string
  /** 纸张主题；切换时要重新 initialize，否则图表还是旧配色 */
  theme: ReaderTheme
  /** 点击查看大图 */
  onZoom?: (svg: string) => void
}) {
  const [state, setState] = useState<
    { kind: 'loading' } | { kind: 'ok'; svg: string } | { kind: 'error'; message: string }
  >({ kind: 'loading' })
  const hostRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    let cancelled = false
    // 主题或内容变了都重画：mermaid 的配色在 initialize 时固定下来
    setState({ kind: 'loading' })
    void (async () => {
      try {
        const mermaid = await loadMermaid()
        mermaid.initialize(configFor(theme))
        const { svg } = await mermaid.render(nextId(), String(code || ''))
        if (cancelled) return
        if (!looksSafe(svg)) {
          setState({ kind: 'error', message: '渲染结果未通过安全检查，已降级为代码块' })
          return
        }
        setState({ kind: 'ok', svg })
      } catch (e) {
        if (cancelled) return
        setState({ kind: 'error', message: (e as Error)?.message || String(e) })
      }
    })()
    return () => {
      cancelled = true
    }
  }, [code, theme])

  if (state.kind === 'loading') {
    return (
      <div className="md-diagram" data-md-diagram>
        <div className="md-diagram-skeleton">图表渲染中…</div>
      </div>
    )
  }

  if (state.kind === 'error') {
    return (
      <div className="md-diagram-fallback" data-md-diagram-fallback>
        <pre>
          <code>{code}</code>
        </pre>
        <p className="md-diagram-fallback-note">
          图表无法渲染：{state.message}。内容已按代码块显示。
        </p>
      </div>
    )
  }

  return (
    <div
      className="md-diagram"
      data-md-diagram
      ref={hostRef}
      onClick={() => onZoom?.(state.svg)}
      title={onZoom ? '点击查看大图' : undefined}
      // 内容已过 looksSafe 自检 + mermaid strict 配置
      dangerouslySetInnerHTML={{ __html: state.svg }}
    />
  )
}

/** 白名单外类型：按代码块显示并说明，不静默丢弃 */
export function MermaidUnsupported({ code }: { code: string }) {
  const kind = diagramKind(code) || '未知'
  return (
    <div className="md-diagram-fallback" data-md-diagram-unsupported>
      <pre>
        <code>{code}</code>
      </pre>
      <p className="md-diagram-fallback-note">
        该图表类型当前不支持渲染：「{kind}」。内容已按代码块显示。
      </p>
    </div>
  )
}
