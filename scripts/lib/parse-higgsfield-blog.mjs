/**
 * higgsfield 博客文章 → 结构化提示词指南。
 *
 * 为什么单独成文件、纯函数：与 `server/stock-parse.mjs` 同一个理由——
 * 解析规则要能在 Node 里直接跑回归，不必起服务、不必联网；抓取与解析分开，
 * 页面改版时只需重跑 fixture。
 *
 * 依赖为零：仓库没有 cheerio / jsdom，用正则按已知标记切分。
 * 如果哪天 higgsfield 改了模板，解析会在这里失败而不是静默产出空指南。
 */

/** 实体解码。范围只覆盖博客正文里实际出现的几类 */
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

/** 去标签 + 解码 + 压空白；块内保留换行由调用方决定 */
function textOf(html, opts = {}) {
  const { keepNewlines = false } = opts
  let s = String(html ?? '')
  // 块级标签换成换行，行内标签直接去掉
  s = s.replace(/<(script|style)[^>]*>[\s\S]*?<\/\1>/gi, ' ')
  s = s.replace(/<br\s*\/?>/gi, '\n')
  s = s.replace(/<\/(p|div|li|h[1-6]|section)>/gi, '\n')
  s = s.replace(/<[^>]+>/g, '')
  s = decodeEntities(s)
  s = s.replace(/\r\n?/g, '\n')
  s = s.replace(/[ \t]+/g, ' ')
  s = s.replace(/\n{3,}/g, '\n\n')
  if (!keepNewlines) s = s.replace(/\s*\n\s*/g, ' ')
  return s.trim()
}

/**
 * 从 `<h2>` 里切出各节。
 *
 * 返回 `[{ title, html }]`，html 是该标题到下一个 h2 之间的原始标记。
 * 文章末尾的营销区块（FAQ、Discover more）由调用方按标题名过滤。
 */
export function splitSections(html) {
  const src = String(html ?? '')
  const re = /<h2[^>]*>([\s\S]*?)<\/h2>/gi
  const marks = []
  let m
  while ((m = re.exec(src))) {
    marks.push({ title: textOf(m[1]), start: m.index, end: re.lastIndex })
  }
  const out = []
  for (let i = 0; i < marks.length; i += 1) {
    const next = i + 1 < marks.length ? marks[i + 1].start : src.length
    out.push({ title: marks[i].title, html: src.slice(marks[i].end, next) })
  }
  return out
}

/**
 * 解析 `Settings:` 那一行。
 *
 * 原文形如：
 *   <strong>Settings:</strong> Genre: Drama, noir base. Lighting: Hard key,
 *   high contrast, monochrome. Camera: Anamorphic, locked lens per segment.
 *   Color: Black and white throughout, zero color anywhere.
 *
 * 键名不固定（Genre / Lighting / Camera / Color / Physics / Emotional control /
 * Aspect ratio ...），所以按「已知键 + 冒号」切，不假设固定顺序。
 */
const SETTINGS_KEYS = [
  'genre',
  'lighting',
  'camera',
  'color',
  'physics',
  'emotional control',
  'aspect ratio',
  'sound',
  'editing',
  'references',
  'duration',
  'style',
  'motion',
]

export function parseSettings(raw) {
  const text = textOf(raw)
  if (!text) return {}
  // 把所有已知键转成唯一分隔符，再按分隔符切
  let s = ` ${text} `
  const order = []
  for (const key of SETTINGS_KEYS) {
    const re = new RegExp(`\\b${key.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\s*:`, 'gi')
    s = s.replace(re, () => {
      order.push(key)
      return `\u0000${key}\u0000`
    })
  }
  const parts = s.split('\u0000')
  const out = {}
  for (let i = 1; i < parts.length; i += 2) {
    const key = parts[i]
    const value = String(parts[i + 1] ?? '')
      .replace(/^[\s.;,]+/, '')
      .replace(/[\s.;,]+$/, '')
      .trim()
    if (key && value && !out[key]) out[key] = value
  }
  return out
}

/** 取 `<strong>X:</strong>` 后面那一段的纯文本；找不到返回空串 */
function fieldAfter(html, label) {
  const re = new RegExp(
    `<strong[^>]*>\\s*${label.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\s*:?\\s*</strong>`,
    'i',
  )
  const m = re.exec(html)
  if (!m) return ''
  // 从标签结束到下一个块级标签
  const rest = html.slice(m.index + m[0].length)
  const stop = rest.search(/<\/(p|div|section)>/i)
  return textOf(stop >= 0 ? rest.slice(0, stop) : rest)
}

/**
 * 抽提示词正文。三种容器按优先级尝试：
 *
 * 1. `font-mono` 的 div —— 模板 A（seedance-2-5 指南）用它，最干净
 * 2. `<pre>` —— 少数文章用
 * 3. 一整串 `<em>` 段落 —— 模板 B（seedance 指南）用它把提示词整段斜体标记
 *
 * 第 3 种最容易误抓：文章里的强调文字也是 `<em>`。所以要求「连续 >= 2 个 em 块、
 * 合计长度 > 400」，否则宁可不取——取错了比取不到更糟（会把正文当提示词展示）。
 */
function extractPrompt(html) {
  const mono = /<div[^>]*font-mono[^>]*>([\s\S]*?)<\/div>/i.exec(html)
  if (mono) {
    const text = textOf(mono[1], { keepNewlines: true })
    if (text.length > 80) return { prompt: text, kind: 'mono' }
  }

  const pre = /<pre[^>]*>([\s\S]*?)<\/pre>/i.exec(html)
  if (pre) {
    const text = textOf(pre[1], { keepNewlines: true })
    if (text.length > 80) return { prompt: text, kind: 'pre' }
  }

  // 连续 em 块：允许中间夹 <p> 标签
  const emBlocks = [...html.matchAll(/<em[^>]*>([\s\S]*?)<\/em>/gi)].map((m) => textOf(m[1], { keepNewlines: true }))
  const joined = emBlocks.filter((t) => t.length > 40).join('\n\n')
  if (emBlocks.filter((t) => t.length > 40).length >= 2 && joined.length > 400) {
    return { prompt: joined, kind: 'em' }
  }

  /**
   * 第四种容器：正文流里的 `— PROMPT — 正文`。
   *
   * 广告/商业类文章把提示词直接写在段落里，用破折号包裹的 PROMPT 做分隔符，
   * 没有 font-mono、没有 em、也没有 Settings。实测
   * `ai-car-commercial-youtube-guide` 一篇就有 23 段这种写法。
   * 取分隔符之后、到段尾的全文（这类提示词本身就是一整段）。
   */
  const flat = textOf(html, { keepNewlines: true })
  const sep = /[—–-]{1,3}\s*(?:THE\s+)?PROMPT\s*[—–-]{1,3}/i.exec(flat)
  if (sep) {
    const body = flat.slice(sep.index + sep[0].length).trim()
    if (body.length > 120) return { prompt: body, kind: 'inline-marker' }
  }

  return { prompt: '', kind: '' }
}

/**
 * 从提示词正文里抽时间轴段落。
 *
 * 作者惯用 `Segment 1 (0-3s):` / `Shot 2:` / `Hard cut` 这类标记。
 * 只抽显式带 Segment/Shot 的行，抽不到就返回空数组（不强造）。
 */
export function parseSegments(prompt) {
  const text = String(prompt ?? '')
  if (!text) return []
  const out = []
  const lines = text.split('\n')
  let cur = null
  const startRe = /^\s*(Segment\s+\d+|Shot\s+\d+|SCENE\s+CONTEXT|LOCATION MAP|FIRST FRAME[^:]*|CAMERA[^:]*|ACTION[^:]*|DIALOGUE[^:]*|AUDIO[^:]*|LIGHTING[^:]*|CONSTRAINTS[^:]*)\s*[:：]?/i
  for (const line of lines) {
    const m = startRe.exec(line)
    if (m) {
      if (cur) out.push(cur)
      cur = { label: m[1].trim(), body: line.slice(m[0].length).trim() }
    } else if (cur) {
      cur.body = `${cur.body}\n${line}`.trim()
    }
  }
  if (cur) out.push(cur)
  return out
    .filter((s) => s.body)
    .map((s) => ({ label: s.label, body: s.body.replace(/\n{3,}/g, '\n\n') }))
}

/** 把一段英文 Settings 值映射到 18 轴的值 id；映射不到返回空 */
const SETTING_AXIS_HINTS = {
  // Settings 键 → 候选轴（按优先级）
  genre: ['genre'],
  lighting: ['lighting'],
  camera: ['camera-move', 'lens', 'shot-size', 'camera-angle'],
  color: ['color'],
  style: ['style-medium'],
  sound: ['sound'],
  editing: ['editing'],
}

/**
 * 从 settings 文本里挑出可能命中的轴。
 *
 * 这里只做「轴名」层面的提示（genre 值默认落 genre 轴），具体的值由
 * `scripts/fetch-prompt-guides.mjs` 用词表别名匹配解析——本函数不猜值。
 */
export function axisHintForKey(key) {
  const k = String(key || '').toLowerCase().trim()
  return SETTING_AXIS_HINTS[k] || []
}

/**
 * 模板 C：诊断型（`ai-video-prompt-mistakes`）。
 *
 * 结构是 `<h2>问题</h2>` + `Mistake` / `Why It Happens` / `The Fix` 三段，
 * 外加 `<em>Bad prompt:</em>` / `<em>Good prompt:</em>` 对照。
 *
 * 这是三种模板里教学价值最高的：它直接给出「错在哪、为什么错、怎么改」，
 * 正好补 18 轴里「该写什么」之外缺的「不该写什么」。
 */
function parseDiagnostic(html) {
  const mistake = fieldAfter(html, 'Mistake')
  const why = fieldAfter(html, 'Why It Happens')
  const fix = fieldAfter(html, 'The Fix')
  if (!mistake && !why && !fix) return null

  const emOf = (label) => {
    const re = new RegExp(`<em[^>]*>\\s*${label}\\s*:?\\s*([\\s\\S]*?)</em>`, 'i')
    const m = re.exec(html)
    return m ? textOf(m[1], { keepNewlines: true }) : ''
  }

  return {
    mistake,
    why,
    fix,
    badPrompt: emOf('Bad prompt'),
    goodPrompt: emOf('Good prompt'),
  }
}

/**
 * 模板 D：对照型（`ai-video-prompt-mistakes`）。
 *
 * 结构是 `<h2>问题</h2>` + 一段诊断 + `<em>Bad prompt: …</em>` + 坏提示词块 + 解释
 * + `<em>Good prompt: …</em>` + 好提示词块 + 修复方法。
 *
 * 标签有两种写法，都要认：
 *   <em>Bad prompt: 内容就在 em 里</em>            ← 短示例
 *   <em>Good prompt: 一句话摘要</em> + 后面的 font-mono 块  ← 长示例
 *
 * 这是四种模板里唯一给出「错误示范」的：其余三种都在讲怎么对，只有它讲怎么错。
 * 对 18 轴来说这是缺的一半——筛选栏能列出「低调光」，但没人告诉你「写成
 * cinematic lighting 这种空泛词会被模型自由发挥」。
 */
function parseContrast(html) {
  const grab = (label) => {
    const re = new RegExp(`<em[^>]*>\\s*${label}\\s*:?([\\s\\S]*?)</em>`, 'i')
    const m = re.exec(html)
    if (!m) return { inline: '', block: '' }
    const inline = textOf(m[1], { keepNewlines: true })
    // em 之后的第一个 font-mono / pre 块才是完整版本
    const rest = html.slice(m.index + m[0].length)
    const mono = /<div[^>]*font-mono[^>]*>([\s\S]*?)<\/div>/i.exec(rest)
    const pre = /<pre[^>]*>([\s\S]*?)<\/pre>/i.exec(rest)
    const hit = mono || pre
    const block = hit ? textOf(hit[1], { keepNewlines: true }) : ''
    return { inline, block }
  }

  const bad = grab('Bad prompt')
  const good = grab('Good prompt')
  // 长示例优先用块；块缺失或过短时用 em 内联文本
  const badPrompt = bad.block.length > bad.inline.length ? bad.block : bad.inline
  const goodPrompt = good.block.length > good.inline.length ? good.block : good.inline
  if (!badPrompt && !goodPrompt) return null

  // 诊断句：h2 后的第一段（不含 Bad/Good 说明）
  const firstP = /<p[^>]*>([\s\S]*?)<\/p>/i.exec(html)
  const diagnosis = firstP ? textOf(firstP[1]) : ''

  return { badPrompt, goodPrompt, diagnosis }
}

/**
 * 解析整篇文章。
 *
 * higgsfield 的博客有四种模板，必须都吃：
 *
 * 模板 A（seedance-2-5-prompting-guide）：
 *   <h2>类别标题</h2> + Settings: Genre/Lighting/Camera... + Why this combination + Prompt used
 *   —— 配方型，字段直接映射到 18 轴。
 *
 * 模板 B（seedance-prompting-guide）：
 *   <h2>变体标题</h2> + What it does + Inputs + The Prompt + Pro tip
 *   —— 变体型，没有 Settings，但同样有完整提示词。
 *
 * 模板 C/D（ai-video-prompt-mistakes）：
 *   <h2>问题</h2> + 诊断 + Bad prompt + Good prompt + 修复步骤
 *   —— 对照型，教「怎么错」。C（Mistake/Why/The Fix 三段式）只在开头出现一次，
 *     正文里的 FAQ 走 D（Bad/Good 对照），两种都认。
 *
 * 共同点：都有可读说明 + 提示词文本。差异只在字段名，按「命中哪套字段」分派。
 *
 * @param {string} html 原始 HTML
 * @param {{ id: string, url: string, title?: string }} source
 * @returns {{ guides: object[], sections: number }}
 */
export function parseHiggsfieldArticle(html, source) {
  const sections = splitSections(html)
  // 营销/导航区块：标题命中这些就不当指南
  const skip = /^(what is |how to write|what the testing shows|got any questions|discover more|faq|ai-native|best \d+ platforms|pricing|promotions?|before you start|step \d+|checklist before|key takeaways)/i
  const guides = []

  for (const sec of sections) {
    if (!sec.title || skip.test(sec.title)) continue
    const hasSettings = /Settings\s*:/i.test(sec.html)
    const hasVariant = /What it does\s*:|The Prompt\s*:/i.test(sec.html)
    const contrast = parseContrast(sec.html)
    const diag = /Mistake\s*:|Why It Happens\s*:|The Fix\s*:/i.test(sec.html) ? parseDiagnostic(sec.html) : null

    if (!hasSettings && !hasVariant && !contrast && !diag) continue

    const settingsRaw = hasSettings ? fieldAfter(sec.html, 'Settings') : ''
    const rationale = fieldAfter(sec.html, 'Why this combination')
    const whatItDoes = hasVariant ? fieldAfter(sec.html, 'What it does') : ''
    const inputs = hasVariant ? fieldAfter(sec.html, 'Inputs') : ''
    const proTip = hasVariant ? fieldAfter(sec.html, 'Pro tip') : ''
    const { prompt } = extractPrompt(sec.html)
    if (!settingsRaw && !prompt && !contrast && !diag) continue

    guides.push({
      id: `${source.id}/${slug(sec.title)}`,
      sourceId: source.id,
      title: sec.title,
      // 模板 A
      settingsText: settingsRaw,
      settings: parseSettings(settingsRaw),
      // 模板 B
      whatItDoes,
      inputs,
      proTip,
      // 模板 C
      mistake: diag?.mistake || '',
      why: diag?.why || '',
      fix: diag?.fix || '',
      // 模板 D（也覆盖 C 的 Bad/Good）
      diagnosis: contrast?.diagnosis || '',
      badPrompt: contrast?.badPrompt || '',
      goodPrompt: contrast?.goodPrompt || '',
      rationale,
      // 正文优先「正确写法」：对照型里 goodPrompt 才是推荐值，坏的是反面教材。
      // 注意不能直接用 extractPrompt 的结果——它取的是节内第一个 font-mono 块，
      // 而对照型里第一个块是 BAD prompt。
      prompt: contrast?.goodPrompt || prompt || '',
      segments: parseSegments(contrast?.goodPrompt || prompt || ''),
      // 正文：该节去掉营销块后的可读文本
      body: textOf(sec.html, { keepNewlines: true }),
    })
  }

  return { guides, sections: sections.length }
}

/** 标题 → 稳定 id 片段（保留可读性，便于人工核对） */
export function slug(s) {
  return String(s ?? '')
    .toLowerCase()
    .replace(/[^a-z0-9\u4e00-\u9fff]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 60)
}
