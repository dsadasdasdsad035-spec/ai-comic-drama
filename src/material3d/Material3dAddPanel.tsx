import type { Cc0PropEntry, DesignSheet, ItchPropEntry, ProjectAsset } from '../api'
import { cc0PropDisplayTitle } from './cc0PropDisplayTitle'

export type PropSource = 'project' | 'characters' | 'animals' | 'cc0' | 'itch'

/** 家具分组：清单里的 group 字段，Grab3D 侧才有；Poly Haven 的现代家具归入按品类推导的组 */
export const FURNITURE_GROUPS: { id: string; label: string }[] = [
  { id: 'seat', label: '沙发椅凳' },
  { id: 'bed', label: '床与卧室' },
  { id: 'table', label: '桌' },
  { id: 'storage', label: '柜与收纳' },
  { id: 'soft', label: '软装' },
  { id: 'decor', label: '装饰' },
  { id: 'plant', label: '绿植' },
  { id: 'light', label: '灯具' },
  { id: 'kitchen', label: '厨房' },
  { id: 'bath', label: '卫浴' },
  { id: 'laundry', label: '洗衣' },
  { id: 'other', label: '其他' },
]

type Props = {
  designOptions: DesignSheet[]
  gltfAssets: ProjectAsset[]
  cc0Props: Cc0PropEntry[]
  itchProps: ItchPropEntry[]
  cc0Filtered: Cc0PropEntry[]
  characterFiltered: Cc0PropEntry[]
  animalFiltered: Cc0PropEntry[]
  itchFiltered: ItchPropEntry[]
  charactersReady: boolean
  animalsReady: boolean
  /** 家具目录里 Grab3D 补库件的数量（显示在摘要里） */
  furnitureGapFillCount: number
  furnitureReady: boolean
  /** 家具分组筛选；空串表示不筛 */
  furnitureGroup: string
  onFurnitureGroup: (g: string) => void
  /** 每个分组的件数，用于 chip 上的计数 */
  furnitureGroupCounts: Record<string, number>
  propSource: PropSource
  onPropSource: (s: PropSource) => void
  propQuery: string
  onPropQuery: (q: string) => void
  samplesReady: boolean
  itchVendorReady: boolean
  importingProp: boolean
  onAddBillboard: (designId: string) => void
  onAddGltf: (url: string) => void
  onImportCc0: (prop: Cc0PropEntry) => void
  onImportItch: (prop: ItchPropEntry) => void
}

export default function Material3dAddPanel({
  designOptions,
  gltfAssets,
  cc0Props,
  itchProps,
  cc0Filtered,
  characterFiltered,
  animalFiltered,
  itchFiltered,
  charactersReady,
  animalsReady,
  furnitureGapFillCount,
  furnitureReady,
  furnitureGroup,
  onFurnitureGroup,
  furnitureGroupCounts,
  propSource,
  onPropSource,
  propQuery,
  onPropQuery,
  samplesReady,
  itchVendorReady,
  importingProp,
  onAddBillboard,
  onAddGltf,
  onImportCc0,
  onImportItch,
}: Props) {
  const catalogRows =
    propSource === 'characters'
      ? characterFiltered.map((p) => ({
          kind: 'cc0' as const,
          prop: p,
          title: cc0PropDisplayTitle(p),
          meta: p.license || 'CC0',
          url: p.url,
          disabled: !charactersReady,
        }))
      : propSource === 'animals'
      ? animalFiltered.map((p) => ({
          kind: 'cc0' as const,
          prop: p,
          title: cc0PropDisplayTitle(p),
          meta: p.license || 'CC0',
          url: p.url,
          disabled: !animalsReady,
        }))
      : propSource === 'cc0'
      ? cc0Filtered.map((p) => ({
          kind: 'cc0' as const,
          prop: p,
          title: cc0PropDisplayTitle(p),
          // Grab3D 补库件标一下来源，读者能看出它是轻量 PBR 而不是 Poly Haven 写实件
          meta: p.source === 'grab3d' ? 'CC0 · Grab3D 轻量' : p.license || 'CC0',
          url: p.url,
          disabled: p.source === 'grab3d' ? !furnitureReady : false,
        }))
      : propSource === 'itch'
        ? itchFiltered.map((p) => ({
            kind: 'itch' as const,
            prop: p,
            title: p.title,
            meta: p.license || '见 itch',
            url: p.url,
            disabled: !itchVendorReady,
          }))
        : []

  const characterCount = cc0Props.filter((p) => (p.categories || []).includes('characters')).length
  const animalCount = cc0Props.filter((p) => (p.categories || []).includes('animals')).length

  const catalogHint =
    propSource === 'characters'
      ? !samplesReady
        ? '加载目录…'
        : !characterCount
          ? '无人形目录：npm run sync:m3d-characters'
          : charactersReady
            ? `${characterCount} 款分镜人形 · CC0 Grab3D`
            : '本地缺 GLB：在项目根执行 npm run sync:m3d-characters'
      : propSource === 'animals'
      ? !samplesReady
        ? '加载目录…'
        : !animalCount
          ? '无动物目录：npm run sync:m3d-animal-props'
          : animalsReady
            ? `${animalCount} 款写实动物 · CC0 Grab3D`
            : '本地缺 GLB：在项目根执行 npm run sync:m3d-animal-props'
      : propSource === 'cc0'
      ? !samplesReady
        ? '加载目录…'
        : cc0Filtered.length || cc0Props.length
          ? `${cc0Filtered.length || cc0Props.length} 件布景家具 · Poly Haven${
              furnitureGapFillCount ? ` + Grab3D 补库 ${furnitureGapFillCount}` : ''
            }`
          : '无目录：npm run sync:cc0-props'
      : propSource === 'itch'
        ? !samplesReady
          ? '加载目录…'
          : !itchProps.length
            ? '无条目：见 presets/itch-props/README.md'
            : itchVendorReady
              ? `${itchProps.length} 件已入库`
              : 'vendor 缺文件：npm run validate:itch-props'
        : ''

  return (
    <div className="m3d-panel m3d-panel-add">
      <p className="m3d-library-lede">① 加入立板或模型 → ②「编排」里微调 → ③「分镜」存机位</p>
      <section className="m3d-panel-block m3d-add-card">
        <header className="m3d-panel-block-head">
          <h5>参考立板</h5>
          <p>把场景/道具设定图贴在场景中</p>
        </header>
        {designOptions.length === 0 ? (
          <p className="m3d-empty-inline">暂无可用的设定图（需已出图且文件存在）</p>
        ) : (
          <div className="m3d-chip-grid">
            {designOptions.slice(0, 12).map((d) => (
              <button
                key={d.id}
                type="button"
                className="m3d-chip"
                data-m3d-design-pick={d.id}
                onClick={() => onAddBillboard(d.id)}
              >
                <span className="m3d-chip-tag">{d.kind === 'scene' ? '场景' : '道具'}</span>
                {d.name}
              </button>
            ))}
          </div>
        )}
        {designOptions.length > 12 ? (
          <select
            className="wb-field m3d-field-tight"
            data-m3d-design-select
            defaultValue=""
            onChange={(e) => {
              const v = e.target.value
              if (!v) return
              onAddBillboard(v)
              e.target.value = ''
            }}
          >
            <option value="">更多设定卡…</option>
            {designOptions.map((d) => (
              <option key={d.id} value={d.id}>
                {d.kind === 'scene' ? '场景' : '道具'} · {d.name}
              </option>
            ))}
          </select>
        ) : null}
      </section>

      <section className="m3d-panel-block m3d-add-card">
        <header className="m3d-panel-block-head">
          <h5>三维素材</h5>
          <p>人形、动物、家具或项目 GLB；可先「加入场景」或「存素材」</p>
        </header>
        <nav className="m3d-source-tabs m3d-source-tabs--stack" aria-label="模型来源">
          <button
            type="button"
            className={propSource === 'project' ? 'on' : undefined}
            onClick={() => onPropSource('project')}
          >
            项目
            {gltfAssets.length ? <span>{gltfAssets.length}</span> : null}
          </button>
          <button
            type="button"
            className={propSource === 'characters' ? 'on' : undefined}
            onClick={() => onPropSource('characters')}
            data-m3d-source-characters
          >
            人形
            {characterCount ? <span>{characterCount}</span> : null}
          </button>
          <button
            type="button"
            className={propSource === 'animals' ? 'on' : undefined}
            onClick={() => onPropSource('animals')}
            data-m3d-source-animals
          >
            动物
            {animalCount ? <span>{animalCount}</span> : null}
          </button>
          <button
            type="button"
            className={propSource === 'cc0' ? 'on' : undefined}
            onClick={() => onPropSource('cc0')}
            data-m3d-source-furniture
          >
            布景家具
            {cc0Filtered.length ? <span>{cc0Filtered.length}</span> : null}
          </button>
          <button
            type="button"
            className={propSource === 'itch' ? 'on' : undefined}
            onClick={() => onPropSource('itch')}
          >
            itch 本地
            {itchProps.length ? <span>{itchProps.length}</span> : null}
          </button>
        </nav>

        {propSource === 'project' ? (
          gltfAssets.length === 0 ? (
            <p className="m3d-empty-inline">项目里还没有 GLB/glTF，可用下方库加入或从素材板上传</p>
          ) : (
            <ul className="m3d-catalog">
              {gltfAssets.map((a, i) => (
                <li key={`${a.url}-${i}`} className="m3d-catalog-row">
                  <div className="m3d-catalog-copy">
                    <strong>{a.title || decodeURIComponent(a.url.split('/').pop() || '模型')}</strong>
                    <small>项目素材</small>
                  </div>
                  <button
                    type="button"
                    className="btn-mini primary"
                    data-m3d-gltf-select
                    onClick={() => onAddGltf(a.url)}
                  >
                    加入
                  </button>
                </li>
              ))}
            </ul>
          )
        ) : (
          <>
            <input
              className="wb-field m3d-field-tight"
              type="search"
              placeholder={
                propSource === 'characters'
                  ? '搜索木人、男性、西装…'
                  : propSource === 'animals'
                    ? '搜索猫、狗、马、熊猫…'
                    : propSource === 'cc0'
                      ? '搜索餐椅、咖啡桌、沙发…'
                      : '搜索本地包…'
              }
              value={propQuery}
              onChange={(e) => onPropQuery(e.target.value)}
              disabled={
                propSource === 'characters'
                  ? !characterCount
                  : propSource === 'animals'
                    ? !animalCount
                    : propSource === 'cc0'
                      ? !cc0Filtered.length
                      : !itchProps.length
              }
            />
            {propSource === 'cc0' ? (
              <div className="m3d-group-chips" role="group" aria-label="家具分组">
                <button
                  type="button"
                  className={`btn-mini ${furnitureGroup ? '' : 'on'}`}
                  data-m3d-group=""
                  onClick={() => onFurnitureGroup('')}
                >
                  全部
                </button>
                {FURNITURE_GROUPS.filter((g) => (furnitureGroupCounts[g.id] || 0) > 0).map((g) => (
                  <button
                    key={g.id}
                    type="button"
                    className={`btn-mini ${furnitureGroup === g.id ? 'on' : ''}`}
                    data-m3d-group={g.id}
                    onClick={() => onFurnitureGroup(furnitureGroup === g.id ? '' : g.id)}
                  >
                    {g.label}
                    <span>{furnitureGroupCounts[g.id]}</span>
                  </button>
                ))}
              </div>
            ) : null}
            <p className="m3d-meta-line">{catalogHint}</p>
            <ul className="m3d-catalog m3d-catalog-scroll">
              {catalogRows.length === 0 ? (
                <li className="m3d-empty-inline">无匹配结果</li>
              ) : (
                catalogRows.map((row) => (
                  <li
                    key={row.prop.id}
                    className={`m3d-catalog-row${'disabled' in row && row.disabled ? ' is-disabled' : ''}`}
                  >
                    <div className="m3d-catalog-copy">
                      <strong>{row.title}</strong>
                      <small>{row.meta}</small>
                    </div>
                    <div className="m3d-catalog-actions">
                      <button
                        type="button"
                        className="btn-mini primary"
                        disabled={('disabled' in row && row.disabled) || importingProp}
                        data-m3d-cc0-select={row.kind === 'cc0' ? true : undefined}
                        data-m3d-itch-select={row.kind === 'itch' ? true : undefined}
                        onClick={() => onAddGltf(row.url)}
                      >
                        加入
                      </button>
                      <button
                        type="button"
                        className="btn-mini ghost"
                        disabled={('disabled' in row && row.disabled) || importingProp}
                        data-m3d-cc0-import-select={row.kind === 'cc0' ? true : undefined}
                        data-m3d-itch-import-select={row.kind === 'itch' ? true : undefined}
                        onClick={() =>
                          row.kind === 'cc0'
                            ? onImportCc0(row.prop as Cc0PropEntry)
                            : onImportItch(row.prop as ItchPropEntry)
                        }
                      >
                        存素材
                      </button>
                    </div>
                  </li>
                ))
              )}
            </ul>
          </>
        )}
      </section>
    </div>
  )
}