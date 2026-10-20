import { useRef } from 'react'
import { generateImage } from './api'
import { TURNAROUND_SUFFIX, type CharacterSheet } from './characters'

type Props = {
  characters: CharacterSheet[]
  patch: (id: string, p: Partial<CharacterSheet>) => void
  selectedShot: { id: string; no: string } | null
  onInject: (charId: string) => void
}

export default function CharacterBoard({ characters, patch, selectedShot, onInject }: Props) {
  return (
    <div className="board">
      <div className="board-head">
        <div>
          <h2>角色设定板</h2>
          <p>
            三视图锁定外观，<code>lookEn</code> 会原样注入到每个镜头的提示词，保证多镜头长相一致。
          </p>
        </div>
        <div className="board-hint">
          {selectedShot ? `当前镜头 ${selectedShot.no}` : '先在分镜视图里选一个镜头'}
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
          />
        ))}
      </div>
    </div>
  )
}

function CharCard({
  c,
  patch,
  canInject,
  onInject,
}: {
  c: CharacterSheet
  patch: (id: string, p: Partial<CharacterSheet>) => void
  canInject: boolean
  onInject: () => void
}) {
  const fileRef = useRef<HTMLInputElement>(null)
  const candidates = c.candidates ?? []
  const activeIdx = c.activeIdx ?? 0

  const generate = async () => {
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

  return (
    <div className="char-card">
      <div className="char-head">
        <span className="char-name">{c.name}</span>
        <span className="char-role">{c.role}</span>
      </div>

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
        <p>{c.lookCn}</p>
        <code className="char-en">{c.lookEn}</code>
      </div>

      <div className="char-tags">
        <span className="char-palette">{c.palette}</span>
        {c.keywords.map((k) => (
          <span key={k} className="char-tag">{k}</span>
        ))}
      </div>

      {c.state === 'error' && c.error && <div className="gen-error">{c.error}</div>}

      <div className="char-actions">
        <button className="btn" disabled={c.state === 'running'} onClick={generate}>
          {c.image ? '重出三视图' : '生成三视图'} · ¥0.44
        </button>
        <button className="btn-ghost" onClick={() => fileRef.current?.click()}>上传</button>
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
