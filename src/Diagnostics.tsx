import type { ShotNodeType } from './data'

export type Issue = {
  /** 出问题的节点，点击后定位 */
  nodeId: string
  no: string
  level: 'warn' | 'info'
  rule: string
  msg: string
}

const MIN_SEC = 2
const MAX_SEC = 6
const MAX_LINE = 18

/** 按镜号自然排序，不看数组顺序（文件里的顺序会被写回打乱） */
function sortByNo(nodes: ShotNodeType[]): ShotNodeType[] {
  return [...nodes].sort((a, b) => {
    const na = parseInt(String(a.data.no).replace(/\D/g, ''), 10) || 0
    const nb = parseInt(String(b.data.no).replace(/\D/g, ''), 10) || 0
    return na - nb
  })
}

/**
 * 连续性诊断。
 *
 * 这些规则靠「相邻关系」才看得出，在表格里逐行扫永远发现不了——
 * 这正是画布该干的活。
 */
export function diagnose(nodes: ShotNodeType[]): Issue[] {
  const list = sortByNo(nodes)
  const out: Issue[] = []

  for (const n of list) {
    const d = n.data
    const no = String(d.no)

    if (d.seconds < MIN_SEC) {
      out.push({ nodeId: n.id, no, level: 'warn', rule: '时长过短', msg: `${d.seconds}s，低于 ${MIN_SEC}s 下限` })
    } else if (d.seconds > MAX_SEC) {
      out.push({ nodeId: n.id, no, level: 'warn', rule: '时长过长', msg: `${d.seconds}s，超过 ${MAX_SEC}s 上限` })
    }

    const lines = String(d.dialogue || '')
      .split('\n')
      .map((s) => s.trim())
      .filter(Boolean)
    for (const line of lines) {
      const text = line.includes('：') ? line.split('：').slice(1).join('：') : line
      if (text.length > MAX_LINE) {
        out.push({
          nodeId: n.id,
          no,
          level: 'warn',
          rule: '台词过长',
          msg: `${text.length} 字，配音与字幕会被挤（建议 ≤${MAX_LINE} 字）`,
        })
        break
      }
    }
  }

  // 连续三镜同景别：分镜节奏最容易犯的错，且只有相邻比较才看得出来
  for (let i = 2; i < list.length; i++) {
    const [a, b, c] = [list[i - 2].data.size, list[i - 1].data.size, list[i].data.size]
    if (a && a === b && b === c) {
      out.push({
        nodeId: list[i].id,
        no: String(list[i].data.no),
        level: 'warn',
        rule: '连续同景别',
        msg: `${list[i - 2].data.no}–${list[i].data.no} 连续三镜都是「${a}」，节奏会平`,
      })
    }
  }

  return out
}

/** 诊断面板：列问题，点一条直接定位到那张卡 */
export function DiagnosticsPanel({
  issues,
  onPick,
  onClose,
}: {
  issues: Issue[]
  onPick: (nodeId: string) => void
  onClose: () => void
}) {
  return (
    <div className="diag">
      <div className="diag-head">
        <b>{issues.length ? `${issues.length} 处需要注意` : '没有发现问题'}</b>
        <div className="spacer" />
        <button className="btn-mini" onClick={onClose}>
          收起
        </button>
      </div>
      {issues.length > 0 && (
        <div className="diag-list">
          {issues.map((it, i) => (
            <button key={`${it.nodeId}-${i}`} className="diag-row" onClick={() => onPick(it.nodeId)}>
              <span className={`diag-lv ${it.level}`} />
              <span className="diag-no">{it.no}</span>
              <span className="diag-rule">{it.rule}</span>
              <span className="diag-msg">{it.msg}</span>
            </button>
          ))}
        </div>
      )}
    </div>
  )
}
