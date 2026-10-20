import { useCallback, useEffect, useMemo, useState } from 'react'
import { MOVES, SHOT_SIZES } from './types'
import {
  callText,
  getProject,
  listProjects,
  mergeProjectShots,
  type ProjectShot,
  type ProjectSummary,
} from './api'
import { STORYBOARD_SYS, dialogueToText, parseDialogue } from './prompts'
import { mergeGenerated } from './shotSync'

type Props = {
  projectName: string
  setProjectName: (v: string) => void
  /** 已在画布上的 shotId */
  onCanvas: Set<string>
  onPush: (shots: ProjectShot[]) => void
  toast: (m: string) => void
}

const pad = (n: number) => String(n).padStart(2, '0')

export default function ShotTable({ projectName, setProjectName, onCanvas, onPush, toast }: Props) {
  const [projects, setProjects] = useState<ProjectSummary[]>([])
  const [root, setRoot] = useState('')
  const [shots, setShots] = useState<ProjectShot[]>([])
  const [style, setStyle] = useState('')
  const [aspect, setAspect] = useState('16:9')
  const [epNo, setEpNo] = useState(1)
  const [target, setTarget] = useState(60)
  const [brief, setBrief] = useState('')
  const [loading, setLoading] = useState(false)
  const [saving, setSaving] = useState(false)
  const [genning, setGenning] = useState(false)
  const [dirty, setDirty] = useState(false)

  const load = useCallback(
    async (name: string) => {
      if (!name) return
      setLoading(true)
      try {
        const p = await getProject(name)
        setShots(p.shots ?? [])
        setStyle(p.style ?? '')
        setAspect(p.aspect ?? '16:9')
        const firstEp = (p.episodes ?? [])[0] as any
        if (firstEp?.no) setEpNo(Number(firstEp.no) || 1)
        const epBrief = (p.episodes ?? []).find((e: any) => Number(e?.no) === epNo) as any
        setBrief(epBrief ? describeEpisode(epBrief) : '')
        setDirty(false)
        toast(`已加载 ${name}：${(p.shots ?? []).length} 镜`)
      } catch (e: any) {
        toast(e.message || '加载失败')
      } finally {
        setLoading(false)
      }
    },
    [epNo, toast],
  )

  useEffect(() => {
    listProjects()
      .then(({ root: r, projects: ps }) => {
        setProjects(ps)
        setRoot(r)
        if (!projectName && ps[0]) setProjectName(ps[0].name)
      })
      .catch((e) => toast(e.message || '读不到项目列表'))
    // 只在挂载时拉一次
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  useEffect(() => {
    if (projectName) load(projectName)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [projectName])

  const total = useMemo(
    () => shots.reduce((a, s) => a + (Number(s.seconds) || 0), 0),
    [shots],
  )
  const locked = useMemo(
    () => shots.reduce((a, s) => a + (s.handEdited?.length ?? 0), 0),
    [shots],
  )
  const pushed = useMemo(() => shots.filter((s) => onCanvas.has(s.id)).length, [shots, onCanvas])

  const edit = (idx: number, field: string, value: unknown) => {
    setShots((prev) =>
      prev.map((s, i) => {
        if (i !== idx) return s
        const hand = new Set([...(s.handEdited ?? []), field])
        return { ...s, [field]: value, handEdited: [...hand] }
      }),
    )
    setDirty(true)
  }

  const generate = async () => {
    if (!brief.trim()) {
      toast('先写本集内容或梗概，再来拆镜')
      return
    }
    setGenning(true)
    try {
      const r = await callText<{ shots: any[] }>({
        system: STORYBOARD_SYS,
        prompt:
          `画风：${style || '近未来科幻写实'}\n画幅：${aspect}\n\n` +
          `${brief}\n\n目标总时长 ${target} 秒。相邻镜头景别要有变化。`,
        model: 'pro',
        json: true,
        maxTokens: 8192,
      })
      const got = r.json?.shots
      if (!Array.isArray(got) || got.length === 0) throw new Error('模型没给出镜头列表')
      const next: ProjectShot[] = got.map((s, i) => {
        const no = String(s?.no || `S${pad(i + 1)}`)
        return {
          id: `E${pad(epNo)}-${no}`,
          episode: epNo,
          no,
          seconds: Number(s?.seconds) || 3,
          size: s?.size || '中景',
          move: s?.move || '固定',
          desc: s?.desc || '',
          dialogue: Array.isArray(s?.dialogue) ? s.dialogue : [],
        }
      })
      // 手改过的字段在重新生成时保住，这是 handEdited 唯一生效的地方
      const merged = mergeGenerated(shots, next)
      const kept = merged.filter((s) => (s.handEdited?.length ?? 0) > 0).length
      setShots(merged)
      setDirty(true)
      const sum = merged.reduce((a, s) => a + (Number(s.seconds) || 0), 0)
      toast(
        `拆出 ${merged.length} 镜 / ${sum.toFixed(1)}s` +
          (kept > 0 ? ` · ${kept} 镜的手改字段已保留` : '') +
          '，记得先审阅再保存',
      )
    } catch (e: any) {
      toast(e.message || '拆镜失败')
    } finally {
      setGenning(false)
    }
  }

  const save = async () => {
    if (!projectName) return
    setSaving(true)
    try {
      const r = await mergeProjectShots(projectName, shots)
      // 服务端做了字段级合并，拿回真正落盘的结果
      setShots(r.shots as ProjectShot[])
      setDirty(false)
      toast(`已写回 project.json · ${r.shots.length} 镜`)
    } catch (e: any) {
      toast(e.message || '保存失败')
    } finally {
      setSaving(false)
    }
  }

  return (
    <main className="wb">
      <div className="wb-bar">
        <div className="wb-field">
          <span className="label">项目</span>
          <select value={projectName} onChange={(e) => setProjectName(e.target.value)}>
            {projects.length === 0 && <option value="">（无）</option>}
            {projects.map((p) => (
              <option key={p.name} value={p.name}>
                {p.title} · {p.shots} 镜
              </option>
            ))}
          </select>
        </div>

        <div className="wb-field">
          <span className="label">集</span>
          <input
            type="number"
            min={1}
            value={epNo}
            onChange={(e) => setEpNo(Math.max(1, Number(e.target.value) || 1))}
            style={{ width: 56 }}
          />
        </div>

        <div className="wb-field">
          <span className="label">目标时长</span>
          <input
            type="number"
            min={10}
            step={5}
            value={target}
            onChange={(e) => setTarget(Math.max(10, Number(e.target.value) || 60))}
            style={{ width: 64 }}
          />
          <span className="label">秒</span>
        </div>

        <div className="spacer" />

        <span className="wb-root" title={root}>
          项目根：{root || '…'}
        </span>
        <button className="btn" onClick={() => load(projectName)} disabled={loading}>
          {loading ? '加载中…' : '重新加载'}
        </button>
      </div>

      <div className="wb-gen">
        <textarea
          value={brief}
          onChange={(e) => setBrief(e.target.value)}
          placeholder="本集内容 / 梗概 / 场景 beats —— 拆镜的输入。从项目里加载到 episodes 时会自动带上。"
          rows={3}
        />
        <button className="btn primary wb-genbtn" onClick={generate} disabled={genning || !brief.trim()}>
          {genning ? '拆镜中…' : '拆镜'}
        </button>
      </div>

      {shots.length === 0 ? (
        <div className="wb-empty">
          {loading ? '加载中…' : '这个项目还没有镜头。上面写点内容，点「拆镜」。'}
        </div>
      ) : (
        <div className="wb-scroll">
          <table className="wb-table">
            <thead>
              <tr>
                <th style={{ width: 62 }}>镜号</th>
                <th style={{ width: 60 }}>秒</th>
                <th style={{ width: 84 }}>景别</th>
                <th style={{ width: 84 }}>运镜</th>
                <th>描述</th>
                <th style={{ width: 200 }}>台词</th>
                <th style={{ width: 78 }}>状态</th>
              </tr>
            </thead>
            <tbody>
              {shots.map((s, i) => {
                const isPushed = onCanvas.has(s.id)
                const hand = new Set(s.handEdited ?? [])
                return (
                  <tr key={s.id} className={s.orphan ? 'orphan' : ''}>
                    <td className="mono">
                      <input value={s.no ?? ''} onChange={(e) => edit(i, 'no', e.target.value)} />
                    </td>
                    <td>
                      <input
                        type="number"
                        step={0.5}
                        min={1}
                        max={12}
                        className={hand.has('seconds') ? 'hand' : ''}
                        value={s.seconds ?? 3}
                        onChange={(e) => edit(i, 'seconds', Number(e.target.value) || 0)}
                      />
                    </td>
                    <td>
                      <select value={s.size ?? '中景'} onChange={(e) => edit(i, 'size', e.target.value)}>
                        {SHOT_SIZES.map((v) => (
                          <option key={v}>{v}</option>
                        ))}
                      </select>
                    </td>
                    <td>
                      <select value={s.move ?? '固定'} onChange={(e) => edit(i, 'move', e.target.value)}>
                        {MOVES.map((v) => (
                          <option key={v}>{v}</option>
                        ))}
                      </select>
                    </td>
                    <td>
                      <textarea
                        rows={2}
                        value={s.desc ?? ''}
                        onChange={(e) => edit(i, 'desc', e.target.value)}
                      />
                    </td>
                    <td>
                      <textarea
                        rows={2}
                        value={dialogueToText(s.dialogue)}
                        placeholder="角色：台词（一行一句）"
                        onChange={(e) => edit(i, 'dialogue', parseDialogue(e.target.value))}
                      />
                    </td>
                    <td className="state">
                      {s.orphan && <em className="tag orphan">孤儿</em>}
                      {isPushed ? <em className="tag ok">在画布</em> : <em className="tag off">未上画布</em>}
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      )}

      <div className="wb-foot">
        <span className="wb-sum">
          {shots.length} 镜 · 总时长{' '}
          <b className={total > target ? 'over' : ''}>{total.toFixed(1)}s</b> / 目标 {target}s
          {total > target && <span className="wb-warn">超 {(total - target).toFixed(1)}s</span>}
        </span>
        <span className="wb-sum">
          已在画布 {pushed} / {shots.length}
          {locked > 0 && <span className="wb-lock">{locked} 个手改字段受保护</span>}
        </span>
        <div className="spacer" />
        <button className="btn" onClick={save} disabled={saving || !projectName || !dirty}>
          {saving ? '保存中…' : dirty ? '保存到 project.json' : '已保存'}
        </button>
        <button
          className="btn primary"
          onClick={() => onPush(shots)}
          disabled={shots.length === 0}
          title="按 shot.id 幂等推送：画布上没有的新建，已有的更新，多余的标灰不删"
        >
          生成到画布
        </button>
      </div>
    </main>
  )
}

function describeEpisode(ep: any): string {
  const parts: string[] = []
  if (ep?.title) parts.push(`第 ${ep.no} 集《${ep.title}》`)
  if (ep?.hook) parts.push(`结尾钩子：${ep.hook}`)
  for (const sc of ep?.scenes ?? []) {
    parts.push(
      `场景 ${sc.no}｜${sc.slug || ''}｜${sc.place || ''}｜${sc.time || ''}｜` +
        `${sc.beats || ''}｜在场：${(sc.characters ?? []).join('、')}`,
    )
  }
  return parts.join('\n')
}
