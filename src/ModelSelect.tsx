import type { AppSettings, Cap, ModelEntry, Stage } from './api'

/** 环节手选：只存模型表键；空串/缺省 = 用环节默认 */
export type StagePick = Partial<Record<Stage, string>>

export const STAGE_PICK_KEY = 'storyboard-stage-model-pick'

/** 文本族：text / textPro 是同一种能力的两个档位，手选时一起列 */
export const isTextCap = (cap: Cap) => cap === 'text' || cap === 'textPro'

export function textModelEntries(settings: AppSettings | null): ModelEntry[] {
  return (settings?.models ?? []).filter((m) => isTextCap(m.cap))
}

export type StageResolution = {
  entry?: ModelEntry
  source: 'pick' | 'stage' | 'textDefault' | 'first' | 'none'
  /** 配置里写了键、但模型表里找不到；生成时把这个键交给服务端换明确报错 */
  invalidKey?: string
}

/**
 * 环节解析：手选 > 设置页环节默认 > 文本默认 > 文本族第一条。
 * 配了键却找不到时不做静默替换，交给生成请求报 model-key-not-found，
 * 否则用户会以为自己在用 A，实际跑了 B。
 */
export function resolveStageModel(
  settings: AppSettings | null,
  stage: Stage,
  pick?: StagePick,
): StageResolution {
  const models = textModelEntries(settings)
  const pickKey = String(pick?.[stage] || '').trim()
  if (pickKey) {
    const hit = models.find((m) => m.key === pickKey)
    return hit ? { entry: hit, source: 'pick' } : { source: 'none', invalidKey: pickKey }
  }
  const stageKey = String(settings?.stageModels?.[stage] || '').trim()
  if (stageKey) {
    const hit = models.find((m) => m.key === stageKey)
    return hit ? { entry: hit, source: 'stage' } : { source: 'none', invalidKey: stageKey }
  }
  const defKey = String(settings?.defaults?.text || '').trim()
  if (defKey) {
    const hit = models.find((m) => m.key === defKey)
    return hit ? { entry: hit, source: 'textDefault' } : { source: 'none', invalidKey: defKey }
  }
  return models[0] ? { entry: models[0], source: 'first' } : { source: 'none' }
}

/** 生成时实际传给 /api/text 的键；为空表示交给服务端按文本默认解析 */
export function stageModelKey(settings: AppSettings | null, stage: Stage, pick?: StagePick): string {
  const r = resolveStageModel(settings, stage, pick)
  return r.entry?.key || r.invalidKey || ''
}

export function stageDefaultLabel(settings: AppSettings | null, stage: Stage, pick?: StagePick): string {
  const r = resolveStageModel(settings, stage, pick)
  if (r.entry) return `${r.entry.label} · ${r.entry.model}`
  if (r.invalidKey) return `配置的模型不可用（${r.invalidKey}）`
  return '未配置文本模型'
}

/** 生成按钮是否可用：没有文本族模型时不能发请求 */
export function hasTextModels(settings: AppSettings | null): boolean {
  return textModelEntries(settings).length > 0
}

/**
 * 按能力选模型。空值 = 用设置页该能力的默认模型。
 * 出图 / 出片 / 配音 / 三视图共用，行为与旧 Inspector 里的 ModelPicker 一致。
 */
export function CapModelSelect({
  cap,
  caps,
  label,
  settings,
  value,
  onChange,
  className = 'mp-row',
}: {
  cap: Cap
  /** 可选：同时列出多个能力的模型（如视频族 video + videoRef） */
  caps?: Cap[]
  label: string
  settings: AppSettings | null
  value?: string
  onChange: (key: string) => void
  className?: string
}) {
  const family = caps ?? [cap]
  const list = (settings?.models ?? []).filter((m) => family.includes(m.cap))
  const defKey = settings?.defaults?.[cap] || ''
  const def = list.find((m) => m.key === defKey) || list[0]
  return (
    <label
      className={className}
      data-cap-model-select={cap}
      title="这个环节用哪个模型；不选就用设置页的默认"
    >
      <span className="label">{label}</span>
      <select value={value || ''} onChange={(e) => onChange(e.target.value)}>
        <option value="">{def ? `默认 · ${def.label}` : '默认（未配置）'}</option>
        {list.map((m) => (
          <option key={m.key} value={m.key}>
            {m.label} · {m.model}
            {m.supportsVideoRef ? ' · 视频参考' : ''}
          </option>
        ))}
      </select>
    </label>
  )
}

/**
 * 按生成环节选文本模型。首项显示当前默认解析结果，
 * 手选后由调用方写进 StagePick（本机持久化）。
 */
export function StageModelSelect({
  stage,
  label = '模型',
  settings,
  pick,
  onChange,
  className = 'wb-field',
  disabled,
}: {
  stage: Stage
  label?: string
  settings: AppSettings | null
  pick?: StagePick
  onChange: (stage: Stage, key: string) => void
  className?: string
  disabled?: boolean
}) {
  const list = textModelEntries(settings)
  const value = pick?.[stage] || ''
  const defLabel = stageDefaultLabel(settings, stage, pick)
  return (
    <label
      className={className}
      data-stage-model-select={stage}
      title="这个环节用哪个模型；默认来自设置页的「生成环节默认模型」，手选只保存在本机"
    >
      <span className="label">{label}</span>
      <select
        value={value}
        onChange={(e) => onChange(stage, e.target.value)}
        disabled={disabled || list.length === 0}
      >
        <option value="">默认 · {defLabel}</option>
        {list.map((m) => (
          <option key={m.key} value={m.key}>
            {m.label} · {m.model}
          </option>
        ))}
      </select>
    </label>
  )
}
