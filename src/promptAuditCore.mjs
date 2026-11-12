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
