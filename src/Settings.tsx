import { useEffect, useState } from 'react'
import { getSettings, saveSettings, type AppSettings, type RulePack } from './api'
import { DEFAULT_RULES, normalizeRules } from './prompts'

/**
 * 设置页：大模型 + 技能规则包，存 SQLite settings 表（key=app）。
 *
 * 为什么规则包放这里而不是硬编码：技能守则是「可调的拍摄参数」——
 * 哪条对哪个项目有用要实测，停用/改写不该动代码。
 * 大模型同理：换模型 ID / 换 Key 不该改 vite.config 重启。
 */
type Props = { toast: (m: string) => void }

const MODEL_FIELDS = [
  { key: 'lite', label: '文本 · lite 档', hint: '拆镜外的批量生成默认走这档，便宜' },
  { key: 'pro', label: '文本 · pro 档', hint: '拆镜/重质量生成用，慢但稳' },
  { key: 'image', label: '图像 · Seedream', hint: '首帧图生成模型 ID' },
  { key: 'video', label: '视频 · Seedance', hint: '图生视频模型 ID（首帧模式）' },
  {
    key: 'videoRef',
    label: '视频 · 多参考图',
    hint: 'reference_image 模式模型（1~4 张参考图），默认 Lite I2V',
  },
] as const

const RULE_META = [
  { key: 'script', title: '剧本守则', source: 'script-to-manga', hint: '挂在「生成分集」的系统提示词后' },
  { key: 'character', title: '角色一致性铁律', source: 'character-design-sheet', hint: '三视图/外观锚点生成（Python CLI 消费）' },
  { key: 'shot', title: '拆镜守则', source: 'script-to-manga / storyboard-creation', hint: '挂在「拆镜」的系统提示词后' },
  { key: 'prompt', title: '提示词规范', source: 'video-prompting-guide', hint: '挂在「生成提示词」的系统提示词后' },
] as const

export default function Settings({ toast }: Props) {
  const [models, setModels] = useState<Record<string, string>>({})
  const [apiKey, setApiKey] = useState('')
  const [rules, setRules] = useState<Record<string, RulePack>>(() => normalizeRules())
  const [dbFile, setDbFile] = useState('')
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)

  useEffect(() => {
    getSettings()
      .then(({ settings, db }) => {
        setModels(settings.models || {})
        setApiKey(settings.apiKey || '')
        setRules(normalizeRules(settings.rules))
        setDbFile(db || '')
      })
      .catch((e) => toast(e.message || '读取设置失败'))
      .finally(() => setLoading(false))
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

  const save = async () => {
    setSaving(true)
    try {
      await saveSettings({ models, apiKey, rules } as Partial<AppSettings>)
      toast('设置已保存（存入 SQLite）')
    } catch (e: any) {
      toast(e.message || '保存失败')
    } finally {
      setSaving(false)
    }
  }

  if (loading) return <main className="settings"><div className="wb-empty">加载中…</div></main>

  return (
    <main className="settings">
      <div className="st-scroll">
        <section className="st-sec">
          <header className="st-sec-head">
            <h3>大模型</h3>
            <span className="st-hint">留空 = 用内置默认。改完保存即生效，无需重启。</span>
          </header>
          <div className="st-grid">
            {MODEL_FIELDS.map((f) => (
              <label key={f.key} className="st-field">
                <span>{f.label}</span>
                <input
                  value={models[f.key] ?? ''}
                  placeholder={
                    f.key === 'lite' ? 'doubao-seed-2-0-lite-260428'
                    : f.key === 'pro' ? 'doubao-seed-2-1-pro-260915'
                    : f.key === 'image' ? 'doubao-seedream-4-5-251128'
                    : 'doubao-seedance-1-0-pro-250528'
                  }
                  onChange={(e) => setModels({ ...models, [f.key]: e.target.value })}
                />
                <em>{f.hint}</em>
              </label>
            ))}
            <label className="st-field">
              <span>ARK API Key</span>
              <input
                type="password"
                value={apiKey}
                placeholder="留空 = 沿用 ~/.canghe-skills/.env 里的 ARK_API_KEY"
                onChange={(e) => setApiKey(e.target.value)}
              />
              <em>设置里填的 Key 优先于 .env / 环境变量</em>
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
            项目数据已从 project.json 迁到 SQLite（单文件，含 settings）：
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
