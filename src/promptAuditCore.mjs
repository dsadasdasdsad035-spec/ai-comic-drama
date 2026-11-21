/**
 * 首帧提示词锚点审计的可共享核心。
 *
 * 为什么是 .mjs：浏览器构建（src/promptAudit.ts 再导出）与服务端
 * （server/db.mjs 的项目列表健康统计）要用同一份判定，避免两边口径漂移。
 * 这里只放纯函数，不 import 任何 React / 浏览器 / node 专有模块。
 */

/**
 * 台词文本 → 数组。与 src/prompts.ts 的 parseDialogue 保持同一规则：
 * 首行「角色：台词」按冒号切分，匹配不到的角色留空。
 * @param {string} text
 * @returns {{ speaker: string, text: string }[]}
 */
export function parseDialogueCore(text) {
  return String(text || '')
    .split('\n')
    .map((s) => s.trim())
    .filter(Boolean)
    .map((line) => {
      const m = line.match(/^([^：:]{1,12})[：:]\s*(.+)$/)
      return m ? { speaker: m[1].trim(), text: m[2].trim() } : { speaker: '', text: line }
    })
}

/**
 * 按 cast 声明逐名判定锚点缺失。cast 是拆镜产出，比从台词猜准。
 * @param {any} shot
 * @param {{ name?: string, lookEn?: string }[]} chars
 * @param {string[]} declared
 */
function auditByCastCore(shot, chars, declared) {
  const kf = String(shot?.keyframe_prompt || '')
  const missing = []
  const unknown = []
  for (const name of declared) {
    const c = chars.find((x) => x.name === name)
    if (!c) {
      unknown.push(name)
      continue
    }
    if (c.lookEn && !kf.includes(c.lookEn)) missing.push(name)
  }
  return { cast: [...declared], missing, maybe: [], unknown, empty: !kf.trim() }
}

/**
 * 没有 cast 时的启发式：有台词的角色算硬缺失，只在描述里被提到的算软提示。
 * @param {any} shot
 * @param {{ name?: string, lookEn?: string }[]} chars
 */
function auditByHeuristicCore(shot, chars) {
  const dlg = Array.isArray(shot?.dialogue)
    ? shot.dialogue
    : typeof shot?.dialogue === 'string'
      ? parseDialogueCore(shot.dialogue)
      : []
  const spoken = new Set()
  for (const d of dlg) if (d?.speaker) spoken.add(d.speaker)
  const desc = String(shot?.desc || '')
  const mentioned = new Set()
  for (const c of chars) if (c.name && desc.includes(c.name)) mentioned.add(c.name)

  const kf = String(shot?.keyframe_prompt || '')
  const missing = []
  const maybe = []
  const unknown = []

  const judge = (name, hard) => {
    const c = chars.find((x) => x.name === name)
    if (!c) {
      if (hard) unknown.push(name)
      return
    }
    if (!c.lookEn) return
    if (kf.includes(c.lookEn)) return
    ;(hard ? missing : maybe).push(name)
  }

  for (const n of spoken) judge(n, true)
  for (const n of mentioned) if (!spoken.has(n)) judge(n, false)

  return {
    cast: [...new Set([...spoken, ...mentioned])],
    missing,
    maybe,
    unknown,
    empty: !kf.trim(),
  }
}

/**
 * 首帧提示词锚点审计：cast 权威时以 cast 为准，否则台词 + 描述启发式。
 * @param {any} shot
 * @param {{ name?: string, lookEn?: string }[]} chars
 * @returns {{ cast: string[], missing: string[], maybe: string[], unknown: string[], empty: boolean }}
 */
export function auditKeyframePromptCore(shot, chars) {
  const list = Array.isArray(chars) ? chars : []
  const declared = Array.isArray(shot?.cast) && shot.cast.length > 0 ? shot.cast : null
  if (declared) return auditByCastCore(shot, list, declared)
  return auditByHeuristicCore(shot, list)
}

/**
 * 项目卡片健康度：缺首帧、缺锚点、是否为空项目。
 * 空项目单独标记，避免卡片显示成「0 镜 0 秒」的正常项目。
 * @param {any[]} shots
 * @param {{ name?: string, lookEn?: string }[]} chars
 * @returns {{ empty: boolean, missing_keyframe: number, missing_anchor: number }}
 */
export function projectHealthCore(shots, chars) {
  const list = Array.isArray(shots) ? shots : []
  let missingKeyframe = 0
  let missingAnchor = 0
  for (const s of list) {
    if (!String(s?.keyframe || '')) missingKeyframe++
    const a = auditKeyframePromptCore(s, chars)
    if (!a.empty && a.missing.length > 0) missingAnchor++
  }
  return {
    empty: list.length === 0,
    missing_keyframe: missingKeyframe,
    missing_anchor: missingAnchor,
  }
}

/* ================================================================
 * 视频提示词内容审计
 *
 * 与首帧审计的区别：首帧只审「角色锚点」，视频正文要审结构、表演、
 * 声音、参考一致性与生成风险。视频正文是自由中文文本（`videoPrompt.ts`
 * 明确「正文只来自人/Agent」），所以全部判定都是可解释的文本启发式。
 *
 * 三级判定：applicable / ok / level。
 *   applicable=false -> 本镜不涉及，不计问题、不阻断
 *   applicable=true && ok=false && level='error' -> 阻断写回
 *   applicable=true && ok=false && level='warn'  -> 只提示
 * 这个分离是「不是全部检查都必须有」的唯一表达方式。
 * ================================================================ */

/** 文本是否命中任一词（包含式匹配，中文无词边界） */
function hit(text, terms) {
  const t = String(text || '')
  if (!t) return false
  return (terms || []).some((w) => w && t.includes(w))
}

function hitAll(text, terms) {
  const t = String(text || '')
  const out = []
  for (const w of terms || []) if (w && t.includes(w)) out.push(w)
  return out
}

/** 取正文尾段（默认最后 80 字），用于终点姿态判定 */
function tail(text, n = 80) {
  const t = String(text || '').trim()
  return t.length <= n ? t : t.slice(-n)
}

/** 解析正文中的标秒分段：0.0-1.5s / 0–2 秒 / 第 3 秒 等 */
function parseSecondsSegments(text) {
  const t = String(text || '')
  const segs = []
  const re = /(\d+(?:\.\d+)?)\s*(?:s|秒)?\s*[-–—~至到]\s*(\d+(?:\.\d+)?)\s*(?:s|秒)/gi
  let m
  while ((m = re.exec(t))) {
    const a = Number(m[1])
    const b = Number(m[2])
    if (Number.isFinite(a) && Number.isFinite(b) && b > a) segs.push({ start: a, end: b, raw: m[0] })
  }
  return segs
}

/** 提取正文中的发声引文：引号内文本 + <d>...</d> */
function extractSpokenQuotes(text) {
  const t = String(text || '')
  const out = []
  const quoted = t.match(/[「『"“]([^」』"”]{2,80})[」』"”]/g) || []
  for (const q of quoted) out.push(q.replace(/^[「『"“]|[」』"”]$/g, '').trim())
  const tagged = t.match(/<d>([\s\S]{2,200}?)<\/d>/gi) || []
  for (const q of tagged) out.push(q.replace(/<\/?d>/gi, '').trim())
  return out.filter(Boolean)
}

function check(id, level, applicable, ok, evidence, hint) {
  return {
    id,
    level,
    applicable: Boolean(applicable),
    ok: Boolean(ok),
    ...(evidence ? { evidence } : {}),
    ...(hint ? { hint } : {}),
  }
}

/** 参考集摘要项：{ kind: 'character'|'scene'|'prop'|'frame'|'video'|'other', name? } */
function refNames(refs) {
  return (Array.isArray(refs) ? refs : []).map((r) => String(r?.name ?? '').trim()).filter(Boolean)
}

function refKinds(refs) {
  return new Set((Array.isArray(refs) ? refs : []).map((r) => String(r?.kind ?? 'other')))
}

/**
 * 视频提示词审计。
 *
 * @param {any} shot 镜头（ProjectShot 形状）
 * @param {{
 *   vocab: any,
 *   sceneBeats?: string,
 *   prevShot?: any,
 *   nextShot?: any,
 *   refs?: { kind?: string, name?: string }[],
 *   chars?: { name?: string, lookEn?: string }[],
 *   speakers?: string[],
 *   isLastShot?: boolean,
 *   castSceneNames?: string[],
 *   propNames?: string[],
 * }} ctx
 */
export function auditVideoPromptCore(shot, ctx) {
  const c = ctx || {}
  const vocab = c.vocab || {}
  const text = String(shot?.video_prompt ?? shot?.videoPrompt ?? '').trim()
  const desc = String(shot?.desc ?? '')
  const sceneBeats = String(c.sceneBeats ?? '')
  const cast = Array.isArray(shot?.cast) ? shot.cast.filter(Boolean) : []
  const size = String(shot?.size ?? '').trim()
  const move = String(shot?.move ?? '').trim()
  const seconds = Number(shot?.seconds) || 0
  const refs = Array.isArray(c.refs) ? c.refs : []
  const chars = Array.isArray(c.chars) ? c.chars : []

  // 说话人：显式传入优先，否则从台词解析
  const speakers = (() => {
    if (Array.isArray(c.speakers)) return c.speakers.filter(Boolean)
    const dlg = Array.isArray(shot?.dialogue)
      ? shot.dialogue
      : typeof shot?.dialogue === 'string'
        ? parseDialogueCore(shot.dialogue)
        : []
    return [...new Set(dlg.map((d) => d?.speaker).filter(Boolean))]
  })()

  const hasDialogue = Array.isArray(shot?.dialogue)
    ? shot.dialogue.length > 0
    : Boolean(String(shot?.dialogue ?? '').trim())
  const nativeMode = shot?.audio_mode === 'native'
  const clip = String(shot?.clip ?? '').trim()
  const refKindSet = refKinds(refs)
  const checks = []

  /* ---------- A 结构完整性 ---------- */

  // size-declared：声明了景别，正文要有景别词
  {
    const terms = [...(vocab.size || []), ...(vocab.sizeAlias || [])]
    const ok = !size || hit(text, terms)
    checks.push(
      check(
        'size-declared',
        'error',
        Boolean(size),
        ok,
        ok ? '' : `镜头景别为「${size}」，正文未出现任何景别描述`,
        ok ? '' : `在本镜正文补一句景别，如「${size}构图」，或写明与「${size}」同级的取景范围`,
      ),
    )
  }

  // move-declared：声明了运镜，正文要有运镜词
  {
    const isStatic = /固定|不动|静止/.test(move)
    const terms = isStatic ? [...(vocab.staticMove || []), ...(vocab.move || [])] : vocab.move || []
    const ok = !move || hit(text, terms)
    checks.push(
      check(
        'move-declared',
        'error',
        Boolean(move),
        ok,
        ok ? '' : `镜头运镜为「${move}」，正文未写运镜方式`,
        ok ? '' : isStatic
          ? '补「机位保持固定/构图不变」这类说明'
          : `补运镜轨迹，如「镜头缓慢${move}」`,
      ),
    )
  }

  // action-chain：正文要有可执行动作，不能只有氛围
  {
    // 中文没有词边界，`\b` 不生效；用动词表包含式匹配
    const ACT_VERBS = [
      '走', '跑', '站', '坐', '推', '拉', '抬', '转', '伸', '握', '放', '拿',
      '看', '望', '低头', '抬头', '回身', '转身', '迈', '靠', '蹲', '起', '落',
      '挥', '松', '扶', '贴', '合上', '翻开', '推门', '开门', '关门', '走进',
      '走出', '停下', '停住', '后退', '俯身', '扬起', '递', '接过', '按',
    ]
    const ok = hit(text, ACT_VERBS)
    checks.push(
      check(
        'action-chain',
        'error',
        Boolean(text),
        ok,
        ok ? '' : text ? '正文只写了光线、陈设或氛围，没有主体动作' : '视频正文为空',
        ok ? '' : '补一条「谁 — 做什么 — 碰到什么 — 结果如何」的动作链',
      ),
    )
  }

  // placeholder-free：不能留模板占位
  {
    const found = hitAll(text, vocab.placeholder || [])
    checks.push(
      check(
        'placeholder-free',
        'error',
        Boolean(text),
        found.length === 0,
        found.length ? `正文含占位串：${found.join('、')}` : '',
        found.length ? '把这些占位串替换成本镜真实的动作与状态描写' : '',
      ),
    )
  }

  /* ---------- B 结尾衔接（首发 warn） ---------- */

  // ending-state：正文尾段要有终点姿态/持物
  {
    const t = tail(text)
    const ok = !text || hit(t, vocab.ending || [])
    checks.push(
      check(
        'ending-state',
        'warn',
        Boolean(text),
        ok,
        ok ? '' : '正文结尾未写明定格姿态或持物归属',
        ok ? '' : '补一句终点状态，如「最终她停在门边，右手扶住门框，半张脸留在光里」',
      ),
    )
  }

  // handoff-consistency：本镜终点与下一镜起手不矛盾
  {
    const next = c.nextShot
    const applicable = Boolean(next) && !c.isLastShot
    if (!applicable) {
      checks.push(check('handoff-consistency', 'warn', false, true))
    } else {
      const prevTail = tail(text, 60)
      const nextHead = String(next?.video_prompt ?? next?.videoPrompt ?? '').trim().slice(0, 60)
      // 只做「持物关键词」层面的轻量冲突：本镜结尾提到某物，下一镜开头明确说空手
      const held = ['伞', '刀', '杯', '信', '灯', '杖', '包', '绳'].filter((o) => prevTail.includes(o))
      const emptyHanded = /双手空着|两手空空|手中空无|空空如也/.test(nextHead)
      const contradiction = held.length > 0 && emptyHanded
      checks.push(
        check(
          'handoff-consistency',
          'warn',
          true,
          !contradiction,
          contradiction
            ? `本镜结尾持有「${held.join('、')}」，下一镜起手写「双手空着」`
            : '',
          contradiction ? '补一处交接动作，或改下一镜起手，使持物归属连续' : '',
        ),
      )
    }
  }

  /* ---------- C 表演与声音 ---------- */

  // lip-sync：有台词就要有口型/发声描写
  {
    const ok = !hasDialogue || hit(text, vocab.lip || [])
    checks.push(
      check(
        'lip-sync',
        'error',
        hasDialogue,
        ok,
        ok ? '' : `本镜有台词（说话人：${speakers.join('、') || '未标注'}），正文未写口型或发声`,
        ok ? '' : '补口型与发声描写，如「嘴唇开合说出……」或「低声吐字」',
      ),
    )
  }

  // voice-consistent：音色参考角色必须是说话人
  {
    const audioChar = String(shot?.audio_ref?.character ?? '').trim()
    const applicable = nativeMode && hasDialogue && Boolean(audioChar)
    const ok = !applicable || speakers.length === 0 || speakers.includes(audioChar)
    checks.push(
      check(
        'voice-consistent',
        'error',
        applicable,
        ok,
        ok ? '' : `音色参考指向「${audioChar}」，但本镜说话人是「${speakers.join('、')}」`,
        ok ? '' : '把音色参考换成实际说话的角色，或确认说话人是否写错',
      ),
    )
  }

  // audio-ready：有台词但还没有音频
  {
    const applicable = hasDialogue && !clip
    const ok = !applicable || nativeMode || Boolean(shot?.voice_meta)
    checks.push(
      check(
        'audio-ready',
        'warn',
        applicable,
        ok,
        ok ? '' : '本镜有台词，但配音尚未生成且未走原生音轨',
        ok ? '' : '出片前先生成本镜配音，或改用音画同出模式',
      ),
    )
  }

  // performance-action：按角色分条的动作表演要被正文覆盖
  {
    const perf = Array.isArray(shot?.performance) ? shot.performance.filter((p) => p?.action) : []
    const missing = perf
      .filter((p) => p.character && !text.includes(String(p.character)))
      .map((p) => p.character)
    const applicable = perf.length > 0
    checks.push(
      check(
        'performance-action',
        'warn',
        applicable,
        !applicable || missing.length === 0,
        missing.length ? `表演条目里的角色未出现在正文：${missing.join('、')}` : '',
        missing.length ? '在正文里为这些角色补上对应的动作表演' : '',
      ),
    )
  }

  // ambient-sound：剧情有天气/环境事实，正文要有声音
  {
    const ambientFacts = hitAll(`${sceneBeats} ${desc}`, vocab.weather || [])
    const applicable = ambientFacts.length > 0
    const ok = !applicable || hit(text, vocab.sfx || [])
    checks.push(
      check(
        'ambient-sound',
        'error',
        applicable,
        ok,
        ok ? '' : `剧本/描述含环境事实「${ambientFacts.join('、')}」，正文未写任何环境声`,
        ok ? '' : '补写对应声音，如雨声、雷声、地面积水回响等底噪',
      ),
    )
  }

  // perf-diversity：多人同框表演不能同质化
  {
    const applicable = cast.length >= 2
    const emotionWords = ['震惊', '惊讶', '愤怒', '害怕', '紧张', '平静', '兴奋', '悲伤', '疑惑', '冷笑']
    const shared = applicable
      ? emotionWords.filter((e) => {
          const count = cast.filter((name) => text.includes(name)).length
          const perChar = cast.map((name) => {
            const idx = text.indexOf(name)
            if (idx < 0) return ''
            return text.slice(idx, idx + 30)
          })
          return perChar.filter((w) => w.includes(e)).length >= 2 && count >= 2
        })
      : []
    checks.push(
      check(
        'perf-diversity',
        'warn',
        applicable,
        shared.length === 0,
        shared.length ? `多个角色共用同一情绪词：${shared.join('、')}` : '',
        shared.length ? '按角色写差异化反应，如一人紧绷一人冷笑' : '',
      ),
    )
  }

  /* ---------- D 参考一致性 ---------- */

  // cast-anchor：入画角色要有外观锚点（复用首帧审计的 lookEn 匹配）
  {
    const missing = []
    const unknown = []
    for (const name of cast) {
      const card = chars.find((x) => x.name === name)
      if (!card) {
        unknown.push(name)
        continue
      }
      if (card.lookEn && !text.includes(card.lookEn)) missing.push(name)
    }
    checks.push(
      check(
        'cast-anchor',
        'error',
        cast.length > 0,
        missing.length === 0,
        missing.length ? `角色缺外观锚点：${missing.join('、')}` : '',
        missing.length ? '补上这些角色的外观锚定描述（与角色卡 look 一致）' : '',
      ),
    )
    // 始终输出，applicable 表示「确有角色卡缺失」；不适用时也留在清单里
    checks.push(
      check(
        'cast-anchor-unknown',
        'warn',
        unknown.length > 0,
        unknown.length === 0,
        unknown.length ? `角色卡里找不到：${unknown.join('、')}` : '',
        unknown.length ? '确认角色名是否写错，或先为这些角色建档' : '',
      ),
    )
  }

  // scene-ref：有场次就该有场景参考
  {
    const applicable = Boolean(String(shot?.scene_slug ?? '').trim()) && Boolean(c.castSceneNames?.length)
    const ok = !applicable || refKindSet.has('scene')
    checks.push(
      check(
        'scene-ref',
        'warn',
        applicable,
        ok,
        ok ? '' : '本镜有场次，但参考集里没有场景图',
        ok ? '' : '为场景挂一张空间/布局参考，或用正文写清空间关系',
      ),
    )
  }

  // prop-ref：正文提到道具卡名，就要挂该道具参考
  {
    const propNames = Array.isArray(c.propNames) ? c.propNames.filter(Boolean) : []
    const mentioned = propNames.filter((n) => text.includes(n))
    const refNamesAll = refNames(refs)
    const missing = mentioned.filter((n) => !refNamesAll.some((r) => r.includes(n)))
    const applicable = mentioned.length > 0
    checks.push(
      check(
        'prop-ref',
        'warn',
        applicable,
        missing.length === 0,
        missing.length ? `正文提到的道具未挂参考：${missing.join('、')}` : '',
        missing.length ? '给这些道具补参考图，或删掉正文里对它们的依赖' : '',
      ),
    )
  }

  // ref-described：挂了参考图，正文应说明用途
  {
    const applicable = refs.length > 0
    const ok = !applicable || hit(text, vocab.refDescribe || [])
    checks.push(
      check(
        'ref-described',
        'warn',
        applicable,
        ok,
        ok ? '' : '本镜挂了参考图，但正文没有说明参考用途',
        ok ? '' : '补一句参考说明，如「依照参考图保持场景布局与人物造型」',
      ),
    )
  }

  // mode-matched：正文引用式表述 ↔ 参考集非空；自足式描写 ↔ 可为空
  {
    const citesRef = /参考(首帧|上一镜|前镜|设定|图)|沿用上一镜|承接上一镜|延续前镜/.test(text)
    const ok = !citesRef || refs.length > 0
    checks.push(
      check(
        'mode-matched',
        'error',
        Boolean(text),
        ok,
        ok ? '' : '正文声称参考首帧或上一镜，但本镜没有任何参考图',
        ok ? '' : '先挂上参考图，或把正文改成完整自足的画面描述',
      ),
    )
  }

  /* ---------- E 生成风险 ---------- */

  // duration-fit：标秒分段之和要等于镜长
  {
    const segs = parseSecondsSegments(text)
    const applicable = segs.length > 0 && seconds > 0
    const total = segs.reduce((s, x) => s + (x.end - x.start), 0)
    // 重叠段按合并区间算
    const merged = (() => {
      if (segs.length < 2) return total
      const sorted = segs.slice().sort((a, b) => a.start - b.start)
      let acc = 0
      let curS = sorted[0].start
      let curE = sorted[0].end
      for (const s of sorted.slice(1)) {
        if (s.start <= curE) curE = Math.max(curE, s.end)
        else {
          acc += curE - curS
          curS = s.start
          curE = s.end
        }
      }
      return acc + (curE - curS)
    })()
    const ok = !applicable || Math.abs(merged - seconds) < 0.05
    checks.push(
      check(
        'duration-fit',
        'warn',
        applicable,
        ok,
        ok ? '' : `标秒分段合计 ${merged.toFixed(1)}s，与镜头时长 ${seconds}s 不一致`,
        ok ? '' : '调整分段起止，使合计等于镜头时长且不留空白',
      ),
    )
  }

  // camera-conflict：同一时段既固定又移动
  {
    const hasBoth = /固定/.test(text) && /推近|拉远|横移|摇镜|升降|跟拍|手持/.test(text)
    const segs = parseSecondsSegments(text)
    const applicable = segs.length > 0
    checks.push(
      check(
        'camera-conflict',
        'warn',
        applicable,
        !hasBoth,
        hasBoth ? '正文同时出现固定机位与移动运镜指令' : '',
        hasBoth ? '拆成前后互不重叠的分段：先固定，再由静转动' : '',
      ),
    )
  }

  // multi-person-blocking：多人同框要有站位说明
  {
    const applicable = cast.length >= 2
    const hasBlocking = /站在|坐在|位于|左侧|右侧|前景|后景|画左|画右|背后|身侧/.test(text)
    checks.push(
      check(
        'multi-person-blocking',
        'warn',
        applicable,
        !applicable || hasBlocking,
        !applicable || hasBlocking ? '' : '多人同框但正文没有站位或左右关系',
        !applicable || hasBlocking ? '' : '补一句空间关系，如「他站在画左，她坐在画右靠窗」',
      ),
    )
  }

  // fight-rounds：打戏要分回合
  {
    const applicable = hit(`${desc} ${sceneBeats}`, vocab.fight || [])
    const segs = parseSecondsSegments(text)
    const ok = !applicable || segs.length > 0 || /回合|先|随后|接着/.test(text)
    checks.push(
      check(
        'fight-rounds',
        'warn',
        applicable,
        ok,
        ok ? '' : '本镜有打戏，但正文未按回合或标秒分段',
        ok ? '' : '按交手回合拆段，每段只让一人出招',
      ),
    )
  }

  // text-risk：画面含易乱码的文字载体
  {
    const riskFacts = hitAll(`${text} ${desc}`, vocab.textRisk || [])
    const applicable = riskFacts.length > 0
    const ok = !applicable || /无字幕|无水印|不生成|字样|文字|清晰可辨|不乱码/.test(text)
    checks.push(
      check(
        'text-risk',
        'warn',
        applicable,
        ok,
        ok ? '' : `画面含文字载体「${riskFacts.join('、')}」，正文未说明文字处理`,
        ok ? '' : '写明不生成画面外字幕，或写清需要看清的字样与位置',
      ),
    )
  }

  // physically-risky：AI 高损耗动作
  {
    const riskFacts = hitAll(text, vocab.riskyAction || [])
    const applicable = riskFacts.length > 0
    const ok = !applicable || /改为|遮挡|拆成|切到|备选|画外/.test(text)
    checks.push(
      check(
        'physically-risky',
        'warn',
        applicable,
        ok,
        ok ? '' : `正文含 AI 高损耗动作：${riskFacts.join('、')}`,
        ok ? '' : '改写为日常可完成的动作，或用构图遮挡/拆分镜头化解',
      ),
    )
  }

  // dialogue-fidelity：发声引文必须出自定稿
  {
    const quotes = extractSpokenQuotes(text)
    const applicable = quotes.length > 0
    // 定稿来源由调用方拼成一段可检索文本
    const source = String(c.dialogueSource ?? '')
    const fabricated = applicable && source ? quotes.filter((q) => !source.includes(q)) : []
    checks.push(
      check(
        'dialogue-fidelity',
        'error',
        applicable && Boolean(source),
        fabricated.length === 0,
        fabricated.length ? `正文引用了剧本外的发声台词：${fabricated.join(' / ')}` : '',
        fabricated.length ? '删掉编造的台词，或退回剧本/分镜补定稿' : '',
      ),
    )
  }

  const blockers = checks.filter((x) => x.applicable && !x.ok && x.level === 'error')
  const warnings = checks.filter((x) => x.applicable && !x.ok && x.level === 'warn')
  return { checks, blockers, warnings }
}

/** 审计项的稳定 id 清单：23 项 + 1 个辅助项，供测试与 UI 断言 */
export const VIDEO_AUDIT_CHECK_IDS = [
  'size-declared',
  'move-declared',
  'action-chain',
  'placeholder-free',
  'ending-state',
  'handoff-consistency',
  'lip-sync',
  'voice-consistent',
  'audio-ready',
  'performance-action',
  'ambient-sound',
  'perf-diversity',
  'cast-anchor',
  'cast-anchor-unknown',
  'scene-ref',
  'prop-ref',
  'ref-described',
  'mode-matched',
  'duration-fit',
  'camera-conflict',
  'multi-person-blocking',
  'fight-rounds',
  'text-risk',
  'physically-risky',
  'dialogue-fidelity',
]

