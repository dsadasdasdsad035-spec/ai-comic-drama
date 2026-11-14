import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import {
  generateImage,
  getProject,
  patchProject,
  type AppSettings,
  type DesignKind,
  type DesignSheet,
  type ProjectAsset,
  type ProjectData,
  type Stage,
} from './api'
import { buildDesignPrompt, designRatio } from './designExtract'
import { CapModelSelect, StageModelSelect, type StagePick } from './ModelSelect'
import { CharacterImageCropModal } from './CharacterImageCropModal'
import type { MaterialCropPlan } from './imageMaterialCrop'
import {
  materialUploadGateFromFile,
  materialUploadGateFromUrl,
  releaseMaterialCropPlan,
} from './materialImageGate'
import { ACCEPT_ATTR, uploadImageFile } from './mediaUpload'
import CameraLexiconBrowser from './CameraLexiconBrowser'
import LexiconWhiteboxStudio from './LexiconWhiteboxStudio'
import { getCameraLexiconCatalog } from './cameraLexicon'
import { listLexiconWhitebox, type LexiconWhiteboxSheet } from './lexiconWhitebox'
import OnlineStockList from './stock/OnlineStockList'
import type { StockImportResult, StockImportTarget, StockItem } from './stock/types'
import AssetVideoBoard from './AssetVideoBoard'
import WorkbenchBar from './WorkbenchBar'
import { assetMediaType } from './mediaPick'
import type { AssetKind } from './data'
import { imageCost, money, type Pricing } from './pricing'
import { endTask, startTask } from './tasks'
import { BoardListToolbar } from './BoardListToolbar'
import { BOARD_LIST_PAGE_SIZE, designListMatch, useBoardListFilter } from './boardListFilter'
import CharacterBoard, { type CharacterBoardProps } from './CharacterBoard'
import { MATERIAL_TAB_CHARACTER_KEY } from './shell/route'

type MaterialTab = DesignKind | 'video' | 'character'

function readInitialMaterialTab(): MaterialTab {
  try {
    if (sessionStorage.getItem(MATERIAL_TAB_CHARACTER_KEY) === 'character') {
      sessionStorage.removeItem(MATERIAL_TAB_CHARACTER_KEY)
      return 'character'
    }
  } catch {
    /* 忽略 */
  }
  return 'character'
}

type Props = {
  projectName: string
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
  /** 镜头语言「自定义白模」工作台需要的项目画幅与未保存回调 */
  projectAspect: string
  onEditorDirtyChange?: (dirty: boolean) => void
  /** 侧栏「素材」徽标：设定卡条数 */
  onDesignCountChange?: (count: number) => void
} & Omit<
  CharacterBoardProps,
  'embedded' | 'settings' | 'stagePick' | 'onPickStage' | 'projectName' | 'price' | 'toast' | 'missing' | 'onImageMissing'
>

const KIND_LABEL: Record<DesignKind, string> = { scene: '场景', prop: '道具' }

/**
 * 素材设定板：先拆场景/关键道具，生成可复用设定图，再按单卡或批量发布到画布。
 * 设定卡存 project.designs；画布上的 asset 卡只是发布后的视图。
 */
export default function AssetBoard({
  projectName,
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
  projectAspect,
  onEditorDirtyChange,
  onDesignCountChange,
  ...characterProps
}: Props) {
  const [project, setProject] = useState<ProjectData | null>(null)
  const [designs, setDesigns] = useState<DesignSheet[]>([])
  const [tab, setTab] = useState<MaterialTab>(readInitialMaterialTab)
  const { characters } = characterProps
  const [lexiconOpen, setLexiconOpen] = useState(false)
  const [lexiconView, setLexiconView] = useState<'preset' | 'custom'>('preset')
  const [whiteboxSheets, setWhiteboxSheets] = useState<LexiconWhiteboxSheet[]>([])
  const [loading, setLoading] = useState(false)
  const [stockOpen, setStockOpen] = useState(false)
  const [videoAddOpen, setVideoAddOpen] = useState(false)

  useEffect(() => {
    if (tab !== 'video') setVideoAddOpen(false)
  }, [tab])
  const [ready, setReady] = useState('')
  const [running, setRunning] = useState<Record<string, boolean>>({})
  const [errors, setErrors] = useState<Record<string, string>>({})
  const [cropPending, setCropPending] = useState<{
    designId: string
    plan: MaterialCropPlan
    pendingUrls?: string[]
    candIdx?: number
  } | null>(null)
  const [cropBusy, setCropBusy] = useState(false)
  const designsRef = useRef(designs)
  const savedSigRef = useRef('')
  const epochRef = useRef(0)
  /** 空板起始提示：本次会话关掉就不再出现 */
  const [tipOpen, setTipOpen] = useState(true)
  useEffect(() => {
    designsRef.current = designs
  }, [designs])

  useEffect(() => {
    if (ready === projectName) onDesignCountChange?.(designs.length)
  }, [designs.length, ready, projectName, onDesignCountChange])

  useEffect(() => {
    const epoch = ++epochRef.current
    let alive = true
    setReady('')
    setProject(null)
    setDesigns([])
    setWhiteboxSheets([])
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
        setWhiteboxSheets(listLexiconWhitebox(p))
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
    const epochAtSchedule = epochRef.current
    const projectAtSchedule = projectName
    const t = window.setTimeout(() => {
      if (epochRef.current !== epochAtSchedule || projectName !== projectAtSchedule) return
      savedSigRef.current = sig
      patchProject(projectAtSchedule, { designs }).catch((e) => {
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
      const gate = await materialUploadGateFromUrl(urls[0], 'design-gen')
      if (gate.mode === 'crop') {
        setCropPending({ designId: d.id, plan: gate.plan, pendingUrls: urls })
        endTask(tid)
        return
      }
      const next = designsRef.current.map((x) =>
        x.id === d.id ? { ...x, candidates: urls, activeIdx: 0, image: urls[0] } : x,
      )
      designsRef.current = next
      setDesigns(next)
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

  const chooseCandidate = async (d: DesignSheet, idx: number) => {
    const url = d.candidates?.[idx]
    if (!url) return
    const gate = await materialUploadGateFromUrl(url, 'design-cand')
    if (gate.mode === 'crop') {
      setCropPending({ designId: d.id, plan: gate.plan, candIdx: idx })
      return
    }
    updateDesign(d.id, { activeIdx: idx, image: url })
  }

  /**
   * 上传设定图：立即成为当前图，并入候选列表。
   * 不依赖英文锚点 —— 手上已经有参考图的人不该被迫先生成一张。
   * 只有保存成功才写状态；失败时卡片保持原样，不留空图占位。
   */
  const finishDesignUpload = async (d: DesignSheet, file: File) => {
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

  const uploadDesignImage = async (d: DesignSheet, file: File) => {
    const gate = await materialUploadGateFromFile(file)
    if (!gate.ok) {
      setErrors((x) => ({ ...x, [d.id]: gate.reason }))
      return
    }
    if (gate.mode === 'crop') {
      setCropPending({ designId: d.id, plan: gate.plan })
      return
    }
    await finishDesignUpload(d, gate.file)
  }

  const persistDesignImageUrl = (designId: string, url: string, candidates: string[], activeIdx: number) => {
    const next = designsRef.current.map((x) =>
      x.id === designId ? { ...x, candidates, activeIdx, image: url } : x,
    )
    designsRef.current = next
    setDesigns(next)
    const sig = JSON.stringify(next)
    patchProject(projectName, { designs: next })
      .then(() => {
        savedSigRef.current = sig
      })
      .catch((e) => toast((e as Error).message || '保存设定图失败'))
  }

  const confirmDesignCrop = async () => {
    if (!cropPending || !projectName) return
    const { designId, plan, pendingUrls, candIdx } = cropPending
    const d = designsRef.current.find((x) => x.id === designId)
    if (!d) return
    setCropBusy(true)
    try {
      const file = plan.croppedFile
      const url = await uploadImageFile(file, { project: projectName, prefix: `design-${d.kind}` })
      if (pendingUrls) {
        persistDesignImageUrl(designId, url, [url, ...pendingUrls.slice(1)], 0)
        toast(`已裁切并保存${KIND_LABEL[d.kind]}图：${d.name}`)
      } else if (candIdx !== undefined) {
        const prev = [...(d.candidates ?? [])]
        if (candIdx >= 0 && candIdx < prev.length) prev[candIdx] = url
        persistDesignImageUrl(designId, url, prev, candIdx)
      } else {
        await finishDesignUpload(d, file)
      }
      releaseMaterialCropPlan(plan)
      setCropPending(null)
    } catch (e) {
      setErrors((x) => ({ ...x, [designId]: (e as Error).message || '裁切上传失败' }))
    } finally {
      setCropBusy(false)
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

  const videoCount = useMemo(
    () =>
      (project?.assets || []).filter(
        (a) => assetMediaType(String(a.kind) as AssetKind, a.url) === 'video',
      ).length,
    [project?.assets],
  )
  const shown = useMemo(
    () => (tab === 'video' || tab === 'character' ? [] : designs.filter((d) => d.kind === tab)),
    [designs, tab],
  )
  const designList = useBoardListFilter(
    shown,
    designListMatch,
    BOARD_LIST_PAGE_SIZE,
    tab === 'character' || tab === 'video' ? 'scene' : tab,
  )
  const sceneCount = designs.filter((d) => d.kind === 'scene').length
  const propCount = designs.filter((d) => d.kind === 'prop').length
  const withImage = designs.filter((d) => d.image && !missing.has(d.image)).length
  const canPush = Boolean(projectName && ready === projectName && withImage > 0)

  return (
    <div className="board">
      <WorkbenchBar
        scope={<span className="wb-bar-title">素材</span>}
        scopeDetail={
          <span className="board-hint">
            {lexiconOpen
              ? projectName
                ? lexiconView === 'preset'
                  ? `镜头语言 · ${getCameraLexiconCatalog().count} 段预置运镜（非场景/道具设定）`
                  : `镜头语言 · 自定义白模 ${whiteboxSheets.length} 条`
                : '镜头语言 · 先选择项目再导入'
              : tab === 'character'
                ? (
                    <>
                      项目级 · {characters.length} 个角色 ·{' '}
                      {characterProps.selectedShot
                        ? `当前镜头 ${characterProps.selectedShot.no}`
                        : '未选镜头（到画布选镜后可注入）'}
                    </>
                  )
              : tab === 'video'
                ? projectName
                  ? `视频库 ${videoCount} 条`
                  : '视频 · 先选择项目'
              : projectName
                ? `场景 ${sceneCount} · 道具 ${propCount} · 项目级设定`
                : '先选择项目'}
          </span>
        }
        settings={
          lexiconOpen || tab === 'video' ? null : tab === 'character' ? (
            <>
              <StageModelSelect
                stage={'character' as Stage}
                label="拆角色模型"
                settings={settings}
                pick={stagePick}
                onChange={onPickStage}
                compact
              />
              <CapModelSelect
                cap="view"
                label="三视图模型"
                settings={settings}
                value={characterProps.viewModel}
                onChange={characterProps.onPickViewModel}
                className="wb-field"
              />
            </>
          ) : (
          <>
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
          )
        }
        actions={
          lexiconOpen ? (
            <button
              type="button"
              className="btn-ghost"
              onClick={() => setLexiconOpen(false)}
            >
              返回素材分类
            </button>
          ) : tab === 'character' ? (
            <>
              <button
                className={characters.length === 0 ? 'btn primary' : 'btn'}
                onClick={characterProps.onAdd}
                title="新建一张角色卡"
              >
                + 新建角色
              </button>
              {characters.length > 0 ? (
                <button
                  className={characterProps.charsOn ? 'btn-ghost' : 'btn primary'}
                  onClick={characterProps.onToggleChars}
                  title="把角色卡显示到画布上（画布视图可见，可拖到分镜旁）"
                >
                  {characterProps.charsOn ? '角色已在画布' : '全部上画布'}
                </button>
              ) : null}
            </>
          ) : tab === 'video' ? (
            <button
              type="button"
              className="btn primary"
              data-asset-video-add
              disabled={!projectName || ready !== projectName}
              onClick={() => setVideoAddOpen(true)}
              title="链接下载或上传本地 MP4 进视频库"
            >
              + 添加视频
            </button>
          ) : (
          <>
            <button
              className="btn-ghost"
              disabled={!projectName || ready !== projectName}
              onClick={() => setStockOpen(true)}
              title="检索公开图库，把图片 / 视频 / 音频下载进项目"
            >
              在线素材列表
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
              className={canPush ? 'btn primary' : 'btn'}
              disabled={!canPush}
              onClick={pushAll}
              title="把所有有图的场景/道具加入画布"
            >
              全部加入画布
            </button>
          </>
          )
        }
      />

      <div className="asset-tabs">
        <button
          type="button"
          className={!lexiconOpen && tab === 'character' ? 'on' : ''}
          data-asset-character-tab
          onClick={() => {
            setLexiconOpen(false)
            setTab('character')
          }}
        >
          角色 <span>{characters.length}</span>
        </button>
        <button
          className={!lexiconOpen && tab === 'scene' ? 'on' : ''}
          onClick={() => {
            setLexiconOpen(false)
            setTab('scene')
          }}
        >
          场景 <span>{sceneCount}</span>
        </button>
        <button className={tab === 'prop' && !lexiconOpen ? 'on' : ''} onClick={() => { setLexiconOpen(false); setTab('prop') }}>
          道具 <span>{propCount}</span>
        </button>
        <button
          type="button"
          className={tab === 'video' && !lexiconOpen ? 'on' : ''}
          data-asset-video-tab
          onClick={() => {
            setLexiconOpen(false)
            setTab('video')
          }}
        >
          视频 <span>{videoCount}</span>
        </button>
        <button className={lexiconOpen ? 'on' : ''} onClick={() => setLexiconOpen(true)}>
          镜头语言
        </button>
        <span className="asset-tabs-hint">
          {lexiconOpen
            ? lexiconView === 'preset'
              ? '镜头语言：先预览再发布素材卡 · 白膜仅供运镜参照'
              : '自定义白模：用 3D 工作台写代码并渲染 MP4，再发布为素材卡'
            : tab === 'character'
              ? '角色为项目级设定；在画布选中镜头后可在角色卡上注入 lookEn'
              : tab === 'video'
              ? '参考片与平台下载统一进视频库；几何分析在白模工作台选用'
              : `${withImage} 张有图 · ${designs.filter((d) => onCanvasDesignIds.has(d.id)).length} 张已在画布`}
        </span>
      </div>

      {lexiconOpen ? (
        <>
          <div className="lex-mode-tabs" role="tablist" aria-label="镜头语言来源">
            <button
              type="button"
              role="tab"
              aria-selected={lexiconView === 'preset'}
              className={lexiconView === 'preset' ? 'on' : ''}
              onClick={() => setLexiconView('preset')}
            >
              预置库
            </button>
            <button
              type="button"
              role="tab"
              aria-selected={lexiconView === 'custom'}
              className={lexiconView === 'custom' ? 'on' : ''}
              onClick={() => setLexiconView('custom')}
            >
              自定义白模 <span>{whiteboxSheets.length}</span>
            </button>
          </div>
          {lexiconView === 'preset' ? (
            <CameraLexiconBrowser
              projectName={projectName}
              onPublishAsset={onAddAssetCard}
              toast={toast}
            />
          ) : (
            <LexiconWhiteboxStudio
              projectName={projectName}
              projectAspect={projectAspect}
              sheets={whiteboxSheets}
              onSheetsChange={setWhiteboxSheets}
              settings={settings}
              stagePick={stagePick}
              onPickStage={onPickStage}
              onPublishAsset={onAddAssetCard}
              onEditorDirtyChange={onEditorDirtyChange}
              toast={toast}
            />
          )}
        </>
      ) : tab === 'character' ? (
        <CharacterBoard
          embedded
          {...characterProps}
          settings={settings}
          stagePick={stagePick}
          onPickStage={onPickStage}
          projectName={projectName}
          price={price}
          toast={toast}
          missing={missing}
          onImageMissing={onImageMissing}
        />
      ) : tab === 'video' ? (
        <AssetVideoBoard
          projectName={projectName}
          disabled={!projectName || ready !== projectName}
          assets={project?.assets || []}
          ingestOpen={videoAddOpen}
          onIngestOpenChange={setVideoAddOpen}
          onAssetsChange={async (next) => {
            setProject((p) => (p ? { ...p, assets: next } : p))
            if (!projectName) return
            const p = await getProject(projectName)
            setProject(p)
          }}
          onAddAssetCard={onAddAssetCard}
          toast={toast}
        />
      ) : (
      <>
      {shown.length > 0 ? (
        <BoardListToolbar
          query={designList.query}
          onQueryChange={designList.setQuery}
          placeholder={`搜索${KIND_LABEL[tab]}名称、中文说明、promptEn、镜号…`}
          ariaLabel={`搜索${KIND_LABEL[tab]}设定`}
          filteredCount={designList.filteredCount}
          totalCount={designList.totalCount}
          page={designList.page}
          totalPages={designList.totalPages}
          onPageChange={designList.setPage}
          pageSize={BOARD_LIST_PAGE_SIZE}
        />
      ) : null}
      <div className="char-grid" data-asset-design-grid>
        {loading ? (
          <div className="char-empty-board">正在读取素材设定…</div>
        ) : !projectName ? (
          <div className="char-empty-board">先在顶栏选择项目，再新建场景/道具卡。</div>
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
              `还没有${KIND_LABEL[tab]}设定，点右上角「+ ${tab === 'scene' ? '场景' : '道具'}卡」或打开工作台 Pi 助手。`
            )}
          </div>
        ) : designList.filteredCount === 0 ? (
          <div className="char-empty-board">没有匹配的{KIND_LABEL[tab]}，换个关键词试试。</div>
        ) : (
          designList.slice.map((d) => (
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
      </>
      )}
      {stockOpen && (
        <div className="mp-backdrop" onMouseDown={(e) => e.target === e.currentTarget && setStockOpen(false)}>
          <div className="mp-dialog stock-dialog" role="dialog" aria-modal="true" aria-label="在线素材列表">
            <header className="mp-head">
              <div>
                <b>在线素材列表</b>
                <span>推荐站点卡片 · 可站内检索导入</span>
              </div>
              <button type="button" className="mp-close" aria-label="关闭" onClick={() => setStockOpen(false)}>
                ×
              </button>
            </header>
            <div className="mp-stock-body">
              <OnlineStockList
                projectName={projectName}
                mode="library"
                onImported={onStockImported}
                toast={toast}
              />
            </div>
          </div>
        </div>
      )}
      <CharacterImageCropModal
        open={Boolean(cropPending)}
        title={
          cropPending?.pendingUrls
            ? '裁切生成的设定图'
            : cropPending?.candIdx !== undefined
              ? '裁切设定图候选'
              : '裁切设定图'
        }
        plan={cropPending?.plan ?? null}
        busy={cropBusy}
        onConfirm={() => void confirmDesignCrop()}
        onCancel={() => {
          releaseMaterialCropPlan(cropPending?.plan)
          setCropPending(null)
        }}
      />
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
