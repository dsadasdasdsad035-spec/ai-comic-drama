import { useCallback, useEffect, useMemo, useState } from 'react'
import { callText, getProject, patchProject, type ProjectShot } from './api'
import { characterBible, toSheet, type ProjectChar } from './charMap'
import type { CharacterSheet } from './characters'
import { PROMPT_SYS } from './prompts'

type Props = {
  projectName: string
  onCanvas: Set<string>
  onPush: (shots: ProjectShot[]) => void
  toast: (m: string) => void
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

export default function PromptTable({ projectName, onCanvas, onPush, toast }: Props) {
  const [shots, setShots] = useState<ProjectShot[]>([])
  const [chars, setChars] = useState<CharacterSheet[]>([])
  const [style, setStyle] = useState('')
  const [loading, setLoading] = useState(false)
  const [genning, setGenning] = useState(false)
  const [saving, setSaving] = useState(false)
  const [dirty, setDirty] = useState(false)

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

  const audits = useMemo(() => shots.map((s) => auditOf(s, chars)), [shots, chars])
  const stat = useMemo(() => {
    const empty = audits.filter((a) => a.empty).length
    const miss = audits.filter((a) => !a.empty && a.missing.length > 0).length
    const may = audits.filter((a) => !a.empty && a.maybe.length > 0).length
    const unk = audits.filter((a) => a.unknown.length > 0).length
    return { empty, miss, may, unk, ok: shots.length - empty - miss }
  }, [audits, shots.length])

  const edit = (idx: number, field: 'keyframe_prompt' | 'video_prompt', value: string) => {
    setShots((prev) => prev.map((s, i) => (i === idx ? { ...s, [field]: value } : s)))
    setDirty(true)
  }

  const generate = async () => {
    if (shots.length === 0) {
      toast('先去「镜头表」拆镜')
      return
    }
    setGenning(true)
    try {
      const brief = shots.map((s) => ({
        no: s.no,
        seconds: s.seconds,
        size: s.size,
        move: s.move,
        desc: s.desc,
        dialogue: s.dialogue,
      }))
      const r = await callText<{ shots: { no: string; keyframe_prompt: string; video_prompt: string }[] }>({
        system: PROMPT_SYS,
        model: 'pro',
        json: true,
        maxTokens: 8192,
        prompt:
          `画风锁：${style || '近未来科幻写实'}\n\n` +
          `角色外观锚点（必须原样嵌入 keyframe_prompt，一字不改）：\n${characterBible(chars) || '（项目里还没有角色锚点）'}\n\n` +
          `分镜：\n${JSON.stringify(brief)}`,
      })
      const got = r.json?.shots
      if (!Array.isArray(got) || got.length === 0) throw new Error('模型没给出提示词')
      const byNo = new Map(got.map((g) => [String(g.no), g]))
      let filled = 0
      setShots((prev) =>
        prev.map((s) => {
          const g = byNo.get(String(s.no))
          if (!g) return s
          filled++
          return {
            ...s,
            keyframe_prompt: String(g.keyframe_prompt || '').trim(),
            video_prompt: String(g.video_prompt || '').trim(),
          }
        }),
      )
      setDirty(true)
      toast(`生成 ${filled}/${shots.length} 条提示词，先看锚点校验再保存`)
    } catch (e: any) {
      toast(e.message || '生成失败')
    } finally {
      setGenning(false)
    }
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

      {shots.length === 0 ? (
        <div className="wb-empty">{loading ? '加载中…' : '这个项目还没有镜头。先去「镜头表」拆镜。'}</div>
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
              {shots.map((s, i) => {
                const a = audits[i]
                return (
                  <tr key={s.id}>
                    <td className="mono">
                      <span className="wb-no">{s.no}</span>
                      {onCanvas.has(s.id) && <em className="tag ok">在画布</em>}
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
          {shots.length} 镜 · 缺锚点是 AI 出图「脸崩」的主因，靠人眼核 {shots.length} 条不现实
        </span>
        <div className="spacer" />
        <button className="btn" onClick={fixAnchors} disabled={stat.miss === 0}>
          补齐锚点
        </button>
        <button className="btn" onClick={generate} disabled={genning || shots.length === 0}>
          {genning ? '生成中…' : '生成提示词'}
        </button>
        <button className="btn" onClick={save} disabled={saving || !dirty}>
          {saving ? '保存中…' : dirty ? '保存到 project.json' : '已保存'}
        </button>
        <button
          className="btn primary"
          onClick={() => onPush(shots)}
          disabled={stat.empty > 0}
          title={stat.empty > 0 ? `还有 ${stat.empty} 镜没有首帧提示词` : '把提示词推到画布卡片上'}
        >
          推到画布
        </button>
      </div>
    </main>
  )
}
