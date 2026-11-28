import { useCallback, useMemo, useState } from 'react'
import { callText } from './api'
import {
  isValidSubtitleSrt,
  normalizeSrtFromLlm,
  subtitleCardHasExportableSrt,
  subtitleLlmSrtSystemPrompt,
  subtitleLlmUserPrompt,
} from './subtitleCard'
import { resolveTextModelKey, textModelReady } from './assetCardGeneration'
import type { AssetNodeType } from './data'
import type { AppSettings, Cap } from './api'
import type { ShotNodeType } from './data'
import { CapModelSelect } from './ModelSelect'
import { resolveShotsFromSourceIds, type ShotPromptField } from './assetShotPromptRef'

export default function SubtitleAssetPanel({
  node,
  patch,
  onDelete,
  projectName,
  settings,
  pick,
  onPick,
  shotNodes,
}: {
  node: AssetNodeType
  patch: (id: string, p: Record<string, unknown>) => void
  onDelete: (id: string) => void
  projectName: string
  settings: AppSettings | null
  pick: Partial<Record<Cap, string>>
  onPick: (cap: Cap, key: string) => void
  shotNodes: ShotNodeType[]
}) {
  const d = node.data
  const [exportErr, setExportErr] = useState('')
  const [llmBusy, setLlmBusy] = useState(false)
  const [promptNote, setPromptNote] = useState('')
  const srtBody = String((d as { srtBody?: string }).srtBody ?? '')
  const sourceShotIds = d.sourceShotIds ?? []
  const promptSource = (d.promptSource || 'dialogue') as ShotPromptField

  const set = (p: Record<string, unknown>) => patch(node.id, p)

  const linkedShots = useMemo(
    () => resolveShotsFromSourceIds(shotNodes, sourceShotIds),
    [shotNodes, sourceShotIds],
  )

  const textPickKey = pick.text || pick.textPro || ''

  const downloadSrt = useCallback(
    (body: string) => {
      const srt = body.trim()
      if (!subtitleCardHasExportableSrt(srt)) {
        setExportErr('没有可导出的 SRT：请先连线分镜并生成')
        return
      }
      setExportErr('')
      const label = (d.title || 'subtitle').replace(/[^\w\u4e00-\u9fff-]+/g, '_').slice(0, 40)
      const blob = new Blob(['\ufeff', srt], { type: 'text/srt;charset=utf-8' })
      const url = URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = url
      a.download = `${projectName || 'project'}-${label}.srt`
      a.click()
      window.setTimeout(() => URL.revokeObjectURL(url), 1000)
    },
    [d.title, projectName],
  )

  const exportSrt = () => downloadSrt(srtBody)

  const generateSrt = useCallback(async () => {
    if (!linkedShots.length) {
      setExportErr(
        sourceShotIds.length
          ? '已记录分镜引用，但画布上找不到对应分镜卡（可能已删或换了项目）；请重新从分镜拖到本卡，或在字幕卡上右键点选分镜'
          : '请引用分镜文案：从分镜拖到本字幕卡，或右键字幕卡点选分镜（虚线「分镜文案」；实线「参考」不算）',
      )
      return
    }
    const models = settings?.models ?? []
    const key = resolveTextModelKey(textPickKey, settings)
    const ready = textModelReady(key, models)
    if (!ready.ok) {
      setExportErr(ready.reason)
      return
    }
    setExportErr('')
    setLlmBusy(true)
    try {
      const result = await callText({
        system: subtitleLlmSrtSystemPrompt(),
        prompt: subtitleLlmUserPrompt(linkedShots, promptSource, promptNote),
        modelKey: ready.entry.key,
        json: false,
      })
      const normalized = normalizeSrtFromLlm(result.text || '')
      if (!isValidSubtitleSrt(normalized)) {
        setExportErr('模型返回的内容不是有效 SRT，请重试或更换模型')
        return
      }
      set({ srtBody: normalized })
    } catch (e) {
      setExportErr((e as Error).message || '文本生成失败')
    } finally {
      setLlmBusy(false)
    }
  }, [linkedShots, sourceShotIds.length, promptSource, promptNote, settings, textPickKey, set])

  return (
    <aside className="inspector" data-subtitle-asset-panel>
      <header className="panel-head">
        <b>字幕素材卡</b>
        <span className="panel-sid">{node.id.slice(0, 14)}</span>
      </header>
      <label className="field">
        <span>标题</span>
        <input value={d.title} onChange={(e) => set({ title: e.target.value })} />
      </label>
      <p className="st-hint">
        连线分镜后，用文本模型<strong>直接生成 SRT</strong>并下载；不写回镜头台词，整集导出仍用各镜 dialogue。
      </p>
      <div className="field">
        <span>引用字段</span>
        <select
          value={promptSource}
          onChange={(e) => set({ promptSource: e.target.value as ShotPromptField })}
        >
          <option value="dialogue">台词 dialogue</option>
          <option value="video_prompt">出片提示词</option>
        </select>
      </div>
      <div className="field">
        <span>已引用分镜</span>
        <span className="st-hint">
          {linkedShots.length
            ? linkedShots.map((s) => s.no || s.id).join('、')
            : '尚无（从分镜连线到本卡）'}
        </span>
      </div>
      <label className="field">
        <span>生成说明（可选）</span>
        <textarea
          className="prompt-box"
          rows={2}
          value={promptNote}
          onChange={(e) => setPromptNote(e.target.value)}
          placeholder="写给文本模型的额外要求"
        />
      </label>
      <CapModelSelect
        cap="text"
        caps={['text', 'textPro']}
        label="文本模型"
        settings={settings}
        value={textPickKey}
        onChange={(key) => onPick('text', key)}
      />
      <label className="field">
        <span>SRT 正文</span>
        <textarea
          className="prompt-box"
          rows={12}
          value={srtBody}
          onChange={(e) => set({ srtBody: e.target.value })}
          placeholder="生成后在此预览，也可手改正文再保存项目"
          data-subtitle-srt-body
        />
      </label>
      <button
        type="button"
        className="gen-go"
        disabled={llmBusy}
        onClick={() => void generateSrt()}
        data-subtitle-generate-srt
      >
        {llmBusy ? '生成中…' : '生成 SRT'}
      </button>
      <button type="button" className="btn" onClick={exportSrt} data-subtitle-export>
        下载 SRT 文件
      </button>
      {exportErr ? <p className="st-hint error-text">{exportErr}</p> : null}
      <button className="btn-ghost reset" onClick={() => onDelete(node.id)}>
        删除素材卡
      </button>
    </aside>
  )
}