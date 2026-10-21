import { useEffect, useMemo, useState } from 'react'
import {
  getSettings,
  saveSettings,
  type AppSettings,
  type Cap,
  type ModelEntry,
  type Provider,
  type ProviderKind,
  type RulePack,
} from './api'
import { DEFAULT_RULES, normalizeRules } from './prompts'

/**
 * 设置页：渠道 + 模型表 + 各能力默认模型 + 技能规则包，存 SQLite settings 表（key=app）。
 *
 * 为什么要渠道抽象：文字可能用 DeepSeek、生图可能用第三方中转、配音可能用 MiniMax，
 * 每种渠道的协议不同。模型表把「能力 → 渠道 + 模型 ID」绑起来，生成时只报一个 modelKey。
 */
type Props = { toast: (m: string) => void }

const CAP_META: { cap: Cap; label: string; hint: string }[] = [
  { cap: 'text', label: '文本 · 常规', hint: '拆镜/提示词之外的批量生成' },
  { cap: 'textPro', label: '文本 · 高质量', hint: '拆镜 / 拆角色 / 长输出' },
  { cap: 'image', label: '图像 · 出画面', hint: '画布生成画面' },
  { cap: 'view', label: '图像 · 角色三视图', hint: '角色板生成三视图' },
  { cap: 'video', label: '视频 · 首帧出片', hint: '单图图生视频' },
  { cap: 'videoRef', label: '视频 · 多参考图', hint: 'reference_image 1~4 张' },
  { cap: 'audio', label: '音频 · 配音', hint: '台词合成' },
]

const KIND_META: { kind: ProviderKind; label: string }[] = [
  { kind: 'ark', label: '字节方舟（ARK）' },
  { kind: 'openai', label: 'OpenAI 兼容' },
  { kind: 'minimax', label: 'MiniMax' },
  { kind: 'elevenlabs', label: 'ElevenLabs' },
]

const RULE_META = [
  { key: 'script', title: '剧本守则', source: 'script-to-manga', hint: '挂在「生成分集」的系统提示词后' },
  { key: 'character', title: '角色一致性铁律', source: 'character-design-sheet', hint: '三视图/外观锚点生成' },
  { key: 'shot', title: '拆镜守则', source: 'script-to-manga / storyboard-creation', hint: '挂在「拆镜」的系统提示词后' },
  { key: 'prompt', title: '提示词规范', source: 'video-prompting-guide', hint: '挂在「生成提示词」的系统提示词后' },
] as const

export default function Settings({ toast }: Props) {
  const [providers, setProviders] = useState<Provider[]>([])
  const [models, setModels] = useState<ModelEntry[]>([])
  const [defaults, setDefaults] = useState<Partial<Record<Cap, string>>>({})
  const [apiKey, setApiKey] = useState('')
  const [rules, setRules] = useState<Record<string, RulePack>>(() => normalizeRules())
  const [dbFile, setDbFile] = useState('')
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)

  useEffect(() => {
    getSettings()
      .then(({ settings, db }) => {
        const s = settings as AppSettings
        setProviders(s.providers || [])
        setModels(s.models || [])
        setDefaults(s.defaults || {})
        setApiKey(s.apiKey || '')
        setRules(normalizeRules(s.rules))
        setDbFile(db || '')
      })
      .catch((e) => toast(e.message || '读取设置失败'))
      .finally(() => setLoading(false))
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

  const save = async () => {
    setSaving(true)
    try {
      await saveSettings({ providers, models, defaults, apiKey, rules } as Partial<AppSettings>)
      toast('设置已保存（存入 SQLite），生成时立即生效')
    } catch (e: any) {
      toast(e.message || '保存失败')
    } finally {
      setSaving(false)
    }
  }

  const patchProvider = (id: string, p: Partial<Provider>) =>
    setProviders((ps) => ps.map((x) => (x.id === id ? { ...x, ...p } : x)))

  const patchModel = (key: string, p: Partial<ModelEntry>) =>
    setModels((ms) => ms.map((x) => (x.key === key ? { ...x, ...p } : x)))

  const addProvider = () => {
    const id = `custom-${Date.now().toString(36).slice(-4)}`
    setProviders((ps) => [
      ...ps,
      { id, label: '新渠道', kind: 'openai', baseUrl: 'https://', apiKey: '' },
    ])
  }

  const addModel = (cap: Cap) => {
    const first = providers[0]?.id || 'ark'
    const key = `m-${cap}-${Date.now().toString(36).slice(-4)}`
    setModels((ms) => [...ms, { key, label: '新模型', cap, provider: first, model: '' }])
  }

  /** 每个能力可选哪些模型 */
  const byCap = useMemo(() => {
    const m = new Map<Cap, ModelEntry[]>()
    for (const x of models) {
      const arr = m.get(x.cap) || []
      arr.push(x)
      m.set(x.cap, arr)
    }
    return m
  }, [models])

  if (loading) return <main className="settings"><div className="wb-empty">加载中…</div></main>

  return (
    <main className="settings">
      <div className="st-scroll">
        <section className="st-sec">
          <header className="st-sec-head">
            <h3>渠道（Provider）</h3>
            <span className="st-hint">
              一个渠道 = 一个 baseUrl + 一把 Key。已预置字节方舟 / DeepSeek / MiniMax / ElevenLabs / 第三方兼容；
              方舟的 Key 留空会自动沿用 ~/.canghe-skills/.env。
            </span>
            <button className="btn-mini" onClick={addProvider}>
              + 渠道
            </button>
          </header>
          <div className="st-providers">
            {providers.map((p) => (
              <div key={p.id} className="st-prov">
                <div className="st-prov-head">
                  <input
                    className="st-prov-name"
                    value={p.label}
                    onChange={(e) => patchProvider(p.id, { label: e.target.value })}
                  />
                  <select
                    value={p.kind}
                    onChange={(e) => patchProvider(p.id, { kind: e.target.value as ProviderKind })}
                  >
                    {KIND_META.map((k) => (
                      <option key={k.kind} value={k.kind}>
                        {k.label}
                      </option>
                    ))}
                  </select>
                  <button
                    className="btn-mini danger"
                    onClick={() => setProviders((ps) => ps.filter((x) => x.id !== p.id))}
                    title="删除渠道（引用它的模型会失效）"
                  >
                    删除
                  </button>
                </div>
                <label className="st-field">
                  <span>Base URL</span>
                  <input value={p.baseUrl} onChange={(e) => patchProvider(p.id, { baseUrl: e.target.value })} />
                </label>
                <label className="st-field">
                  <span>API Key</span>
                  <input
                    type="password"
                    value={p.apiKey || ''}
                    placeholder={p.kind === 'ark' ? '留空 = 沿用 .env 的 ARK_API_KEY' : '必填'}
                    onChange={(e) => patchProvider(p.id, { apiKey: e.target.value })}
                  />
                </label>
                {p.note && <em className="st-prov-note">{p.note}</em>}
              </div>
            ))}
          </div>
        </section>

        <section className="st-sec">
          <header className="st-sec-head">
            <h3>默认模型</h3>
            <span className="st-hint">按能力各选一个默认；画布生成时可临时改，批量走这里的默认。</span>
          </header>
          <div className="st-grid">
            {CAP_META.map((c) => (
              <label key={c.cap} className="st-field">
                <span>{c.label}</span>
                <select
                  value={defaults[c.cap] || ''}
                  onChange={(e) => setDefaults({ ...defaults, [c.cap]: e.target.value })}
                >
                  <option value="">（未设置 · 用该能力第一条）</option>
                  {(byCap.get(c.cap) || []).map((m) => (
                    <option key={m.key} value={m.key}>
                      {m.label} · {m.model || '未填模型 ID'}
                    </option>
                  ))}
                </select>
                <em>{c.hint}</em>
              </label>
            ))}
          </div>
        </section>

        <section className="st-sec">
          <header className="st-sec-head">
            <h3>模型表</h3>
            <span className="st-hint">
              一行 = 一个可选模型。协议由所属渠道决定：方舟支持参考图，第三方兼容渠道按纯文生图处理。
            </span>
          </header>
          <div className="st-models">
            {CAP_META.map((c) => (
              <div key={c.cap} className="st-model-group">
                <div className="st-model-cap">
                  <b>{c.label}</b>
                  <button className="btn-mini" onClick={() => addModel(c.cap)}>
                    + 模型
                  </button>
                </div>
                {(byCap.get(c.cap) || []).map((m) => (
                  <div key={m.key} className="st-model-row">
                    <input
                      className="st-model-label"
                      value={m.label}
                      placeholder="显示名"
                      onChange={(e) => patchModel(m.key, { label: e.target.value })}
                    />
                    <select
                      value={m.provider}
                      onChange={(e) => patchModel(m.key, { provider: e.target.value })}
                    >
                      {providers.map((p) => (
                        <option key={p.id} value={p.id}>
                          {p.label}
                        </option>
                      ))}
                    </select>
                    <input
                      className="st-model-id"
                      value={m.model}
                      placeholder="模型 ID，如 doubao-seedream-4-5-251128"
                      onChange={(e) => patchModel(m.key, { model: e.target.value })}
                    />
                    <button
                      className="btn-mini danger"
                      onClick={() => setModels((ms) => ms.filter((x) => x.key !== m.key))}
                      title="删除模型"
                    >
                      ✕
                    </button>
                  </div>
                ))}
                {(byCap.get(c.cap) || []).length === 0 && (
                  <div className="st-model-empty">这个能力还没有模型，点「+ 模型」加一条</div>
                )}
              </div>
            ))}
          </div>
        </section>

        <section className="st-sec">
          <header className="st-sec-head">
            <h3>兼容字段</h3>
            <span className="st-hint">旧的单 Key 字段，仅方舟渠道兜底用。</span>
          </header>
          <div className="st-grid">
            <label className="st-field">
              <span>ARK API Key（旧字段）</span>
              <input
                type="password"
                value={apiKey}
                placeholder="留空 = 沿用 ~/.canghe-skills/.env"
                onChange={(e) => setApiKey(e.target.value)}
              />
              <em>建议改在「渠道」里填；这里留作兼容</em>
            </label>
          </div>
        </section>

        <section className="st-sec">
          <header className="st-sec-head">
            <h3>技能规则包</h3>
            <span className="st-hint">
              从技能库摘录的硬规则，拼进各环节的系统提示词。可停用、可改写 —— 改文本即改提示词。
            </span>
          </header>
          <div className="st-rules">
            {RULE_META.map((r) => {
              const pack = rules[r.key] || DEFAULT_RULES[r.key as keyof typeof DEFAULT_RULES]
              return (
                <div key={r.key} className={`st-rule ${pack.enabled ? '' : 'off'}`}>
                  <header>
                    <label className="st-switch">
                      <input
                        type="checkbox"
                        checked={pack.enabled}
                        onChange={(e) => setRules({ ...rules, [r.key]: { ...pack, enabled: e.target.checked } })}
                      />
                      <span>{r.title}</span>
                    </label>
                    <span className="st-src">{r.source}</span>
                    <span className="spacer" />
                    <span className="st-hint">{r.hint}</span>
                  </header>
                  <textarea
                    rows={r.key === 'character' ? 8 : 7}
                    value={pack.text}
                    spellCheck={false}
                    onChange={(e) => setRules({ ...rules, [r.key]: { ...pack, text: e.target.value } })}
                  />
                </div>
              )
            })}
          </div>
        </section>

        <section className="st-sec">
          <header className="st-sec-head">
            <h3>数据存储</h3>
          </header>
          <p className="st-hint">
            项目数据与设置都在 SQLite 单文件里：
            <code>{dbFile || '（首次访问项目数据时创建）'}</code>
            <br />
            原各项目目录下的 project.json 保留作为迁移前备份，之后不再回读。
          </p>
        </section>

        <div className="st-actions">
          <button className="btn primary" onClick={save} disabled={saving}>
            {saving ? '保存中…' : '保存设置'}
          </button>
        </div>
      </div>
    </main>
  )
}
