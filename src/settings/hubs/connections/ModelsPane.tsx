import type { SettingsWorkbench } from '../../useSettingsWorkbench'
import { CAP_LABELS, CAP_ORDER, modelCaps, modelCapsLabel, modelHasCap, isRunnableModel } from '../../../modelCaps'
import type { Cap } from '../../../api'

type Props = { wb: SettingsWorkbench }

export function ModelsPane({ wb }: Props) {
  return (
<section className="st-sec" data-settings-pane="models">
      <header className="st-sec-head">
        <h3>模型库</h3>
        <span className="st-hint">一个模型一行；能力标签决定它能被哪些能力选中。</span>
      </header>
      <div className="st-toolbar">
        <input
          className="st-search"
          placeholder="搜索显示名 / 模型 ID"
          value={wb.modelSearch}
          onChange={(e) => wb.setModelSearch(e.target.value)}
        />
        <select value={wb.providerFilter} onChange={(e) => wb.setProviderFilter(e.target.value)}>
          <option value="all">全部渠道</option>
          {wb.providers.map((p) => (
            <option key={p.id} value={p.id}>
              {p.label}
            </option>
          ))}
        </select>
        <select value={wb.capFilter} onChange={(e) => wb.setCapFilter(e.target.value as 'all' | Cap)}>
          <option value="all">全部能力</option>
          {CAP_ORDER.map((c) => (
            <option key={c} value={c}>
              {CAP_LABELS[c]}
            </option>
          ))}
        </select>
        <span className="st-hint board-list-toolbar-meta">
          {wb.modelSearch.trim() || wb.providerFilter !== 'all' || wb.capFilter !== 'all'
            ? `匹配 ${wb.filteredModels.length} / ${wb.models.length}`
            : `共 ${wb.models.length} 个`}
        </span>
        <span className="spacer" />
        <button type="button" className="btn-mini" onClick={() => wb.openCatalog()}>
          同步 APIMart 目录
        </button>
        <button type="button" className="btn-mini" onClick={wb.addModel}>
          + 手动添加
        </button>
      </div>

      <div className="st-model-table st-model-grid">
        {wb.filteredModels.map((m) => {
          const provider = wb.providers.find((p) => p.id === m.provider)
          const open = wb.expandedModel === m.key
          const sourceLabel =
            m.source === 'preset' ? '预设' : m.source === 'catalog' ? '同步' : m.source === 'manual' ? '手动' : '旧数据'
          return (
            <article
              key={m.key}
              className={`st-model-item st-model-card${open ? ' is-expanded' : ''}${!isRunnableModel(m) ? ' is-muted' : ''}`}
              data-model-key={m.key}
            >
              <header className="st-model-card-head">
                <input
                  className="st-model-label"
                  value={m.label}
                  placeholder="显示名"
                  aria-label="模型显示名"
                  onChange={(e) => wb.patchModel(m.key, { label: e.target.value })}
                />
                <button type="button" className="btn-mini danger" onClick={() => wb.removeModel(m)} title="删除模型">
                  删除
                </button>
              </header>

              <label className="st-field st-model-card-field">
                <span>模型 ID</span>
                <input
                  className="st-model-id"
                  value={m.model}
                  placeholder="provider/model-id"
                  onChange={(e) => wb.patchModel(m.key, { model: e.target.value })}
                />
              </label>

              <label className="st-field st-model-card-field">
                <span>渠道</span>
                <select
                  value={m.provider}
                  onChange={(e) => wb.patchModel(m.key, { provider: e.target.value })}
                  title="所属渠道"
                >
                  {!provider && <option value={m.provider}>（渠道已删除）</option>}
                  {wb.providers.map((p) => (
                    <option key={p.id} value={p.id}>
                      {p.label}
                    </option>
                  ))}
                </select>
              </label>

              <button
                type="button"
                className="st-model-caps-btn"
                aria-expanded={open}
                onClick={() => wb.setExpandedModel(open ? '' : m.key)}
              >
                <span className="st-model-caps-label">能力</span>
                <span className="st-model-caps-value">{modelCapsLabel(m) || '未声明'}</span>
              </button>

              <div className="st-model-badges">
                <b className="st-badge muted">{sourceLabel}</b>
                <b
                  className={`st-badge ${isRunnableModel(m) ? 'ok' : 'bad'}`}
                  title={isRunnableModel(m) ? undefined : m.note || '当前版本未接入运行时'}
                >
                  {isRunnableModel(m) ? '可运行' : '未接入'}
                </b>
              </div>

              {open && (
                <div className="st-model-caps-editor">
                  <span className="st-hint">勾选能力</span>
                  {CAP_ORDER.map((c) => (
                    <button
                      key={c}
                      type="button"
                      className={`st-cap ${modelCaps(m).includes(c) ? 'on' : ''}`}
                      onClick={() => wb.toggleModelCap(m, c)}
                    >
                      {CAP_LABELS[c]}
                    </button>
                  ))}
                  {m.note && <em className="st-prov-note">{m.note}</em>}
                </div>
              )}

              {modelCaps(m).includes('video') && (
                <div className="st-model-video-ref">
                  <label className="chk" title="只有声明支持参考视频的模型才能勾；本地参考视频需公网 URL">
                    <input
                      type="checkbox"
                      checked={Boolean(m.supportsVideoRef)}
                      onChange={(e) => wb.patchModel(m.key, { supportsVideoRef: e.target.checked })}
                    />
                    支持视频参考
                  </label>
                  {m.supportsVideoRef && (
                    <select
                      value={m.videoRefTaskType || ''}
                      onChange={(e) =>
                        wb.patchModel(m.key, {
                          videoRefTaskType: e.target.value === 'reference' ? 'reference' : undefined,
                        })
                      }
                      title="Seedance 2.5 建议显式指定，避免被判定成视频编辑/延长"
                    >
                      <option value="">任务类型：自动（2.0）</option>
                      <option value="reference">任务类型：参考生视频（2.5）</option>
                    </select>
                  )}
                </div>
              )}
            </article>
          )
        })}
        {wb.filteredModels.length === 0 && (
          <div className="st-empty-state st-model-empty">
            {wb.models.length === 0 ? '还没有模型，可同步 APIMart 目录或手动添加' : '没有匹配的模型，试试放宽筛选条件'}
          </div>
        )}
      </div>
    </section>
  )
}
