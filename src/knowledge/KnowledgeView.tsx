import { useCallback, useEffect, useState } from 'react'
import {
  createKnowledgeBase,
  deleteKnowledgeBase,
  getKnowledgeAcceptedTypes,
  getKnowledgeBases,
  getKnowledgeDocs,
  getKnowledgeSettings,
  purgeKnowledgeDocs,
  removeKnowledgeDocs,
  renameKnowledgeBase,
  uploadKnowledgeDoc,
  type KnowledgeBaseSummary,
  type KnowledgeDoc,
  type KnowledgeSettingsView,
} from '../api'

/**
 * 知识库视图（全局，只做维护）。
 *
 * 为什么这里没有问答：问答统一在创意会话里（模型按会话选定的库检索）。
 * 本页只承载「建库 / 上传 / 清理」，见 openspec 变更 knowledge-base-library-model。
 *
 * 四个状态必须都能画出来：
 * 1. 未配置 → 整页引导，不是报错框；
 * 2. 连不上 → 保留上次已知清单并显示可重试连接条，不整体空白；
 * 3. 还没有库 → 空态 + 新建入口（不再自动建库：库名是用户的，自动建等于造垃圾）；
 * 4. 正常 → 左库列表 + 右文档清单。
 */

type Props = {
  toast: (message: string) => void
  /** 跳到设置页的知识库面板；未配置时引导用 */
  onOpenSettings: () => void
}

const NAME_MAX = 60

export default function KnowledgeView({ toast, onOpenSettings }: Props) {
  const [settings, setSettings] = useState<KnowledgeSettingsView | null>(null)
  const [bases, setBases] = useState<KnowledgeBaseSummary[]>([])
  const [activeId, setActiveId] = useState('')
  const [docs, setDocs] = useState<KnowledgeDoc[]>([])
  const [loading, setLoading] = useState(true)
  const [loadingDocs, setLoadingDocs] = useState(false)
  /** 连接错误：与「未配置」区分，这条只是可重试的横幅 */
  const [connError, setConnError] = useState('')
  /** 当前库的上游 workspace 已不存在：文档区给出「删记录重建」的说明 */
  const [docsError, setDocsError] = useState('')
  const [uploading, setUploading] = useState(false)
  const [accepted, setAccepted] = useState<string[]>([])
  const [busyDoc, setBusyDoc] = useState('')
  const [busyBase, setBusyBase] = useState('')

  const active = bases.find((b) => b.id === activeId) || null

  const loadBases = useCallback(async (keepId?: string) => {
    setConnError('')
    const list = await getKnowledgeBases()
    setBases(list)
    // 选中项要跟着列表走：删掉当前库后不能继续显示它的文档
    const want = keepId ?? ''
    const next = list.find((b) => b.id === want) || list[0]
    setActiveId(next?.id || '')
    return list
  }, [])

  const loadDocs = useCallback(async (kbId: string) => {
    if (!kbId) {
      setDocs([])
      setDocsError('')
      return
    }
    setLoadingDocs(true)
    setDocsError('')
    try {
      const result = await getKnowledgeDocs(kbId)
      setDocs(result.documents)
    } catch (e) {
      // 上游库被手工删了：保留空清单 + 可读说明，不假装成功
      setDocs([])
      setDocsError((e as Error).message || '读取文档清单失败')
    } finally {
      setLoadingDocs(false)
    }
  }, [])

  const boot = useCallback(async () => {
    setConnError('')
    try {
      const view = await getKnowledgeSettings()
      setSettings(view)
      if (!view.enabled) {
        setLoading(false)
        return
      }
      await loadBases()
    } catch (e) {
      setConnError((e as Error).message || '读取知识库失败')
    } finally {
      setLoading(false)
    }
  }, [loadBases])

  useEffect(() => {
    void boot()
  }, [boot])

  useEffect(() => {
    void loadDocs(activeId)
  }, [activeId, loadDocs])

  useEffect(() => {
    // 类型清单只认上游：拉一次即可，失败不阻塞上传（选择器退回不限类型）
    void getKnowledgeAcceptedTypes()
      .then((r) => setAccepted(r.extensions))
      .catch(() => setAccepted([]))
  }, [])

  const createBase = async () => {
    const name = window.prompt(`新知识库名称（最多 ${NAME_MAX} 字）`, '')
    if (name == null) return
    const trimmed = name.trim()
    if (!trimmed) return
    try {
      const base = await createKnowledgeBase(trimmed)
      toast(`已创建知识库：${base.name}`)
      await loadBases(base.id)
    } catch (e) {
      toast((e as Error).message || '创建知识库失败')
    }
  }

  const renameBase = async (base: KnowledgeBaseSummary) => {
    const name = window.prompt('重命名知识库', base.name)
    if (name == null) return
    const trimmed = name.trim()
    if (!trimmed || trimmed === base.name) return
    setBusyBase(base.id)
    try {
      const next = await renameKnowledgeBase(base.id, trimmed)
      toast(`已改名为：${next.name}`)
      await loadBases(base.id)
    } catch (e) {
      toast((e as Error).message || '改名失败')
    } finally {
      setBusyBase('')
    }
  }

  const deleteBase = async (base: KnowledgeBaseSummary) => {
    /*
     * 确认文案必须说清「文档还在」：用户最怕的是删库把资料一起删了。
     * 实际上删库只删本应用的库记录与上游的文档引用集合，文档池不受影响。
     */
    const n = base.docCount == null ? '若干' : String(base.docCount)
    const ok = window.confirm(
      `删除知识库「${base.name}」？\n\n` +
        `库内的 ${n} 份文档不会被从文档池删除，只是不再属于这个库；` +
        `如果它们只在这个库里，之后将没有库能检索到它们。\n\n` +
        `删除后，选了这个库的创意会话需要重新选择知识库。`,
    )
    if (!ok) return
    setBusyBase(base.id)
    try {
      const r = await deleteKnowledgeBase(base.id)
      toast(`已删除知识库：${r.name}`)
      await loadBases('')
      if (r.warnings?.length) toast(r.warnings[0])
    } catch (e) {
      toast((e as Error).message || '删除知识库失败')
    } finally {
      setBusyBase('')
    }
  }

  const doUpload = async (files: FileList | null) => {
    if (!files?.length || !active) return
    // 先固化成数组：onChange 会立刻清空 input，FileList 也随之变空
    const list = Array.from(files)
    setUploading(true)
    // 逐个上传：上游每个文件单独解析，一个失败不能拖垮其余
    const failed: string[] = []
    for (const file of list) {
      try {
        await uploadKnowledgeDoc(active.id, file)
      } catch (e) {
        failed.push(`${file.name}：${(e as Error).message}`)
      }
    }
    setUploading(false)
    if (failed.length) {
      toast(`${failed.length} 个文件上传失败：${failed[0]}${failed.length > 1 ? ' 等' : ''}`)
    } else {
      toast(`已上传 ${list.length} 个文件`)
    }
    await Promise.all([loadDocs(active.id), loadBases(active.id)])
  }

  const removeDoc = async (doc: KnowledgeDoc) => {
    if (!active) return
    setBusyDoc(doc.location)
    try {
      await removeKnowledgeDocs(active.id, [doc.location])
      toast(`已移出本库：${doc.title}`)
      await Promise.all([loadDocs(active.id), loadBases(active.id)])
    } catch (e) {
      toast((e as Error).message || '移出失败')
    } finally {
      setBusyDoc('')
    }
  }

  const purgeDoc = async (doc: KnowledgeDoc) => {
    const ok = window.confirm(
      `彻底删除「${doc.title}」？\n\n` +
        `这会从实例文档池删除该文档，其它库如果也挂了同一份文档，会一并失效。\n` +
        `只想从这个库移除，请用「移出」。`,
    )
    if (!ok) return
    setBusyDoc(doc.location)
    try {
      await purgeKnowledgeDocs([doc.location])
      toast(`已彻底删除：${doc.title}`)
      await Promise.all([loadDocs(activeId), loadBases(activeId)])
    } catch (e) {
      toast((e as Error).message || '删除失败')
    } finally {
      setBusyDoc('')
    }
  }

  // ---- 未配置：整页引导
  if (!loading && settings && !settings.enabled) {
    return (
      <div className="kb-view" data-knowledge-view data-knowledge-unconfigured>
        <div className="kb-guide">
          <h2>知识库还没有连接</h2>
          <p>
            知识库是一个可选的伴生服务：上传文档后，创意会话里的助手能按需检索。
            不配置它不影响其它任何功能。
          </p>
          <ol>
            <li>
              启动一个 AnythingLLM 实例（默认 <code>127.0.0.1:3001</code>）。
              <br />
              <small>
                docker run -d -p 3001:3001 --cap-add SYS_ADMIN
                -v ~/anythingllm:/app/server/storage
                -e STORAGE_DIR=/app/server/storage mintplexlabs/anythingllm
              </small>
            </li>
            <li>在它的界面里生成一个 API Key（Settings → API Keys）。</li>
            <li>
              把地址与 Key 填进本应用的设置，点「保存并测试连接」。
              <br />
              <small>
                <strong>对话模型不用你去上游配</strong>：本应用会把自己已配好的 MiniMax
                渠道自动推过去。向量化模型用上游内置的即可。
              </small>
            </li>
          </ol>
          <button type="button" className="btn" data-knowledge-goto-settings onClick={onOpenSettings}>
            去设置里填写
          </button>
        </div>
      </div>
    )
  }

  return (
    <div className="kb-view" data-knowledge-view>
      <header className="kb-head">
        <div>
          <h2>知识库</h2>
          <span className="kb-sub">
            {bases.length
              ? `${bases.length} 个库 · 问答在创意会话里（会话头部选库）`
              : '还没有知识库'}
          </span>
        </div>
        <div className="kb-head-actions">
          <button
            type="button"
            className="btn"
            data-knowledge-create
            onClick={() => void createBase()}
          >
            新建知识库
          </button>
          <button type="button" className="btn-ghost" onClick={() => void boot()} title="重新读取">
            刷新
          </button>
        </div>
      </header>

      {connError ? (
        <div className="kb-banner" data-knowledge-conn-error>
          <span>{connError}</span>
          <button type="button" className="btn-ghost" onClick={() => void boot()}>
            重试
          </button>
        </div>
      ) : null}

      <div className="kb-body">
        <section className="kb-bases" data-knowledge-base-list>
          <div className="kb-docs-head">
            <strong>库</strong>
          </div>
          {loading ? (
            <div className="kb-empty">正在读取…</div>
          ) : bases.length === 0 ? (
            <div className="kb-empty" data-knowledge-no-base>
              还没有知识库。新建一个，再把剧本、设定或参考资料传进去。
            </div>
          ) : (
            <ul>
              {bases.map((b) => (
                <li
                  key={b.id}
                  data-knowledge-base-row
                  data-active={b.id === activeId ? '' : undefined}
                  className={b.id === activeId ? 'is-active' : undefined}
                  onClick={() => setActiveId(b.id)}
                >
                  <div className="kb-doc-main">
                    <span className="kb-doc-title" title={b.upstreamSlug}>
                      {b.name}
                    </span>
                    <span className="kb-doc-meta">
                      {b.broken
                        ? '上游已丢失'
                        : b.docCount == null
                          ? '—'
                          : `${b.docCount} 份文档`}
                    </span>
                  </div>
                  <div className="kb-doc-actions">
                    <button
                      type="button"
                      className="btn-ghost"
                      disabled={busyBase === b.id}
                      onClick={(e) => {
                        e.stopPropagation()
                        void renameBase(b)
                      }}
                    >
                      改名
                    </button>
                    <button
                      type="button"
                      className="btn-ghost is-danger"
                      data-knowledge-delete-base
                      disabled={busyBase === b.id}
                      onClick={(e) => {
                        e.stopPropagation()
                        void deleteBase(b)
                      }}
                    >
                      删除
                    </button>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </section>

        <section className="kb-docs" data-knowledge-doc-list>
          <div className="kb-docs-head">
            <strong>{active ? `${active.name} 的文档` : '文档'}</strong>
            {accepted.length ? <span className="kb-accept">支持 {accepted.join(' ')}</span> : null}
            {active ? (
              <label className={`btn ${uploading ? 'is-busy' : ''}`} data-knowledge-upload>
                {uploading ? '上传中…' : '上传文档'}
                <input
                  type="file"
                  multiple
                  hidden
                  accept={accepted.join(',')}
                  onChange={(e) => {
                    void doUpload(e.target.files)
                    e.currentTarget.value = ''
                  }}
                />
              </label>
            ) : null}
          </div>
          {!active ? (
            <div className="kb-empty">先在上面选一个库，或新建一个。</div>
          ) : loadingDocs ? (
            <div className="kb-empty">正在读取…</div>
          ) : docsError ? (
            <div className="kb-empty" data-knowledge-doc-error>
              {docsError}
            </div>
          ) : docs.length === 0 ? (
            <div className="kb-empty" data-knowledge-empty>
              这个库还没有文档。上传剧本、设定或参考资料，创意会话里提问时就会用到。
            </div>
          ) : (
            <ul>
              {docs.map((d) => (
                <li key={d.location} data-knowledge-doc-row>
                  <div className="kb-doc-main">
                    <span className="kb-doc-title" title={d.location}>
                      {d.title || d.location}
                    </span>
                    {d.wordCount ? <span className="kb-doc-meta">{d.wordCount} 词</span> : null}
                  </div>
                  <div className="kb-doc-actions">
                    <button
                      type="button"
                      className="btn-ghost"
                      disabled={busyDoc === d.location}
                      onClick={() => void removeDoc(d)}
                      title="只从这个库移除，文档留在实例文档池"
                    >
                      移出
                    </button>
                    <button
                      type="button"
                      className="btn-ghost is-danger"
                      disabled={busyDoc === d.location}
                      onClick={() => void purgeDoc(d)}
                      title="从实例文档池彻底删除"
                    >
                      删除
                    </button>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </section>
      </div>
    </div>
  )
}
