import { z } from 'zod'
import type { ProjectData } from '../api'
import {
  getContractToolSchema,
  normalizeCharactersContractPayload,
  validateContract,
} from '../skills/contracts'
import type { Skill } from '../skills/types'
import { getSkill } from '../skills/registry'
import { boundJson, type WorkbenchChatAdapter } from './workbenchChat'
import { defineTool, type ToolDef } from './tool'

export type LoadedSkill = { skill: Skill; mode: 'host' | 'readonly' }

export type StageToolSet = {
  read: Map<string, ToolDef>
  submit?: ToolDef
  byName: Map<string, ToolDef>
}

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' ? (value as Record<string, unknown>) : {}
}

function ownOr(value: unknown, fallback: unknown): unknown {
  return value === undefined || value === null ? fallback : value
}

function filterByName<T extends { name?: unknown }>(items: T[], names?: string[]): T[] {
  if (!names?.length) return items
  const set = new Set(names.map(String))
  return items.filter((x) => set.has(String(x.name || '')))
}

/**
 * 工具集只通过 adapter 取数/写草稿：
 * 自己的产物读活草稿，上游产物读已保存项目；提交只产生草稿，合并交给宿主。
 */
export function createStageToolSet(adapter: WorkbenchChatAdapter): StageToolSet {
  let snapshotPromise: Promise<ProjectData> | null = null
  const snapshot = () => (snapshotPromise ??= adapter.projectSnapshot())

  const scriptData = async (): Promise<{ source: string; logline: string; episodes: unknown[]; style: string; aspect: string }> => {
    const p = await snapshot()
    return {
      source: String(p.source || ''),
      logline: String(p.logline || ''),
      episodes: Array.isArray(p.episodes) ? p.episodes : [],
      style: String(p.style || ''),
      aspect: String(p.aspect || ''),
    }
  }

  const charactersData = async (): Promise<unknown[]> => {
    if (adapter.artifact === 'characters') {
      const own = adapter.ownDraft()
      return Array.isArray(own) ? own : []
    }
    const p = await snapshot()
    return Array.isArray(p.characters) ? p.characters : []
  }

  const designsData = async (): Promise<unknown[]> => {
    if (adapter.artifact === 'designs') {
      const own = adapter.ownDraft()
      return Array.isArray(own) ? own : []
    }
    const p = await snapshot()
    return Array.isArray(p.designs) ? p.designs : []
  }

  const shotsData = async (): Promise<Array<Record<string, unknown>>> => {
    if (adapter.artifact === 'shots' || adapter.artifact === 'prompts') {
      const own = adapter.ownDraft()
      return Array.isArray(own) ? (own as Array<Record<string, unknown>>) : []
    }
    const p = await snapshot()
    return Array.isArray(p.shots) ? (p.shots as Array<Record<string, unknown>>) : []
  }

  const readSource = defineTool({
    name: 'read_source',
    description: '读取当前项目的原著/梗概。只读；返回可能被截断。',
    schema: z.object({}),
    run: async () => {
      const d = await scriptData()
      return { ok: true, source: d.source, chars: d.source.length }
    },
  })

  const readEpisodes = defineTool({
    name: 'read_episodes',
    description: '读取分集与场次。只读；可用 episode 只取某一集。',
    schema: z.object({
      episode: z.number().int().min(1).optional().describe('只读第 N 集；省略则读全部分集'),
    }),
    run: async ({ episode }) => {
      const d = await scriptData()
      const episodes = episode
        ? d.episodes.filter((e) => Number(asRecord(e).no) === Number(episode))
        : d.episodes
      return { ok: true, episodes: boundJson(episodes), total: d.episodes.length }
    },
  })

  const readCharacters = defineTool({
    name: 'read_characters',
    description: '读取角色表与外观锚点。只读；可用 names 过滤。',
    schema: z.object({
      names: z.array(z.string()).max(50).optional().describe('只读这些角色名'),
    }),
    run: async ({ names }) => {
      const list = await charactersData()
      const filtered = names?.length
        ? list.filter((x) => names.includes(String(asRecord(x).name || '')))
        : list
      return { ok: true, characters: boundJson(filtered), total: list.length }
    },
  })

  const readDesigns = defineTool({
    name: 'read_designs',
    description: '读取场景/道具设定卡。只读；可用 kind 和 names 过滤。',
    schema: z.object({
      kind: z.enum(['scene', 'prop']).optional().describe('scene 场景 / prop 道具'),
      names: z.array(z.string()).max(50).optional().describe('只读这些名称'),
    }),
    run: async ({ kind, names }) => {
      const list = await designsData()
      const filtered = list.filter((x) => {
        const o = asRecord(x)
        if (kind && o.kind !== kind) return false
        if (names?.length && !names.includes(String(o.name || ''))) return false
        return true
      })
      return { ok: true, designs: boundJson(filtered), total: list.length }
    },
  })

  const readShots = defineTool({
    name: 'read_shots',
    description: '读取镜头表。只读；可用 episode / shotIds 过滤，limit 控制条数。',
    schema: z.object({
      episode: z.number().int().min(1).optional().describe('只读第 N 集'),
      shotIds: z.array(z.string()).max(100).optional().describe('只读这些 shot.id'),
      limit: z.number().int().min(1).max(200).optional().describe('最多返回多少镜'),
    }),
    run: async ({ episode, shotIds, limit }) => {
      const all = await shotsData()
      let list = all
      if (episode) list = list.filter((s) => Number(s.episode) === Number(episode))
      if (shotIds?.length) {
        const set = new Set(shotIds.map(String))
        list = list.filter((s) => set.has(String(s.id || '')))
      }
      if (limit) list = list.slice(0, limit)
      const maxChars = shotIds?.length && shotIds.length <= 4 ? 200_000 : 8000
      return { ok: true, shots: boundJson(list, maxChars), total: all.length }
    },
  })

  const readTransitionRecipes = defineTool({
    name: 'read_transition_recipes',
    description:
      '读取转场食谱索引。可按 taxonomy 或关键词过滤。卡片可能含 whenToUse（适用接缝）、energy（能量等级）、durationHint（秒）、principle（视觉机制）、variants（技法卡多式）、pitfalls（已知坑）、seedanceHints（可直接进提示词的完整句子）。',
    schema: z.object({
      taxonomy: z
        .enum(['scene', 'character', 'space', 'vfx', 'camera', 'ai_video'])
        .optional()
        .describe('六类接缝主分类'),
      q: z.string().optional().describe('标题/intent/tags 关键词'),
      limit: z.number().int().min(1).max(40).optional(),
    }),
    run: async ({ taxonomy, q, limit }) => {
      const { listTransitionRecipes, searchTransitionRecipes } = await import('../transitionRecipes')
      let list = listTransitionRecipes()
      if (taxonomy) list = list.filter((r) => r.taxonomy === taxonomy)
      if (q?.trim()) list = searchTransitionRecipes(q.trim())
      if (limit) list = list.slice(0, limit)
      return { ok: true, recipes: boundJson(list), total: list.length }
    },
  })

  const readEpisode = defineTool({
    name: 'read_episode',
    description: '读取某一集的场次与镜头摘要。只读。',
    schema: z.object({
      episode: z.number().int().min(1).describe('第 N 集'),
    }),
    run: async ({ episode }) => {
      const d = await scriptData()
      const ep = d.episodes.find((x) => Number(asRecord(x).no) === Number(episode))
      if (!ep) return { ok: false, error: `没有第 ${episode} 集` }
      const shots = (await shotsData()).filter((s) => Number(s.episode) === Number(episode))
      return { ok: true, episode: boundJson(ep), shots: boundJson(shots.slice(0, 40)), shotTotal: shots.length }
    },
  })

  const readSkill = defineTool({
    name: 'read_skill',
    description:
      '读取指定技能的完整 SKILL.md（含 frontmatter）。选择/切换技能后应先读取宿主技能全文，再按需读取只读技能。',
    schema: z.object({
      id: z.string().min(1).describe('技能 id，例如 character、asset、shotlist、transition-director'),
    }),
    run: async ({ id }) => {
      try {
        const skill = await getSkill(String(id).trim())
        return {
          ok: true,
          id: skill.id,
          version: skill.manifest.version,
          source: skill.source,
          tools: skill.manifest.tools,
          inputs: skill.manifest.inputs,
          output: skill.manifest.output,
          contracts: skill.manifest.contracts,
          text: skill.text,
        }
      } catch (e) {
        return { ok: false, error: (e as Error).message || String(e) }
      }
    },
  })

  const readByName = new Map<string, ToolDef>([
    [readSkill.name, readSkill],
    [readSource.name, readSource],
    [readEpisodes.name, readEpisodes],
    [readCharacters.name, readCharacters],
    [readDesigns.name, readDesigns],
    [readShots.name, readShots],
    [readTransitionRecipes.name, readTransitionRecipes],
    [readEpisode.name, readEpisode],
  ])

  const contractId = adapter.writeContract
  const submitSchema = getContractToolSchema(contractId)
  if (!submitSchema) throw new Error(`未知输出契约：${contractId}`)
  const submit = defineTool({
    name: adapter.writeTool,
    description:
      '提交当前工作台的产物草稿。只写入草稿并交给宿主合并，不保存到项目；' +
      '返回新增/更新数量。大产物不要重复贴给用户。',
    schema: submitSchema,
    run: async (payload) => {
      const normalized =
        contractId === 'characters-v1' ? normalizeCharactersContractPayload(payload) : payload
      const checked = validateContract(contractId, normalized)
      if (!checked.ok) return { ok: false, error: `提交不符合契约：${checked.errors.join('；')}` }
      const applied = adapter.applyDraft(checked.value)
      adapter.onDraftChanged?.()
      if (!applied.ok) return { ok: false, error: applied.error || applied.summary }
      return {
        ok: true,
        summary: applied.summary,
        ...(applied.counts ? { counts: applied.counts } : {}),
        // 回执上的「用它生成三视图」靠它定位目标角色，不解析文本
        ...(applied.subjects?.length ? { subjects: applied.subjects } : {}),
        ...(applied.hash ? { hash: applied.hash } : {}),
      }
    },
  })

  const byName = new Map(readByName)
  byName.set(submit.name, submit)
  return { read: readByName, submit, byName }
}

/**
 * 绑定技能声明的工具：宿主技能可读写；只读技能只能拿到读工具。
 * 技能声明了运行时没有的工具时直接跳过（装载期已校验，不静默假装可用）。
 */
export function bindSkillTools(
  set: StageToolSet,
  loaded: LoadedSkill[],
): ToolDef[] {
  const byName = new Map<string, ToolDef>()
  for (const { skill, mode } of loaded) {
    for (const name of skill.manifest.tools) {
      if (mode === 'readonly' && name.startsWith('submit_')) continue
      const tool = set.byName.get(name)
      if (tool) byName.set(name, tool)
    }
  }
  const readSkillTool = set.byName.get('read_skill')
  if (readSkillTool) byName.set('read_skill', readSkillTool)
  return [...byName.values()]
}
