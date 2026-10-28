import { lazy, Suspense, useCallback, useEffect, useMemo, useRef, useState } from 'react'
import {
  callText,
  generateImage,
  getProject,
  patchProject,
  type AppSettings,
  type DesignKind,
  type DesignSheet,
  type ProjectData,
  type Stage,
} from './api'
import {
  buildDesignContext,
  buildDesignPrompt,
  designRatio,
  mergeDesigns,
  pickExtractedDesigns,
} from './designExtract'
import { CapModelSelect, hasTextModels, StageModelSelect, stageModelKey, type StagePick } from './ModelSelect'
import { ACCEPT_ATTR, uploadImageFile } from './mediaUpload'
import { assertSkillOutput, buildBoardSkillPrompt } from './skills/board'
import {
  builtinFailure,
  type BuiltinResult,
  WORKBENCH_BUILTINS,
  type WorkbenchChatAdapter,
} from './agent/workbenchChat'
import { AgentButton } from './agent/AgentButton'
import StockBrowser from './stock/StockBrowser'
import type { StockImportResult, StockImportTarget, StockItem } from './stock/types'
import { WorkbenchChatAside } from './agent/WorkbenchChatAside'
import { useWorkbenchChatOpen } from './agent/chatPanel'
import WorkbenchBar from './WorkbenchBar'
import { imageCost, money, type Pricing } from './pricing'
import { endTask, startTask } from './tasks'

const LazySkillChat = lazy(() => import('./agent/SkillChat'))

type Props = {
  projectName: string
  epNo: number
  settings: AppSettings | null
  stagePick: StagePick
  onPickStage: (stage: Stage, key: string) => void
  imageModelKey?: string
  onPickImageModel: (key: string) => void
  /** 已在当前项目画布上的设定 id */
  onCanvasDesignIds: Set<string>
  onPush: (designs: DesignSheet[]) => void
  /** 在线素材导入后直接建一张画布素材卡 */
  onAddAssetCard?: (input: { title: string; kind: string; url: string }) => void
  toast: (m: string) => void
  price?: Pricing
  /** 服务端报告的缺失图片引用 */
  missing: Set<string>
  /** <img> 加载失败时补记缺失 */
  onImageMissing: (ref: string) => void
}

const KIND_LABEL: Record<DesignKind, string> = { scene: '场景', prop: '道具' }

/**
 * 素材设定板：先拆场景/关键道具，生成可复用设定图，再按单卡或批量发布到画布。
 * 设定卡存 project.designs；画布上的 asset 卡只是发布后的视图。
 */
export default function AssetBoard({
  projectName,
  epNo,
  settings,
  stagePick,
  onPickStage,
  imageModelKey,
  onPickImageModel,
  onCanvasDesignIds,
  onPush,
  onAddAssetCard,
  toast,
  price,
  missing,
  onImageMissing,
}: Props) {
  const [project, setProject] = useState<ProjectData | null>(null)
  const [designs, setDesigns] = useState<DesignSheet[]>([])
  const [tab, setTab] = useState<DesignKind>('scene')
  const [loading, setLoading] = useState(false)
  const [stockOpen, setStockOpen] = useState(false)
  const [ready, setReady] = useState('')
  const [extracting, setExtracting] = useState<'' | 'episode' | 'script'>('')
  const [running, setRunning] = useState<Record<string, boolean>>({})
  const [errors, setErrors] = useState<Record<string, string>>({})
  const designsRef = useRef(designs)
  const savedSigRef = useRef('')
  const epochRef = useRef(0)
  const [chatRunning, setChatRunning] = useState(false)
  /** 空板起始提示：本次会话关掉就不再出现 */
  const [tipOpen, setTipOpen] = useState(true)
  const { open: chatOpen, setOpen: setChatOpen } = useWorkbenchChatOpen('assets')
  const chatVisible = chatOpen && Boolean(projectName)
  const builtinStateRef = useRef({ extracting, settings, projectName, ready, project })
  builtinStateRef.current = { extracting, settings, projectName, ready, project }
  const runExtractRef = useRef<
    (scope: 'episode' | 'script', signal?: AbortSignal) => Promise<BuiltinResult>
  >(async (scope) =>
    builtinFailure(
      scope === 'episode' ? 'extract_designs_episode' : 'extract_designs_script',
      '拆场景/道具尚未就绪',
      {
        label: scope === 'episode' ? '从本集拆' : '从全剧拆',
        scope,
        saveMode: 'immediate',
      },
    ),
  )

  const chatAdapter = useMemo<WorkbenchChatAdapter>(
    () => ({
      surface: 'assets',
      skillId: 'asset',
      stage: 'asset',
      artifact: 'designs',
      writeTool: 'submit_designs',
      writeContract: 'designs-v1',
      threadKey: { project: projectName, surface: 'assets' },
      scope: () => '本集',
      inputs: () => {
        const p = project
        const { sceneText, shotText } = buildDesignContext({
          scope: 'episode',
          epNo,
          source: p?.source,
          episodes: p?.episodes,
          shots: p?.shots,
        })
        return {
          scopeLabel: `第 ${epNo} 集的剧本场次与分镜`,
          sceneText,
          shotBlock: shotText ? `\n\n【镜头摘要】\n${shotText}` : '',
        }
      },
      ownDraft: () => designsRef.current,
      projectSnapshot: () => getProject(projectName),
      applyDraft: (payload) => {
        const incoming = pickExtractedDesigns(payload)
        if (incoming.length === 0) return { ok: false, summary: '', error: '没有可写入的场景或道具' }
        const { next, added, updated } = mergeDesigns(designsRef.current, incoming)
        designsRef.current = next
        savedSigRef.current = JSON.stringify(next)
        setDesigns(next)
        // 沿用现有语义：素材提取结果立即落库，避免切项目时停在防抖窗口
        patchProject(projectName, { designs: next }).catch(() => {})
        return {
          ok: true,
          summary: `已写入并保存素材：新增 ${added.length} / 合并 ${updated.length}`,
          counts: { total: next.length, added: added.length, updated: updated.length },
        }
      },
      builtins: [
        {
          ...WORKBENCH_BUILTINS.extract_designs_episode,
          disabled: () => {
            const st = builtinStateRef.current
            if (!st.projectName || st.ready !== st.projectName || !st.project) {
              return { disabled: true, reason: '先选择项目' }
            }
            if (st.extracting) return { disabled: true, reason: '正在拆场景/道具' }
            if (!hasTextModels(st.settings)) {
              return { disabled: true, reason: '设置页还没有可用的文本模型' }
            }
            return { disabled: false }
          },
          run: (signal) => runExtractRef.current('episode', signal),
        },
        {
          ...WORKBENCH_BUILTINS.extract_designs_script,
          disabled: () => {
            const st = builtinStateRef.current
            if (!st.projectName || st.ready !== st.projectName || !st.project) {
              return { disabled: true, reason: '先选择项目' }
            }
            if (st.extracting) return { disabled: true, reason: '正在拆场景/道具' }
            if (!hasTextModels(st.settings)) {
              return { disabled: true, reason: '设置页还没有可用的文本模型' }
            }
            return { disabled: false }
          },
          run: (signal) => runExtractRef.current('script', signal),
        },
      ],
    }),
    [projectName, epNo, project],
  )

  useEffect(() => {
    designsRef.current = designs
  }, [designs])

  useEffect(() => {
    const epoch = ++epochRef.current
    let alive = true
    setReady('')
    setProject(null)
    setDesigns([])
    setErrors({})
    if (!projectName) {
      setLoading(false)
      return () => {
        alive = false
      }
    }
    setLoading(true)
    getProject(projectName)
      .then((p) => {
        if (!alive || epoch !== epochRef.current) return
        const ds = (p.designs ?? []) as DesignSheet[]
        setProject(p)
        setDesigns(ds)
        savedSigRef.current = JSON.stringify(ds)
        setReady(projectName)
        setLoading(false)
      })
      .catch((e) => {
        if (!alive || epoch !== epochRef.current) return
        setLoading(false)
        setReady('')
        toast((e as Error).message || '读取素材设定失败')
      })
    return () => {
      alive = false
    }
    // 项目切换才重载；toast 是 App 的短提示函数，不参与依赖
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [projectName])

  // 编辑防抖回写；提取/生成会通过 savedSigRef 避免首屏空写
  useEffect(() => {
    if (!projectName || ready !== projectName) return
    const sig = JSON.stringify(designs)
    if (sig === savedSigRef.current) return
    const t = window.setTimeout(() => {
      savedSigRef.current = sig
      patchProject(projectName, { designs }).catch((e) => {
        toast((e as Error).message || '保存素材设定失败')
      })
    }, 900)
    return () => window.clearTimeout(t)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [designs, projectName, ready])

  const updateDesign = useCallback((id: string, p: Partial<DesignSheet>) => {
    setDesigns((ds) => ds.map((d) => (d.id === id ? { ...d, ...p } : d)))
  }, [])

  /** 手工新建一张设定卡：只有名称与类型，其余为空，与拆解得到的卡完全等价 */
  const addDesign = useCallback(
    (kind: DesignKind) => {
      const base = KIND_LABEL[kind]
      let i = 1
      const names = new Set(designsRef.current.map((d) => d.name))
      while (names.has(`新${base}${i}`)) i += 1
      const name = `新${base}${i}`
      const sheet: DesignSheet = {
        id: `design-manual-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
        kind,
        name,
        refs: [],
        summaryCn: '',
        promptEn: '',
        keywords: [],
      }
      const dupName = designsRef.current.find(
        (d) => d.kind === kind && d.name.trim().toLowerCase() === name.trim().toLowerCase(),
      )
      if (dupName) toast(`已存在同名${base}卡，后续拆解会合并到同一张`)
      const next = [...designsRef.current, sheet]
      designsRef.current = next
      setDesigns(next)
      setTab(kind)
      toast(`已新建${base}卡：补英文锚点或上传图片后即可使用`)
    },
    [toast],
  )

  const removeDesign = useCallback(
    (d: DesignSheet) => {
      if (!window.confirm(`删除${KIND_LABEL[d.kind]}「${d.name}」？画布上已发布的素材卡不会自动删除。`)) return
      setDesigns((ds) => ds.filter((x) => x.id !== d.id))
    },
    [],
  )

  const runExtract = useCallback(
    async (scope: 'episode' | 'script', signal?: AbortSignal): Promise<BuiltinResult> => {
      const label = scope === 'episode' ? '从本集拆' : '从全剧拆'
      const action = scope === 'episode' ? 'extract_designs_episode' : 'extract_designs_script'
      const fail = (message: string, cancelled = false) =>
        builtinFailure(action, message, {
          label,
          scope,
          saveMode: 'immediate',
          ...(cancelled ? { cancelled: true } : {}),
        })
      if (extracting) return fail('正在拆场景/道具，请稍候')
      if (!projectName || ready !== projectName || !project) return fail('先选择项目，再拆场景/道具')
      if (!hasTextModels(settings)) return fail('设置页还没有可用的文本模型')
      const { sceneText, shotText } = buildDesignContext({
        scope,
        epNo,
        source: project.source,
        episodes: project.episodes,
        shots: project.shots,
      })
      if (!sceneText.trim() && !shotText.trim()) {
        return fail(
          scope === 'episode'
            ? `第 ${epNo} 集还没有可拆的场次/镜头`
            : '当前项目没有剧本素材（source / 分集 / 镜头都为空）',
        )
      }
      if (signal?.aborted) return fail('已取消', true)
      setExtracting(scope)
      const t0 = Date.now()
      try {
        const scopeLabel =
          scope === 'episode' ? `第 ${epNo} 集的剧本场次与分镜` : '全剧的原著梗概、分集场次与分镜'
        const shotBlock = shotText ? `\n\n【镜头摘要】\n${shotText}` : ''
        const skill = await buildBoardSkillPrompt('asset', { scopeLabel, sceneText, shotBlock })
        const r = await callText<{ scenes?: unknown[]; props?: unknown[] }>({
          system: skill.system,
          modelKey: stageModelKey(settings, 'asset', stagePick),
          json: true,
          maxTokens: 6000,
          prompt: skill.task,
          signal,
        })
        assertSkillOutput('designs-v1', r.json)
        const incoming = pickExtractedDesigns(r.json)
        if (incoming.length === 0) throw new Error('模型没给出场景或道具，换个范围再试')
        if (signal?.aborted) return fail('已取消', true)
        const { next, added, updated } = mergeDesigns(designsRef.current, incoming)
        setDesigns(next)
        let saved = true
        try {
          await patchProject(projectName, { designs: next })
          savedSigRef.current = JSON.stringify(next)
        } catch {
          saved = false
        }
        const secs = Math.round((Date.now() - t0) / 1000)
        return {
          ok: true,
          action,
          label,
          scope,
          summary:
            `拆出 ${incoming.length} 个素材 · ${secs}s｜新增 ${added.length}` +
            (updated.length ? ` · 合并 ${updated.length}` : '') +
            (r.modelLabel ? ` · 模型：${r.modelLabel}` : '') +
            (saved ? ' · 已保存到项目' : ' · 已写入本地草稿，但落库失败'),
          counts: { total: next.length, added: added.length, updated: updated.length },
          ...(r.modelLabel ? { modelLabel: r.modelLabel } : {}),
          elapsedMs: Date.now() - t0,
          saveMode: 'immediate',
        }
      } catch (e) {
        const err = e as Error
        const cancelled = Boolean(signal?.aborted) || err.name === 'AbortError'
        return fail(cancelled ? '已取消' : err.message || '拆场景/道具失败', cancelled)
      } finally {
        setExtracting('')
      }
    },
    [epNo, extracting, project, projectName, ready, settings, stagePick],
  )
  runExtractRef.current = runExtract

  const extract = async (scope: 'episode' | 'script') => {
    const r = await runExtract(scope)
    if (!r.ok) {
      if (!r.cancelled) toast(r.error || '拆场景/道具失败')
      return
    }
    toast(r.summary)
  }

  const generate = async (d: DesignSheet) => {
    if (!d.promptEn.trim()) {
      setErrors((x) => ({ ...x, [d.id]: '先补英文锚点（promptEn）再生成' }))
      return
    }
    const imageModels = (settings?.models ?? []).filter((m) => m.cap === 'image')
    if (imageModels.length === 0) {
      setErrors((x) => ({ ...x, [d.id]: '设置页还没有可用的图像模型' }))
      return
    }
    setErrors((x) => {
      const next = { ...x }
      delete next[d.id]
      return next
    })
    if (!projectName) {
      setErrors((x) => ({ ...x, [d.id]: '先选择项目再生成设定图' }))
      return
    }
    setRunning((x) => ({ ...x, [d.id]: true }))
    const tid = startTask('image', `设定图 ${d.name}`, {
      cost: price ? imageCost(price, 2) : undefined,
    })
    try {
      const res = await generateImage({
        prompt: buildDesignPrompt(d, project?.style),
        ratio: designRatio(d.kind),
        n: 2,
        cap: 'image',
        modelKey: imageModelKey,
        project: projectName,
      })
      const urls = res.urls?.length ? res.urls : [res.url]
      const next = designsRef.current.map((x) =>
        x.id === d.id ? { ...x, candidates: urls, activeIdx: 0, image: urls[0] } : x,
      )
      designsRef.current = next
      setDesigns(next)
      // 立即落库：生成后马上刷新也不会丢；失败时保留防抖重试
      const sig = JSON.stringify(next)
      patchProject(projectName, { designs: next })
        .then(() => {
          savedSigRef.current = sig
        })
        .catch((e) => toast((e as Error).message || '保存设定图失败'))
      endTask(tid)
    } catch (e) {
      const msg = (e as Error).message || '生成设定图失败'
      setErrors((x) => ({ ...x, [d.id]: msg }))
      endTask(tid, msg)
    } finally {
      setRunning((x) => {
        const next = { ...x }
        delete next[d.id]
        return next
      })
    }
  }

  const chooseCandidate = (d: DesignSheet, idx: number) => {
    const url = d.candidates?.[idx]
    if (url) updateDesign(d.id, { activeIdx: idx, image: url })
  }

  /**
   * 上传设定图：立即成为当前图，并入候选列表。
   * 不依赖英文锚点 —— 手上已经有参考图的人不该被迫先生成一张。
   * 只有保存成功才写状态；失败时卡片保持原样，不留空图占位。
   */
  const uploadDesignImage = async (d: DesignSheet, file: File) => {
    if (!projectName) {
      setErrors((x) => ({ ...x, [d.id]: '先选择项目再上传图片' }))
      return
    }
    setErrors((x) => {
      const next = { ...x }
      delete next[d.id]
      return next
    })
    try {
      const url = await uploadImageFile(file, { project: projectName, prefix: `design-${d.kind}` })
      const prev = designsRef.current.find((x) => x.id === d.id)
      if (!prev) return
      // 生成图仍留在候选里可切回；上传图并入末尾并成为当前图
      const candidates = [...new Set([...(prev.candidates ?? []), url])]
      const next = designsRef.current.map((x) =>
        x.id === d.id ? { ...x, candidates, activeIdx: candidates.indexOf(url), image: url } : x,
      )
      designsRef.current = next
      setDesigns(next)
      const sig = JSON.stringify(next)
      patchProject(projectName, { designs: next })
        .then(() => {
          savedSigRef.current = sig
        })
        .catch((e) => {
          setErrors((x) => ({ ...x, [d.id]: (e as Error).message || '保存设定图失败' }))
        })
      toast(`已上传${KIND_LABEL[d.kind]}图：${d.name}`)
    } catch (e) {
      setErrors((x) => ({ ...x, [d.id]: (e as Error).message || '上传失败' }))
    }
  }

  const pushOne = (d: DesignSheet) => {
    if (!d.image) {
      toast('先生成或上传这张设定图，再加入画布')
      return
    }
    if (missing.has(d.image)) {
      toast('这张设定图的文件缺失，请先重新生成')
      return
    }
    onPush([d])
  }

  const pushAll = () => {
    if (designs.length === 0) {
      toast('还没有场景/道具设定，先拆解')
      return
    }
    // 无图/缺图的卡片交给 App 统一跳过并报告，保留「跳过 N 张」的计数
    onPush(designs)
  }

  /**
   * 在线素材导入落点：
   * - 素材卡：直接建卡（视频/音频只能走这里）
   * - 场景/道具：建一张没有英文锚点的设定卡，提示补锚点后再生成设定图
   */
  const onStockImported = (result: StockImportResult, item: StockItem, target: StockImportTarget) => {
    const mediaKind = item.mediaType === 'audio' ? 'audio' : item.mediaType === 'video' ? 'video' : 'image'
    if (target === 'scene' || target === 'prop') {
      if (item.mediaType !== 'image') {
        onAddAssetCard?.({ title: item.title, kind: mediaKind, url: result.url })
        return
      }
      const id = `design-stock-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`
      const sheet: DesignSheet = {
        id,
        kind: target === 'scene' ? 'scene' : 'prop',
        name: item.title || '在线素材',
        refs: [],
        summaryCn: item.author ? `来自 ${item.provider} · ${item.author}` : `来自 ${item.provider}`,
        promptEn: '',
        keywords: [],
        image: result.url,
        candidates: [result.url],
        activeIdx: 0,
      }
      const next = [...designsRef.current, sheet]
      designsRef.current = next
      setDesigns(next)
      patchProject(projectName, { designs: next }).catch(() => {})
      setTab(sheet.kind)
      toast('已作为设定卡导入，补英文锚点后即可生成设定图')
      return
    }
    onAddAssetCard?.({ title: item.title, kind: mediaKind, url: result.url })
  }

  const shown = useMemo(() => designs.filter((d) => d.kind === tab), [designs, tab])
  const sceneCount = designs.filter((d) => d.kind === 'scene').length
  const propCount = designs.filter((d) => d.kind === 'prop').length
  const withImage = designs.filter((d) => d.image && !missing.has(d.image)).length
  const canPush = Boolean(projectName && ready === projectName && withImage > 0)

  return (
    <div className="board-with-chat">
      <div className="board">
      <WorkbenchBar
        scope={<span className="wb-bar-title">素材</span>}
        scopeDetail={
          <span className="board-hint">
            {projectName
              ? `E${String(epNo).padStart(2, '0')} · 场景 ${sceneCount} · 道具 ${propCount}`
              : '先选择项目'}
          </span>
        }
        settings={
          <>
            <StageModelSelect
              stage="asset"
              label="拆素材模型"
              settings={settings}
              pick={stagePick}
              onChange={onPickStage}
              compact
            />
            <CapModelSelect
              cap="image"
              label="设定图模型"
              settings={settings}
              value={imageModelKey}
              onChange={onPickImageModel}
              className="wb-field"
            />
            <span className="board-hint wb-bar-optional">默认 2 张候选</span>
          </>
        }
        actions={
          <>
            <AgentButton
              open={chatVisible}
              onToggle={() => setChatOpen((v) => !v)}
              disabled={!projectName}
              running={chatRunning}
              controlsId="workbench-chat-assets"
            />
            <button
              className="btn-ghost"
              disabled={!projectName || ready !== projectName || !!extracting}
              onClick={() => void extract('script')}
              title="用当前项目的原著、分集场次和全部分镜拆场景/道具"
            >
              {extracting === 'script' ? '拆解中…' : '从全剧拆'}
            </button>
            <button
              className="btn-ghost"
              disabled={!projectName || ready !== projectName}
              onClick={() => setStockOpen(true)}
              title="检索公开图库，把图片 / 视频 / 音频下载进项目"
            >
              在线素材库
            </button>
            <button
              className="btn-ghost"
              disabled={!projectName || ready !== projectName}
              onClick={() => addDesign('scene')}
              title="手工新建一张场景卡（不依赖拆解）"
              data-add-design="scene"
            >
              + 场景卡
            </button>
            <button
              className="btn-ghost"
              disabled={!projectName || ready !== projectName}
              onClick={() => addDesign('prop')}
              title="手工新建一张道具卡（不依赖拆解）"
              data-add-design="prop"
            >
              + 道具卡
            </button>
            <button
              className={withImage === 0 ? 'btn primary' : 'btn-ghost'}
              disabled={!projectName || ready !== projectName || !!extracting}
              onClick={() => void extract('episode')}
              title="用当前集的剧本场次和全部分镜拆场景/道具"
            >
              {extracting === 'episode' ? '拆解中…' : '从本集拆'}
            </button>
            <button
              className={canPush ? 'btn primary' : 'btn'}
              disabled={!canPush}
              onClick={pushAll}
              title="把所有有图的场景/道具加入画布"
            >
              全部加入画布
            </button>
          </>
        }
      />

      <div className="asset-tabs">
        <button className={tab === 'scene' ? 'on' : ''} onClick={() => setTab('scene')}>
          场景 <span>{sceneCount}</span>
        </button>
        <button className={tab === 'prop' ? 'on' : ''} onClick={() => setTab('prop')}>
          道具 <span>{propCount}</span>
        </button>
        <span className="asset-tabs-hint">{withImage} 张有图 · {designs.filter((d) => onCanvasDesignIds.has(d.id)).length} 张已在画布</span>
      </div>

      <div className="char-grid">
        {loading ? (
          <div className="char-empty-board">正在读取素材设定…</div>
        ) : !projectName ? (
          <div className="char-empty-board">先在顶栏选择项目，再拆场景/道具。</div>
        ) : shown.length === 0 ? (
          <div className="char-empty-board">
            {tipOpen ? (
              <>
                <span>
                  还没有{KIND_LABEL[tab]}设定。场景图只放空镜、道具图不带手和人物，避免参考图污染镜头。
                </span>
                <button className="btn-mini ghost" onClick={() => setTipOpen(false)}>
                  知道了
                </button>
              </>
            ) : (
              `还没有${KIND_LABEL[tab]}设定，点右上角「从本集拆」或「从全剧拆」开始。`
            )}
          </div>
        ) : (
          shown.map((d) => (
            <DesignCard
              key={d.id}
              d={d}
              projectStyle={project?.style}
              running={Boolean(running[d.id])}
              error={errors[d.id]}
              onCanvas={onCanvasDesignIds.has(d.id)}
              price={price}
              onUpdate={updateDesign}
              onDelete={() => removeDesign(d)}
              onGenerate={() => void generate(d)}
              onUpload={(file) => void uploadDesignImage(d, file)}
              onChoose={(idx) => chooseCandidate(d, idx)}
              onPush={() => pushOne(d)}
              missing={missing}
              onImageMissing={onImageMissing}
            />
          ))
        )}
      </div>
      </div>
      {stockOpen && (
        <div className="mp-backdrop" onMouseDown={(e) => e.target === e.currentTarget && setStockOpen(false)}>
          <div className="mp-dialog stock-dialog" role="dialog" aria-modal="true" aria-label="在线素材库">
            <header className="mp-head">
              <div>
                <b>在线素材库</b>
                <span>检索公开图库，下载到当前项目</span>
              </div>
              <button type="button" className="mp-close" aria-label="关闭" onClick={() => setStockOpen(false)}>
                ×
              </button>
            </header>
            <div className="mp-stock-body">
              <StockBrowser
                projectName={projectName}
                mode="library"
                onImported={onStockImported}
                toast={toast}
              />
            </div>
          </div>
        </div>
      )}
      <WorkbenchChatAside
        surface="assets"
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
            />
          </Suspense>
        ) : (
          <div className="sb-chat-placeholder">先选择项目，再打开聊天。</div>
        )}
      </WorkbenchChatAside>
    </div>
  )
}

function DesignCard({
  d,
  projectStyle,
  running,
  error,
  onCanvas,
  price,
  onUpdate,
  onDelete,
  onGenerate,
  onUpload,
  onChoose,
  onPush,
  missing,
  onImageMissing,
}: {
  d: DesignSheet
  projectStyle?: string
  running: boolean
  error?: string
  onCanvas: boolean
  price?: Pricing
  onUpdate: (id: string, p: Partial<DesignSheet>) => void
  onDelete: () => void
  onGenerate: () => void
  onUpload: (file: File) => void
  onChoose: (idx: number) => void
  onPush: () => void
  missing: Set<string>
  onImageMissing: (ref: string) => void
}) {
  const [editing, setEditing] = useState(false)
  const [kw, setKw] = useState(d.keywords.join('、'))
  const uploadRef = useRef<HTMLInputElement | null>(null)

  useEffect(() => {
    if (!editing) setKw(d.keywords.join('、'))
  }, [d.keywords, editing])

  const toggleEdit = () => {
    if (!editing) setKw(d.keywords.join('、'))
    setEditing((v) => !v)
  }

  const candidates = d.candidates ?? []
  const imageMissing = Boolean(d.image && missing.has(d.image))

  return (
    <div className={`char-card design-card ${editing ? 'editing' : ''}`}>
      <div className="char-head">
        <span className="char-name">{d.name}</span>
        <span className="char-role">
          {KIND_LABEL[d.kind]}
          {onCanvas ? ' · 已在画布' : ''}
        </span>
        <span className="char-head-acts">
          <button className="btn-mini" onClick={toggleEdit}>
            {editing ? '收起' : '编辑'}
          </button>
          <button className="btn-mini danger" onClick={onDelete} title="只删除设定，不删除画布上已发布的素材卡">
            删除
          </button>
        </span>
      </div>

      {editing && (
        <div className="char-edit">
          <label className="wide">
            <span>名称</span>
            <input value={d.name} onChange={(e) => onUpdate(d.id, { name: e.target.value })} />
          </label>
          <label className="wide">
            <span>中文摘要</span>
            <textarea
              rows={2}
              value={d.summaryCn}
              onChange={(e) => onUpdate(d.id, { summaryCn: e.target.value })}
            />
          </label>
          <label className="wide">
            <span>英文锚点（生图复用）</span>
            <textarea
              rows={4}
              value={d.promptEn}
              onChange={(e) => onUpdate(d.id, { promptEn: e.target.value })}
            />
          </label>
          <label className="wide">
            <span>关键词（顿号/逗号分隔）</span>
            <input
              value={kw}
              onChange={(e) => {
                setKw(e.target.value)
                onUpdate(d.id, {
                  keywords: e.target.value
                    .split(/[、,，]/)
                    .map((s) => s.trim())
                    .filter(Boolean),
                })
              }}
            />
          </label>
        </div>
      )}

      <div className={`char-sheet design-sheet ${d.kind}`}>
        {imageMissing ? (
          <div className="char-empty char-missing">
            <span>图片文件缺失</span>
            <span className="char-empty-sub">文件已不在项目媒体目录，请重新生成</span>
          </div>
        ) : d.image ? (
          <img src={d.image} alt={d.name} onError={() => d.image && onImageMissing(d.image)} />
        ) : (
          <div className="char-empty">
            <span>还没有设定图</span>
            <span className="char-empty-sub">点下方「生成设定图」</span>
          </div>
        )}
        {running && (
          <div className="gen-overlay">
            <span className="spinner" />
            生成中
          </div>
        )}
        {candidates.length > 1 && (
          <div className="cand-bar">
            {candidates.map((u, i) => (
              <button
                key={u}
                className={`cand-dot ${i === (d.activeIdx ?? 0) ? 'on' : ''}`}
                onClick={() => onChoose(i)}
                title={`候选 ${i + 1}`}
              />
            ))}
          </div>
        )}
      </div>

      <div className="char-look">
        <span className="char-label">关联镜号</span>
        <p>{d.refs.length ? d.refs.join('、') : '（未标注）'}</p>
        <span className="char-label">中文摘要</span>
        <p>{d.summaryCn || '（未填）'}</p>
        <span className="char-label">英文锚点</span>
        <code className="char-en">{d.promptEn || '（未填，生成设定图前必须补）'}</code>
        {projectStyle && <span className="char-label">项目画风锁：{projectStyle}</span>}
      </div>

      <div className="char-tags">
        {d.keywords.map((k) => (
          <span key={k} className="char-tag">
            {k}
          </span>
        ))}
      </div>

      {error && <div className="gen-error">{error}</div>}

      <div className="char-actions">
        <button className="btn" disabled={running} onClick={onGenerate}>
          {d.image ? '重出设定图' : '生成设定图'}
          {price ? ` · ¥${money(imageCost(price, 2))}` : ''}
        </button>
        <button
          className="btn-ghost"
          disabled={running}
          onClick={() => uploadRef.current?.click()}
          title="上传本地图片作为当前设定图；不需要先填英文锚点"
        >
          上传设定图
        </button>
        <button className="btn-ghost" disabled={!d.image || imageMissing} onClick={onPush}>
          {onCanvas ? '更新画布' : '加入画布'}
        </button>
      </div>
      <input
        ref={uploadRef}
        type="file"
        accept={ACCEPT_ATTR}
        hidden
        onChange={(e) => {
          const file = e.target.files?.[0]
          if (file) onUpload(file)
          e.target.value = ''
        }}
      />
    </div>
  )
}
