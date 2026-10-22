import { useCallback, useEffect, useState } from 'react'
import {
  callText,
  getProject,
  patchProject,
  type AppSettings,
  type ProjectEpisode,
  type Stage,
} from './api'
import { hasTextModels, StageModelSelect, stageModelKey, type StagePick } from './ModelSelect'
import { scriptSys } from './prompts'

type Props = {
  projectName: string
  epNo: number
  setEpNo: (n: number) => void
  /** App 统一加载的设置；环节默认与规则包都从这里取 */
  settings: AppSettings | null
  stagePick: StagePick
  onPickStage: (stage: Stage, key: string) => void
  /** 未保存状态报给 App：切项目/全剧拆角色前要检查 */
  onDirtyChange?: (dirty: boolean) => void
  /** 跳去镜头表拆这一集 */
  onGotoShotTable: () => void
  onSaved: () => void
  toast: (m: string) => void
}

const pad = (n: number) => String(n).padStart(2, '0')

/**
 * 剧本工作台（流水线第 1 段）：原著 → 分集剧本。
 *
 * 为什么不做成画布：这是线性长文本，价值在「通读 + 改」，不是空间排布。
 * 左栏原著、右栏分集，唯一出口是把某一集交给镜头表。
 */
export default function ScriptBoard({
  projectName,
  epNo,
  setEpNo,
  settings,
  stagePick,
  onPickStage,
  onDirtyChange,
  onGotoShotTable,
  onSaved,
  toast,
}: Props) {
  const [source, setSource] = useState('')
  const [logline, setLogline] = useState('')
  const [style, setStyle] = useState('')
  const [episodes, setEpisodes] = useState<ProjectEpisode[]>([])
  const [epCount, setEpCount] = useState(3)
  const [targetSeconds, setTargetSeconds] = useState(75)
  const [loading, setLoading] = useState(false)
  const [genning, setGenning] = useState(false)
  const [saving, setSaving] = useState(false)
  const [dirty, setDirty] = useState(false)
  const [elapsed, setElapsed] = useState<number | null>(null)

  useEffect(() => {
    onDirtyChange?.(dirty)
  }, [dirty, onDirtyChange])
  useEffect(() => () => onDirtyChange?.(false), [onDirtyChange])

  const load = useCallback(async () => {
    if (!projectName) return
    setLoading(true)
    try {
      const p = await getProject(projectName)
      setSource(p.source ?? '')
      setLogline(p.logline ?? '')
      setStyle(p.style ?? '')
      setEpisodes((p.episodes ?? []) as ProjectEpisode[])
      setEpCount(Math.max(1, (p.episodes ?? []).length || 3))
      setDirty(false)
      toast(`已加载 ${projectName}：${(p.episodes ?? []).length} 集`)
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

  const generate = async () => {
    if (!projectName) {
      toast('先在顶栏选择项目，再生成分集')
      return
    }
    if (!source.trim()) {
      toast('先把原著粘到左栏')
      return
    }
    if (!hasTextModels(settings)) {
      toast('设置页还没有可用的文本模型，先加一条再生成')
      return
    }
    setGenning(true)
    setElapsed(null)
    const t0 = Date.now()
    try {
      const r = await callText<{ logline?: string; episodes?: ProjectEpisode[] }>({
        system: scriptSys(settings?.rules),
        modelKey: stageModelKey(settings, 'script', stagePick),
        json: true,
        maxTokens: 8192,
        prompt:
          `原著：\n${source}\n\n` +
          `要求：拆 ${epCount} 集，每集目标时长约 ${targetSeconds} 秒。\n` +
          `画风：${style || '近未来科幻写实'}`,
      })
      const eps = (r.json?.episodes ?? []).filter((e) => e && e.no !== undefined)
      if (eps.length === 0) throw new Error('模型没给出分集结果')
      setEpisodes(eps)
      if (r.json?.logline) setLogline(r.json.logline)
      setDirty(true)
      const secs = Math.round((Date.now() - t0) / 1000)
      setElapsed(secs)
      toast(
        `生成 ${eps.length} 集 · ${secs}s${r.modelLabel ? ` · 模型：${r.modelLabel}` : ''}，先审阅再保存`,
      )
    } catch (e: any) {
      toast(e.message || '生成失败')
    } finally {
      setGenning(false)
    }
  }

  const addEpisode = () => {
    const no = episodes.reduce((m, e) => Math.max(m, Number(e.no) || 0), 0) + 1
    setEpisodes((prev) => [...prev, { no, title: '', hook: '', scenes: [] }])
    setDirty(true)
  }

  const removeEpisode = (idx: number) => {
    const ep = episodes[idx]
    if (!ep) return
    const n = Number(ep.no)
    if (!window.confirm(`删除第 ${n} 集？分集结构会删掉，但该集已拆的镜头不受影响。`)) return
    setEpisodes((prev) => prev.filter((_, i) => i !== idx))
    setDirty(true)
    toast(`已删除第 ${n} 集（记得保存）`)
  }

  const patchEp = (idx: number, p: Partial<ProjectEpisode>) => {
    setEpisodes((prev) => prev.map((e, i) => (i === idx ? { ...e, ...p } : e)))
    setDirty(true)
  }

  const save = async () => {
    if (!projectName) {
      toast('先在顶栏选择项目，再保存分集')
      return
    }
    setSaving(true)
    try {
      await patchProject(projectName, { source, logline, episodes, style })
      setDirty(false)
      onSaved()
      toast('剧本已写回 project.json')
    } catch (e: any) {
      toast(e.message || '保存失败')
    } finally {
      setSaving(false)
    }
  }

  const totalScenes = episodes.reduce((a, e) => a + (e.scenes?.length ?? 0), 0)

  return (
    <main className="sb">
      <div className="sb-left">
        <div className="sb-head">
          <span className="label">原著</span>
          <span className="sb-note">{source.length} 字</span>
        </div>
        <textarea
          className="sb-source"
          value={source}
          onChange={(e) => {
            setSource(e.target.value)
            setDirty(true)
          }}
          placeholder="把原著 / 故事梗概粘到这里。也可以直接读 projects/<项目>/source.md。"
        />

        <div className="sb-head">
          <span className="label">一句话故事</span>
        </div>
        <textarea
          className="sb-logline"
          value={logline}
          onChange={(e) => {
            setLogline(e.target.value)
            setDirty(true)
          }}
          placeholder="logline，会写进 project.json"
        />

        <div className="sb-opts">
          <div className="wb-field">
            <span className="label">集数</span>
            <input
              type="number"
              min={1}
              max={30}
              value={epCount}
              onChange={(e) => setEpCount(Math.max(1, Number(e.target.value) || 3))}
              style={{ width: 56 }}
            />
          </div>
          <div className="wb-field">
            <span className="label">每集</span>
            <input
              type="number"
              min={20}
              step={5}
              value={targetSeconds}
              onChange={(e) => setTargetSeconds(Math.max(20, Number(e.target.value) || 75))}
              style={{ width: 64 }}
            />
            <span className="label">秒</span>
          </div>
          <StageModelSelect
            stage="script"
            settings={settings}
            pick={stagePick}
            onChange={onPickStage}
          />
        </div>

        <div className="sb-actions">
          <button
            className="btn primary"
            onClick={generate}
            disabled={genning || !source.trim() || !hasTextModels(settings) || !projectName}
          >
            {genning ? '生成分集中…' : episodes.length > 0 ? '重新生成分集' : '生成分集'}
          </button>
          <button className="btn" onClick={save} disabled={saving || !dirty || !projectName}>
            {saving ? '保存中…' : dirty ? '保存' : '已保存'}
          </button>
          <button className="btn" onClick={addEpisode} title="手动加一集（也可以重新生成分集）">
            + 加一集
          </button>
          <button className="btn" onClick={load} disabled={loading}>
            {loading ? '加载中…' : '重新加载'}
          </button>
        </div>
        {elapsed !== null && <div className="sb-note">{episodes.length} 集 / {totalScenes} 场 · 上次用时 {elapsed}s</div>}
      </div>

      <div className="sb-right">
        {episodes.length === 0 ? (
          <div className="wb-empty">
            {genning ? '正在拆集…' : '还没有分集。左边粘上原著，点「生成分集」。'}
          </div>
        ) : (
          <div className="sb-scroll">
            <datalist id="sb-tone-options">
              {['紧张', '温情', '悬疑', '压抑', '热血'].map((t) => (
                <option key={t} value={t} />
              ))}
            </datalist>
            {episodes.map((e, i) => {
              const isCur = Number(e.no) === epNo
              return (
                <section key={`${e.no}-${i}`} className={`sb-ep ${isCur ? 'on' : ''}`}>
                  <header className="sb-ep-head">
                    <b>E{pad(Number(e.no) || i + 1)}</b>
                    <input
                      className="sb-ep-title"
                      value={e.title ?? ''}
                      placeholder="集标题"
                      onChange={(ev) => patchEp(i, { title: ev.target.value })}
                    />
                    <span className="sb-note">{(e.scenes?.length ?? 0)} 场</span>
                    <div className="spacer" />
                    <button
                      className="btn-mini"
                      onClick={() => {
                        setEpNo(Number(e.no) || i + 1)
                        onGotoShotTable()
                      }}
                      title="切到这一集并打开镜头表"
                    >
                      拆这一集 →
                    </button>
                    <button className="btn-mini" onClick={() => removeEpisode(i)} title="删除这一集">
                      删除
                    </button>
                  </header>

                  <label className="sb-hook">
                    <span>结尾钩子</span>
                    <input
                      value={e.hook ?? ''}
                      placeholder="本集结尾的悬念 / 反转"
                      onChange={(ev) => patchEp(i, { hook: ev.target.value })}
                    />
                  </label>

                  <ol className="sb-scenes">
                    {(e.scenes ?? []).map((sc, si) => (
                      <li key={si}>
                        <div className="sb-scene-meta">
                          <span className="sb-slug">{sc.slug || `场景 ${si + 1}`}</span>
                          <span className="sb-dim">{sc.place}</span>
                          <span className="sb-dim">{sc.time}</span>
                          {!!sc.characters?.length && <span className="sb-cast">{sc.characters.join('、')}</span>}
                          <span className="sb-knob" title="冲突强度 0-10：拆镜时 0-3 一条运镜、4-6 两条、7-10 三条">
                            <span className="sb-knob-k">强度</span>
                            <input
                              className="sb-knob-in sb-int"
                              type="number"
                              min={0}
                              max={10}
                              step={1}
                              value={sc.intensity ?? ''}
                              placeholder="—"
                              onChange={(ev) => {
                                const v = ev.target.value
                                const scenes = [...(e.scenes ?? [])]
                                scenes[si] = {
                                  ...sc,
                                  intensity: v === '' ? undefined : Math.max(0, Math.min(10, Number(v) || 0)),
                                }
                                patchEp(i, { scenes })
                              }}
                            />
                          </span>
                          <span className="sb-knob" title="情绪基调：紧张 / 温情 / 悬疑 / 压抑 / 热血">
                            <span className="sb-knob-k">基调</span>
                            <input
                              className="sb-knob-in sb-tone"
                              value={sc.tone ?? ''}
                              placeholder="—"
                              list="sb-tone-options"
                              onChange={(ev) => {
                                const scenes = [...(e.scenes ?? [])]
                                scenes[si] = { ...sc, tone: ev.target.value || undefined }
                                patchEp(i, { scenes })
                              }}
                            />
                          </span>
                        </div>
                        <textarea
                          className="sb-beats"
                          rows={2}
                          value={sc.beats ?? ''}
                          onChange={(ev) => {
                            const scenes = [...(e.scenes ?? [])]
                            scenes[si] = { ...sc, beats: ev.target.value }
                            patchEp(i, { scenes })
                          }}
                        />
                      </li>
                    ))}
                  </ol>
                </section>
              )
            })}
          </div>
        )}
      </div>
    </main>
  )
}
