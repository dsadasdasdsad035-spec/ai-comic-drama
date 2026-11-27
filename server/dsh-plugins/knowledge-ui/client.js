window.__ModuleLoader__.load({id:`dsh-plugin-knowledge-ui`,factory:require=>{var module={exports:{}};var exports=module.exports;Object.defineProperty(exports,Symbol.toStringTag,{value:`Module`});const React=require("react");

/**
 * 会话头部知识库选择器。
 *
 * 为什么挂在 `conversation.session.header.actions`：这是官方 agent-preset 插件
 * 放「专家选择器」的同一个插槽（scope = session），组件 props 里带 `sessionId`。
 * 我们需要的正是它 —— 选库结果按会话隔离，两个会话可以选不同的库。
 *
 * 为什么不做成对话里的工具调用：让用户靠打字完成界面设置是可用性倒退，而且
 * 会产生「模型选错库」这类难排查的问题。工具只读，选库只能由人来点。
 */

/**
 * 两个插槽都要挂，因为空白会话不渲染头部。
 *
 * `conversation.session.header` 在 `session.blank` 时收到 `hideChrome: true`，
 * 头部动作区（header.actions）整块不渲染。而「新建会话 → 先选库再提问」正是
 * 最典型的路径 —— 只挂头部的话，用户在新会话里根本看不到选择器。
 * 所以空白态挂到 hero 的选项区（模型选择器旁边），有内容的会话挂头部。
 */
const SLOT_NAMES = [`conversation.session.header.actions`, `conversation.hero.options`]
const PLUGIN_ID = `dsh-plugin-knowledge-ui`

const CSS = `
.kb-pick{display:inline-flex;align-items:center;gap:6px;max-width:260px}
.kb-pick-icon{opacity:.6;flex:0 0 auto}
.kb-pick-select{appearance:none;border:1px solid var(--dsw-alias-border, rgba(128,128,128,.28));background:transparent;color:inherit;font:inherit;font-size:12px;line-height:20px;border-radius:6px;padding:2px 22px 2px 8px;max-width:220px;cursor:pointer;background-image:linear-gradient(45deg,transparent 50%,currentColor 50%),linear-gradient(135deg,currentColor 50%,transparent 50%);background-position:calc(100% - 13px) 9px,calc(100% - 8px) 9px;background-size:5px 5px,5px 5px;background-repeat:no-repeat}
.kb-pick-select:disabled{opacity:.55;cursor:progress}
.kb-pick-select.is-gone{color:#d4743a;border-color:#d4743a}
.kb-pick-hint{font-size:11px;color:var(--dsw-alias-label-secondary, rgba(128,128,128,.9));white-space:nowrap}
`

if (typeof document !== `undefined`) {
  const tagId = `${PLUGIN_ID}/picker.css`
  if (document.querySelector(`style[data-plugin-css=${JSON.stringify(tagId)}]`) === null) {
    const tag = document.createElement(`style`)
    tag.dataset.plugin = PLUGIN_ID
    tag.dataset.pluginCss = tagId
    tag.textContent = CSS
    document.head.append(tag)
  }
}

/** 相对路径 fetch：宿主前端由应用同源反代（/studio/），所以 /api/* 打到应用本身 */
async function callApi(path, init) {
  const res = await fetch(path, { credentials: `include`, ...(init || {}) })
  let body = null
  try {
    body = await res.json()
  } catch (_e) {
    body = null
  }
  return { ok: res.ok, status: res.status, body }
}

function KnowledgePicker({ sessionId }) {
  const [bases, setBases] = React.useState([])
  const [picked, setPicked] = React.useState(``)
  const [gone, setGone] = React.useState(false)
  const [busy, setBusy] = React.useState(false)
  /**
   * 未配置 / 读不到：整控件不渲染，不往会话头部塞一个用不了的死控件。
   * 初值就用 sessionId 判断，而不是等 effect —— 否则首帧会闪一个空下拉
   * （会话头部那一格会先占位再消失）。
   */
  const hasSession = typeof sessionId === `string` && sessionId !== ``
  const [hidden, setHidden] = React.useState(!hasSession)
  const [error, setError] = React.useState(``)

  const load = React.useCallback(async () => {
    if (typeof sessionId !== `string` || sessionId === ``) {
      setHidden(true)
      return
    }
    const list = await callApi(`/api/knowledge/bases`)
    if (!list.ok || !list.body || list.body.ok === false) {
      // 未配置（409）与暂时连不上都按「不显示」处理：这个控件是可选增强
      setHidden(true)
      return
    }
    const rows = Array.isArray(list.body.bases) ? list.body.bases : []
    setBases(rows)
    const cur = await callApi(`/api/knowledge/session-kb?sessionId=${encodeURIComponent(sessionId)}`)
    if (cur.ok && cur.body) {
      setPicked(String(cur.body.kbId || ``))
      setGone(cur.body.gone === true)
    }
    setHidden(rows.length === 0 && !picked)
  }, [sessionId, picked])

  React.useEffect(() => {
    setError(``)
    load().catch((e) => {
      setHidden(true)
      setError(String((e && e.message) || e))
    })
  }, [load])

  const choose = React.useCallback(
    async (event) => {
      const next = String(event.target.value || ``)
      if (next === `` || !sessionId) return
      setBusy(true)
      setError(``)
      try {
        const r = await callApi(`/api/knowledge/session-kb`, {
          method: `POST`,
          headers: { 'Content-Type': `application/json` },
          body: JSON.stringify({ sessionId, kbId: next }),
        })
        if (!r.ok || (r.body && r.body.ok === false)) {
          throw new Error((r.body && r.body.message) || `选择知识库失败`)
        }
        setPicked(next)
        setGone(false)
      } catch (e) {
        setError(String((e && e.message) || e))
      } finally {
        setBusy(false)
      }
    },
    [sessionId],
  )

  if (!hasSession || hidden) return null
  if (error !== ``) return React.createElement(`span`, { className: `kb-pick-hint`, title: error }, `知识库不可用`)

  const options = [React.createElement(`option`, { key: `__none`, value: `` }, gone ? `已失效，请重选` : `未选知识库`)]
  for (const b of bases) {
    const label = typeof b.docCount === `number` ? `${b.name}（${b.docCount} 份）` : b.name
    options.push(React.createElement(`option`, { key: b.id, value: b.id }, label))
  }

  return React.createElement(
    `label`,
    { className: `kb-pick`, title: `本会话检索哪个知识库；两个会话可以选不同的库` },
    React.createElement(
      `svg`,
      {
        className: `kb-pick-icon`,
        width: 13,
        height: 13,
        viewBox: `0 0 24 24`,
        fill: `none`,
        stroke: `currentColor`,
        strokeWidth: 2,
        strokeLinecap: `round`,
        strokeLinejoin: `round`,
        'aria-hidden': true,
      },
      React.createElement(`path`, { d: `M4 19.5A2.5 2.5 0 0 1 6.5 17H20` }),
      React.createElement(`path`, { d: `M6.5 2H20v20H6.5A2.5 2.5 0 0 1 4 19.5v-15A2.5 2.5 0 0 1 6.5 2z` }),
    ),
    React.createElement(
      `select`,
      {
        className: gone ? `kb-pick-select is-gone` : `kb-pick-select`,
        value: picked,
        disabled: busy,
        onChange: choose,
        'aria-label': `知识库`,
        'data-knowledge-picker': sessionId,
      },
      options,
    ),
  )
}

/**
 * 注册入口。
 *
 * 为什么必须走 `ctx.slots.inject(key, cb)` 而不是直接 `ctx.slots.register`：
 * 别的包声明的 child slot 在它的 entry 存活期间才「已声明」；直接 register 会在
 * 插件激活时抛 `slot ... is not declared (a parent entry's children table must
 * declare it)`。inject 的回调在每段声明生命周期内运行 —— owner 折叠时我们的
 * 注册随之移除，owner 重新挂载时重新运行（官方 slots 文档的扩展方式）。
 */
function apply(ctx) {
  if (!ctx || !ctx.slots || typeof ctx.slots.inject !== `function`) {
    // 插槽服务不存在（宿主版本变化）：只记录，不阻塞宿主启动。
    // 知识库功能仍然可用 —— 模型能调 list_knowledge_bases / search_knowledge，
    // 用户也可以在对话里说「用 X 库」。
    ctx?.logger?.warn?.(`[knowledge-ui] 宿主没有 slots.inject，跳过知识库选择器`)
    return
  }
  const disposers = []
  let mounted = 0
  for (const slotName of SLOT_NAMES) {
    try {
      // inject 自己返回 disposer；它负责把回调里的 register 一起收掉
      disposers.push(
        ctx.slots.inject(slotName, () => {
          mounted += 1
          return ctx.slots.register({ name: slotName, id: `knowledge-base`, order: 5 }, KnowledgePicker)
        }),
      )
    } catch (error) {
      // 插槽名被上游改掉时不能把整个宿主一起弄挂：另一个插槽仍可能挂上，
      // 都挂不上就降级为「靠对话选库」（list_knowledge_bases 仍可用）
      ctx?.logger?.warn?.(
        `[knowledge-ui] 注册插槽 ${slotName} 失败：${String((error && error.message) || error)}`,
      )
    }
  }
  if (!disposers.length) {
    ctx?.logger?.warn?.(`[knowledge-ui] 两个插槽都没注册上，知识库选择降级为对话选库`)
    return
  }
  return () => {
    for (const dispose of disposers) {
      try {
        if (typeof dispose === `function`) dispose()
      } catch (_e) {
        /* 卸载失败不影响宿主 */
      }
    }
  }
}

const inject = [`slots`]

exports.apply = apply
exports.inject = inject
exports.KnowledgePicker = KnowledgePicker
return module.exports}});
