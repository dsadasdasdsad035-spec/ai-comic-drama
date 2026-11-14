import type { SettingsWorkbench } from '../../useSettingsWorkbench'
import PipelinePreviewCard from '../../PipelinePreviewCard'
import { CAP_META, STAGE_META } from '../../settingsMeta'
import { isRunnableModel, modelHasCap } from '../../../modelCaps'
import { resolveStageModel, stageModelEntries, textModelEntries } from '../../../ModelSelect'

type Props = { wb: SettingsWorkbench }

export function RoutingPane({ wb }: Props) {
  const { models, providers, defaults, stageModels, setDefaults, setStageModels, settingsDraft } = wb
  return (
    <>
      <section className="st-sec" data-settings-routing data-settings-pane="routing">
      <header className="st-sec-head">
        <h3>默认路由</h3>
        <span className="st-hint">先选渠道，再选模型；批量生成走这里的默认，工作台里仍可临时改。</span>
      </header>

      <PipelinePreviewCard models={models} defaults={defaults} stageModels={stageModels} />

      <div className="st-routing">
        {CAP_META.map((c) => {
          const key = wb.defaults[c.cap] || ''
          const model = wb.models.find((m) => m.key === key)
          const providerId = model?.provider || ''
          const eligibleProviders = wb.providers.filter((p) =>
            wb.models.some((m) => m.provider === p.id && modelHasCap(m, c.cap) && isRunnableModel(m)),
          )
          const providerModels = wb.models.filter(
            (m) => m.provider === providerId && modelHasCap(m, c.cap) && isRunnableModel(m),
          )
          const invalid = Boolean(key) && (!model || !modelHasCap(model, c.cap) || !isRunnableModel(model))
          const providerMissingKey = wb.providers.find((p) => p.id === providerId)?.keyAvailable === false
          return (
            <div key={c.cap} className="st-routing-row" data-routing-cap={c.cap}>
              <div className="st-routing-label">
                <b>{c.label}</b>
                <em>{c.hint}</em>
              </div>
              <select
                value={providerId}
                onChange={(e) => {
                  const pid = e.target.value
                  const first = wb.models.find(
                    (m) => m.provider === pid && modelHasCap(m, c.cap) && isRunnableModel(m),
                  )
                  wb.setDefaults((d) => ({ ...d, [c.cap]: first?.key || '' }))
                }}
              >
                <option value="">（选择渠道）</option>
                {eligibleProviders.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.label}
                  </option>
                ))}
              </select>
              <select
                value={key}
                disabled={!providerId || providerModels.length === 0}
                onChange={(e) => wb.setDefaults((d) => ({ ...d, [c.cap]: e.target.value }))}
              >
                <option value="">（未设置）</option>
                {providerModels.map((m) => (
                  <option key={m.key} value={m.key}>
                    {m.label} · {m.model || '未填模型 ID'}
                  </option>
                ))}
              </select>
              <span className={`st-routing-status ${invalid ? 'bad' : providerMissingKey ? 'warn' : key ? 'ok' : 'muted'}`}>
                {invalid ? '默认模型失效' : providerMissingKey ? '渠道缺 Key' : key ? '可用' : '未设置'}
              </span>
            </div>
          )
        })}
      </div>

      <h4 className="st-subhead">生成环节默认</h4>
      <p className="st-hint">
        文本环节空着 = 用「文本 · 常规」；视觉为空 = 素材只给标签；视频理解为空 = 回退关键帧。
      </p>
      <div className="st-stage-table">
        {STAGE_META.map((s) => {
          const options = stageModelEntries(settingsDraft, s.stage)
          const resolved = resolveStageModel(settingsDraft, s.stage, {})
          const current = stageModels[s.stage] || ''
          const invalidStage = Boolean(current) && !options.some((m) => m.key === current)
          const emptyLabel =
            s.stage === 'vision'
              ? '（未绑定 · 素材只给标签）'
              : s.stage === 'videoVision'
                ? '（未绑定 · 回退关键帧）'
                : '（跟随文本默认）'
          return (
            <label key={s.stage} className="st-stage-row" data-stage-row={s.stage}>
              <span>
                <b>{s.label}</b>
                <em>{s.hint}</em>
              </span>
              <select
                data-stage-model-select={s.stage}
                value={current}
                onChange={(e) => {
                  wb.setStageModels((prev) => {
                    const next = { ...prev }
                    if (e.target.value) next[s.stage] = e.target.value
                    else delete next[s.stage]
                    return next
                  })
                }}
              >
                <option value="">{emptyLabel}</option>
                {invalidStage && <option value={current}>配置的模型不可用（{current}）</option>}
                {options.map((m) => (
                  <option key={m.key} value={m.key}>
                    {m.label} · {m.model || '未填模型 ID'}
                  </option>
                ))}
              </select>
              <em className="st-stage-resolved">
                {resolved.entry ? `当前：${resolved.entry.label}` : resolved.invalidKey ? '配置的模型不可用' : '未解析'}
              </em>
            </label>
          )
        })}
      </div>
      <div className="st-hint" style={{ marginTop: 8 }}>
        角色三视图使用上方「图像 · 角色三视图」默认；角色板里可以单独手选。
      </div>
    </section>
    </>
  )
}
