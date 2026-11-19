/**
 * 专家闸门插件：让一个 preset 只看得见自己的工具与技能。
 *
 * 挂在 preset 的子插件列表里，因此它注册的限制落在该 agent scope：
 * - `tools.restrict({ allow })` 收窄可见工具（限制只减不增，无法被下层放开）；
 * - `tools/pre-execute` 兜住技能 id：白名单外的读请求直接拒绝，
 *   不依赖「技能根本没被发现」这一层假设（宿主也可能从别处挂根）。
 *
 * 未配置任何字段时不做任何限制：缺配置应该表现为「没有专家约束」，
 * 而不是「一个工具都不能用」。
 */

export const name = 'creative-expert'
export const inject = ['tools']

/** 只接受技能 id 的读工具；`read_skill_file` 的 path 不参与白名单判断 */
const SKILL_ID_TOOLS = new Set(['read_skill', 'read_skill_text', 'read_skill_file'])

export function apply(ctx, config) {
  const toolIds = Array.isArray(config?.toolIds) ? config.toolIds.map(String).filter(Boolean) : []
  const skillIds = Array.isArray(config?.skillIds) ? config.skillIds.map(String).filter(Boolean) : []
  const expertId = String(config?.expertId || '')

  // 工具子集：空数组等于「没声明」，此时不限制，避免一个手写错的 preset 变成无工具会话
  if (toolIds.length) {
    try {
      ctx.effect(() => ctx.tools.restrict({ allow: toolIds }))
    } catch (e) {
      ctx.logger?.warn?.(`[creative-expert] ${expertId} 工具限制未生效：${e?.message || String(e)}`)
    }
  }

  if (skillIds.length) {
    const allowed = new Set(skillIds)
    ctx.on('tools/pre-execute', (exec, next) => {
      if (!SKILL_ID_TOOLS.has(exec?.name)) return next()
      const id = String(exec.args?.id || exec.args?.skillId || '')
      if (!id || allowed.has(id)) return next()
      return {
        kind: 'deny',
        reason: `专家「${expertId}」的技能白名单不含「${id}」，请改用白名单内的技能。`,
      }
    })
  }
}

export default { name, inject, apply }
