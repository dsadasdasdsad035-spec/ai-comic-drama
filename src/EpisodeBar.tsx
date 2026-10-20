import { useCallback, useEffect, useState } from 'react'
import { getProject, type ProjectShot } from './api'

type Ep = { no: number; title?: string; hook?: string }

type Props = {
  projectName: string
  epNo: number
  setEpNo: (n: number) => void
  /** 工作台保存后由 App 递增，用来刷新镜数 */
  version: number
}

const pad = (n: number) => String(n).padStart(2, '0')

/**
 * 集选择栏。集号是「镜头表 / 提示词 / 剧本」三个视图共用的维度，
 * 所以放在 App 层，不归某个工作台所有。
 */
export default function EpisodeBar({ projectName, epNo, setEpNo, version }: Props) {
  const [eps, setEps] = useState<Ep[]>([])
  const [counts, setCounts] = useState<Record<number, number>>({})

  const load = useCallback(async () => {
    if (!projectName) return
    try {
      const p = await getProject(projectName)
      const declared = (p.episodes ?? []) as Ep[]
      const shots = (p.shots ?? []) as ProjectShot[]
      const c: Record<number, number> = {}
      for (const s of shots) {
        const n = Number(s.episode) || 1
        c[n] = (c[n] ?? 0) + 1
      }
      // episodes 表和 shots 里出现过的集号取并集，避免「有镜头但没写 episodes」的集消失
      const nos = [...new Set([...declared.map((e) => Number(e.no)), ...Object.keys(c).map(Number)])]
        .filter((n) => Number.isFinite(n) && n > 0)
        .sort((a, b) => a - b)
      setEps(nos.map((n) => ({ no: n, ...(declared.find((e) => Number(e.no) === n) ?? {}) })))
      setCounts(c)
    } catch {
      setEps([])
    }
  }, [projectName])

  useEffect(() => {
    load()
  }, [load, version])

  if (!projectName || eps.length === 0) return null

  return (
    <div className="epbar">
      <span className="epbar-label">集</span>
      {eps.map((e) => (
        <button
          key={e.no}
          className={`epbar-tab ${e.no === epNo ? 'on' : ''}`}
          onClick={() => setEpNo(e.no)}
          title={e.hook || e.title || `第 ${e.no} 集`}
        >
          <b>E{pad(e.no)}</b>
          {e.title && <span className="epbar-title">{e.title}</span>}
          <span className="epbar-count">{counts[e.no] ?? 0} 镜</span>
        </button>
      ))}
    </div>
  )
}
