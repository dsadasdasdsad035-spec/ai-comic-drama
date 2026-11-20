import type { Cc0PropEntry, DesignSheet, ItchPropEntry, ProjectAsset } from '../api'

export type PropSource = 'project' | 'characters' | 'cc0' | 'itch'

type Props = {
  designOptions: DesignSheet[]
  gltfAssets: ProjectAsset[]
  cc0Props: Cc0PropEntry[]
  itchProps: ItchPropEntry[]
  cc0Filtered: Cc0PropEntry[]
  characterFiltered: Cc0PropEntry[]
  itchFiltered: ItchPropEntry[]
  charactersReady: boolean
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
  itchFiltered,
  charactersReady,
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
          title: p.title,
          meta: p.license || 'CC0',
          url: p.url,
          disabled: !charactersReady,
        }))
      : propSource === 'cc0'
      ? cc0Filtered.map((p) => ({ kind: 'cc0' as const, prop: p, title: p.title, meta: p.license || 'CC0', url: p.url }))
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

  const catalogHint =
    propSource === 'characters'
      ? !samplesReady
        ? '加载目录…'
        : !characterCount
          ? '无人形目录：npm run sync:m3d-characters'
          : charactersReady
            ? `${characterCount} 款分镜人形 · CC0 Grab3D`
            : '本地缺 GLB：在项目根执行 npm run sync:m3d-characters'
      : propSource === 'cc0'
      ? !samplesReady
        ? '加载目录…'
        : cc0Filtered.length || cc0Props.length
          ? `${cc0Filtered.length || cc0Props.length} 件家具/道具 CC0 · 首次加入会拉取 glTF`
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
      <section className="m3d-panel-block">
        <header className="m3d-panel-block-head">
          <h5>设定立板</h5>
          <p>从场景/道具设定卡贴参考图到地面</p>
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

      <section className="m3d-panel-block">
        <header className="m3d-panel-block-head">
          <h5>三维模型</h5>
          <p>选来源后一键加入场景，或存到项目素材</p>
        </header>
        <nav className="m3d-source-tabs" aria-label="模型来源">
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
            className={propSource === 'cc0' ? 'on' : undefined}
            onClick={() => onPropSource('cc0')}
          >
            CC0 家具
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
                  : propSource === 'cc0'
                    ? '搜索椅子、灯具…'
                    : '搜索本地包…'
              }
              value={propQuery}
              onChange={(e) => onPropQuery(e.target.value)}
              disabled={
                propSource === 'characters'
                  ? !characterCount
                  : propSource === 'cc0'
                    ? !cc0Filtered.length
                    : !itchProps.length
              }
            />
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