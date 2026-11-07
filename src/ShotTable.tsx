import { Fragment, lazy, Suspense, useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { MOVES, SHOT_SIZES } from './types'
import {
  getProject,
  patchProject,
  listProjects,
  mergeProjectShots,
  type AppSettings,
  type ProjectEpisode,
  type ProjectShot,
  type Stage,
} from './api'
import { StageModelSelect, type StagePick } from './ModelSelect'
import { toSheet, type ProjectChar } from './charMap'
import type { CharacterSheet } from './characters'
import { expandAnchors, hasUnresolvedAnchor, dialogueToText, parseDialogue, reconcileDialogueDelivery } from './prompts'
import { auditKeyframePrompt } from './promptAudit'
import IntakeDialog from './intake/IntakeDialog'
import { clearHandEdited, mergeGenerated } from './shotSync'
import PerformanceEditor from './PerformanceEditor'
import WorkbenchBar from './WorkbenchBar'
import LipSyncPanel from './LipSyncPanel'
import { performanceSummary } from './performance'
import { buildShotsFromModel } from './agent/shotDraft'
import { type WorkbenchChatAdapter } from './agent/workbenchChat'
import { AgentButton } from './agent/AgentButton'
import { WorkbenchChatAside } from './agent/WorkbenchChatAside'
import { useWorkbenchChatOpen } from './agent/chatPanel'
import { projectImageAttachmentSource } from './agent/projectAttachments'
import { useMediaPicker } from './agent/useMediaPicker'
import { blankShot, findDuplicateNos, insertAfter, nextShotNo, removeRow } from './shotRows'
import {
  resolveEpisodeTarget,
  resolveProjectStyle,
  setEpisodeTargetSeconds,
} from './productionContext'

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

function describeEpisode(ep: any): string {
  const parts: string[] = []
  if (ep?.title) parts.push(`第 ${ep.no} 集《${ep.title}》`)
  if (ep?.hook) parts.push(`结尾钩子：${ep.hook}`)
  for (const sc of ep?.scenes ?? []) {
    const itn = sc.intensity === undefined || sc.intensity === null ? '' : `｜强度 ${sc.intensity}/10`
    const tone = sc.tone ? `｜基调 ${sc.tone}` : ''
    parts.push(
      `场景 ${sc.no}｜${sc.slug || ''}｜${sc.place || ''}｜${sc.time || ''}` +
        `${itn}${tone}｜${sc.beats || ''}｜在场：${(sc.characters ?? []).join('、')}`,
    )
  }
  return parts.join('\n')
}

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
  const [shots, setShots] = useState<ProjectShot[]>([])
  const [chars, setChars] = useState<CharacterSheet[]>([])
  const [style, setStyle] = useState('')
  const [aspect, setAspect] = useState('16:9')
  const [episodes, setEpisodes] = useState<ProjectEpisode[]>([])
  const [episodesDirty, setEpisodesDirty] = useState(false)
  const [loading, setLoading] = useState(false)
  const [saving, setSaving] = useState(false)
  const [dirty, setDirty] = useState(false)
  const [chatRunning, setChatRunning] = useState(false)
  const [perfEdit, setPerfEdit] = useState<string | null>(null)
  const [intakeOpen, setIntakeOpen] = useState(false)
  /** 待删除的镜头 id：显式删除意图，保存时随 deleteShotIds 提交 */
  const [pendingDelete, setPendingDelete] = useState<string[]>([])
  const [orphanOpen, setOrphanOpen] = useState(false)
  const { open: chatOpen, setOpen: setChatOpen } = useWorkbenchChatOpen('shots')
  const chatVisible = chatOpen && Boolean(projectName)
  /** 聊天里的「从素材选」：复用既有缩略图选择器 */
  const mediaPicker = useMediaPicker(projectName)

  const liveRef = useRef({ shots, chars, style, aspect, episodes, epNo })
  liveRef.current = { shots, chars, style, aspect, episodes, epNo }
  const episodeTarget = useMemo(() => resolveEpisodeTarget(episodes, epNo), [episodes, epNo])
  const saveRef = useRef<() => Promise<void>>(async () => {})

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
        const ep = l.episodes.find((x: any) => Number(x?.no) === l.epNo)
        return {
          style: resolveProjectStyle({ style: l.style }) ?? '',
          aspect: l.aspect,
          brief: ep ? describeEpisode(ep) : '',
          target: resolveEpisodeTarget(l.episodes, l.epNo),
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
        const anchors = liveRef.current.chars.map((c) => ({ name: c.name, lookEn: c.lookEn }))
        let unresolved = 0
        const missingPromptCols: string[] = []
        const withAnchors = merged.map((s) => {
          const rawKf = String(s.keyframe_prompt ?? '').trim()
          const rawVp = String(s.video_prompt ?? '').trim()
          if (!rawKf && !rawVp) return s
          if (!rawKf || !rawVp) missingPromptCols.push(String(s.no || s.id))
          const kf = rawKf ? expandAnchors(rawKf, anchors) : s.keyframe_prompt
          if (kf && hasUnresolvedAnchor(kf)) unresolved++
          return {
            ...s,
            ...(rawKf ? { keyframe_prompt: kf } : {}),
            ...(rawVp ? { video_prompt: rawVp } : {}),
          }
        })
        const added = withAnchors.filter((s) => !beforeIds.has(s.id)).length
        const updated = withAnchors.length - added
        const next = [...current.filter((s) => (Number(s.episode) || 1) !== epNo), ...withAnchors]
        liveRef.current.shots = next
        setShots(next)
        setDirty(true)
        const promptNote =
          missingPromptCols.length > 0
            ? ` · ${missingPromptCols.length} 镜缺首帧或视频提示词：${missingPromptCols.slice(0, 5).join('、')}${missingPromptCols.length > 5 ? '…' : ''}`
            : ''
        const anchorNote = unresolved > 0 ? ` · ${unresolved} 条未解析 {{角色名}}` : ''
        return {
          ok: true,
          summary: `已写入镜头草稿：E${String(epNo).padStart(2, '0')} ${withAnchors.length} 镜（新增 ${added} / 更新 ${updated}）${promptNote}${anchorNote}，尚未保存`,
          counts: { total: withAnchors.length, added, updated, sceneFallback: built.sceneFallback, unresolved },
        }
      },
      saveDraft: () => saveRef.current(),
      attachments: projectImageAttachmentSource({
        projectName,
        prefix: 'chat-shots',
        picker: {
          open: async () => {
            const item = await mediaPicker.open()
            return item ? { url: item.url, title: item.title, name: item.name } : null
          },
        },
        hint: '图片只用于本次对话，不写入镜头表',
      }),
    }),
    [projectName, epNo, mediaPicker],
  )

  const load = useCallback(
    async (name: string) => {
      if (!name) return
      setLoading(true)
      try {
        const p = await getProject(name)
        setShots(p.shots ?? [])
        setChars(((p.characters ?? []) as ProjectChar[]).map(toSheet))
        setStyle(p.style ?? '')
        setAspect(p.aspect ?? '16:9')
        setEpisodes((p.episodes ?? []) as ProjectEpisode[])
        setEpisodesDirty(false)
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
      .then(({ projects: ps }) => {
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

  useEffect(() => {
    try {
      if (sessionStorage.getItem('workbench-chat:shots:openOnce') === '1') {
        sessionStorage.removeItem('workbench-chat:shots:openOnce')
        setChatOpen(true)
      }
    } catch {
      /* sessionStorage 不可用 */
    }
  }, [projectName, epNo, setChatOpen])

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
  const audits = useMemo(() => visible.map((s) => auditKeyframePrompt(s, chars)), [visible, chars])
  const promptStat = useMemo(() => {
    const empty = audits.filter((a) => a.empty).length
    const miss = audits.filter((a) => !a.empty && a.missing.length > 0).length
    const may = audits.filter((a) => !a.empty && a.maybe.length > 0).length
    const unk = audits.filter((a) => a.unknown.length > 0).length
    return { empty, miss, may, unk, ok: visible.length - empty - miss }
  }, [audits, visible.length])

  const fixAnchors = () => {
    const auditById = new Map(visible.map((s, i) => [s.id, audits[i]]))
    let fixed = 0
    setShots((prev) =>
      prev.map((s) => {
        const a = auditById.get(s.id)
        if (!a || a.empty || a.missing.length === 0) return s
        const add = a.missing
          .map((name) => chars.find((c) => c.name === name)?.lookEn || '')
          .filter(Boolean)
        if (add.length === 0) return s
        fixed++
        const hand = new Set([...(s.handEdited ?? []), 'keyframe_prompt'])
        return {
          ...s,
          keyframe_prompt: `${(s.keyframe_prompt || '').trim()}, ${add.join(', ')}`,
          handEdited: [...hand],
        }
      }),
    )
    setDirty(true)
    toast(fixed > 0 ? `已为 ${fixed} 镜补齐角色锚点` : '没有需要补的锚点')
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

  const orphanShots = useMemo(() => visible.filter((s) => s.orphan), [visible])
  const orphanCount = orphanShots.length

  /** 新增一镜：追加到本集末尾，镜号取集内最大+1 */
  const addShotRow = () => {
    const no = nextShotNo(shots, epNo)
    setShots((prev) => [...prev, blankShot(epNo, no)])
    setDirty(true)
  }

  /** 在指定镜之后插入 */
  const insertShotRow = (afterId: string) => {
    const no = nextShotNo(shots, epNo)
    setShots((prev) => insertAfter(prev, afterId, blankShot(epNo, no)))
    setDirty(true)
  }

  /**
   * 删除一镜：显式动作 + 确认。前端顺手清掉指向它的转场，
   * 服务端还会再兜底扫一次悬空引用。
   */
  const deleteShotRow = (s: ProjectShot) => {
    const hasOutput = [s.keyframe, s.clip, s.voice_meta ? 'x' : ''].filter(Boolean).length
    const detail = hasOutput
      ? '该镜已有画面/成片/配音产物；删除只移除项目数据，媒体文件保留'
      : '该镜没有产物'
    if (!window.confirm(`删除 ${s.no || s.id}？\n${detail}\n删除不可撤销；需要找回请用项目目录里的 project.json.bak。`)) return
    setShots((prev) => {
      const next = removeRow(prev, s.id)
      return next.map((x) =>
        x.transition_out?.to === s.id ? { ...x, transition_out: null } : x,
      )
    })
    setPendingDelete((prev) => [...new Set([...prev, s.id])])
    setDirty(true)
    toast(`已标记删除 ${s.no || s.id}（保存后生效）`)
  }

  const save = async () => {
    if (!projectName) return
    // 保存前校验镜号唯一：重复会生成相同 id
    const dups = findDuplicateNos(shots, epNo)
    if (dups.length) {
      toast(`保存被阻止：第 ${epNo} 集镜号「${dups[0].no}」重复。镜头 id 由集号+镜号生成，重复会互相覆盖。`)
      return
    }
    setSaving(true)
    try {
      const r = await mergeProjectShots(projectName, shots, pendingDelete)
      // 服务端做了字段级合并，拿回真正落盘的结果
      setShots(r.shots as ProjectShot[])
      setPendingDelete([])
      if (episodesDirty) {
        await patchProject(projectName, { episodes })
        setEpisodesDirty(false)
      }
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
        scopeDetail={
          visible.length === 0 ? (
            <>{visible.length} 镜</>
          ) : (
            <>
              {visible.length} 镜 · 有首帧提示词 {promptStat.ok} · 缺锚点{' '}
              <b className={promptStat.miss ? 'over' : ''}>{promptStat.miss}</b> · 空白{' '}
              <b className={promptStat.empty ? 'over' : ''}>{promptStat.empty}</b>
            </>
          )
        }
        settings={
          <>
            <div className="wb-field">
              <span className="label">目标时长</span>
              <input
                type="number"
                min={10}
                step={5}
                value={episodeTarget}
                onChange={(e) => {
                  const next = setEpisodeTargetSeconds(
                    episodes,
                    epNo,
                    Math.max(10, Number(e.target.value) || episodeTarget),
                  )
                  setEpisodes(next)
                  setEpisodesDirty(true)
                  setDirty(true)
                }}
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
            <button className="btn" disabled={!projectName} onClick={() => setIntakeOpen(true)}>
              导入
            </button>
          </>
        }
      />

      {visible.length > 0 ? (
        <div className="wb-row-tools">
          <button className="btn-mini" onClick={addShotRow} data-add-shot>
            新增镜头
          </button>
          {orphanCount > 0 ? (
            <button className="btn-mini ghost" onClick={() => setOrphanOpen(true)} data-orphan-open>
              清理孤儿 {orphanCount}
            </button>
          ) : null}
          {pendingDelete.length > 0 ? (
            <span className="wb-row-hint">待删除 {pendingDelete.length} 镜（保存后生效）</span>
          ) : null}
        </div>
      ) : null}

      {visible.length === 0 ? (
        <div className="wb-empty">
          {loading
            ? '加载中…'
            : `E${pad(epNo)} 还没有镜头。在右侧 Agent 描述如何拆镜（例如：拆成 12 个 3 秒镜头）。`}
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
                <th>首帧提示词</th>
                <th style={{ width: 180 }}>视频指令</th>
                <th style={{ width: 88 }}>锚点</th>
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
                const a = audits[i]
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
                    <td>
                      <textarea
                        rows={2}
                        className={hand.has('keyframe_prompt') ? 'hand' : ''}
                        value={s.keyframe_prompt ?? ''}
                        placeholder={s.desc ? s.desc.slice(0, 48) : '拆镜时由 Agent 写入'}
                        onChange={(e) => edit(s.id, 'keyframe_prompt', e.target.value)}
                      />
                    </td>
                    <td>
                      <textarea
                        rows={2}
                        className={hand.has('video_prompt') ? 'hand' : ''}
                        value={s.video_prompt ?? ''}
                        onChange={(e) => edit(s.id, 'video_prompt', e.target.value)}
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
                        <em className="tag orphan" title={`疑似画外：${a.maybe.join('、')}`}>
                          疑 {a.maybe.length}
                        </em>
                      )}
                    </td>
                    <td className="state">
                      {/* 默认什么都不显示：整表都是「在画布」时逐行标注是纯噪音 */}
                      {s.orphan && <em className="tag orphan">孤儿</em>}
                      {!isPushed && !s.orphan && <i className="wb-dot" title="还没推到画布" />}
                      <span className="wb-row-acts">
                        <button
                          className="btn-mini ghost"
                          onClick={() => insertShotRow(s.id)}
                          title="在这一镜之后插入一镜"
                          data-insert-after={s.id}
                        >
                          +
                        </button>
                        <button
                          className="btn-mini ghost danger"
                          onClick={() => deleteShotRow(s)}
                          title="删除这一镜（保存后生效）"
                          data-delete-shot={s.id}
                        >
                          ✕
                        </button>
                      </span>
                    </td>
                  </tr>
                  {perfEdit === s.id && (
                    <tr className="perf-expanded">
                      <td colSpan={11}>
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

      {orphanOpen ? (
        <div className="wb-orphan-panel" role="dialog" aria-label="清理孤儿镜头">
          <div className="wb-orphan-head">
            <b>孤儿镜头 {orphanCount} 个</b>
            <span>这些镜头在项目里有记录，但已不在最近一次生成的列表里。逐条勾选后删除，不提供全选删除。</span>
          </div>
          <div className="wb-orphan-list">
            {orphanShots.map((s) => (
              <label key={s.id} className="wb-orphan-row">
                <input
                  type="checkbox"
                  checked={pendingDelete.includes(s.id)}
                  onChange={(e) =>
                    setPendingDelete((prev) =>
                      e.target.checked ? [...new Set([...prev, s.id])] : prev.filter((x) => x !== s.id),
                    )
                  }
                />
                <code>{s.no || s.id}</code>
                <span>{s.seconds ?? 0}s</span>
                <em>{String(s.desc ?? '').slice(0, 40)}</em>
                <span className="st-hint">
                  {[s.keyframe ? '有首帧' : '', s.clip ? '有成片' : '', s.voice_meta ? '有配音' : '']
                    .filter(Boolean)
                    .join(' · ') || '无产物'}
                </span>
              </label>
            ))}
          </div>
          <div className="wb-orphan-foot">
            <button className="btn-mini ghost" onClick={() => setOrphanOpen(false)}>
              关闭
            </button>
            <button
              className="btn-mini"
              disabled={!orphanShots.some((s) => pendingDelete.includes(s.id))}
              onClick={() => {
                toast(`已标记删除 ${pendingDelete.filter((id) => orphanShots.some((s) => s.id === id)).length} 个孤儿（保存后生效）`)
                setOrphanOpen(false)
                setDirty(true)
              }}
            >
              标记删除所选
            </button>
          </div>
        </div>
      ) : null}

      <div className="wb-foot">
        <span className="wb-sum">
          {visible.length} 镜 · 总时长{' '}
          <b className={total > episodeTarget ? 'over' : ''}>{total.toFixed(1)}s</b> / 目标 {episodeTarget}s
          {total > episodeTarget && <span className="wb-warn">超 {(total - episodeTarget).toFixed(1)}s</span>}
        </span>
        <span className="wb-sum">
          已在画布 {pushed} / {visible.length}
          {locked > 0 && <span className="wb-lock">{locked} 个手改字段受保护</span>}
        </span>
        <div className="spacer" />
        <button className="btn" onClick={save} disabled={saving || !projectName || !dirty}>
          {saving ? '保存中…' : dirty ? '保存到 project.json' : '已保存'}
        </button>
        <button className="btn" onClick={fixAnchors} disabled={promptStat.miss === 0}>
          补齐锚点
        </button>
        <button
          className="btn primary"
          onClick={() => onPush(visible)}
          disabled={visible.length === 0 || promptStat.empty > 0}
          title={
            promptStat.empty > 0
              ? `还有 ${promptStat.empty} 镜没有首帧提示词`
              : '按 shot.id 幂等推送：画布上没有的新建，已有的更新，多余的标灰不删'
          }
        >
          生成到画布
        </button>
      </div>

      {intakeOpen ? (
        <IntakeDialog
          target="shots"
          projectName={projectName}
          epNo={epNo}
          settings={settings}
          stagePick={stagePick}
          shots={shots}
          episodes={episodes}
          chars={chars}
          toast={toast}
          onClose={() => setIntakeOpen(false)}
          onApply={(result) => {
            if (result.shots) setShots(result.shots)
            if (result.episodes) {
              setEpisodes(result.episodes)
              setEpisodesDirty(true)
            }
            setDirty(true)
            setIntakeOpen(false)
            toast(result.summary)
          }}
        />
      ) : null}
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
      {mediaPicker.node}
    </div>
  )
}
