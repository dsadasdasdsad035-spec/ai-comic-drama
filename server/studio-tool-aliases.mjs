/** 模型偶发错名 → 正式平台工具 id（须同时在 creative-tools 插件注册同名别名工具） */
export const STUDIO_TOOL_NAME_ALIASES = {
  submit_shot_prompts: 'submit_prompts',
}

export function resolveStudioToolName(name) {
  const raw = String(name || '').trim()
  return STUDIO_TOOL_NAME_ALIASES[raw] || raw
}

/** 给工具清单扩展别名条目（schema/description 复用 canonical） */
export function expandStudioToolCatalog(tools) {
  const list = Array.isArray(tools) ? tools : []
  const byName = new Map(list.map((t) => [t.name, t]))
  const extra = []
  for (const [alias, canonical] of Object.entries(STUDIO_TOOL_NAME_ALIASES)) {
    if (byName.has(alias) || !byName.has(canonical)) continue
    const base = byName.get(canonical)
    extra.push({
      ...base,
      name: alias,
      description: `【别名→${canonical}】${base.description || ''}`,
    })
  }
  return [...list, ...extra]
}