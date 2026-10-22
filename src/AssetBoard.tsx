import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
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
import { assetSys } from './prompts'
import { imageCost, money, type Pricing } from './pricing'
import { endTask, startTask } from './tasks'

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
  toast: (m: string) => void
  price?: Pricing
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
  toast,
  price,
}: Props) {
  const [project, setProject] = useState<ProjectData | null>(null)
  const [designs, setDesigns] = useState<DesignSheet[]>([])
  const [tab, setTab] = useState<DesignKind>('scene')
  const [loading, setLoading] = useState(false)
  const [ready, setReady] = useState('')
  const [extracting, setExtracting] = useState<'' | 'episode' | 'script'>('')
  const [running, setRunning] = useState<Record<string, boolean>>({})
  const [errors, setErrors] = useState<Record<string, string>>({})
  const designsRef = useRef(designs)
  const savedSigRef = useRef('')
  const epochRef = useRef(0)

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

  const removeDesign = useCallback(
    (d: DesignSheet) => {
      if (!window.confirm(`删除${KIND_LABEL[d.kind]}「${d.name}」？画布上已发布的素材卡不会自动删除。`)) return
      setDesigns((ds) => ds.filter((x) => x.id !== d.id))
    },
    [],
  )

  const extract = useCallback(
    async (scope: 'episode' | 'script') => {
      if (extracting) return
      if (!projectName || ready !== projectName || !project) {
        toast('先选择项目，再拆场景/道具')
        return
      }
      if (!hasTextModels(settings)) {
        toast('设置页还没有可用的文本模型')
        return
      }
      const { sceneText, shotText } = buildDesignContext({
        scope,
        epNo,
        source: project.source,
        episodes: project.episodes,
        shots: project.shots,
      })
      if (!sceneText.trim() && !shotText.trim()) {
        toast(
          scope === 'episode'
            ? `第 ${epNo} 集还没有可拆的场次/镜头`
            : '当前项目没有剧本素材（source / 分集 / 镜头都为空）',
        )
        return
      }
      setExtracting(scope)
      const t0 = Date.now()
      try {
        const r = await callText<{ scenes?: unknown[]; props?: unknown[] }>({
          system: assetSys(settings?.rules),
          modelKey: stageModelKey(settings, 'asset', stagePick),
          json: true,
          maxTokens: 6000,
          prompt:
            `以下是${scope === 'episode' ? `第 ${epNo} 集的剧本场次与分镜` : '全剧的原著梗概、分集场次与分镜'}。\n\n` +
            sceneText +
            (shotText ? `\n\n【镜头摘要】\n${shotText}` : '') +
            '\n\n要求：按场景 scenes、道具 props 两类输出；同一地点/同一道具合并成一条，' +
            'refs 列出所有出现过的镜号；只拆可复用的空间和剧情关键道具。',
        })
        const incoming = pickExtractedDesigns(r.json)
        if (incoming.length === 0) throw new Error('模型没给出场景或道具，换个范围再试')
        const { next, added, updated } = mergeDesigns(designsRef.current, incoming)
        setDesigns(next)
        // 提取结果立即落库，避免用户马上切项目时停在防抖窗口里
        savedSigRef.current = JSON.stringify(next)
        patchProject(projectName, { designs: next }).catch(() => {})
        const secs = Math.round((Date.now() - t0) / 1000)
        toast(
          `拆出 ${incoming.length} 个素材 · ${secs}s｜新增 ${added.length}` +
            (updated.length ? ` · 合并 ${updated.length}` : '') +
            (r.modelLabel ? ` · 模型：${r.modelLabel}` : ''),
        )
      } catch (e) {
        toast((e as Error).message || '拆场景/道具失败')
      } finally {
        setExtracting('')
      }
    },
    [epNo, extracting, project, projectName, ready, settings, stagePick, toast],
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
      })
      const urls = res.urls?.length ? res.urls : [res.url]
      updateDesign(d.id, { candidates: urls, activeIdx: 0, image: urls[0] })
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

  const pushOne = (d: DesignSheet) => {
    if (!d.image) {
      toast('先生成或上传这张设定图，再加入画布')
      return
    }
    onPush([d])
  }

  const pushAll = () => {
    if (designs.length === 0) {
      toast('还没有场景/道具设定，先拆解')
      return
    }
    onPush(designs)
  }

  const shown = useMemo(() => designs.filter((d) => d.kind === tab), [designs, tab])
  const sceneCount = designs.filter((d) => d.kind === 'scene').length
  const propCount = designs.filter((d) => d.kind === 'prop').length
  const withImage = designs.filter((d) => d.image).length
  const canPush = Boolean(projectName && ready === projectName && withImage > 0)

  return (
    <div className="board">
      <div className="board-head">
        <div>
          <h2>素材设定板</h2>
          <p>
            先拆场景和关键道具，生成可复用的空镜/多角度参考图，再按单卡或全部加入画布。
            场景图不带主要角色，道具图不带手和人物，避免参考图污染镜头。
          </p>
        </div>
        <div className="board-acts">
          <div className="board-hint">{projectName ? `当前项目 ${projectName}` : '先选择项目'}</div>
          <button
            className="btn-ghost"
            disabled={!projectName || ready !== projectName || !!extracting}
            onClick={() => extract('episode')}
            title="用当前集的剧本场次和全部分镜拆场景/道具"
          >
            {extracting === 'episode' ? '拆解中…' : '从本集拆'}
          </button>
          <button
            className="btn-ghost"
            disabled={!projectName || ready !== projectName || !!extracting}
            onClick={() => extract('script')}
            title="用当前项目的原著、分集场次和全部分镜拆场景/道具"
          >
            {extracting === 'script' ? '拆解中…' : '从全剧拆'}
          </button>
          <button className="btn" disabled={!canPush} onClick={pushAll} title="把所有有图的场景/道具加入画布">
            全部加入画布
          </button>
        </div>
      </div>

      <div className="board-models">
        <StageModelSelect
          stage="asset"
          label="拆素材模型"
          settings={settings}
          pick={stagePick}
          onChange={onPickStage}
        />
        <CapModelSelect
          cap="image"
          label="设定图模型"
          settings={settings}
          value={imageModelKey}
          onChange={onPickImageModel}
          className="wb-field"
        />
        <span className="board-hint">
          场景 16:9 · 道具 1:1 · 默认 2 张候选
        </span>
      </div>

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
            还没有{KIND_LABEL[tab]}设定，点右上角「从本集拆」或「从全剧拆」开始。
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
              onChoose={(idx) => chooseCandidate(d, idx)}
              onPush={() => pushOne(d)}
            />
          ))
        )}
      </div>
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
  onChoose,
  onPush,
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
  onChoose: (idx: number) => void
  onPush: () => void
}) {
  const [editing, setEditing] = useState(false)
  const [kw, setKw] = useState(d.keywords.join('、'))

  useEffect(() => {
    if (!editing) setKw(d.keywords.join('、'))
  }, [d.keywords, editing])

  const toggleEdit = () => {
    if (!editing) setKw(d.keywords.join('、'))
    setEditing((v) => !v)
  }

  const candidates = d.candidates ?? []

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
        {d.image ? (
          <img src={d.image} alt={d.name} />
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
        <button className="btn-ghost" disabled={!d.image} onClick={onPush}>
          {onCanvas ? '更新画布' : '加入画布'}
        </button>
      </div>
    </div>
  )
}
