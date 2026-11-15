/**
 * Agent 连参考时的名字解析。
 *
 * 为什么不能复用导入那套 `resolveRefNames`：导入要的是「尽量写进去，写不进的
 * 列进预览」，返回 notice；而工具调用是一个要么成功要么失败的动作，必须返回
 * 一句话能让模型自己纠正的错误（含候选名单）。两者的失败语义不同，混用会让
 * 工具在名字写错时静默成功。
 *
 * 两条硬规则：
 * 1. 只用名字寻址，不接受节点 id——模型看不到画布 id，能传就一定是编的。
 * 2. 不做模糊匹配。参考连线决定出图取哪张图，猜错一张整镜外观就错，且不会报错。
 */

export type RefTargetKind = 'character' | 'asset'

export type RefCandidate = { id: string; name: string }

export type RefTargetResolution =
  | { ok: true; tokens: string[]; labels: string[] }
  | { ok: false; error: string }

/** 候选名单截断：一次列几百个名字会把上下文吃光，也帮不上模型 */
const MAX_CANDIDATES = 12

function listNames(names: string[]): string {
  const shown = names.slice(0, MAX_CANDIDATES)
  return shown.join('、') + (names.length > shown.length ? ` 等 ${names.length} 个` : '')
}

/**
 * 把名字解析成参考 id token（`char-<角色 id>` / `asset-<节点 id>`）。
 *
 * 角色 id 可读（就是角色名，改名时由界面迁移），素材节点 id 是随机 uid，
 * 所以素材必须由调用方把画布上的 id 与标题一起传进来。
 */
export function resolveRefTargets(input: {
  kind: RefTargetKind
  names: string[]
  characters?: RefCandidate[]
  assets?: RefCandidate[]
}): RefTargetResolution {
  const names = Array.from(
    new Set((input.names ?? []).map((n) => String(n ?? '').trim()).filter(Boolean)),
  )
  if (!names.length) {
    return { ok: false, error: `names 不能为空：至少给出一个${input.kind === 'character' ? '角色名' : '素材标题'}` }
  }

  if (input.kind === 'character') {
    const roster = input.characters ?? []
    if (!roster.length) {
      return { ok: false, error: '当前项目还没有角色卡；下一步：先用 submit_characters 建角色，或改用素材参考' }
    }
    const tokens: string[] = []
    const labels: string[] = []
    const missing: string[] = []
    const dup: string[] = []
    for (const name of names) {
      const hits = roster.filter((c) => c.name === name)
      if (hits.length === 1) {
        tokens.push(`char-${hits[0].id}`)
        labels.push(hits[0].name)
      } else if (hits.length > 1) dup.push(name)
      else missing.push(name)
    }
    if (missing.length || dup.length) {
      const parts: string[] = []
      if (missing.length) parts.push(`找不到角色：${missing.join('、')}`)
      if (dup.length) parts.push(`角色重名，无法确定连哪一张：${dup.join('、')}`)
      parts.push(`当前项目可选角色：${listNames(roster.map((c) => c.name))}`)
      return { ok: false, error: parts.join('；') }
    }
    return { ok: true, tokens, labels }
  }

  const cards = input.assets ?? []
  if (!cards.length) {
    return {
      ok: false,
      error: '当前画布没有素材卡；下一步：先用 submit_assets 建卡，或改用角色参考',
    }
  }
  const tokens: string[] = []
  const labels: string[] = []
  const missing: string[] = []
  const ambiguous: string[] = []
  for (const title of names) {
    const hits = cards.filter((a) => a.name === title)
    if (hits.length === 1) {
      tokens.push(hits[0].id)
      labels.push(hits[0].name)
    } else if (hits.length > 1) {
      ambiguous.push(`素材「${title}」有 ${hits.length} 张同名卡（${hits.map((a) => a.id).join('、')}），请改名或只发一张`)
    } else missing.push(title)
  }
  if (missing.length || ambiguous.length) {
    const parts: string[] = []
    if (missing.length) parts.push(`找不到素材：${missing.join('、')}`)
    parts.push(...ambiguous)
    parts.push(`当前画布可选素材：${listNames(cards.map((a) => a.name))}`)
    return { ok: false, error: parts.join('；') }
  }
  return { ok: true, tokens, labels }
}

/**
 * 参考连线的增删。
 *
 * 增是并集（重复调用不产生重复项），删只移除目标项，其余顺序不变。
 * 顺序必须保留：画布按 refIds 顺序渲染参考，重排会让用户的视觉记忆错位。
 */
export function applyRefTokens(
  current: string[] | undefined,
  tokens: string[],
  action: 'add' | 'remove',
): string[] {
  const base = (current ?? []).map(String).filter(Boolean)
  if (action === 'add') {
    const out = [...base]
    for (const t of tokens) if (t && !out.includes(t)) out.push(t)
    return out
  }
  const drop = new Set(tokens)
  return base.filter((t) => !drop.has(t))
}
