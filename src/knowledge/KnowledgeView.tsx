import { useCallback, useEffect, useRef, useState } from 'react'
import {
  KnowledgeError,
  getKnowledgeAcceptedTypes,
  getKnowledgeDocs,
  getKnowledgeHistory,
  getKnowledgeSettings,
  purgeKnowledgeDocs,
  removeKnowledgeDocs,
  streamKnowledgeChat,
  uploadKnowledgeDoc,
  type KnowledgeDoc,
  type KnowledgeHistoryItem,
  type KnowledgeSettingsView,
  type KnowledgeSource,
} from '../api'
import { KnowledgeCitations } from './KnowledgeCitations'
import { normalizeStreamSources, stripReasoning } from './stripReasoning'

/**
 * 上游「库里没有任何内容」时的固定英文回答。
 * 换行与空白不固定，用宽松匹配。
 */
const NO_HIT_RE = /there is no relevant information in this workspace/i

type Props = {
  projectName: string
  toast: (message: string) => void
  /** 跳到设置页的知识库面板；未配置时引导用 */
  onOpenSettings: () => void
}

type Msg = { role: 'user' | 'assistant'; content: string; sources: KnowledgeSource[] }

/**
 * 知识库视图（项目级）。
 *
 * 四个状态必须都能画出来：
 * 1. 未配置 → 整页引导，不是报错框；
 * 2. 连不上 → 保留上次已知清单并显示可重试连接条，不整体空白；
 * 3. 首次进入且库不存在 → 服务端自动建库，页面只显示加载态；
 * 4. 正常 → 左清单 + 右问答。
 *
 * 问答历史存在上游（按 sessionId 分区），本地不留副本：两套真相必然漂移。
 */
export default function KnowledgeView({ projectName, toast, onOpenSettings }: Props) {
  const [settings, setSettings] = useState<KnowledgeSettingsView | null>(null)
  const [docs, setDocs] = useState<KnowledgeDoc[]>([])
  const [slug, setSlug] = useState('')
  const [loading, setLoading] = useState(true)
  /** 连接错误：与「未配置」区分，这条只是可重试的横幅 */
  const [connError, setConnError] = useState('')
  const [uploading, setUploading] = useState(false)
  const [accepted, setAccepted] = useState<string[]>([])
  const [messages, setMessages] = useState<Msg[]>([])
  const [question, setQuestion] = useState('')
  const [asking, setAsking] = useState(false)
  const [busyDoc, setBusyDoc] = useState('')
  const abortRef = useRef<AbortController | null>(null)
  const listRef = useRef<HTMLDivElement | null>(null)

  const load = useCallback(async () => {
    setConnError('')
    try {
      const view = await getKnowledgeSettings()
      setSettings(view)
      if (!view.enabled) {
        setLoading(false)
        return
      }
      try {
        const result = await getKnowledgeDocs(projectName)
        setDocs(result.documents)
        setSlug(result.slug)
        const hist = await getKnowledgeHistory(projectName).catch(() => [])
        setMessages(
          (hist as KnowledgeHistoryItem[]).map((h) => ({
            role: h.role,
            // 历史是上游原文，同样可能带推理块
            content: h.role === 'assistant' ? stripReasoning(h.content) : h.content,
            sources: h.sources || [],
          })),
        )
      } catch (e) {
        // 已配置但连不上：保留上次清单，只显示可重试的连接条
        setConnError((e as Error).message || '连接知识库失败')
      }
    } catch (e) {
      setConnError((e as Error).message || '读取知识库设置失败')
    } finally {
      setLoading(false)
    }
  }, [projectName])

  useEffect(() => {
    setDocs([])
    setMessages([])
    setSlug('')
    setLoading(true)
    void load()
  }, [load])

  useEffect(() => {
    // 类型清单只认上游：拉一次即可，失败不阻塞上传（选择器退回不限类型）
    void getKnowledgeAcceptedTypes()
      .then((r) => setAccepted(r.extensions))
      .catch(() => setAccepted([]))
  }, [])

  useEffect(() => {
    const el = listRef.current
    if (el) el.scrollTop = el.scrollHeight
  }, [messages])

  const doUpload = async (files: FileList | null) => {
    if (!files?.length) return
    // 先固化成数组：调用方的 onChange 会立刻清空 input，FileList 也随之变空，
    // 之后再读 files.length 就永远是 0（表现为「已上传 0 个文件」）。
    const list = Array.from(files)
    setUploading(true)
    // 逐个上传：上游每个文件单独解析，一个失败不能拖垮其余
    const failed: string[] = []
    for (const file of list) {
      try {
        await uploadKnowledgeDoc(projectName, file)
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
    await load()
  }

  const ask = async () => {
    const text = question.trim()
    if (!text || asking) return
    setAsking(true)
    setQuestion('')
    setMessages((prev) => [...prev, { role: 'user', content: text, sources: [] }])
    // 先放一条空的助手消息，流式往里追加
    setMessages((prev) => [...prev, { role: 'assistant', content: '', sources: [] }])
    const ctrl = new AbortController()
    abortRef.current = ctrl
    try {
      let acc = ''
      let sources: KnowledgeSource[] = []
      await streamKnowledgeChat(
        { project: projectName, message: text },
        {
          signal: ctrl.signal,
          onEvent: (ev) => {
            if (ev.textResponse) {
              acc += ev.textResponse
              // 上游会把模型的 <think>…</think> 并进正文；边流边视图也要剥掉，
              // 否则用户先看到一段英文推理、再看到它消失
              const shown = stripReasoning(acc)
              setMessages((prev) => {
                const next = [...prev]
                next[next.length - 1] = { role: 'assistant', content: shown, sources }
                return next
              })
            }
            if (Array.isArray(ev.sources) && ev.sources.length) {
              // 上游 SSE 原样透传，元数据头要在这里剥（与内容侧同理）
              sources = normalizeStreamSources(ev.sources)
              setMessages((prev) => {
                const next = [...prev]
                next[next.length - 1] = { role: 'assistant', content: acc, sources }
                return next
              })
            }
            if (ev.error) throw new Error(String(ev.error))
          },
        },
      )
    } catch (e) {
      if ((e as Error).name === 'AbortError') {
        toast('已停止本轮回答')
      } else {
        toast((e as Error).message || '问答失败')
        setMessages((prev) => {
          const next = [...prev]
          const last = next[next.length - 1]
          if (last?.role === 'assistant' && !last.content) next.pop()
          return next
        })
      }
    } finally {
      /*
       * 结束时再清洗一次。
       *
       * 流式期间每来一帧都重算 `stripReasoning(acc)`，但上游的收尾帧往往只带
       * sources 而不带 textResponse —— 消息会停在最后一个中间态，那时 `<think>`
       * 可能还没闭合。这里用最终累积值重算一次，保证停在终态上。
       */
      setMessages((prev) => {
        const next = [...prev]
        const i = next.length - 1
        const last = next[i]
        if (last?.role === 'assistant') {
          const cleaned = stripReasoning(last.content)
          /*
           * 上游在「库里没有任何内容」时返回一句固定英文：
           *   There is no relevant information in this workspace to answer your query.
           * 用户看不出这是「空库」还是「没查到」，更不知道该做什么。
           * 换成中文并说清原因 —— 这是全新项目的必现路径，不是异常。
           */
          if (NO_HIT_RE.test(cleaned)) {
            next[i] = {
              ...last,
              content:
                '这个知识库还没有可用内容，所以无法回答。\n先上传文档（右上角「上传文档」），等解析完成后（通常几秒到十几秒）再提问。',
            }
          } else if (!cleaned && last.content.trim()) {
            /*
             * 剥完是空的，说明推理块吃光了输出预算（MiniMax 系不允许关 thinking，
             * 复杂提问时 <think> 能吃掉几千 token，正文一个字没有）。不能留一条
             * 空白消息让用户以为界面坏了 —— 明说被截断，并给出可操作建议。
             */
            next[i] = {
              ...last,
              content:
                '模型这次的推理把输出预算用完了，正文被截断。\n可以：把问题问得更具体，或在设置里调大上游的最大输出。',
            }
          } else if (cleaned !== last.content) {
            next[i] = { ...last, content: cleaned }
          }
        }
        return next
      })
      setAsking(false)
      abortRef.current = null
    }
  }

  const removeDoc = async (doc: KnowledgeDoc) => {
    setBusyDoc(doc.location)
    try {
      await removeKnowledgeDocs(projectName, [doc.location])
      toast(`已移出本库：${doc.title}`)
      await load()
    } catch (e) {
      toast((e as Error).message || '移出失败')
    } finally {
      setBusyDoc('')
    }
  }

  const purgeDoc = async (doc: KnowledgeDoc) => {
    const ok = window.confirm(
      `彻底删除「${doc.title}」？\n\n这会从实例文档池删除该文档，其它项目如果挂载了同一份文档也会一并失效。\n只想从本项目移除，请用「移出」。`,
    )
    if (!ok) return
    setBusyDoc(doc.location)
    try {
      await purgeKnowledgeDocs([doc.location])
      toast(`已彻底删除：${doc.title}`)
      await load()
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
            知识库是一个可选的伴生服务：上传文档后可以带引用地提问，Agent 也能按需检索。
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
            <li>
              在它的界面里生成一个 API Key（Settings → API Keys）。
            </li>
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
            {slug ? (
              <>
                已连接 · <code>{slug}</code> · {docs.length} 份文档
              </>
            ) : (
              '正在准备知识库…'
            )}
          </span>
        </div>
        <div className="kb-head-actions">
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
          <button type="button" className="btn-ghost" onClick={() => void load()} title="重新读取清单">
            刷新
          </button>
        </div>
      </header>

      {connError ? (
        <div className="kb-banner" data-knowledge-conn-error>
          <span>{connError}</span>
          <button type="button" className="btn-ghost" onClick={() => void load()}>
            重试
          </button>
        </div>
      ) : null}

      <div className="kb-body">
        <section className="kb-docs" data-knowledge-doc-list>
          <div className="kb-docs-head">
            <strong>文档</strong>
            {accepted.length ? <span className="kb-accept">支持 {accepted.join(' ')}</span> : null}
          </div>
          {loading ? (
            <div className="kb-empty">正在读取…</div>
          ) : docs.length === 0 ? (
            <div className="kb-empty" data-knowledge-empty>
              还没有文档。上传剧本、设定或参考资料，提问时就会带引用。
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
                      title="只从本项目移除，文档留在实例里"
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

        <section className="kb-chat">
          <div className="kb-messages" ref={listRef}>
            {messages.length === 0 ? (
              <div className="kb-empty">
                就这个项目的资料提问。回答会附上被引用的文档片段；没命中会明确说明。
              </div>
            ) : (
              messages.map((m, i) => (
                <div
                  key={i}
                  className={m.role === 'user' ? 'kb-msg is-user' : 'kb-msg is-assistant'}
                  data-knowledge-answer={m.role === 'assistant' ? '' : undefined}
                  data-knowledge-msg-role={m.role}
                >
                  <div className="kb-msg-role">{m.role === 'user' ? '你' : '知识库'}</div>
                  <div className="kb-msg-body">{m.content || (asking ? '…' : '')}</div>
                  {m.role === 'assistant' ? (
                    <KnowledgeCitations
                      sources={m.sources}
                      empty={!asking && i === messages.length - 1}
                    />
                  ) : null}
                </div>
              ))
            )}
          </div>
          <div className="kb-composer">
            <textarea
              data-knowledge-question
              value={question}
              placeholder="例如：第三集男主在哪一场出场？"
              rows={2}
              onChange={(e) => setQuestion(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && !e.shiftKey) {
                  e.preventDefault()
                  void ask()
                }
              }}
            />
            <div className="kb-composer-actions">
              {asking ? (
                <button type="button" className="btn-ghost" onClick={() => abortRef.current?.abort()}>
                  停止
                </button>
              ) : null}
              <button
                type="button"
                className="btn"
                data-knowledge-ask
                disabled={asking || !question.trim()}
                onClick={() => void ask()}
              >
                {asking ? '回答中…' : '提问'}
              </button>
            </div>
          </div>
        </section>
      </div>
    </div>
  )
}
