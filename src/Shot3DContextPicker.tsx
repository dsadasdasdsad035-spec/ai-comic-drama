import { useMemo, useState } from 'react'
import { SCENE_CODE_LIMITS } from './types'
import type { Shot3DContext } from './types'
import {
  allCatalogItems,
  itemIsSelected,
  missingSelectionItems,
  setContextCategory,
  setDialogueSelection,
  toggleContextItem,
  toggleContextText,
  toggleDialogueLine,
  type ContextTextKey,
  type Shot3DContextCatalog,
  type Shot3DContextCategory,
  type Shot3DContextItem,
} from './shot3dContextCatalog'
import { sanitizeShot3DContext, TEXT_CONTEXT_OFF } from './shot3dContext'

type Tab = Shot3DContextCategory | 'text'

type Props = {
  catalog: Shot3DContextCatalog
  value: Shot3DContext
  projectName?: string
  currentEpisode?: number
  onChange: (next: Shot3DContext) => void
  onInherit?: () => void
  onToast?: (message: string) => void
}

const TABS: { id: Tab; label: string }[] = [
  { id: 'character', label: '角色' },
  { id: 'asset', label: '素材' },
  { id: 'scene', label: '场景' },
  { id: 'prop', label: '道具' },
  { id: 'image', label: '图片' },
  { id: 'video', label: '视频' },
  { id: 'text', label: '文本' },
]

function itemKindLabel(item: Shot3DContextItem): string {
  if (item.kind === 'scene-text') return '场次'
  if (item.category === 'character') return '角色'
  if (item.category === 'scene') return '场景'
  if (item.category === 'prop') return '道具'
  if (item.category === 'video') return '视频'
  if (item.category === 'asset') return '素材'
  return '图片'
}

function itemSubtitle(item: Shot3DContextItem): string {
  if (item.missing) return '资源缺失'
  return [itemKindLabel(item), item.subtitle].filter(Boolean).join(' · ')
}

function Empty({ text }: { text: string }) {
  return <p className="ctxp-empty">{text}</p>
}

function Thumb({ item, broken, onBroken }: { item: Shot3DContextItem; broken: boolean; onBroken: () => void }) {
  if (!item.url || broken) {
    return (
      <div className={`ctxp-thumb ${item.url || item.missing ? 'bad' : 'empty'}`}>
        <span>{item.url ? '加载失败' : item.missing ? '缺失' : '无图'}</span>
      </div>
    )
  }
  if (item.category === 'video') {
    return (
      <div className="ctxp-thumb">
        <video src={item.url} muted preload="metadata" playsInline />
        <i className="ctxp-play">▶</i>
      </div>
    )
  }
  return (
    <div className="ctxp-thumb">
      <img src={item.url} alt={item.label} loading="lazy" onError={onBroken} />
    </div>
  )
}

function Preview({
  item,
  broken,
  selected,
  onToggle,
  onClose,
}: {
  item: Shot3DContextItem
  broken: boolean
  selected: boolean
  onToggle: () => void
  onClose: () => void
}) {
  return (
    <div className="ctxp-preview">
      <div className="ctxp-preview-head">
        <b>{item.label}</b>
        <span style={{ display: 'flex', gap: 6 }}>
          <button className={`btn-mini ${selected ? 'on' : ''}`} onClick={onToggle}>
            {selected ? '移除' : '加入上下文'}
          </button>
          <button className="btn-mini" onClick={onClose} aria-label="关闭预览">
            收起
          </button>
        </span>
      </div>
      <div className="ctxp-preview-media">
        {!item.url || broken ? (
          <div className="ctxp-preview-missing">{item.url ? '资源加载失败' : item.missing ? '资源已删除' : '该条只有文本'}</div>
        ) : item.category === 'video' ? (
          <video src={item.url} controls autoPlay muted loop playsInline />
        ) : (
          <img src={item.url} alt={item.label} />
        )}
      </div>
      <p>{itemSubtitle(item)}</p>
    </div>
  )
}

function TextPanel({
  catalog,
  value,
  onChange,
}: {
  catalog: Shot3DContextCatalog
  value: Shot3DContext
  onChange: (next: Shot3DContext) => void
}) {
  const text = catalog.text
  const lines = text.dialogue
  const checks: { key: ContextTextKey; label: string; body?: string }[] = [
    { key: 'prompt', label: '画面提示词', body: text.prompt },
    { key: 'videoPrompt', label: '运动提示词', body: text.videoPrompt },
    { key: 'cast', label: '画面出场角色', body: text.cast.join('、') },
    { key: 'sizeMove', label: '景别 / 运镜 / 秒数', body: text.sizeMove },
    { key: 'marks', label: '画面标注摘要', body: text.marks },
  ]
  return (
    <div className="ctxp-text">
      {checks.map((c) => (
        <label key={c.key} className={`ctxp-text-row ${!c.body ? 'disabled' : ''}`}>
          <input
            type="checkbox"
            checked={Boolean(value.text[c.key])}
            disabled={!c.body}
            onChange={() => onChange(toggleContextText(value, c.key))}
          />
          <span>
            <b>{c.label}</b>
            <em>{c.body ? c.body.slice(0, 160) : '当前镜头没有内容'}</em>
          </span>
        </label>
      ))}
      <div className="ctxp-dialogue">
        <div className="ctxp-text-title">
          <b>台词</b>
          {lines.length > 0 && (
            <label className="ctxp-inline">
              <input
                type="checkbox"
                checked={value.text.dialogue === 'all'}
                onChange={(e) => onChange(setDialogueSelection(value, e.target.checked ? 'all' : []))}
              />
              全部
            </label>
          )}
        </div>
        {!lines.length && <Empty text="当前镜头没有台词" />}
        {lines.map((line) => {
          const checked =
            value.text.dialogue === 'all' || (Array.isArray(value.text.dialogue) && value.text.dialogue.includes(line.index))
          return (
            <label key={line.index} className="ctxp-line">
              <input
                type="checkbox"
                checked={checked}
                onChange={() => onChange(toggleDialogueLine(value, line.index, lines.length))}
              />
              <span>
                <b>{line.speaker || '旁白'}</b>
                <em>{line.text}</em>
              </span>
            </label>
          )
        })}
      </div>
    </div>
  )
}

export default function Shot3DContextPicker({
  catalog,
  value,
  projectName,
  currentEpisode,
  onChange,
  onInherit,
  onToast,
}: Props) {
  const [tab, setTab] = useState<Tab>(() => {
    if (catalog.characters.length) return 'character'
    if (catalog.images.length) return 'image'
    if (catalog.scenes.length) return 'scene'
    if (catalog.props.length) return 'prop'
    if (catalog.assets.length) return 'asset'
    if (catalog.videos.length) return 'video'
    return 'character'
  })
  const [query, setQuery] = useState('')
  const [episodeFilter, setEpisodeFilter] = useState<number | 'all'>(currentEpisode ?? 'all')
  const [recommendOpen, setRecommendOpen] = useState(false)
  const [preview, setPreview] = useState<Shot3DContextItem | null>(null)
  const [broken, setBroken] = useState<Set<string>>(() => new Set())

  const all = useMemo(() => allCatalogItems(catalog), [catalog])
  const missing = useMemo(() => missingSelectionItems(catalog, value), [catalog, value])
  const selectedItems = useMemo(
    () => [...all.filter((item) => itemIsSelected(value, item)), ...missing],
    [all, missing, value],
  )
  const selectedTextCount =
    Number(value.text.prompt) +
    Number(value.text.videoPrompt) +
    Number(value.text.cast) +
    Number(value.text.marks) +
    Number(value.text.sizeMove) +
    (value.text.dialogue === 'all' ? catalog.text.dialogue.length : value.text.dialogue.length)

  const episodeOptions = useMemo(() => {
    const set = new Set<number>()
    for (const item of catalog.scenes) {
      if (item.kind === 'scene-text' && item.episode) set.add(item.episode)
    }
    if (currentEpisode) set.add(currentEpisode)
    return [...set].sort((a, b) => a - b)
  }, [catalog.scenes, currentEpisode])

  const recommendLabels = useMemo(() => {
    const labels = allCatalogItems(catalog)
      .filter((item) => itemIsSelected(catalog.defaults, item))
      .map((item) => item.label)
    const t = catalog.defaults.text
    if (t.prompt && catalog.text.prompt) labels.push('画面提示词')
    if (t.videoPrompt && catalog.text.videoPrompt) labels.push('运动提示词')
    if (t.cast && catalog.text.cast.length) labels.push('出场角色')
    if (t.sizeMove && catalog.text.sizeMove) labels.push('景别/运镜')
    if (t.marks && catalog.text.marks) labels.push('画面标注')
    if (catalog.text.dialogue.length && t.dialogue === 'all') {
      labels.push(`全部台词（${catalog.text.dialogue.length} 句）`)
    }
    return labels
  }, [catalog])

  const applyRecommend = () => {
    const d = catalog.defaults
    const dialogue: 'all' | number[] =
      value.text.dialogue === 'all' || d.text.dialogue === 'all'
        ? 'all'
        : [...new Set([...value.text.dialogue, ...d.text.dialogue])]
    onChange(
      sanitizeShot3DContext({
        ...value,
        characterIds: [...new Set([...value.characterIds, ...d.characterIds])],
        designIds: [...new Set([...value.designIds, ...d.designIds])],
        assetUrls: [...new Set([...value.assetUrls, ...d.assetUrls])],
        imageUrls: [...new Set([...value.imageUrls, ...d.imageUrls])],
        videoUrls: [...new Set([...value.videoUrls, ...d.videoUrls])],
        sceneKeys: [...new Set([...value.sceneKeys, ...d.sceneKeys])],
        text: {
          prompt: value.text.prompt || d.text.prompt,
          videoPrompt: value.text.videoPrompt || d.text.videoPrompt,
          cast: value.text.cast || d.text.cast,
          marks: value.text.marks || d.text.marks,
          sizeMove: value.text.sizeMove || d.text.sizeMove,
          dialogue,
        },
        ...(d.dialogueHash ? { dialogueHash: d.dialogueHash } : {}),
      }),
    )
    setRecommendOpen(false)
  }

  const itemsForTab = (t: Tab): Shot3DContextItem[] => {
    if (t === 'character') return catalog.characters
    if (t === 'asset') return catalog.assets
    if (t === 'scene') {
      return catalog.scenes.filter(
        (item) =>
          item.kind !== 'scene-text' ||
          episodeFilter === 'all' ||
          item.episode === episodeFilter,
      )
    }
    if (t === 'prop') return catalog.props
    if (t === 'image') return catalog.images
    if (t === 'video') return catalog.videos
    return []
  }

  const visible = useMemo(() => {
    const list = itemsForTab(tab)
    const q = query.trim().toLowerCase()
    if (!q) return list
    return list.filter((item) =>
      `${item.label} ${item.subtitle || ''} ${itemKindLabel(item)}`.toLowerCase().includes(q),
    )
  }, [catalog, tab, query, episodeFilter])

  const tabCount = (t: Tab) => {
    if (t === 'text') return selectedTextCount
    return itemsForTab(t).filter((item) => itemIsSelected(value, item)).length
  }

  const select = (item: Shot3DContextItem) => {
    setPreview(item)
    const selected = itemIsSelected(value, item)
    if (!selected) {
      if (item.category === 'video' && value.videoUrls.length >= SCENE_CODE_LIMITS.videos) {
        onToast?.(`最多选择 ${SCENE_CODE_LIMITS.videos} 个视频`)
        return
      }
      if (item.url && item.category !== 'video') {
        const urls = new Set<string>()
        for (const candidate of all) {
          if (!candidate.url || candidate.category === 'video') continue
          if (candidate.url === item.url || itemIsSelected(value, candidate)) urls.add(candidate.url)
        }
        if (urls.size > SCENE_CODE_LIMITS.images) {
          onToast?.(`最多选择 ${SCENE_CODE_LIMITS.images} 张图片`)
          return
        }
      }
    }
    onChange(toggleContextItem(value, item))
  }

  const selectAll = () => {
    if (tab === 'text') {
      onChange({
        ...value,
        text: { prompt: true, videoPrompt: true, dialogue: 'all', cast: true, marks: true, sizeMove: true },
        updatedAt: new Date().toISOString(),
      })
      return
    }
    const next = setContextCategory(value, catalog, tab, true)
    if (selectedImageCountSafe(next) > SCENE_CODE_LIMITS.images) {
      onToast?.(`最多选择 ${SCENE_CODE_LIMITS.images} 张图片`)
      return
    }
    if (next.videoUrls.length > SCENE_CODE_LIMITS.videos) {
      onToast?.(`最多选择 ${SCENE_CODE_LIMITS.videos} 个视频`)
      return
    }
    onChange(next)
  }

  const selectedImageCountSafe = (ctx: Shot3DContext) => {
    const urls = new Set<string>()
    for (const item of all) {
      if (!item.url || item.category === 'video') continue
      if (itemIsSelected(ctx, item)) urls.add(item.url)
    }
    return urls.size
  }

  const clear = () => {
    onChange({
      ...value,
      characterIds: [],
      designIds: [],
      assetUrls: [],
      imageUrls: [],
      videoUrls: [],
      sceneKeys: [],
      text: { ...TEXT_CONTEXT_OFF, dialogue: [] },
      updatedAt: new Date().toISOString(),
    })
  }

  const previewBroken = preview ? broken.has(preview.key) : false

  return (
    <section className="ctxp" aria-label="3D 参考内容">
      <div className="ctxp-head">
        <div>
          <b>参考内容</b>
          <span>{selectedItems.length} 项 + 文本 {selectedTextCount}</span>
        </div>
        <div className="ctxp-head-actions">
          <button
            className="btn-mini"
            onClick={() => setRecommendOpen((v) => !v)}
            title="先预览本镜相关条目，确认后才加入上下文"
          >
            推荐参考
          </button>
          {onInherit && (
            <button className="btn-mini" onClick={onInherit} title="沿用同集同场上一镜的选择，不复制代码">
              沿用上一镜
            </button>
          )}
          <button className="btn-mini" onClick={clear} disabled={!selectedItems.length && !selectedTextCount}>
            清空
          </button>
        </div>
      </div>

      {selectedItems.length > 0 && (
        <div className="ctxp-chips" aria-label="已选参考内容">
          {selectedItems.map((item) => (
            <button
              key={item.key}
              className={`ctxp-chip ${item.missing ? 'bad' : ''}`}
              onClick={() => select(item)}
              title={`移除 ${item.label}`}
            >
              <span>{item.label}</span>
              <i>×</i>
            </button>
          ))}
        </div>
      )}

      <div className="ctxp-scope">
        <span>项目：{projectName || '当前项目'}</span>
        <label>
          集数
          <select
            value={String(episodeFilter)}
            onChange={(e) =>
              setEpisodeFilter(e.target.value === 'all' ? 'all' : Number(e.target.value))
            }
          >
            <option value="all">全部</option>
            {episodeOptions.map((no) => (
              <option key={no} value={no}>
                E{String(no).padStart(2, '0')}
              </option>
            ))}
          </select>
        </label>
      </div>

      {recommendOpen && (
        <div className="ctxp-recommend">
          <b>推荐参考</b>
          <span>这些是本镜相关的默认条目，确认后才会加入当前上下文。</span>
          <ul>
            {recommendLabels.length ? (
              recommendLabels.map((label) => <li key={label}>{label}</li>)
            ) : (
              <li>没有可推荐的条目</li>
            )}
          </ul>
          <div className="ctxp-head-actions">
            <button className="btn-mini" onClick={applyRecommend} disabled={!recommendLabels.length}>
              加入这些参考
            </button>
            <button className="btn-mini" onClick={() => setRecommendOpen(false)}>
              取消
            </button>
          </div>
        </div>
      )}

      <div className="ctxp-tabs" role="tablist">
        {TABS.map((t) => (
          <button
            key={t.id}
            role="tab"
            aria-selected={tab === t.id}
            className={tab === t.id ? 'on' : ''}
            onClick={() => setTab(t.id)}
          >
            {t.label}
            <span>{tabCount(t.id)}</span>
          </button>
        ))}
      </div>

      {tab !== 'text' && (
        <div className="ctxp-tools">
          <input
            className="ctxp-search"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="搜索名称、类型、场次…"
            aria-label="搜索参考内容"
          />
          <button className="btn-mini" onClick={selectAll} disabled={!itemsForTab(tab).length}>
            全选本类
          </button>
        </div>
      )}

      {preview && (
        <Preview
          item={preview}
          broken={previewBroken}
          selected={itemIsSelected(value, preview)}
          onToggle={() => select(preview)}
          onClose={() => setPreview(null)}
        />
      )}

      {tab === 'text' ? (
        <TextPanel catalog={catalog} value={value} onChange={onChange} />
      ) : (
        <div className="ctxp-list" role="list">
          {!visible.length && <Empty text={query ? '没有匹配项' : '这个分类还没有资源'} />}
          {visible.map((item) => {
            const selected = itemIsSelected(value, item)
            const bad = broken.has(item.key)
            return (
              <button
                key={item.key}
                role="listitem"
                className={`ctxp-item ${selected ? 'on' : ''} ${bad || item.missing ? 'bad' : ''}`}
                onClick={() => setPreview(item)}
                aria-pressed={selected}
                aria-label={`预览 ${item.label}`}
                title={itemSubtitle(item)}
              >
                <Thumb item={item} broken={bad} onBroken={() => setBroken((s) => new Set(s).add(item.key))} />
                <span className="ctxp-item-text">
                  <b>{item.label}</b>
                  <em>{itemSubtitle(item)}</em>
                </span>
                <i className="ctxp-check">{selected ? '✓' : ''}</i>
              </button>
            )
          })}
        </div>
      )}

      <p className="ctxp-foot">
        只选项目内资源；图片最多 {SCENE_CODE_LIMITS.images} 张、视频最多 {SCENE_CODE_LIMITS.videos} 个，视频按关键帧进入聊天。
      </p>
    </section>
  )
}
