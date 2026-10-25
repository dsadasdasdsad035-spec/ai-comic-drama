import { Fragment, lazy, Suspense, useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { MOVES, SHOT_SIZES } from './types'
import {
  callText,
  createProject,
  getProject,
  listProjects,
  mergeProjectShots,
  type AppSettings,
  type ProjectEpisode,
  type ProjectShot,
  type Stage,
} from './api'
import { hasTextModels, StageModelSelect, stageModelKey, type StagePick } from './ModelSelect'
import { dialogueToText, parseDialogue, reconcileDialogueDelivery } from './prompts'
import { assertSkillOutput, buildBoardSkillPrompt } from './skills/board'
import { clearHandEdited, mergeGenerated } from './shotSync'
import PerformanceEditor from './PerformanceEditor'
import WorkbenchBar from './WorkbenchBar'
import LipSyncPanel from './LipSyncPanel'
import { performanceSummary } from './performance'
import { endTask, startTask } from './tasks'
import { buildShotsFromModel } from './agent/shotDraft'
import {
  builtinFailure,
  type BuiltinResult,
  WORKBENCH_BUILTINS,
  type WorkbenchChatAdapter,
} from './agent/workbenchChat'
import { AgentButton } from './agent/AgentButton'
import { WorkbenchChatAside } from './agent/WorkbenchChatAside'
import { useWorkbenchChatOpen } from './agent/chatPanel'

const LazySkillChat = lazy(() => import('./agent/SkillChat'))

type Props = {
  projectName: string
  setProjectName: (v: string) => void
  /** 项目列表变化（新建项目后）通知顶栏刷新 */
  onProjectsChanged?: () => void | Promise<unknown>
  /** 已在画布上的 shotId */
  onCanvas: Set<string>
  onPush: (shots: ProjectShot[]) => void
  toast: (m: string) => void
  /** 当前集：由 App 统一管理，两个工作台共用 */
  epNo: number
  /** App 统一加载的设置；环节默认与规则包都从这里取 */
  settings: AppSettings | null
  stagePick: StagePick
  onPickStage: (stage: Stage, key: string) => void
  /** 保存成功后通知 App 刷新集栏镜数 */
  onSaved?: () => void
}

const pad = (n: number) => String(n).padStart(2, '0')

export default function ShotTable({
  projectName,
  setProjectName,
  onProjectsChanged,
  onCanvas,
  onPush,
  toast,
  epNo,
  settings,
  stagePick,
  onPickStage,
  onSaved,
}: Props) {
  const [root, setRoot] = useState('')
  const [shots, setShots] = useState<ProjectShot[]>([])
  const [style, setStyle] = useState('')
  const [aspect, setAspect] = useState('16:9')
  const [target, setTarget] = useState(60)
  const [brief, setBrief] = useState('')
  const [episodes, setEpisodes] = useState<any[]>([])
  const [loading, setLoading] = useState(false)
  const [saving, setSaving] = useState(false)
  const [genning, setGenning] = useState(false)
  const [elapsed, setElapsed] = useState(0)
  const [dirty, setDirty] = useState(false)
  const [creating, setCreating] = useState(false)
  const [newName, setNewName] = useState('')
  const [newTitle, setNewTitle] = useState('')
  const [making, setMaking] = useState(false)
  const [chatRunning, setChatRunning] = useState(false)
  const [perfEdit, setPerfEdit] = useState<string | null>(null)
  const { open: chatOpen, setOpen: setChatOpen } = useWorkbenchChatOpen('shots')
  const chatVisible = chatOpen && Boolean(projectName)

  const liveRef = useRef({ shots, style, aspect, brief, target, episodes })
  liveRef.current = { shots, style, aspect, brief, target, episodes }
  const saveRef = useRef<() => Promise<void>>(async () => {})
  const builtinStateRef = useRef({ genning, brief, settings, projectName })
  builtinStateRef.current = { genning, brief, settings, projectName }
  const runSplitRef = useRef<(signal?: AbortSignal) => Promise<BuiltinResult>>(async () =>
    builtinFailure('split_shots', '拆镜尚未就绪', {
      label: '拆镜',
      scope: 'episode',
      saveMode: 'explicit',
    }),
  )

  const chatAdapter = useMemo<WorkbenchChatAdapter>(
    () => ({
      surface: 'shots',
      skillId: 'shotlist',
      stage: 'shot',
      artifact: 'shots',
      writeTool: 'submit_shots',
      writeContract: 'shots-v1',
      threadKey: { project: projectName, surface: 'shots', episode: epNo },
      scope: () => '本集',
      inputs: () => {
        const l = liveRef.current
        return {
          style: l.style || '近未来科幻写实',
          aspect: l.aspect,
          brief: l.brief,
          target: l.target,
        }
      },
      ownDraft: () => liveRef.current.shots,
      projectSnapshot: () => getProject(projectName),
      applyDraft: (payload) => {
        const data = (payload || {}) as { shots?: unknown[] }
        const got = Array.isArray(data.shots) ? data.shots : []
        const built = buildShotsFromModel(got, liveRef.current.episodes as ProjectEpisode[], epNo)
        const current = liveRef.current.shots
        const visibleNow = current.filter((s) => (Number(s.episode) || 1) === epNo)
        const beforeIds = new Set(visibleNow.map((s) => s.id))
        const merged = mergeGenerated(visibleNow, built.shots)
        const added = merged.filter((s) => !beforeIds.has(s.id)).length
        const updated = merged.length - added
        const next = [...current.filter((s) => (Number(s.episode) || 1) !== epNo), ...merged]
        liveRef.current.shots = next
        setShots(next)
        setDirty(true)
        return {
          ok: true,
          summary: `已写入镜头草稿：E${String(epNo).padStart(2, '0')} ${merged.length} 镜（新增 ${added} / 更新 ${updated}），尚未保存`,
          counts: { total: merged.length, added, updated, sceneFallback: built.sceneFallback },
        }
      },
      saveDraft: () => saveRef.current(),
      builtins: [
        {
          ...WORKBENCH_BUILTINS.split_shots,
          disabled: () => {
            const st = builtinStateRef.current
            if (!st.projectName) return { disabled: true, reason: '先选择项目' }
            if (st.genning) return { disabled: true, reason: '正在拆镜' }
            if (!st.brief.trim()) return { disabled: true, reason: '先写本集内容或梗概' }
            if (!hasTextModels(st.settings)) {
              return { disabled: true, reason: '设置页还没有可用的文本模型' }
            }
            return { disabled: false }
          },
          run: (signal) => runSplitRef.current(signal),
        },
      ],
    }),
    [projectName, epNo],
  )

  const load = useCallback(
    async (name: string) => {
      if (!name) return
      setLoading(true)
      try {
        const p = await getProject(name)
        setShots(p.shots ?? [])
        setStyle(p.style ?? '')
        setAspect(p.aspect ?? '16:9')
        setEpisodes(p.episodes ?? [])
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

  // 切集时把该集的场景 beats 填进拆镜输入框
  useEffect(() => {
    const e = episodes.find((x: any) => Number(x?.no) === epNo)
    setBrief(e ? describeEpisode(e) : '')
  }, [epNo, episodes])

  /** 当前集的镜头。集号缺失的老数据按第 1 集处理 */
  const visible = useMemo(
    () => shots.filter((s) => (Number(s.episode) || 1) === epNo),
    [shots, epNo],
  )

  const total = useMemo(
    () => visible.reduce((a, s) => a + (Number(s.seconds) || 0), 0),
    [visible],
  )
  const locked = useMemo(
    () => visible.reduce((a, s) => a + (s.handEdited?.length ?? 0), 0),
    [visible],
  )
  const pushed = useMemo(() => visible.filter((s) => onCanvas.has(s.id)).length, [visible, onCanvas])

  const doCreate = async () => {
    const name = newName.trim()
    if (!/^[a-zA-Z0-9_-]{1,40}$/.test(name)) {
      toast('项目名只能用字母/数字/下划线/短横，最长 40 字（会作为目录名）')
      return
    }
    setMaking(true)
    try {
      await createProject(name, { title: newTitle.trim() || name })
      await onProjectsChanged?.()
      setProjectName(name)
      setCreating(false)
      setNewName('')
      setNewTitle('')
      toast(`已新建项目 ${name}`)
    } catch (e: any) {
      toast(e.message || '新建失败')
    } finally {
      setMaking(false)
    }
  }

  /**
   * 按 shot.id 定位，不能用行下标：
   * 表格渲染的是「当前集」的子集，下标与全量 shots 数组对不上，
   * 一旦文件里镜头不是严格按集排列，就会改到别的镜头上（实测踩到过）。
   */
  const edit = (id: string, field: string, value: unknown) => {
    setShots((prev) =>
      prev.map((s) => {
        if (s.id !== id) return s
        const hand = new Set([...(s.handEdited ?? []), field])
        return { ...s, [field]: value, handEdited: [...hand] }
      }),
    )
    setDirty(true)
  }

  /** 一次改多个字段、只合并一次手改标记（表演需要同时写 performance + dialogue_delivery）。 */
  const editMany = (id: string, patch: Partial<ProjectShot>, fields: string[]) => {
    setShots((prev) =>
      prev.map((s) => {
        if (s.id !== id) return s
        const hand = new Set([...(s.handEdited ?? []), ...fields])
        return { ...s, ...patch, handEdited: [...hand] }
      }),
    )
    setDirty(true)
  }

  const clearPerfHand = (s: ProjectShot) => {
    setShots((prev) => prev.map((x) => (x.id === s.id ? clearHandEdited(x, ['performance', 'dialogue_delivery']) : x)))
    setDirty(true)
  }

  const runSplit = useCallback(
    async (signal?: AbortSignal): Promise<BuiltinResult> => {
      const label = '拆镜'
      const action = 'split_shots'
      const fail = (message: string, cancelled = false) =>
        builtinFailure(action, message, {
          label,
          scope: 'episode',
          saveMode: 'explicit',
          ...(cancelled ? { cancelled: true } : {}),
        })
      const l = liveRef.current
      if (!projectName) return fail('先选择项目')
      if (!l.brief.trim()) return fail('先写本集内容或梗概，再来拆镜')
      if (!hasTextModels(settings)) return fail('设置页还没有可用的文本模型，先加一条再拆镜')
      if (signal?.aborted) return fail('已取消', true)
      setGenning(true)
      setElapsed(0)
      const t0 = Date.now()
      const timer = window.setInterval(() => setElapsed(Math.round((Date.now() - t0) / 1000)), 500)
      const tid = startTask('text', `E${pad(epNo)} 拆镜`)
      try {
        const resolvedStyle = l.style || '近未来科幻写实'
        const skill = await buildBoardSkillPrompt('shotlist', {
          style: resolvedStyle,
          aspect: l.aspect,
          brief: l.brief,
          target: l.target,
        })
        const r = await callText<{ shots: any[] }>({
          system: skill.system,
          prompt: skill.task,
          modelKey: stageModelKey(settings, 'shot', stagePick),
          json: true,
          maxTokens: 8192,
          signal,
        })
        assertSkillOutput('shots-v1', r.json)
        const got = r.json?.shots
        if (!Array.isArray(got) || got.length === 0) throw new Error('模型没给出镜头列表')
        if (signal?.aborted) {
          endTask(tid, '已取消')
          return fail('已取消', true)
        }
        const built = buildShotsFromModel(got, l.episodes as ProjectEpisode[], epNo)
        const visibleNow = l.shots.filter((s) => (Number(s.episode) || 1) === epNo)
        // 手改过的字段在重新生成时保住，这是 handEdited 唯一生效的地方
        const merged = mergeGenerated(visibleNow, built.shots)
        const kept = merged.filter((s) => (s.handEdited?.length ?? 0) > 0).length
        // 只替换本集，别集的镜头原样保留
        setShots((prev) => [...prev.filter((x) => (Number(x.episode) || 1) !== epNo), ...merged])
        setDirty(true)
        const sum = merged.reduce((a, s) => a + (Number(s.seconds) || 0), 0)
        const secs = Math.round((Date.now() - t0) / 1000)
        endTask(tid)
        return {
          ok: true,
          action,
          label,
          scope: 'episode',
          summary:
            `E${pad(epNo)} 拆出 ${merged.length} 镜 / ${sum.toFixed(1)}s · ${secs}s` +
            (r.modelLabel ? ` · 模型：${r.modelLabel}` : '') +
            (kept > 0 ? ` · ${kept} 镜的手改字段已保留` : '') +
            (built.sceneFallback > 0
              ? ` · ${built.sceneFallback} 镜场次缺失/无效，已回退第 ${built.fallbackSceneNo} 场`
              : '') +
            '，草稿未保存',
          counts: {
            shots: merged.length,
            kept,
            sceneFallback: built.sceneFallback,
          },
          ...(r.modelLabel ? { modelLabel: r.modelLabel } : {}),
          elapsedMs: Date.now() - t0,
          saveMode: 'explicit',
        }
      } catch (e) {
        const err = e as Error
        const cancelled = Boolean(signal?.aborted) || err.name === 'AbortError'
        endTask(tid, cancelled ? '已取消' : err.message || '拆镜失败')
        return fail(cancelled ? '已取消' : err.message || '拆镜失败', cancelled)
      } finally {
        window.clearInterval(timer)
        setGenning(false)
      }
    },
    [projectName, epNo, settings, stagePick],
  )
  runSplitRef.current = runSplit

  const generate = async () => {
    const r = await runSplit()
    if (!r.ok) {
      if (!r.cancelled) toast(r.error || '拆镜失败')
      return
    }
    toast(r.summary)
  }

  const save = async () => {
    if (!projectName) return
    setSaving(true)
    try {
      const r = await mergeProjectShots(projectName, shots)
      // 服务端做了字段级合并，拿回真正落盘的结果
      setShots(r.shots as ProjectShot[])
      setDirty(false)
      onSaved?.()
      toast(`已写回 project.json · ${r.shots.length} 镜`)
    } catch (e: any) {
      toast(e.message || '保存失败')
    } finally {
      setSaving(false)
    }
  }
  saveRef.current = save

  return (
    <div className="wb-with-chat">
      <main className="wb">
      <WorkbenchBar
        scope={
          <>
            <span className="wb-bar-title">镜头表</span>
            <span className="ep-chip">E{String(epNo).padStart(2, '0')}</span>
          </>
        }
        scopeDetail={<>{visible.length} 镜</>}
        settings={
          <>
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

            <StageModelSelect
              stage="shot"
              settings={settings}
              pick={stagePick}
              onChange={onPickStage}
              compact
            />

            <div className="wb-field wb-bar-optional">
              <button className="btn-mini" onClick={() => setCreating((v) => !v)} title="新建一个空项目">
                {creating ? '取消' : '+ 新建项目'}
              </button>
              <span className="wb-root" title={root}>
                {root || '…'}
              </span>
            </div>
          </>
        }
        actions={
          <>
            <AgentButton
              open={chatVisible}
              onToggle={() => setChatOpen((v) => !v)}
              disabled={!projectName}
              running={chatRunning}
              dirty={dirty}
              controlsId="workbench-chat-shots"
            />
            <button className="btn" onClick={() => load(projectName)} disabled={loading}>
              {loading ? '加载中…' : '重新加载'}
            </button>
          </>
        }
      />

      {creating && (
        <div className="wb-new">
          <div className="wb-field">
            <span className="label">目录名</span>
            <input
              value={newName}
              onChange={(e) => setNewName(e.target.value)}
              placeholder="如 my-drama"
              style={{ width: 150 }}
            />
          </div>
          <div className="wb-field">
            <span className="label">标题</span>
            <input
              value={newTitle}
              onChange={(e) => setNewTitle(e.target.value)}
              placeholder="如 回收人（可空）"
              style={{ width: 190 }}
            />
          </div>
          <button className="btn primary" onClick={doCreate} disabled={making || !newName.trim()}>
            {making ? '创建中…' : '创建'}
          </button>
          <span className="wb-note">目录名同时是仓库里的文件夹名，只在本地创建，不会自动提交</span>
        </div>
      )}

      <div className="wb-gen">
        <textarea
          value={brief}
          onChange={(e) => setBrief(e.target.value)}
          placeholder="本集内容 / 梗概 / 场景 beats —— 拆镜的输入。从项目里加载到 episodes 时会自动带上。"
          rows={3}
        />
        <button
          className="btn wb-genbtn"
          onClick={generate}
          disabled={genning || !brief.trim() || !hasTextModels(settings)}
        >
          {genning ? `拆镜中 ${elapsed}s` : '拆镜'}
        </button>
      </div>

      {visible.length === 0 ? (
        <div className="wb-empty">
          {loading ? '加载中…' : `E${pad(epNo)} 还没有镜头。上面写点内容，点「拆镜」。`}
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
                <th style={{ width: 150 }}>表演</th>
                <th style={{ width: 78 }}>状态</th>
              </tr>
            </thead>
            <tbody>
              {visible.map((s, i) => {
                const isPushed = onCanvas.has(s.id)
                const hand = new Set(s.handEdited ?? [])
                const dialogue = Array.isArray(s.dialogue)
                  ? s.dialogue
                  : typeof s.dialogue === 'string'
                    ? parseDialogue(s.dialogue)
                    : []
                return (
                  <Fragment key={s.id}>
                  <tr className={s.orphan ? 'orphan' : ''}>
                    <td className="mono">
                      <input value={s.no ?? ''} onChange={(e) => edit(s.id, 'no', e.target.value)} />
                    </td>
                    <td>
                      <input
                        type="number"
                        step={0.5}
                        min={1}
                        max={12}
                        className={hand.has('seconds') ? 'hand' : ''}
                        value={s.seconds ?? 3}
                        onChange={(e) => edit(s.id, 'seconds', Number(e.target.value) || 0)}
                      />
                    </td>
                    <td>
                      <select value={s.size ?? '中景'} onChange={(e) => edit(s.id, 'size', e.target.value)}>
                        {SHOT_SIZES.map((v) => (
                          <option key={v}>{v}</option>
                        ))}
                      </select>
                    </td>
                    <td>
                      <select value={s.move ?? '固定'} onChange={(e) => edit(s.id, 'move', e.target.value)}>
                        {MOVES.map((v) => (
                          <option key={v}>{v}</option>
                        ))}
                      </select>
                    </td>
                    <td>
                      <textarea
                        rows={2}
                        value={s.desc ?? ''}
                        onChange={(e) => edit(s.id, 'desc', e.target.value)}
                      />
                    </td>
                    <td>
                      <textarea
                        rows={2}
                        value={dialogueToText(s.dialogue)}
                        placeholder="角色：台词（一行一句）"
                        onChange={(e) => {
                          const next = parseDialogue(e.target.value)
                          const { delivery } = reconcileDialogueDelivery(dialogue, s.dialogue_delivery, next)
                          editMany(s.id, { dialogue: next, dialogue_delivery: delivery }, ['dialogue'])
                        }}
                      />
                    </td>
                    <td>
                      <div className="perf-cell">
                        <span className={s.performance?.length ? 'perf-summary' : 'perf-empty-mini'}>
                          {performanceSummary(s.performance) || '—'}
                        </span>
                        <button className="btn-mini" onClick={() => setPerfEdit(perfEdit === s.id ? null : s.id)}>
                          {perfEdit === s.id ? '收起' : '编辑'}
                        </button>
                        {(hand.has('performance') || hand.has('dialogue_delivery')) && (
                          <button
                            className="btn-mini ghost"
                            title="清除手改保护，下一次拆镜可以按模型结果重写表演"
                            onClick={() => clearPerfHand(s)}
                          >
                            恢复模型建议
                          </button>
                        )}
                      </div>
                    </td>
                    <td className="state">
                      {/* 默认什么都不显示：整表都是「在画布」时逐行标注是纯噪音 */}
                      {s.orphan && <em className="tag orphan">孤儿</em>}
                      {!isPushed && !s.orphan && <i className="wb-dot" title="还没推到画布" />}
                    </td>
                  </tr>
                  {perfEdit === s.id && (
                    <tr className="perf-expanded">
                      <td colSpan={8}>
                        <PerformanceEditor
                          cast={s.cast}
                          performance={s.performance}
                          dialogue={dialogue}
                          delivery={s.dialogue_delivery}
                          onChange={(next) =>
                            editMany(
                              s.id,
                              { performance: next.performance, dialogue_delivery: next.dialogueDelivery },
                              ['performance', 'dialogue_delivery'],
                            )
                          }
                        />
                        <LipSyncPanel
                          data={{
                            no: s.no ?? '',
                            seconds: Number(s.seconds) || 0,
                            size: s.size ?? '',
                            move: s.move ?? '',
                            dialogue: dialogueToText(s.dialogue),
                            prompt: s.keyframe_prompt ?? '',
                            videoPrompt: s.video_prompt,
                            videoUrl: s.clip,
                            voiceUrl: undefined,
                            performance: s.performance,
                            dialogueDelivery: s.dialogue_delivery,
                            lipSync: s.lip_sync,
                            cast: s.cast,
                            marks: [],
                          }}
                          onPatch={(patch) =>
                            editMany(
                              s.id,
                              {
                                ...(patch.lipSync !== undefined ? { lip_sync: patch.lipSync } : {}),
                              },
                              ['lip_sync'],
                            )
                          }
                          settings={settings}
                          projectName={projectName}
                        />
                      </td>
                    </tr>
                  )}
                  </Fragment>
                )
              })}
            </tbody>
          </table>
        </div>
      )}

      <div className="wb-foot">
        <span className="wb-sum">
          {visible.length} 镜 · 总时长{' '}
          <b className={total > target ? 'over' : ''}>{total.toFixed(1)}s</b> / 目标 {target}s
          {total > target && <span className="wb-warn">超 {(total - target).toFixed(1)}s</span>}
        </span>
        <span className="wb-sum">
          已在画布 {pushed} / {visible.length}
          {locked > 0 && <span className="wb-lock">{locked} 个手改字段受保护</span>}
        </span>
        <div className="spacer" />
        <button className="btn" onClick={save} disabled={saving || !projectName || !dirty}>
          {saving ? '保存中…' : dirty ? '保存到 project.json' : '已保存'}
        </button>
        <button
          className="btn primary"
          onClick={() => onPush(visible)}
          disabled={visible.length === 0}
          title="按 shot.id 幂等推送：画布上没有的新建，已有的更新，多余的标灰不删"
        >
          生成到画布
        </button>
      </div>
    </main>
      <WorkbenchChatAside
        surface="shots"
        open={chatVisible}
        onClose={() => setChatOpen(false)}
      >
        {projectName ? (
          <Suspense fallback={<div className="sb-chat-placeholder">正在加载聊天…</div>}>
            <LazySkillChat
              adapter={chatAdapter}
              settings={settings}
              stagePick={stagePick}
              onToast={toast}
              onRunningChange={setChatRunning}
              onClose={() => setChatOpen(false)}
              dirty={dirty}
            />
          </Suspense>
        ) : (
          <div className="sb-chat-placeholder">先选择项目，再打开聊天。</div>
        )}
      </WorkbenchChatAside>
    </div>
  )
}

function describeEpisode(ep: any): string {
  const parts: string[] = []
  if (ep?.title) parts.push(`第 ${ep.no} 集《${ep.title}》`)
  if (ep?.hook) parts.push(`结尾钩子：${ep.hook}`)
  for (const sc of ep?.scenes ?? []) {
    // 强度决定运镜条数（0-3 一条 / 4-6 两条 / 7-10 三条），必须带给拆镜模型
    const itn = sc.intensity === undefined || sc.intensity === null ? '' : `｜强度 ${sc.intensity}/10`
    const tone = sc.tone ? `｜基调 ${sc.tone}` : ''
    parts.push(
      `场景 ${sc.no}｜${sc.slug || ''}｜${sc.place || ''}｜${sc.time || ''}` +
        `${itn}${tone}｜${sc.beats || ''}｜在场：${(sc.characters ?? []).join('、')}`,
    )
  }
  return parts.join('\n')
}
