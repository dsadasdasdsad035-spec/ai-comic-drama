import type { SettingsWorkbench } from '../../useSettingsWorkbench'
import { VOICE_SOURCE_LABELS } from '../../../voiceCatalog'
import { modelHasCap } from '../../../modelCaps'
import { generateVoice, type VoiceOption } from '../../../api'

type Props = { wb: SettingsWorkbench }

export function VoicesPane({ wb }: Props) {
  const audioModels = wb.models.filter((m) => modelHasCap(m, 'audio'))
  const voiceProviderId =
    wb.models.find((m) => m.key === wb.voiceModelKey)?.provider ||
    wb.voiceList?.voices[0]?.provider ||
    ''
  const caps = wb.voiceList?.capabilities
  const groups = new Map<string, VoiceOption[]>()
  for (const v of wb.voiceList?.voices ?? []) {
    const key = `${v.provider || '当前渠道'} · ${VOICE_SOURCE_LABELS[v.source || 'preset']}`
    const list = groups.get(key) || []
    list.push(v)
    groups.set(key, list)
  }
  const myCustom = wb.customVoices.filter((v) => !voiceProviderId || v.provider === voiceProviderId)
  const addCustom = () => {
    const voiceId = wb.voiceForm.voiceId.trim()
    if (!voiceId) {
      wb.setVoiceError('先填 voice_id')
      return
    }
    if (!voiceProviderId) {
      wb.setVoiceError('当前模型没有渠道信息，不能添加自定义音色')
      return
    }
    const label = wb.voiceForm.label.trim() || voiceId
    wb.setCustomVoices((prev) => [
      ...prev.filter((v) => !(v.provider === voiceProviderId && v.voiceId === voiceId)),
      {
        id: `${voiceProviderId}:${voiceId}`,
        label,
        provider: voiceProviderId,
        modelKey: wb.voiceModelKey,
        voiceId,
        ...(wb.voiceForm.note.trim() ? { note: wb.voiceForm.note.trim() } : {}),
        createdAt: new Date().toISOString(),
      },
    ])
    wb.setVoiceForm({ label: '', voiceId: '', note: '' })
    wb.setVoiceError('')
  }

  return (
    <section className="st-sec" data-settings-pane="voices">
      <header className="st-sec-head">
        <h3>音色管理</h3>
        <span className="st-hint">
          每个渠道按自己的能力提供预置、账号、克隆/设计和自定义音色；不支持自定义的渠道不会出现新增入口。
        </span>
      </header>
      <div className="st-grid">
        <label className="st-field">
          <span>当前音频模型</span>
          <select value={wb.voiceModelKey} onChange={(e) => wb.setVoiceModelKey(e.target.value)}>
            <option value="">跟随设置默认</option>
            {audioModels.map((m) => (
              <option key={m.key} value={m.key}>
                {m.label}
              </option>
            ))}
          </select>
          <em>切换模型后目录和可新增能力会一起切换</em>
        </label>
        <label className="st-field">
          <span>目录状态</span>
          <button
            className="btn"
            onClick={() => void wb.refreshVoices(true)}
            disabled={wb.voiceLoading || !wb.voiceModelKey}
          >
            {wb.voiceLoading ? '刷新中…' : '刷新音色'}
          </button>
          <em>
            {wb.voiceError ||
              wb.voiceList?.error ||
              (wb.voiceList ? `${wb.voiceList.voices.length} 个音色` : '尚未加载')}
          </em>
        </label>
      </div>
      <p className="st-hint" style={{ marginTop: 8 }}>
        {caps?.supportsCustomVoiceId
          ? '该渠道支持自定义 voice_id：可在下方添加，保存设置后角色卡可选中。'
          : '该渠道只支持预置/系统音色，不提供应用内自定义音色。'}
        {caps?.supportsClone || caps?.supportsDesign ? ' 克隆/设计入口需按渠道能力单独接入。' : ''}
        {wb.voiceList?.providerKind === 'elevenlabs' && (
          <>
            {' '}
            还没有账号音色时，可先到{' '}
            <a href="https://elevenlabs.io/app/voice-lab" target="_blank" rel="noreferrer">
              ElevenLabs VoiceLab
            </a>{' '}
            创建/克隆，再把 voice_id 填到下面。
          </>
        )}
      </p>

      <div className="st-rules">
        {[...groups.entries()].map(([label, list]) => (
          <div key={label} className="st-rule">
            <header>
              <b>{label}</b>
              <span className="st-src">{list.length} 个</span>
            </header>
            {list.map((v) => (
              <div key={`${v.provider}:${v.id}`} className="st-field" style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                <span style={{ flex: 1 }}>
                  {v.label} <code>{v.id}</code>
                </span>
                {v.note && <em>{v.note}</em>}
                <button
                  className="btn-mini"
                  onClick={async () => {
                    try {
                      const r = await generateVoice({
                        text: '这是一段音色试听。',
                        voice: v.id,
                        modelKey: wb.voiceModelKey,
                      })
                      wb.setVoicePreview(r.url)
                    } catch (e) {
                      wb.setVoiceError((e as Error).message)
                    }
                  }}
                >
                  试听
                </button>
              </div>
            ))}
          </div>
        ))}
        {!wb.voiceLoading && (wb.voiceList?.voices.length ?? 0) === 0 && (
          <p className="st-hint">当前目录没有音色。检查 Key/账号音色，或使用预置渠道。</p>
        )}
      </div>

      {caps?.supportsCustomVoiceId && (
        <div className="st-rule" style={{ marginTop: 10 }}>
          <header>
            <b>添加自定义音色</b>
            <span className="st-src">设置库</span>
          </header>
          <div className="st-grid">
            <label className="st-field">
              <span>显示名</span>
              <input
                value={wb.voiceForm.label}
                onChange={(e) => wb.setVoiceForm({ ...wb.voiceForm, label: e.target.value })}
                placeholder="我的音色"
              />
            </label>
            <label className="st-field">
              <span>voice_id</span>
              <input
                value={wb.voiceForm.voiceId}
                onChange={(e) => wb.setVoiceForm({ ...wb.voiceForm, voiceId: e.target.value })}
                placeholder="供应商的 voice id"
              />
            </label>
            <label className="st-field">
              <span>备注</span>
              <input
                value={wb.voiceForm.note}
                onChange={(e) => wb.setVoiceForm({ ...wb.voiceForm, note: e.target.value })}
                placeholder="可选"
              />
            </label>
            <button className="btn" onClick={addCustom}>
              添加
            </button>
          </div>
          {myCustom.length > 0 && (
            <div style={{ marginTop: 8 }}>
              {myCustom.map((v) => (
                <div key={v.id} className="st-field" style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                  <span style={{ flex: 1 }}>
                    {v.label} <code>{v.voiceId}</code>
                  </span>
                  <button
                    className="btn-mini danger"
                    onClick={() => wb.setCustomVoices((prev) => prev.filter((x) => x.id !== v.id))}
                  >
                    删除
                  </button>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {wb.voicePreview && (
        <div style={{ marginTop: 8 }}>
          <span className="st-hint">试听</span>
          <audio src={wb.voicePreview} controls preload="metadata" style={{ display: 'block', width: '100%', height: 32 }} />
        </div>
      )}
    </section>
  )
}