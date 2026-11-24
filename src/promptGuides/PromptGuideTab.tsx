import { useCallback, useEffect, useMemo, useState } from 'react'
import { FACET_AXES, facetValueLabel, parseFacetKey } from '../promptCases/taxonomy'
import {
  groupGuidesByAxis,
  guideKindOf,
  loadPromptGuides,
  type PromptGuide,
  type PromptGuideDoc,
} from './api'

const KIND_LABEL: Record<ReturnType<typeof guideKindOf>, string> = {
  recipe: '配方',
  variant: '变体',
  contrast: '对照',
}

/**
 * 写作指南 Tab。
 *
 * 与「提示词案例」的区别：案例是**具体成品**（一条视频 + 一段提示词），
 * 指南是**方法论**（为什么这样写、错在哪）。所以两边不共用一个列表：
 * 案例按时间/来源浏览，指南按 18 轴浏览。
 *
 * 布局沿用案例库的两栏骨架（左侧轴列表 + 右侧正文），但不复用 `pc-*` 类——
 * 案例库那套带抽屉与分面编辑，语义不同，混用会让两边的样式互相牵制。
 */
export default function PromptGuideTab({ onCountChange }: { onCountChange?: (n: number) => void }) {
  const [doc, setDoc] = useState<PromptGuideDoc | null>(null)
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(true)
  const [axisId, setAxisId] = useState('')
  const [selectedId, setSelectedId] = useState('')

  useEffect(() => {
    let alive = true
    setLoading(true)
    loadPromptGuides()
      .then((d) => {
        if (!alive) return
        setDoc(d)
        setError('')
        onCountChange?.(d.guides.length)
      })
      .catch((e) => {
        if (!alive) return
        setError((e as Error)?.message || String(e))
      })
      .finally(() => {
        if (alive) setLoading(false)
      })
    return () => {
      alive = false
    }
    // onCountChange 是父组件 setState，稳定
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const byAxis = useMemo<Map<string, PromptGuide[]>>(
    () => (doc ? groupGuidesByAxis(doc.guides) : new Map<string, PromptGuide[]>()),
    [doc],
  )

  /** 只显示有指南的轴；轴序跟词表 */
  const axisRows = useMemo(
    () =>
      FACET_AXES.map((a) => ({ axis: a, list: byAxis.get(a.id) || [] })).filter((row) => row.list.length > 0),
    [byAxis],
  )

  const selected = useMemo(() => {
    if (!doc) return null
    if (selectedId) return doc.guides.find((g) => g.id === selectedId) || null
    // 未选中时默认展示第一轴的第一篇，避免右侧空白
    return axisRows[0]?.list[0] || null
  }, [doc, selectedId, axisRows])

  const activeAxis = useMemo(() => {
    if (axisId) return axisId
    if (!selected) return ''
    const first = selected.facets[0]
    return first ? parseFacetKey(first).axis : ''
  }, [axisId, selected])

  const axisGuides = useMemo(
    () => (activeAxis ? byAxis.get(activeAxis) || [] : []),
    [byAxis, activeAxis],
  )

  const sourceOf = useCallback(
    (id: string) => doc?.sources.find((s) => s.id === id) || null,
    [doc],
  )

  if (loading) {
    return (
      <div className="guide-tab" data-prompt-guide-tab-panel>
        <div className="guide-loading" aria-busy="true" aria-live="polite">
          <span className="guide-spinner" aria-hidden />
          正在读取写作指南…
        </div>
      </div>
    )
  }

  if (error) {
    return (
      <div className="guide-tab" data-prompt-guide-tab-panel>
        <div className="char-empty-board guide-empty" data-prompt-guide-error>
          <p>写作指南读取失败。</p>
          <p className="board-hint">{error}</p>
        </div>
      </div>
    )
  }

  if (!doc || !doc.guides.length) {
    return (
      <div className="guide-tab" data-prompt-guide-tab-panel>
        <div className="char-empty-board guide-empty" data-prompt-guide-empty>
          <p>还没有写作指南。</p>
          <p className="board-hint">
            运行 <code>node scripts/fetch-prompt-guides.mjs</code> 从外部博客生成快照。
          </p>
        </div>
      </div>
    )
  }

  return (
    <div className="guide-tab" data-prompt-guide-tab-panel>
      <div className="guide-banner">
        <p>
          共 <b>{doc.guides.length}</b> 篇 · 挂在 <b>{axisRows.length}</b> 个轴上 ·{' '}
          <span className="guide-license">仅参考</span>
        </p>
        <p className="board-hint">
          内容来自 {doc.sources.map((s) => s.title).join(' / ')}（外部站点），只作写法参考，不得当作本项目产物。
        </p>
      </div>

      <div className="guide-layout">
        <aside className="guide-rail" data-prompt-guide-rail aria-label="按轴浏览">
          <p className="guide-rail-head">按轴浏览</p>
          {axisRows.map(({ axis, list }) => (
            <button
              key={axis.id}
              type="button"
              className={`guide-axis${activeAxis === axis.id ? ' on' : ''}`}
              data-prompt-guide-axis={axis.id}
              aria-pressed={activeAxis === axis.id}
              onClick={() => {
                setAxisId(axis.id)
                setSelectedId(list[0]?.id || '')
              }}
            >
              <span className="guide-axis-cn">{axis.cn}</span>
              <span className="guide-axis-n">{list.length}</span>
            </button>
          ))}
        </aside>

        <div className="guide-main">
          <div className="guide-list" data-prompt-guide-list>
            {axisGuides.map((g) => (
              <button
                key={g.id}
                type="button"
                className={`guide-card${selected?.id === g.id ? ' on' : ''}`}
                data-prompt-guide-card={g.id}
                aria-pressed={selected?.id === g.id}
                onClick={() => setSelectedId(g.id)}
              >
                <span className={`guide-kind k-${guideKindOf(g)}`}>{KIND_LABEL[guideKindOf(g)]}</span>
                <span className="guide-card-title">{g.title}</span>
                <span className="guide-card-facets">
                  {g.facets.slice(0, 3).map((f) => {
                    const { axis, value } = parseFacetKey(f)
                    return (
                      <span key={f} className="guide-tag">
                        {facetValueLabel(axis, value)}
                      </span>
                    )
                  })}
                </span>
              </button>
            ))}
          </div>

          {selected ? (
            <article className="guide-reader" data-prompt-guide-detail={selected.id}>
              <header className="guide-reader-head">
                <h2>{selected.title}</h2>
                <div className="guide-reader-meta">
                  <span className="guide-kind k-${guideKindOf(selected)}">{KIND_LABEL[guideKindOf(selected)]}</span>
                  {sourceOf(selected.sourceId) ? (
                    <a
                      href={sourceOf(selected.sourceId)!.url}
                      target="_blank"
                      rel="noreferrer"
                      className="btn-mini ghost"
                    >
                      原文 ↗
                    </a>
                  ) : null}
                </div>
              </header>

              <div className="guide-reader-body">
                {selected.diagnosis ? <p className="guide-lead">{selected.diagnosis}</p> : null}
                {selected.whatItDoes ? <p className="guide-lead">{selected.whatItDoes}</p> : null}

                {Object.keys(selected.settings).length ? (
                  <section className="guide-sec">
                    <h3>参数组合</h3>
                    <dl className="guide-settings">
                      {Object.entries(selected.settings as Record<string, string>).map(([k, v]) => (
                        <div key={k}>
                          <dt>{k}</dt>
                          <dd>{v}</dd>
                        </div>
                      ))}
                    </dl>
                  </section>
                ) : null}

                {selected.inputs ? (
                  <section className="guide-sec">
                    <h3>需要的输入</h3>
                    <p>{selected.inputs}</p>
                  </section>
                ) : null}

                {selected.rationale ? (
                  <section className="guide-sec">
                    <h3>为什么这样组合</h3>
                    <p>{selected.rationale}</p>
                  </section>
                ) : null}

                {selected.badPrompt ? (
                  <section className="guide-sec">
                    <h3>
                      反面示范 <span className="guide-sec-hint">这类写法会让模型自由发挥</span>
                    </h3>
                    <pre className="guide-pre is-bad">{selected.badPrompt}</pre>
                  </section>
                ) : null}

                {selected.goodPrompt ? (
                  <section className="guide-sec">
                    <h3>推荐的写法</h3>
                    <pre className="guide-pre is-good" data-prompt-guide-prompt>
                      {selected.goodPrompt}
                    </pre>
                  </section>
                ) : selected.prompt ? (
                  <section className="guide-sec">
                    <h3>提示词全文</h3>
                    <pre className="guide-pre" data-prompt-guide-prompt>
                      {selected.prompt}
                    </pre>
                  </section>
                ) : null}

                {selected.segments.length > 1 ? (
                  <section className="guide-sec">
                    <h3>时间轴</h3>
                    <ol className="guide-segments">
                      {selected.segments.map((s, i) => (
                        <li key={`${s.label}-${i}`}>
                          <b>{s.label}</b>
                          <span>{s.body}</span>
                        </li>
                      ))}
                    </ol>
                  </section>
                ) : null}

                {selected.proTip ? (
                  <section className="guide-sec">
                    <h3>作者提示</h3>
                    <p>{selected.proTip}</p>
                  </section>
                ) : null}

                {selected.mistake || selected.fix ? (
                  <section className="guide-sec">
                    <h3>{selected.mistake ? '常见错误' : '怎么改'}</h3>
                    {selected.mistake ? <p>{selected.mistake}</p> : null}
                    {selected.why ? <p className="guide-why">{selected.why}</p> : null}
                    {selected.fix ? <p>{selected.fix}</p> : null}
                  </section>
                ) : null}

                <section className="guide-sec">
                  <h3>关联的分类轴</h3>
                  <div className="guide-card-facets">
                    {selected.facets.map((f) => {
                      const { axis, value } = parseFacetKey(f)
                      return (
                        <span key={f} className="guide-tag">
                          {facetValueLabel(axis, value)}
                        </span>
                      )
                    })}
                  </div>
                </section>
              </div>
            </article>
          ) : null}
        </div>
      </div>
    </div>
  )
}
