import { useMemo } from 'react'
import type { AppSettings, Cap } from './api'
import type { AssetNodeType, ShotNodeType } from './data'
import { isMusicAudioModel, resolveMusicModelKey } from './assetCardGeneration'
import { resolveShotsFromSourceIds, type ShotPromptField } from './assetShotPromptRef'
import { CapModelSelect } from './ModelSelect'

type Props = {
  node: AssetNodeType
  patch: (id: string, p: Record<string, unknown>) => void
  onDelete: (id: string) => void
  settings: AppSettings | null
  pick: Partial<Record<Cap, string>>
  onPick: (cap: Cap, key: string) => void
  onGenerate?: (id: string) => void
  shotNodes?: ShotNodeType[]
}

/** 画布音乐素材卡：风格 / 歌词 / 时长 + 分镜引用 */
export default function MusicAssetPanel({
  node,
  patch,
  onDelete,
  settings,
  pick,
  onPick,
  onGenerate,
  shotNodes = [],
}: Props) {
  const d = node.data
  const set = (p: Record<string, unknown>) => patch(node.id, p)
  const linkedLabel = useMemo(() => {
    const linked = resolveShotsFromSourceIds(shotNodes, d.sourceShotIds ?? [])
    return linked.length ? linked.map((s) => s.no || s.id).join('、') : '尚无（从分镜拖到本卡）'
  }, [shotNodes, d.sourceShotIds])

  return (
    <aside className="inspector">
      <header className="panel-head">
        <b>音乐素材卡</b>
        <span className="panel-sid">{node.id.slice(0, 14)}</span>
      </header>
      <label className="field">
        <span>标题</span>
        <input value={d.title} onChange={(e) => set({ title: e.target.value })} />
      </label>
      <label className="field">
        <span>风格 / 情绪描述</span>
        <textarea
          className="prompt-box"
          value={d.prompt ?? ''}
          onChange={(e) => set({ prompt: e.target.value })}
          rows={4}
          placeholder="BPM、乐器、情绪；可连线分镜合并进描述"
        />
      </label>
      <label className="field">
        <span>目标时长（秒）</span>
        <input
          type="number"
          min={1}
          max={240}
          value={Number(d.musicLength) || 30}
          onChange={(e) =>
            set({
              musicLength: Math.min(240, Math.max(1, Math.round(Number(e.target.value) || 30))),
            })
          }
        />
      </label>
      <label className="field">
        <span>歌词（可选）</span>
        <textarea
          className="prompt-box"
          rows={3}
          value={String(d.musicLyrics ?? '')}
          onChange={(e) => set({ musicLyrics: e.target.value })}
          placeholder="留空则纯器乐；风格或歌词至少填一项"
        />
      </label>
      <p className="st-hint">Flow Music；需 APIMart Key 与代理。成片时长可能长于目标值。</p>
      <div className="field">
        <span>分镜引用字段</span>
        <select
          value={(d.promptSource as ShotPromptField) || 'dialogue'}
          onChange={(e) => set({ promptSource: e.target.value })}
        >
          <option value="dialogue">台词 dialogue</option>
          <option value="video_prompt">出片提示词</option>
        </select>
      </div>
      <div className="field">
        <span>已引用分镜</span>
        <span className="st-hint">{linkedLabel}</span>
      </div>
      <div className="field">
        <span>预览</span>
        {d.url ? (
          <div className="asset-preview asset-preview-audio">
            <audio src={d.url} controls preload="metadata" />
            <span className="st-hint">连线到出片镜时作为音频参考</span>
          </div>
        ) : (
          <div className="refx-empty">尚未生成</div>
        )}
      </div>
      <CapModelSelect
        cap="audio"
        defaultCap="music"
        label="音乐模型"
        settings={settings}
        value={pick.music}
        onChange={(key) => onPick('music', key)}
        filterEntry={isMusicAudioModel}
      />
      {onGenerate ? (
        <button
          type="button"
          className="gen-go"
          disabled={d.genState === 'running'}
          onClick={() => onGenerate(node.id)}
        >
          {d.genState === 'running' ? '作曲中…' : '生成音乐'}
        </button>
      ) : null}
      {d.genError ? <p className="st-hint error-text">{d.genError}</p> : null}
      <p className="st-hint muted">
        当前解析：{resolveMusicModelKey(pick.music, settings) || '（未配置）'}
      </p>
      <button className="btn-ghost reset" onClick={() => onDelete(node.id)}>
        删除素材卡
      </button>
    </aside>
  )
}