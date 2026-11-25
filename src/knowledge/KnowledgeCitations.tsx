import type { KnowledgeSource } from '../api'

type Props = {
  sources: KnowledgeSource[]
  /** 上游本轮没有返回任何来源：必须明说，不把模型自由回答当知识库结论 */
  empty?: boolean
}

/**
 * 引用卡：回答下方可展开的命中片段。
 *
 * 为什么要显式的空态：上游在库为空或没命中任何内容时，仍然会返回一段
 * 模型自由生成的回答（`sources: []`）。把它直接展示成「知识库的答案」是
 * 误导 —— 这里是唯一能区分「有依据」和「没依据」的地方。
 */
export function KnowledgeCitations({ sources, empty }: Props) {
  if (!sources.length) {
    if (!empty) return null
    return (
      <div className="kb-no-hit" data-knowledge-no-hit>
        本轮没有命中库内容 —— 上面的回答来自模型自身知识，不是这份知识库的结论。
      </div>
    )
  }
  return (
    /*
     * 默认收起，不按段数展开。
     *
     * 曾经的规则是「2 段以内自动展开」，但真实上游的命中片段动辄几百字
     * （还带 <document_metadata> 头），两条就占满整个消息区，把回答本身挤出
     * 视野 —— 实测截图里根本看不见答案。引用是「需要时才看」的佐证，
     * 摘要行已经给出段数，展开交给用户。
     */
    <details className="kb-cites" data-knowledge-cites>
      <summary>
        引用 {sources.length} 段
      </summary>
      <ul>
        {sources.map((s, i) => (
          <li key={`${s.title}-${i}`}>
            <div className="kb-cite-head">
              <span className="kb-cite-title">{s.title || '（无标题片段）'}</span>
              {s.score > 0 ? (
                <span className="kb-cite-score" title="相似度分数">
                  {s.score.toFixed(2)}
                </span>
              ) : null}
            </div>
            {s.text ? <p className="kb-cite-text">{s.text}</p> : null}
          </li>
        ))}
      </ul>
    </details>
  )
}
