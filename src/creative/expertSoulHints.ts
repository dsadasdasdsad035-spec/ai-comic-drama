/** Soul 正文提到的工具名，与白名单对照（弱提示，不阻断保存） */

const ALWAYS_AVAILABLE = new Set(['list_experts'])

/** 在 soul 中扫描已知工具名（子串匹配，忽略大小写） */
export function soulMentionedTools(soul: string, knownToolNames: string[]): string[] {
  const text = String(soul || '').toLowerCase()
  if (!text) return []
  const out: string[] = []
  for (const name of knownToolNames) {
    if (!name || ALWAYS_AVAILABLE.has(name)) continue
    if (text.includes(name.toLowerCase())) out.push(name)
  }
  return out.sort()
}

/** soul 提到但未勾选的工具 */
export function soulToolsMissingFromWhitelist(soul: string, toolIds: string[], knownToolNames: string[]): string[] {
  const allowed = new Set([...toolIds, ...ALWAYS_AVAILABLE])
  return soulMentionedTools(soul, knownToolNames).filter((n) => !allowed.has(n))
}

/** soul 提到 read_skill* 但未配置技能白名单 */
export function soulSkillReadWithoutWhitelist(soul: string, skillIds: string[]): boolean {
  if (skillIds.length) return false
  const text = String(soul || '').toLowerCase()
  return text.includes('read_skill_text') || text.includes('read_skill')
}