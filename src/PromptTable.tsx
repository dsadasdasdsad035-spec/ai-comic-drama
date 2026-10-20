import { useCallback, useEffect, useMemo, useState } from 'react'
import { callText, getProject, patchProject, type ProjectShot } from './api'
import { characterBible, toSheet, type ProjectChar } from './charMap'
import type { CharacterSheet } from './characters'
import { PROMPT_SYS, chunk, expandAnchors, hasUnresolvedAnchor } from './prompts'
import { endTask, startTask } from './tasks'

type Props = {
  projectName: string
  onCanvas: Set<string>
  onPush: (shots: ProjectShot[]) => void
  toast: (m: string) => void
  epNo: number
}

type Audit = {
  cast: string[]
  /** 硬问题：有台词的角色缺锚点 —— 一定错，必红 */
  missing: string[]
  /** 软提示：只在描述里被提到、没有台词的角色缺锚点 —— 可能是画外提及，自己判断 */
  maybe: string[]
  unknown: string[]
  empty: boolean
}

/**
 * 出场角色分两档，因为「被提到」和「在画面里」不是一回事：
 *   - 有台词 → 肯定在画面里（说话人一定在）
 *   - 只在描述里出现 → 可能在画外（实测 S10「她直视陈默」是她的特写，陈默不在框内）
 * 硬问题标红，软提示标黄，不混为一谈。
 */
function auditOf(s: ProjectShot, chars: CharacterSheet[]): Audit {
  // 拆镜给了 cast 就以它为准（权威），没有才退回「台词 + 描述点名」的启发式
  const declared = Array.isArray(s.cast) && s.cast.length > 0 ? s.cast : null
  return declared ? auditByCast(s, chars, declared) : auditByHeuristic(s, chars)
}

function auditByCast(s: ProjectShot, chars: CharacterSheet[], declared: string[]): Audit {
  const kf = s.keyframe_prompt || ''
  const missing: string[] = []
  const unknown: string[] = []
  for (const name of declared) {
    const c = chars.find((x) => x.name === name)
    if (!c) {
      unknown.push(name)
      continue
    }
    if (c.lookEn && !kf.includes(c.lookEn)) missing.push(name)
  }
  return { cast: [...declared], missing, maybe: [], unknown, empty: !kf.trim() }
}

function auditByHeuristic(s: ProjectShot, chars: CharacterSheet[]): Audit {
  const dlg = Array.isArray(s.dialogue) ? s.dialogue : []
  const spoken = new Set<string>()
  for (const d of dlg) if (d?.speaker) spoken.add(d.speaker)
  const desc = s.desc || ''
  const mentioned = new Set<string>()
  for (const c of chars) if (c.name && desc.includes(c.name)) mentioned.add(c.name)

  const kf = s.keyframe_prompt || ''
  const missing: string[] = []
  const maybe: string[] = []
  const unknown: string[] = []

  const judge = (name: string, hard: boolean) => {
    const c = chars.find((x) => x.name === name)
    if (!c) {
      if (hard) unknown.push(name)
      return
    }
    if (!c.lookEn) return
    if (kf.includes(c.lookEn)) return
    ;(hard ? missing : maybe).push(name)
  }

  for (const n of spoken) judge(n, true)
  for (const n of mentioned) if (!spoken.has(n)) judge(n, false)

  return {
    cast: [...new Set([...spoken, ...mentioned])],
    missing,
    maybe,
    unknown,
    empty: !kf.trim(),
  }
}

export default function PromptTable({ projectName, onCanvas, onPush, toast, epNo }: Props) {
  const [shots, setShots] = useState<ProjectShot[]>([])
  const [chars, setChars] = useState<CharacterSheet[]>([])
  const [style, setStyle] = useState('')
  const [loading, setLoading] = useState(false)
  const [genning, setGenning] = useState(false)
  const [saving, setSaving] = useState(false)
  const [dirty, setDirty] = useState(false)
  // 实测：lite 44s / pro 261s（15 镜 3 批并行），质量差异主要在电影感措辞，默认走快的
  const [model, setModel] = useState<'pro' | 'lite'>('lite')
  const [batchSize, setBatchSize] = useState(5)
  const [progress, setProgress] = useState<{ done: number; total: number; failed: number } | null>(null)

  const load = useCallback(async () => {
    if (!projectName) return
    setLoading(true)
    try {
      const p = await getProject(projectName)
      setShots(p.shots ?? [])
      setChars(((p.characters ?? []) as ProjectChar[]).map(toSheet))
      setStyle(p.style ?? '')
      setDirty(false)
      toast(`已加载 ${projectName}：${(p.shots ?? []).length} 镜`)
    } catch (e: any) {
      toast(e.message || '加载失败')
    } finally {
      setLoading(false)
    }
  }, [projectName, toast])

  useEffect(() => {
    load()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [projectName])

  /** 当前集的镜头 */
  const visible = useMemo(
    () => shots.filter((s) => (Number(s.episode) || 1) === epNo),
    [shots, epNo],
  )
  const audits = useMemo(() => visible.map((s) => auditOf(s, chars)), [visible, chars])
  const stat = useMemo(() => {
    const empty = audits.filter((a) => a.empty).length
    const miss = audits.filter((a) => !a.empty && a.missing.length > 0).length
    const may = audits.filter((a) => !a.empty && a.maybe.length > 0).length
    const unk = audits.filter((a) => a.unknown.length > 0).length
    return { empty, miss, may, unk, ok: visible.length - empty - miss }
  }, [audits, visible.length])

  const edit = (idx: number, field: 'keyframe_prompt' | 'video_prompt', value: string) => {
    setShots((prev) => prev.map((s, i) => (i === idx ? { ...s, [field]: value } : s)))
    setDirty(true)
  }

  /** 跑一批。抽成独立函数是为了让任务台账的「重试」能精确重跑这一批 */
  const runGroup = useCallback(
    async (g: ProjectShot[], idx: number, t0: number) => {
      const tid = startTask('text', `E${epNo} 提示词 批${idx + 1}`, {
        retry: () => void runGroup(g, idx, t0),
      })
      const bible = characterBible(chars) || '（项目里还没有角色锚点）'
      const brief = g.map((x) => ({
        no: x.no,
        seconds: x.seconds,
        size: x.size,
        move: x.move,
        desc: x.desc,
        dialogue: x.dialogue,
      }))
      try {
        const r = await callText<{ shots: { no: string; keyframe_prompt: string; video_prompt: string }[] }>({
          system: PROMPT_SYS,
          model,
          json: true,
          maxTokens: 4096,
          prompt:
            `画风锁：${style || '近未来科幻写实'}\n\n` +
            `角色外观锚点：\n${bible}\n\n` +
            `分镜：\n${JSON.stringify(brief)}\n\n` +
            `输出要求：\n` +
            `1. 每一镜都要给 keyframe_prompt 与 video_prompt，no 必须与输入一致\n` +
            `2. keyframe_prompt 里凡出现角色，一律用 {{角色名}} 占位代替整段 look_en（例如 {{陈默}}），` +
            `由我在保存前原样替换回原文 —— 不要自己展开那整段描述\n` +
            `3. 只输出 JSON`,
        })
        const got = r.json?.shots
        if (!Array.isArray(got) || got.length === 0) throw new Error('空返回')

        const patch = new Map<string, { kf: string; vp: string }>()
        let bad = 0
        for (const x of got) {
          const kf = expandAnchors(String(x.keyframe_prompt || '').trim(), chars)
          if (hasUnresolvedAnchor(kf)) bad++
          patch.set(String(x.no), { kf, vp: String(x.video_prompt || '').trim() })
        }
        setShots((prev) =>
          prev.map((x) => {
            const hit = patch.get(String(x.no))
            return hit ? { ...x, keyframe_prompt: hit.kf, video_prompt: hit.vp } : x
          }),
        )
        setDirty(true)
        endTask(tid)
        return { ok: true, filled: g.filter((x) => patch.has(String(x.no))).length, unresolved: bad, groups: 1, total: g.length, t0 }
      } catch (e: any) {
        endTask(tid, String(e?.message || '生成失败'))
        return { ok: false, filled: 0, unresolved: 0, groups: 1, total: g.length, t0 }
      }
    },
    [chars, epNo, model, style],
  )

  const generate = async () => {
    if (visible.length === 0) {
      toast(`E${String(epNo).padStart(2, '0')} 还没有镜头，先去「镜头表」拆镜`)
      return
    }
    // 分片并行：输出量受镜头数线性影响，切批并发是唯一能真正缩短墙钟时间的手段
    const groups = chunk(visible, Math.max(2, batchSize))
    setGenning(true)
    setProgress({ done: 0, total: groups.length, failed: 0 })
    const t0 = Date.now()

    let done = 0
    const results = await Promise.all(
      groups.map(async (g, idx) => {
        const r = await runGroup(g, idx, t0)
        done++
        setProgress({ done, total: groups.length, failed: 0 })
        return r
      }),
    )

    const okCount = results.filter((r) => r.ok).length
    const filled = results.reduce((a, r) => a + r.filled, 0)
    const unresolved = results.reduce((a, r) => a + r.unresolved, 0)
    const failed = groups.length - okCount
    setProgress({ done: groups.length, total: groups.length, failed })
    setGenning(false)
    window.setTimeout(() => setProgress(null), 2600)
    const elapsed = ((Date.now() - t0) / 1000).toFixed(0)
    toast(
      `E${String(epNo).padStart(2, '0')} ${filled}/${visible.length} 镜 · ${elapsed}s（${okCount}/${groups.length} 批）` +
        (failed > 0 ? ` · ${failed} 批失败，可在任务台账里重试` : '') +
        (unresolved > 0 ? ` · ${unresolved} 条占位符未替换，检查角色名` : ''),
    )
  }

  /** 只补硬问题（有台词的角色）。疑似项留给人工判断，避免把画外角色硬塞进特写 */
  const fixAnchors = () => {
    let fixed = 0
    setShots((prev) =>
      prev.map((s, i) => {
        const a = audits[i]
        if (!a || a.empty || a.missing.length === 0) return s
        const add = a.missing
          .map((name) => chars.find((c) => c.name === name)?.lookEn || '')
          .filter(Boolean)
        if (add.length === 0) return s
        fixed++
        return { ...s, keyframe_prompt: `${(s.keyframe_prompt || '').trim()}, ${add.join(', ')}` }
      }),
    )
    setDirty(true)
    toast(fixed > 0 ? `已为 ${fixed} 镜补齐角色锚点` : '没有需要补的锚点')
  }

  const save = async () => {
    if (!projectName) return
    setSaving(true)
    try {
      const r = await patchProject(projectName, { shots })
      setShots(r.shots)
      setDirty(false)
      toast('提示词已写回 project.json')
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
          <span className="wb-name">{projectName || '未选项目'}</span>
        </div>
        <div className="wb-field">
          <span className="label">角色锚点</span>
          <span className="wb-name">{chars.filter((c) => c.lookEn).length} 个可用</span>
        </div>
        <div className="wb-field">
          <span className="label">模型</span>
          <select value={model} onChange={(e) => setModel(e.target.value as 'pro' | 'lite')}>
            <option value="pro">pro（质量）</option>
            <option value="lite">lite（快）</option>
          </select>
        </div>
        <div className="wb-field">
          <span className="label">每批</span>
          <select value={batchSize} onChange={(e) => setBatchSize(Number(e.target.value))}>
            {[3, 5, 8, 15].map((n) => (
              <option key={n} value={n}>
                {n} 镜
              </option>
            ))}
          </select>
        </div>
        <div className="spacer" />
        <span className="wb-sum">
          有提示词 {stat.ok} · 缺锚点 <b className={stat.miss ? 'over' : ''}>{stat.miss}</b> · 空白{' '}
          <b className={stat.empty ? 'over' : ''}>{stat.empty}</b>
          {stat.may > 0 && <span className="wb-maybe">{stat.may} 镜疑似</span>}
          {stat.unk > 0 && <span className="wb-warn">{stat.unk} 镜有未知角色</span>}
        </span>
        <button className="btn" onClick={load} disabled={loading}>
          {loading ? '加载中…' : '重新加载'}
        </button>
      </div>

      {visible.length === 0 ? (
        <div className="wb-empty">
          {loading ? '加载中…' : `E${String(epNo).padStart(2, '0')} 还没有镜头。先去「镜头表」拆镜，或换个集。`}
        </div>
      ) : (
        <div className="wb-scroll">
          <table className="wb-table pt-table">
            <thead>
              <tr>
                <th style={{ width: 60 }}>镜号</th>
                <th style={{ width: 104 }}>出场</th>
                <th>首帧提示词（Seedream）</th>
                <th style={{ width: 200 }}>视频指令（Seedance）</th>
                <th style={{ width: 96 }}>锚点校验</th>
              </tr>
            </thead>
            <tbody>
              {visible.map((s, i) => {
                const a = audits[i]
                return (
                  <tr key={s.id}>
                    <td className="mono">
                      <span className="wb-no">{s.no}</span>
                      {/* 只有个别未上画布时才值得标出来；全都在画布上时逐行标注等于噪音 */}
                      {onCanvas.has(s.id) ? (
                        <i className="wb-dot on" title="已在画布" />
                      ) : (
                        <i className="wb-dot" title="还没推到画布" />
                      )}
                    </td>
                    <td className="wb-cast">{a.cast.join('、') || '—'}</td>
                    <td>
                      <textarea
                        rows={3}
                        value={s.keyframe_prompt ?? ''}
                        placeholder={s.desc ? `（空 → 出图会退回用描述）${s.desc.slice(0, 40)}…` : '点上方「生成提示词」'}
                        onChange={(e) => edit(i, 'keyframe_prompt', e.target.value)}
                      />
                    </td>
                    <td>
                      <textarea
                        rows={3}
                        value={s.video_prompt ?? ''}
                        onChange={(e) => edit(i, 'video_prompt', e.target.value)}
                      />
                    </td>
                    <td className="state">
                      {a.empty ? (
                        <em className="tag off">空白</em>
                      ) : a.missing.length > 0 ? (
                        <em className="tag bad" title={`缺：${a.missing.join('、')}`}>
                          缺 {a.missing.length}
                        </em>
                      ) : (
                        <em className="tag ok">✓</em>
                      )}
                      {a.maybe.length > 0 && (
                        <em
                          className="tag orphan"
                          title={`描述里提到但没锚点（可能是画外提及）：${a.maybe.join('、')}`}
                        >
                          疑似 {a.maybe.length}
                        </em>
                      )}
                      {a.unknown.length > 0 && (
                        <em className="tag unknown" title={`有台词但不在角色表里，长相不会被锚定：${a.unknown.join('、')}`}>
                          未知
                        </em>
                      )}
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
          {visible.length} 镜 · 缺锚点是 AI 出图「脸崩」的主因，靠人眼核 {visible.length} 条不现实
        </span>
        <div className="spacer" />
        <button className="btn" onClick={fixAnchors} disabled={stat.miss === 0}>
          补齐锚点
        </button>
        <button className="btn" onClick={generate} disabled={genning || visible.length === 0}>
          {genning && progress
            ? `生成中 ${progress.done}/${progress.total} 批`
            : progress && progress.failed > 0
              ? '重试失败批次'
              : '生成提示词'}
        </button>
        <button className="btn" onClick={save} disabled={saving || !dirty}>
          {saving ? '保存中…' : dirty ? '保存到 project.json' : '已保存'}
        </button>
        <button
          className="btn primary"
          onClick={() => onPush(visible)}
          disabled={stat.empty > 0}
          title={stat.empty > 0 ? `还有 ${stat.empty} 镜没有首帧提示词` : '把提示词推到画布卡片上'}
        >
          推到画布
        </button>
      </div>
    </main>
  )
}
