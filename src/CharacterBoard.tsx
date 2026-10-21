import { useRef, useState } from 'react'
import { generateImage } from './api'
import { TURNAROUND_SUFFIX, type CharacterSheet } from './characters'

type Props = {
  characters: CharacterSheet[]
  patch: (id: string, p: Partial<CharacterSheet>) => void
  selectedShot: { id: string; no: string } | null
  onInject: (charId: string) => void
  /** 可用音色（一镜多说话人时按角色取） */
  voices: { id: string; label: string }[]
  onAdd: () => void
  onDelete: (charId: string) => void
  /** 改名 = 换 id，需要同步连线与布局 */
  onRename: (oldId: string, name: string) => void
  /** 大模型拆角色：本集剧本+分镜 / 全剧素材 */
  onExtract: (scope: 'episode' | 'script') => void
  extracting: '' | 'episode' | 'script'
}

export default function CharacterBoard({
  characters,
  patch,
  selectedShot,
  onInject,
  voices,
  onAdd,
  onDelete,
  onRename,
  onExtract,
  extracting,
}: Props) {
  return (
    <div className="board">
      <div className="board-head">
        <div>
          <h2>角色设定板</h2>
          <p>
            三视图锁定外观，<code>lookEn</code> 会原样注入到每个镜头的提示词，保证多镜头长相一致。
          </p>
        </div>
        <div className="board-acts">
          <div className="board-hint">
            {selectedShot ? `当前镜头 ${selectedShot.no}` : '先在分镜视图里选一个镜头'}
          </div>
          <button
            className="btn-ghost"
            disabled={!!extracting}
            onClick={() => onExtract('episode')}
            title="用大模型从本集剧本场次 + 本集分镜里拆出角色，自动写外观锚点"
          >
            {extracting === 'episode' ? '拆解中…' : '从本集拆角色'}
          </button>
          <button
            className="btn-ghost"
            disabled={!!extracting}
            onClick={() => onExtract('script')}
            title="用大模型从全剧原文梗概与分集场次里拆出角色"
          >
            {extracting === 'script' ? '拆解中…' : '从全剧拆角色'}
          </button>
          <button className="btn" onClick={onAdd} title="新建一张角色卡">
            + 新建角色
          </button>
        </div>
      </div>

      <div className="char-grid">
        {characters.map((c) => (
          <CharCard
            key={c.id}
            c={c}
            patch={patch}
            canInject={Boolean(selectedShot)}
            onInject={() => onInject(c.id)}
            voices={voices}
            onDelete={() => onDelete(c.id)}
            onRename={(name) => onRename(c.id, name)}
          />
        ))}
        {characters.length === 0 && (
          <div className="char-empty-board">还没有角色，点右上角「+ 新建角色」开始</div>
        )}
      </div>
    </div>
  )
}

function CharCard({
  c,
  patch,
  canInject,
  onInject,
  voices,
  onDelete,
  onRename,
}: {
  c: CharacterSheet
  patch: (id: string, p: Partial<CharacterSheet>) => void
  canInject: boolean
  onInject: () => void
  voices: { id: string; label: string }[]
  onDelete: () => void
  onRename: (name: string) => void
}) {
  const fileRef = useRef<HTMLInputElement>(null)
  const [editing, setEditing] = useState(false)
  const [name, setName] = useState(c.name)
  const [kw, setKw] = useState(c.keywords.join('、'))
  const candidates = c.candidates ?? []
  const activeIdx = c.activeIdx ?? 0

  const generate = async () => {
    if (!c.lookEn.trim()) {
      patch(c.id, { state: 'error', error: '先填英文外观锚点（lookEn）再生成' })
      return
    }
    patch(c.id, { state: 'running', error: undefined })
    try {
      const res = await generateImage({
        prompt: `${c.lookEn}, ${TURNAROUND_SUFFIX}`,
        ratio: '16:9',
        n: 2,
      })
      const urls = res.urls?.length ? res.urls : [res.url]
      patch(c.id, { candidates: urls, activeIdx: 0, image: urls[0], state: 'idle' })
    } catch (e) {
      patch(c.id, { state: 'error', error: (e as Error).message })
    }
  }

  const upload = (file: File) => {
    const reader = new FileReader()
    reader.onload = () => patch(c.id, { image: String(reader.result), candidates: undefined })
    reader.readAsDataURL(file)
  }

  const commitName = () => {
    if (name.trim() && name.trim() !== c.name) onRename(name.trim())
    else setName(c.name)
  }

  return (
    <div className={`char-card ${editing ? 'editing' : ''}`}>
      <div className="char-head">
        <span className="char-name">{c.name}</span>
        <span className="char-role">{c.role}</span>
        <span className="char-head-acts">
          <button
            className="btn-mini"
            onClick={() => {
              setName(c.name)
              setKw(c.keywords.join('、'))
              setEditing((v) => !v)
            }}
            title="编辑名字 / 外观锚点 / 关键词"
          >
            {editing ? '收起' : '编辑'}
          </button>
          <button
            className="btn-mini danger"
            onClick={() => {
              if (window.confirm(`删除角色「${c.name}」？相关参考连线会一起解除`)) onDelete()
            }}
            title="删除这张角色卡"
          >
            删除
          </button>
        </span>
      </div>

      {editing && (
        <div className="char-edit">
          <label>
            <span>角色名</span>
            <input
              data-char-field="name"
              value={name}
              onChange={(e) => setName(e.target.value)}
              onBlur={commitName}
              onKeyDown={(e) => {
                if (e.key === 'Enter') (e.target as HTMLInputElement).blur()
                if (e.key === 'Escape') setName(c.name)
              }}
            />
          </label>
          <label>
            <span>定位</span>
            <input
              data-char-field="role"
              value={c.role}
              onChange={(e) => patch(c.id, { role: e.target.value })}
              placeholder="主角 · 义体回收人"
            />
          </label>
          <label>
            <span>年龄</span>
            <input
              data-char-field="age"
              value={c.age ?? ''}
              onChange={(e) => patch(c.id, { age: e.target.value })}
              placeholder="28 岁"
            />
          </label>
          <label className="wide">
            <span>中文外观</span>
            <textarea
              data-char-field="lookCn"
              rows={2}
              value={c.lookCn}
              onChange={(e) => patch(c.id, { lookCn: e.target.value })}
            />
          </label>
          <label className="wide">
            <span>英文锚点（lookEn，注入提示词）</span>
            <textarea
              data-char-field="lookEn"
              rows={3}
              value={c.lookEn}
              onChange={(e) => patch(c.id, { lookEn: e.target.value })}
            />
          </label>
          <label>
            <span>配色</span>
            <input
              data-char-field="palette"
              value={c.palette}
              onChange={(e) => patch(c.id, { palette: e.target.value })}
              placeholder="暗灰 + 黄铜"
            />
          </label>
          <label>
            <span>关键词（顿号/逗号分隔）</span>
            <input
              data-char-field="keywords"
              value={kw}
              onChange={(e) => {
                setKw(e.target.value)
                patch(c.id, {
                  keywords: e.target.value
                    .split(/[、,，]/)
                    .map((s) => s.trim())
                    .filter(Boolean),
                })
              }}
            />
          </label>
        </div>
      )}

      {voices.length > 0 && (
        <label className="char-voice" title="这个角色的配音音色；一镜多说话人时按行取">
          <span>音色</span>
          <select
            value={c.voiceId ?? ''}
            onChange={(e) => patch(c.id, { voiceId: e.target.value || undefined })}
          >
            <option value="">跟随镜头</option>
            {voices.map((v) => (
              <option key={v.id} value={v.id}>
                {v.label}
              </option>
            ))}
          </select>
        </label>
      )}

      <div className="char-sheet">
        {c.image ? (
          <img src={c.image} alt={c.name} />
        ) : (
          <div className="char-empty">
            <span>还没有三视图</span>
            <span className="char-empty-sub">点下方「生成三视图」</span>
          </div>
        )}

        {c.state === 'running' && (
          <div className="gen-overlay">
            <span className="spinner" />
            生成中
          </div>
        )}

        {candidates.length > 1 && (
          <div className="cand-bar">
            {candidates.map((u, i) => (
              <button
                key={u}
                className={`cand-dot ${i === activeIdx ? 'on' : ''}`}
                onClick={() => patch(c.id, { activeIdx: i, image: u })}
                title={`候选 ${i + 1}`}
              />
            ))}
          </div>
        )}
      </div>

      <div className="char-look">
        <span className="char-label">外观锚点</span>
        <p>{c.lookCn || '（未填）'}</p>
        <code className="char-en">{c.lookEn || '（未填，生成三视图前必须补）'}</code>
      </div>

      <div className="char-tags">
        {c.palette && <span className="char-palette">{c.palette}</span>}
        {c.keywords.map((k) => (
          <span key={k} className="char-tag">
            {k}
          </span>
        ))}
      </div>

      {c.state === 'error' && c.error && <div className="gen-error">{c.error}</div>}

      <div className="char-actions">
        <button className="btn" disabled={c.state === 'running'} onClick={generate}>
          {c.image ? '重出三视图' : '生成三视图'} · ¥0.44
        </button>
        <button className="btn-ghost" onClick={() => fileRef.current?.click()}>
          上传
        </button>
        <input
          ref={fileRef}
          type="file"
          accept="image/*"
          hidden
          onChange={(e) => {
            const f = e.target.files?.[0]
            if (f) upload(f)
          }}
        />
        <button
          className="btn-ghost"
          disabled={!canInject}
          title={canInject ? '把 lookEn 追加到当前镜头的提示词' : '先在分镜视图选一个镜头'}
          onClick={onInject}
        >
          注入镜头
        </button>
      </div>
    </div>
  )
}
