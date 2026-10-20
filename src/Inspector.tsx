import type { ShotData } from './types'
import { CANDIDATE_COUNTS, MOVES, PRICE_PER_IMAGE, RATIOS, SHOT_SIZES, VOICE_RATES } from './types'
import type { VoiceOption } from './api'
import type { ShotNodeType } from './data'

type Props = {
  node: ShotNodeType | null
  patch: (id: string, patch: Partial<ShotData>) => void
  onDelete: (id: string) => void
  onReset: () => void
  onGenerate: (id: string) => void
  ratio: string
  setRatio: (v: string) => void
  refMode: boolean
  setRefMode: (v: boolean) => void
  marksAsGuide: boolean
  setMarksAsGuide: (v: boolean) => void
  candCount: number
  setCandCount: (v: number) => void
  vidRes: '480p' | '720p'
  setVidRes: (v: '480p' | '720p') => void
  onGenerateVideo: (id: string) => void
  onVoice: (id: string) => void
  voices: VoiceOption[]
  voiceProvider: string
}

export default function Inspector({
  node,
  patch,
  onDelete,
  onReset,
  onGenerate,
  ratio,
  setRatio,
  refMode,
  setRefMode,
  marksAsGuide,
  setMarksAsGuide,
  candCount,
  setCandCount,
  vidRes,
  setVidRes,
  onGenerateVideo,
  onVoice,
  voices,
  voiceProvider,
}: Props) {
  if (!node) {
    return (
      <aside className="inspector">
        <div className="panel-empty">
          <h3>未选中镜头</h3>
          <p>点击画布上的分镜卡片查看参数。</p>
          <ul>
            <li><b>V</b> 选择模式 · 拖动卡片、拉连线</li>
            <li><b>P</b> 画笔 · 在画面上画构图标记</li>
            <li><b>R</b> 框选 · 圈出主体位置</li>
            <li>把图片<b>拖进卡片</b>即可替换参考图</li>
            <li>点连线中间的文字可切换关系类型</li>
            <li>编辑内容自动存在浏览器本地</li>
          </ul>
          <button className="btn-ghost reset" onClick={onReset}>恢复示例分镜</button>
        </div>
      </aside>
    )
  }

  const d = node.data
  const set = (p: Partial<ShotData>) => patch(node.id, p)

  return (
    <aside className="inspector">
      <div className="panel-title">
        <span className="panel-no">{d.no}</span>
        {d.shotId && (
          <code className="panel-sid" title="project.json 里的稳定 ID，同步靠它">
            {d.shotId}
          </code>
        )}
        {d.orphan && <em className="panel-orphan" title="project.json 里已没有这一镜">孤儿</em>}
        <span className="spacer" />
        <button className="btn-ghost" onClick={() => onDelete(node.id)}>删除</button>
      </div>

      <label className="field">
        <span>镜号</span>
        <input value={d.no} onChange={(e) => set({ no: e.target.value })} />
      </label>

      <div className="field-row">
        <label className="field">
          <span>时长（秒）</span>
          <input
            type="number"
            step="0.1"
            min="0.1"
            value={d.seconds}
            onChange={(e) => set({ seconds: Number(e.target.value) || 0.1 })}
          />
        </label>
        <label className="field">
          <span>景别</span>
          <select value={d.size} onChange={(e) => set({ size: e.target.value })}>
            {SHOT_SIZES.map((s) => <option key={s}>{s}</option>)}
          </select>
        </label>
      </div>

      <label className="field">
        <span>运镜</span>
        <select value={d.move} onChange={(e) => set({ move: e.target.value })}>
          {MOVES.map((s) => <option key={s}>{s}</option>)}
        </select>
      </label>

      <label className="field">
        <span>台词 / 音效</span>
        <textarea rows={2} value={d.dialogue} onChange={(e) => set({ dialogue: e.target.value })} />
      </label>

      <div className="gen-box voice-box">
        <div className="gen-head">
          <span>台词配音</span>
          <span className="gen-cost">
            {d.voiceUrl ? `${(d.voiceSeconds ?? 0).toFixed(1)}s · ` : ''}
            {voiceProvider === 'elevenlabs' ? 'ElevenLabs' : voiceProvider === 'macos-say' ? 'macOS TTS' : '无可用引擎'}
          </span>
        </div>
        <div className="gen-controls">
          <select
            value={d.voiceName ?? voices[0]?.id ?? ''}
            onChange={(e) => set({ voiceName: e.target.value })}
            title="发音人"
            disabled={voices.length === 0}
          >
            {voices.length === 0 ? (
              <option value="">（无可用音色）</option>
            ) : (
              voices.map((v) => (
                <option key={v.id} value={v.id}>{v.label}</option>
              ))
            )}
          </select>
          <select
            value={d.voiceRate ?? 180}
            onChange={(e) => set({ voiceRate: Number(e.target.value) })}
            title="语速"
          >
            {VOICE_RATES.map((r) => (
              <option key={r} value={r}>
                {r === 150 ? '慢' : r === 180 ? '中' : '快'}
              </option>
            ))}
          </select>
        </div>
        <button
          className="btn primary block"
          disabled={d.voiceState === 'running' || !d.dialogue.trim() || voices.length === 0}
          onClick={() => onVoice(node.id)}
          title={d.dialogue.trim() ? '根据台词合成配音' : '先填台词'}
        >
          {d.voiceState === 'running' ? '配音中…' : d.voiceUrl ? '重新配音' : '生成配音'}
        </button>
        {d.voiceState === 'error' && d.voiceError && <div className="gen-error">{d.voiceError}</div>}
        {d.voiceUrl && <audio className="voice-audio" src={d.voiceUrl} controls preload="metadata" />}
        {(d.voiceSeconds ?? 0) > d.seconds + 0.2 && (
          <div className="gen-warn">
            配音 {(d.voiceSeconds ?? 0).toFixed(1)}s 超过镜头 {d.seconds.toFixed(1)}s，成片会被截断 ——
            要么拉长镜头时长，要么缩短台词
          </div>
        )}
        {(d.voiceSeconds ?? 0) > d.seconds + 0.2 && (
          <div className="gen-warn">
            配音 {(d.voiceSeconds ?? 0).toFixed(1)}s 超过镜头 {d.seconds.toFixed(1)}s，成片会被截断 ——
            要么拉长镜头时长，要么缩短台词
          </div>
        )}
      </div>

      <label className="field">
        <span>画面提示词</span>
        <textarea rows={4} value={d.prompt} onChange={(e) => set({ prompt: e.target.value })} />
      </label>

      <div className="gen-box">
        <div className="gen-head">
          <span>AI 生成画面</span>
          <span className="gen-cost">Seedream 4.5 · ¥{(candCount * PRICE_PER_IMAGE).toFixed(2)} / 次</span>
        </div>

        <div className="gen-controls">
          <select value={ratio} onChange={(e) => setRatio(e.target.value)} title="画幅">
            {RATIOS.map((r) => (
              <option key={r} value={r}>{r}</option>
            ))}
          </select>
          <select
            value={candCount}
            onChange={(e) => setCandCount(Number(e.target.value))}
            title="一次出图张数"
          >
            {CANDIDATE_COUNTS.map((c) => (
              <option key={c} value={c}>{c} 张</option>
            ))}
          </select>
        </div>

        <label className="chk">
          <input type="checkbox" checked={refMode} onChange={(e) => setRefMode(e.target.checked)} />
          用当前画面作参考
        </label>

        <label className={`chk ${!refMode || d.marks.length === 0 ? 'dim' : ''}`}>
          <input
            type="checkbox"
            checked={marksAsGuide}
            disabled={!refMode || d.marks.length === 0}
            onChange={(e) => setMarksAsGuide(e.target.checked)}
          />
          标注作为构图约束
          <span className="chk-note">
            {d.marks.length === 0 ? '（先画框）' : !refMode ? '（需开启参考图）' : `（${d.marks.length} 个标注）`}
          </span>
        </label>

        <button
          className="btn primary block"
          disabled={d.genState === 'running'}
          onClick={() => onGenerate(node.id)}
        >
          {d.genState === 'running' ? '生成中…' : `生成画面${candCount > 1 ? ` ×${candCount}` : ''}`}
        </button>

        {d.genState === 'error' && d.genError && <div className="gen-error">{d.genError}</div>}
      </div>

      <div className="gen-box vid-box">
        <div className="gen-head">
          <span>AI 生成视频</span>
          <span className="gen-cost">Seedance 图生视频</span>
        </div>
        <div className="gen-controls">
          <select value={vidRes} onChange={(e) => setVidRes(e.target.value as '480p' | '720p')} title="分辨率">
            <option value="480p">480p</option>
            <option value="720p">720p</option>
          </select>
          <span className="vid-len">
            {Math.min(12, Math.max(2, Math.round(d.seconds)))}s · {d.move === '固定' ? '固定机位' : `运镜 ${d.move}`}
          </span>
        </div>
        <p className="vid-note">
          以卡片当前画面为首帧，提示词沿用画面描述。时长取镜头时长（2~12 秒），按 tokens 计费。
        </p>
        <button
          className="btn primary block"
          disabled={d.vidState === 'running' || !d.refImage}
          onClick={() => onGenerateVideo(node.id)}
          title={d.refImage ? '' : '先生成画面'}
        >
          {d.vidState === 'running' ? '出片中…' : d.videoUrl ? '重出视频' : '生成视频'}
        </button>
        {d.vidState === 'error' && d.vidError && <div className="gen-error">{d.vidError}</div>}
        {d.videoUrl && (
          <>
            <video className="vid-thumb" src={d.videoUrl} muted loop autoPlay playsInline />
            <a className="btn-ghost vid-save" href={d.videoUrl} download={`${d.shotId || d.no}.mp4`}>
              保存成片
            </a>
          </>
        )}
      </div>

      <div className="field">
        <span>参考图</span>
        <div className="ref-thumb">
          {d.refImage ? <img src={d.refImage} alt="ref" /> : <div className="ref-empty">拖图进卡片</div>}
        </div>
        <div className="ref-actions">
          <label className="btn-ghost file">
            更换
            <input
              type="file"
              accept="image/*"
              onChange={(e) => {
                const f = e.target.files?.[0]
                if (!f) return
                const r = new FileReader()
                r.onload = () => set({ refImage: String(r.result), videoUrl: undefined, vidState: 'idle' })
                r.readAsDataURL(f)
              }}
            />
          </label>
          {d.refImage && (
            <button className="btn-ghost" onClick={() => set({ refImage: undefined, videoUrl: undefined, vidState: 'idle' })}>移除</button>
          )}
        </div>
      </div>

      <div className="field">
        <span>构图标注（{d.marks.length}）</span>
        <button className="btn-ghost" disabled={!d.marks.length} onClick={() => set({ marks: [] })}>
          清除全部标注
        </button>
      </div>

      <div className="panel-foot">
        <div>节点 ID：{node.id.slice(0, 8)}</div>
        <div>坐标：{Math.round(node.position.x)}, {Math.round(node.position.y)}</div>
      </div>
    </aside>
  )
}
