/**
 * apiko.app 提示词页 → 案例条目。
 *
 * 页面结构（服务端渲染，实测 `seedance-2-5-prompts` / `kling-4-0-prompts`）：
 *
 *   <h2>Cinematic</h2>          ← 分类
 *   <h3>标题</h3>               ← 一条案例
 *   <p>完整提示词正文（一段长英文）</p>
 *
 * 与 higgsfield 的差别：apiko 是**成品提示词清单**，每条就是一个可直接用的
 * 提示词；higgsfield 是方法论。所以 apiko 进案例库，higgsfield 进指南。
 *
 * 为什么纯函数、零依赖：与 `stock-parse.mjs` / `parse-higgsfield-blog.mjs` 同一个
 * 理由——解析规则要能在 Node 里直接回归，页面改版时只需重跑 fixture。
 */

export function decodeEntities(s) {
  return String(s ?? '')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;|&#x27;|&apos;/g, "'")
    .replace(/&#(\d+);/g, (_, n) => String.fromCharCode(Number(n)))
    .replace(/&#x([0-9a-f]+);/gi, (_, n) => String.fromCharCode(parseInt(n, 16)))
}

function textOf(html, opts = {}) {
  const { keepNewlines = false } = opts
  let s = String(html ?? '')
  s = s.replace(/<(script|style)[^>]*>[\s\S]*?<\/\1>/gi, ' ')
  s = s.replace(/<br\s*\/?>/gi, '\n')
  s = s.replace(/<\/(p|div|li|h[1-6]|section)>/gi, '\n')
  s = s.replace(/<[^>]+>/g, '')
  s = decodeEntities(s)
  s = s.replace(/\r\n?/g, '\n')
  s = s.replace(/[ \t]+/g, ' ')
  s = s.replace(/\n{3,}/g, '\n\n')
  return (keepNewlines ? s : s.replace(/\s*\n\s*/g, ' ')).trim()
}

/** 取页面里的 og:image / twitter:image 作为封面 */
function pageImage(html) {
  const m =
    /<meta[^>]+property=["']og:image["'][^>]+content=["']([^"']+)["']/i.exec(html) ||
    /<meta[^>]+content=["']([^"']+)["'][^>]+property=["']og:image["']/i.exec(html) ||
    /<meta[^>]+name=["']twitter:image["'][^>]+content=["']([^"']+)["']/i.exec(html)
  return m ? decodeEntities(m[1]) : ''
}

/** 页面标题（去掉站点后缀） */
function pageTitle(html) {
  const m = /<title[^>]*>([\s\S]*?)<\/title>/i.exec(html)
  if (!m) return ''
  return textOf(m[1]).replace(/\s*[—|-]\s*APIKO\s*$/i, '').trim()
}

/**
 * 切出 `<h2>` 分类下的 `<h3>` 条目。
 *
 * 返回 `[{ category, title, prompt }]`。
 *
 * 提示词正文的取法：`<h3>` 之后、下一个 `<h3>`/`<h2>` 之前，取最长的那段
 * 段落文本（>= 80 字符）。apiko 每条案例的正文是一整段长英文，其余段落
 * 是短说明（"Model:", "Duration:" 之类），用长度阈值区分比按标签名猜更稳。
 */
export function parseApikoPrompts(html, options = {}) {
  const src = String(html ?? '')
  const minLen = Number(options.minPromptLen) || 80

  // 按 h2/h3 建标记序列，一次遍历拿到分类与条目边界
  const re = /<h([23])[^>]*>([\s\S]*?)<\/h\1>/gi
  const marks = []
  let m
  while ((m = re.exec(src))) {
    marks.push({
      level: Number(m[1]),
      title: textOf(m[2]),
      start: m.index,
      end: re.lastIndex,
    })
  }

  const out = []
  let category = ''
  for (let i = 0; i < marks.length; i += 1) {
    const mk = marks[i]
    if (mk.level === 2) {
      category = mk.title
      continue
    }
    // h3：条目
    const next = marks[i + 1]
    const block = src.slice(mk.end, next ? next.start : src.length)
    // 取块内最长的段落
    let best = ''
    const paras = [...block.matchAll(/<p[^>]*>([\s\S]*?)<\/p>/gi)].map((x) => textOf(x[1], { keepNewlines: true }))
    for (const p of paras) {
      const t = p.trim()
      if (t.length > best.length) best = t
    }
    // 没有 <p> 时退化成整块文本
    if (best.length < minLen) {
      const flat = textOf(block, { keepNewlines: true })
      if (flat.length > best.length) best = flat
    }
    if (!mk.title || best.length < minLen) continue
    out.push({ category, title: mk.title, prompt: best })
  }
  return { items: out, title: pageTitle(src), poster: pageImage(src) }
}

/** 标题 → 稳定 slug 片段 */
export function slug(s) {
  return String(s ?? '')
    .toLowerCase()
    .replace(/[^a-z0-9\u4e00-\u9fff]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 64)
}
