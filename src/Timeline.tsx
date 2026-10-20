import type { ShotNodeType } from './data'

const PX_PER_SEC = 40

export default function Timeline({
  nodes,
  activeId,
  onPick,
}: {
  nodes: ShotNodeType[]
  activeId: string | null
  onPick: (id: string) => void
}) {
  const total = nodes.reduce((s, n) => s + n.data.seconds, 0)
  let acc = 0

  return (
    <div className="timeline">
      <div className="tl-head">
        <span className="tl-title">时间轴</span>
        <span className="tl-total">
          总时长 <b>{total.toFixed(1)}s</b>
          <span className="tl-count"> · {nodes.length} 镜</span>
        </span>
      </div>

      <div className="tl-track" style={{ width: total * PX_PER_SEC }}>
        {nodes.map((n) => {
          const left = acc * PX_PER_SEC
          acc += n.data.seconds
          const w = Math.max(26, n.data.seconds * PX_PER_SEC)
          return (
            <button
              key={n.id}
              className={`tl-seg ${activeId === n.id ? 'on' : ''}`}
              style={{ left, width: w }}
              onClick={() => onPick(n.id)}
              title={`${n.data.no} · ${n.data.seconds.toFixed(1)}s · ${n.data.size} ${n.data.move}`}
            >
              <span className="tl-no">{n.data.no}</span>
              <span className="tl-sec">{n.data.seconds.toFixed(1)}</span>
            </button>
          )
        })}
      </div>

      <div className="tl-axis">
        <span>0s</span>
        <span>{(total / 2).toFixed(1)}s</span>
        <span>{total.toFixed(1)}s</span>
      </div>
    </div>
  )
}
