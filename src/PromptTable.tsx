import { lazy, Suspense, useCallback, useEffect, useMemo, useRef, useState } from 'react'
import {
  callText,
  getProject,
  mergeProjectShots,
  patchProject,
  type AppSettings,
  type ProjectAsset,
  type ProjectShot,
  type Stage,
} from './api'
import { characterBible, toSheet, type ProjectChar } from './charMap'
import type { CharacterSheet } from './characters'
import type { ShotNodeType } from './data'
import { hasTextModels, StageModelSelect, stageModelKey, type StagePick } from './ModelSelect'
import {
  chunk,
  dialogueToText,
  dialogueWithDelivery,
  expandAnchors,
  hasUnresolvedAnchor,
  parseDialogue,
} from './prompts'
import { assertSkillOutput, buildBoardSkillPrompt } from './skills/board'
import { mergePromptDraft } from './agent/promptDraft'
import { shotToData } from './shotSync'
import { shot3DRenderPatch, shot3DSavePatch } from './shot3dPatch'
import WorkbenchBar from './WorkbenchBar'
import { resolveShotSchedule } from './scheduleStatus'
import type { SceneLayout, ShotData } from './types'
import type { CodeEditorRendered, CodeEditorSave } from './SceneCodeWorkbench'
import {
  builtinFailure,
  type BuiltinResult,
  WORKBENCH_BUILTINS,
  type WorkbenchChatAdapter,
} from './agent/workbenchChat'
import { AgentButton } from './agent/AgentButton'
import { WorkbenchChatAside } from './agent/WorkbenchChatAside'
import { useWorkbenchChatOpen } from './agent/chatPanel'
import { endTask, startTask } from './tasks'

const LazySkillChat = lazy(() => import('./agent/SkillChat'))
const LazySceneCodeWorkbench = lazy(() => import('./SceneCodeWorkbench'))

function promptBrief(s: ProjectShot) {
  const dialogue = Array.isArray(s.dialogue)
    ? s.dialogue
    : typeof s.dialogue === 'string'
      ? parseDialogue(s.dialogue)
      : []
  return {
    no: s.no,
    seconds: s.seconds,
    size: s.size,
    move: s.move,
    desc: s.desc,
    cast: s.cast ?? [],
    performance: s.performance ?? [],
    dialogue: dialogueWithDelivery(dialogue, s.dialogue_delivery),
  }
}

/** 项目镜头没有画布节点时的最小 ShotData。 */
function baseShotData(s: ProjectShot): ShotData {
  return {
    no: s.no ?? '',
    seconds: Number(s.seconds) || 3,
    size: s.size ?? '中景',
    move: s.move ?? '固定',
    dialogue:
      typeof s.dialogue === 'string' ? s.dialogue : dialogueToText(s.dialogue),
    prompt: s.keyframe_prompt || s.desc || '',
    marks: [],
  }
}

/** 用项目镜头合成 3D 工作台需要的节点；已有画布节点时保留其 refIds/media。 */
function projectShotNode(s: ProjectShot, existing?: ShotNodeType): ShotNodeType {
  const base = existing?.data ?? baseShotData(s)
  return {
    id: existing?.id ?? s.id,
    type: 'shot',
    position: existing?.position ?? { x: 0, y: 0 },
    data: shotToData(s, base),
  }
}

type Props = {
  projectName: string
  onCanvas: Set<string>
  onPush: (shots: ProjectShot[]) => void
  toast: (m: string) => void
  epNo: number
  /** App 统一加载的设置；环节默认与规则包都从这里取 */
  settings: AppSettings | null
  stagePick: StagePick
  onPickStage: (stage: Stage, key: string) => void
  /** 画布节点：3D 工作台解析连线素材、保留已有媒体 */
  canvasNodes: ShotNodeType[]
  /** 项目素材与场次布局：3D 工作台和状态判断使用 */
  assets: ProjectAsset[]
  sceneLayouts: SceneLayout[]
  projectAspect: string
  /** 3D 编辑器脏状态交给 App 做离开保护 */
  onEditorDirtyChange?: (dirty: boolean) => void
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

export default function PromptTable({
  projectName,
  onCanvas,
  onPush,
  toast,
  epNo,
  settings,
  stagePick,
  onPickStage,
  canvasNodes,
  assets,
  sceneLayouts,
  projectAspect,
  onEditorDirtyChange,
}: Props) {
  const [shots, setShots] = useState<ProjectShot[]>([])
  const [chars, setChars] = useState<CharacterSheet[]>([])
  const [style, setStyle] = useState('')
  const [loading, setLoading] = useState(false)
  const [genning, setGenning] = useState(false)
  const [saving, setSaving] = useState(false)
  const [dirty, setDirty] = useState(false)
  const [editorShotId, setEditorShotId] = useState<string | null>(null)
  const [batchSize, setBatchSize] = useState(5)
  const [progress, setProgress] = useState<{ done: number; total: number; failed: number } | null>(null)
  const [chatRunning, setChatRunning] = useState(false)
  const { open: chatOpen, setOpen: setChatOpen } = useWorkbenchChatOpen('prompts')
  const chatVisible = chatOpen && Boolean(projectName)

  const liveRef = useRef({ shots, chars, style })
  liveRef.current = { shots, chars, style }
  const saveRef = useRef<() => Promise<void>>(async () => {})
  const builtinStateRef = useRef({ genning, settings, projectName })
  builtinStateRef.current = { genning, settings, projectName }
  const runPromptsRef = useRef<(signal?: AbortSignal) => Promise<BuiltinResult>>(async () =>
    builtinFailure('generate_prompts', '生成提示词尚未就绪', {
      label: '生成提示词',
      scope: 'episode',
      saveMode: 'explicit',
    }),
  )

  const chatAdapter = useMemo<WorkbenchChatAdapter>(
    () => ({
      surface: 'prompts',
      skillId: 'prompt',
      stage: 'prompt',
      artifact: 'prompts',
      writeTool: 'submit_prompts',
      writeContract: 'prompts-v1',
      threadKey: { project: projectName, surface: 'prompts', episode: epNo },
      scope: () => '本集',
      inputs: () => {
        const l = liveRef.current
        const brief = l.shots.filter((s) => (Number(s.episode) || 1) === epNo).map(promptBrief)
        return {
          style: l.style || '近未来科幻写实',
          bible: characterBible(l.chars) || '（项目里还没有角色锚点）',
          briefJson: JSON.stringify(brief),
        }
      },
      ownDraft: () => liveRef.current.shots,
      projectSnapshot: () => getProject(projectName),
      applyDraft: (payload) => {
        const data = (payload || {}) as { shots?: { no: string | number; keyframe_prompt?: string; video_prompt?: string }[] }
        const got = Array.isArray(data.shots) ? data.shots : []
        const merged = mergePromptDraft(
          liveRef.current.shots,
          got,
          epNo,
          liveRef.current.chars,
        )
        liveRef.current.shots = merged.shots
        setShots(merged.shots)
        setDirty(true)
        const warn =
          (merged.missing ? ` · 未匹配 ${merged.missing}` : '') +
          (merged.unresolved ? ` · 残留占位符 ${merged.unresolved}` : '')
        return {
          ok: true,
          summary: `已写入提示词草稿：${merged.patched} 镜，尚未保存${warn}`,
          counts: { total: merged.patched, missing: merged.missing, unresolved: merged.unresolved },
        }
      },
      saveDraft: () => saveRef.current(),
      builtins: [
        {
          ...WORKBENCH_BUILTINS.generate_prompts,
          disabled: () => {
            const st = builtinStateRef.current
            if (!st.projectName) return { disabled: true, reason: '先选择项目' }
            if (st.genning) return { disabled: true, reason: '正在生成提示词' }
            const count = liveRef.current.shots.filter(
              (s) => (Number(s.episode) || 1) === epNo,
            ).length
            if (count === 0) return { disabled: true, reason: '这一集还没有镜头，先去拆镜' }
            if (!hasTextModels(st.settings)) {
              return { disabled: true, reason: '设置页还没有可用的文本模型' }
            }
            return { disabled: false }
          },
          run: (signal) => runPromptsRef.current(signal),
        },
      ],
    }),
    [projectName, epNo],
  )

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

  const scheduleByShot = useMemo(() => {
    const out = new Map<string, ReturnType<typeof resolveShotSchedule>>()
    for (const s of visible) {
      out.set(
        s.id,
        resolveShotSchedule({
          data: shotToData(s, baseShotData(s)),
          shotId: s.id,
          sceneLayouts,
          projectAspect,
        }),
      )
    }
    return out
  }, [visible, sceneLayouts, projectAspect])

  const editorShot = editorShotId ? shots.find((s) => s.id === editorShotId) ?? null : null
  const editorNodes = useMemo(() => {
    // 画布节点提供 refIds/media；项目镜头提供最新 3D 字段。两者按 shotId 合并。
    const canvasShotByProjectId = new Map<string, ShotNodeType>()
    for (const n of canvasNodes) {
      if (n.data.shotId) canvasShotByProjectId.set(n.data.shotId, n)
    }
    const out = canvasNodes.filter(
      (n) => (n as unknown as { type?: string }).type !== 'shot',
    )
    for (const s of visible) out.push(projectShotNode(s, canvasShotByProjectId.get(s.id)))
    return out
  }, [canvasNodes, visible])
  const editorNode = editorShot
    ? editorNodes.find((n) => n.data.shotId === editorShot.id) ?? null
    : null

  const handleEditorDirty = useCallback(
    (dirtyNow: boolean) => {
      onEditorDirtyChange?.(dirtyNow)
    },
    [onEditorDirtyChange],
  )

  const open3D = (shotId: string) => {
    setEditorShotId(shotId)
    handleEditorDirty(false)
  }
  const close3D = () => {
    setEditorShotId(null)
    handleEditorDirty(false)
  }

  /**
   * 3D 保存只写 3D 字段。
   * 先读当前项目再把补丁合进完整镜头列表：mergeShots 会把未出现在入参里的
   * 镜头标成 orphan，只传一条会把其他镜头全标灰；也避免把提示词草稿一起写回。
   */
  const persist3D = useCallback(
    async (shotId: string, patch: Partial<ProjectShot>) => {
      if (!projectName) throw new Error('先选择项目')
      const current = await getProject(projectName)
      const full = (current.shots ?? []).map((s) =>
        s.id === shotId ? ({ ...s, ...patch } as ProjectShot) : s,
      )
      if (!full.some((s) => s.id === shotId)) full.push({ id: shotId, ...patch } as ProjectShot)
      await mergeProjectShots(projectName, full)
      setShots((prev) => prev.map((s) => (s.id === shotId ? { ...s, ...patch } : s)))
    },
    [projectName],
  )

  const saveEditor3D = async (input: CodeEditorSave) => {
    if (!editorShot) return
    await persist3D(editorShot.id, shot3DSavePatch(input))
  }

  const renderEditor3D = async (input: CodeEditorRendered) => {
    if (!editorShot) return
    await persist3D(
      editorShot.id,
      shot3DRenderPatch({ ...input, existingMotionNote: editorShot.motion_note }),
    )
  }

  /** 同上：按 id 定位，行下标只对「当前集」子集有效 */
  const edit = (id: string, field: 'keyframe_prompt' | 'video_prompt', value: string) => {
    setShots((prev) => prev.map((s) => (s.id === id ? { ...s, [field]: value } : s)))
    setDirty(true)
  }

  const retryGroupRef = useRef<(g: ProjectShot[], idx: number, t0: number) => void>(() => {})

  /**
   * 跑一批。只返回补丁，不直接写镜头；
   * 批量生成在全部成功后统一合并，取消时才能整次丢弃。
   */
  const runGroup = useCallback(
    async (g: ProjectShot[], idx: number, t0: number, signal?: AbortSignal) => {
      const tid = startTask('text', `E${epNo} 提示词 批${idx + 1}`, {
        retry: () => retryGroupRef.current(g, idx, t0),
      })
      const bible = characterBible(chars) || '（项目里还没有角色锚点）'
      const brief = g.map(promptBrief)
      try {
        const resolvedStyle = style || '近未来科幻写实'
        const skill = await buildBoardSkillPrompt('prompt', {
          style: resolvedStyle,
          bible,
          briefJson: JSON.stringify(brief),
        })
        const r = await callText<{ shots: { no: string; keyframe_prompt: string; video_prompt: string }[] }>({
          system: skill.system,
          modelKey: stageModelKey(settings, 'prompt', stagePick),
          json: true,
          maxTokens: 4096,
          prompt: skill.task,
          signal,
        })
        assertSkillOutput('prompts-v1', r.json)
        const got = r.json?.shots
        if (!Array.isArray(got) || got.length === 0) throw new Error('空返回')
        if (signal?.aborted) {
          endTask(tid, '已取消')
          return {
            ok: false,
            cancelled: true,
            patch: new Map<string, { kf: string; vp: string }>(),
            filled: 0,
            unresolved: 0,
            total: g.length,
            modelLabel: '',
            error: '已取消',
          }
        }

        const byNo = new Map(g.map((s) => [String(s.no || ''), s.id]))
        const patch = new Map<string, { kf: string; vp: string }>()
        let bad = 0
        for (const x of got) {
          const id = byNo.get(String(x.no))
          if (!id) continue
          const kf = expandAnchors(String(x.keyframe_prompt || '').trim(), chars)
          if (hasUnresolvedAnchor(kf)) bad++
          patch.set(id, { kf, vp: String(x.video_prompt || '').trim() })
        }
        endTask(tid)
        return {
          ok: true,
          patch,
          filled: g.filter((x) => patch.has(x.id)).length,
          unresolved: bad,
          total: g.length,
          modelLabel: r.modelLabel,
        }
      } catch (e) {
        const err = e as Error
        const cancelled = Boolean(signal?.aborted) || err.name === 'AbortError'
        const message = cancelled ? '已取消' : err.message || '生成失败'
        endTask(tid, message)
        return {
          ok: false,
          cancelled,
          patch: new Map<string, { kf: string; vp: string }>(),
          filled: 0,
          unresolved: 0,
          total: g.length,
          modelLabel: '',
          error: message,
        }
      }
    },
    [chars, epNo, settings, stagePick, style],
  )

  const applyPromptPatch = useCallback((patch: Map<string, { kf: string; vp: string }>) => {
    if (patch.size === 0) return
    setShots((prev) =>
      prev.map((x) => {
        const hit = patch.get(x.id)
        return hit ? { ...x, keyframe_prompt: hit.kf, video_prompt: hit.vp } : x
      }),
    )
    setDirty(true)
  }, [])

  /** 单批重试：跑完这一批并立即应用这一批的补丁 */
  const retryGroup = async (g: ProjectShot[], idx: number, t0: number) => {
    const r = await runGroup(g, idx, t0)
    if (!r.ok) {
      toast(r.error || '生成失败')
      return
    }
    applyPromptPatch(r.patch)
    toast(`第 ${idx + 1} 批已补 ${r.filled} 镜`)
  }
  retryGroupRef.current = retryGroup

  const runGeneratePrompts = useCallback(
    async (signal?: AbortSignal): Promise<BuiltinResult> => {
      const label = '生成提示词'
      const action = 'generate_prompts'
      const fail = (message: string, cancelled = false) =>
        builtinFailure(action, message, {
          label,
          scope: 'episode',
          saveMode: 'explicit',
          ...(cancelled ? { cancelled: true } : {}),
        })
      const l = liveRef.current
      const visibleNow = l.shots.filter((s) => (Number(s.episode) || 1) === epNo)
      if (!projectName) return fail('先选择项目')
      if (visibleNow.length === 0) {
        return fail(`E${String(epNo).padStart(2, '0')} 还没有镜头，先去「镜头表」拆镜`)
      }
      if (!hasTextModels(settings)) return fail('设置页还没有可用的文本模型，先加一条再生成提示词')
      if (signal?.aborted) return fail('已取消', true)
      // 分片并行：输出量受镜头数线性影响，切批并发是唯一能真正缩短墙钟时间的手段
      const groups = chunk(visibleNow, Math.max(2, batchSize))
      setGenning(true)
      setProgress({ done: 0, total: groups.length, failed: 0 })
      const t0 = Date.now()
      try {
        let done = 0
        const results = await Promise.all(
          groups.map(async (g, idx) => {
            const r = await runGroup(g, idx, t0, signal)
            done++
            setProgress({ done, total: groups.length, failed: 0 })
            return r
          }),
        )
        if (signal?.aborted || results.some((r) => r.cancelled)) {
          return fail('已取消', true)
        }
        const okResults = results.filter((r) => r.ok)
        const filled = okResults.reduce((a, r) => a + r.filled, 0)
        const unresolved = okResults.reduce((a, r) => a + r.unresolved, 0)
        const failed = groups.length - okResults.length
        setProgress({ done: groups.length, total: groups.length, failed })
        if (okResults.length === 0) {
          return fail(results.find((r) => r.error)?.error || '生成失败')
        }
        const mergedPatch = new Map<string, { kf: string; vp: string }>()
        for (const r of okResults) for (const [id, p] of r.patch) mergedPatch.set(id, p)
        applyPromptPatch(mergedPatch)
        const modelLabel = okResults.find((r) => r.modelLabel)?.modelLabel || ''
        const elapsed = ((Date.now() - t0) / 1000).toFixed(0)
        return {
          ok: true,
          action,
          label,
          scope: 'episode',
          summary:
            `E${String(epNo).padStart(2, '0')} ${filled}/${visibleNow.length} 镜 · ${elapsed}s（${okResults.length}/${groups.length} 批）` +
            (modelLabel ? ` · 模型：${modelLabel}` : '') +
            (failed > 0 ? ` · ${failed} 批失败，可在任务台账里重试` : '') +
            (unresolved > 0 ? ` · ${unresolved} 条占位符未替换，检查角色名` : '') +
            '，草稿未保存',
          counts: {
            filled,
            unresolved,
            failed,
            groups: groups.length,
            total: visibleNow.length,
          },
          ...(modelLabel ? { modelLabel } : {}),
          elapsedMs: Date.now() - t0,
          saveMode: 'explicit',
        }
      } finally {
        setGenning(false)
        window.setTimeout(() => setProgress(null), 2600)
      }
    },
    [applyPromptPatch, batchSize, epNo, projectName, runGroup, settings],
  )
  runPromptsRef.current = runGeneratePrompts

  const generate = async () => {
    const r = await runGeneratePrompts()
    if (!r.ok) {
      if (!r.cancelled) toast(r.error || '生成失败')
      return
    }
    toast(r.summary)
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
  saveRef.current = save

  return (
    <div className="wb-with-chat">
      <main className="wb">
      <WorkbenchBar
        scope={
          <>
            <span className="wb-bar-title">提示词</span>
            <span className="ep-chip">E{String(epNo).padStart(2, '0')}</span>
          </>
        }
        scopeDetail={
          <>
            {visible.length} 镜 · 有提示词 {stat.ok} · 缺锚点{' '}
            <b className={stat.miss ? 'over' : ''}>{stat.miss}</b> · 空白{' '}
            <b className={stat.empty ? 'over' : ''}>{stat.empty}</b>
            {stat.unk > 0 ? ` · ${stat.unk} 镜有未知角色` : ''}
          </>
        }
        settings={
          <>
            <StageModelSelect
              stage="prompt"
              settings={settings}
              pick={stagePick}
              onChange={onPickStage}
              compact
            />
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
            <span className="wb-bar-optional wb-sum">
              角色锚点 {chars.filter((c) => c.lookEn).length} 个可用
            </span>
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
              controlsId="workbench-chat-prompts"
            />
            <button className="btn" onClick={load} disabled={loading}>
              {loading ? '加载中…' : '重新加载'}
            </button>
          </>
        }
      />

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
                <th style={{ width: 92 }}>3D</th>
                <th style={{ width: 96 }}>锚点校验</th>
              </tr>
            </thead>
            <tbody>
              {visible.map((s, i) => {
                const a = audits[i]
                const schedule = scheduleByShot.get(s.id)
                const schedTag =
                  schedule?.status === '生效'
                    ? 'ok'
                    : schedule?.status === '已过期'
                      ? 'bad'
                      : schedule?.status === '仅审阅'
                        ? 'orphan'
                        : 'off'
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
                        onChange={(e) => edit(s.id, 'keyframe_prompt', e.target.value)}
                      />
                    </td>
                    <td>
                      <textarea
                        rows={3}
                        value={s.video_prompt ?? ''}
                        onChange={(e) => edit(s.id, 'video_prompt', e.target.value)}
                      />
                    </td>
                    <td className="state pt-3d">
                      <em className={`tag ${schedTag}`} title={schedule?.reason}>
                        {schedule?.status ?? '未渲染'}
                      </em>
                      <button className="btn-mini" onClick={() => open3D(s.id)}>
                        打开
                      </button>
                      {s.schedule_video && (
                        <a
                          className="btn-mini"
                          href={s.schedule_video}
                          target="_blank"
                          rel="noreferrer"
                        >
                          查看
                        </a>
                      )}
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
        <button
          className="btn"
          onClick={generate}
          disabled={genning || visible.length === 0 || !hasTextModels(settings)}
        >
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

      {editorShot && editorNode && (
        <Suspense
          fallback={<div className="sb-chat-placeholder">正在加载 3D 工作台…</div>}
        >
          <LazySceneCodeWorkbench
            projectName={projectName}
            node={editorNode}
            nodes={editorNodes}
            characters={chars}
            assets={assets}
            sceneLayouts={sceneLayouts}
            projectAspect={projectAspect}
            settings={settings}
            stagePick={stagePick}
            onPickStageModel={onPickStage}
            onClose={close3D}
            onSave={saveEditor3D}
            onRendered={renderEditor3D}
            onDirtyChange={handleEditorDirty}
            toast={toast}
          />
        </Suspense>
      )}

      <WorkbenchChatAside
        surface="prompts"
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
