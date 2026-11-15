import {
  listMedia,
  mergeProjectShots,
  patchProject,
  type DesignSheet,
  type ProjectAsset,
  type ProjectData,
  type ProjectPatch,
  type ProjectShot,
} from '../api'
import { mergePromptDraft } from '../agent/promptDraft'
import type { DraftApplyResult } from '../agent/workbenchChat'
import { mergeCharacters, type ExtractedChar } from '../charExtract'
import { mergeDesignDraft } from '../designExtract'
import { mergeShotsDraft } from '../shotSync'
import { blankShot } from '../shotRows'
import { applyJoinsToShots, type JoinDraft } from '../shotJoins'
import type { CharacterSheet } from '../characters'
import { mergeScriptDraft } from '../agent/drafts'
import { isProjectMediaUrl, mergeAssetCards } from '../assetCards'
import type { ProjectEpisode } from '../api'

export type ProjectDraftCtx = {
  projectName: string
  epNo: number | (() => number)
  getSnapshot: () => ProjectData | null
  setSnapshot: (p: ProjectData) => void
  onProjectDataChanged?: () => void
  /** 可选：落库实现；默认走 HTTP。测试借此注入失败，宿主也可换成别的写入通道。 */
  writer?: {
    patch?: (name: string, patch: ProjectPatch) => Promise<unknown>
    mergeShots?: (name: string, shots: ProjectShot[], deleteShotIds?: string[]) => Promise<unknown>
  }
  /** 可选：项目媒体清单；素材卡地址校验用，默认走 HTTP */
  listMediaUrls?: (name: string) => Promise<string[]>
  /** 可选：素材卡写回后同步画布节点（只落项目会导致画布上看不到） */
  onAssetsWritten?: (assets: ProjectAsset[]) => void | Promise<void>
}

function asError(e: unknown): string {
  return (e as Error)?.message || String(e)
}

/** 等待落库；失败返回失败结果，调用方据此不回写乐观快照 */
async function commit(run: () => Promise<unknown>): Promise<DraftApplyResult | null> {
  try {
    await run()
    return null
  } catch (e) {
    return { ok: false, summary: '', error: asError(e) }
  }
}

function resolveDraftEpNo(ctx: ProjectDraftCtx): number {
  const raw = typeof ctx.epNo === 'function' ? ctx.epNo() : ctx.epNo
  const n = Number(raw)
  return Number.isFinite(n) && n > 0 ? n : 1
}

/** 按平台契约把 payload 合并进当前项目（创意 / 内置 Pi 工具共用） */
export async function applyProjectDraft(
  contractId: string,
  payload: unknown,
  ctx: ProjectDraftCtx,
): Promise<DraftApplyResult> {
  const p = ctx.getSnapshot()
  if (!p) return { ok: false, summary: '', error: '未加载项目：请先在顶栏选择项目' }
  const epNo = resolveDraftEpNo(ctx)
  const writePatch = ctx.writer?.patch ?? patchProject
  const writeShots = ctx.writer?.mergeShots ?? mergeProjectShots

  if (contractId === 'script-v1') {
    // 按集号合并：本次没出现的集必须原样保留，否则一次改第 2 集会把整部剧本删成 1 集。
    const incoming = Array.isArray((payload as { episodes?: ProjectEpisode[] }).episodes)
      ? (payload as { episodes: ProjectEpisode[] }).episodes
      : []
    if (!incoming.length) return { ok: false, summary: '', error: '分集载荷为空：episodes 至少一集' }
    const rawLogline = (payload as { logline?: unknown }).logline
    const logline = typeof rawLogline === 'string' ? rawLogline.trim() : ''
    const merged = mergeScriptDraft((p.episodes || []) as ProjectEpisode[], incoming, 'merge')
    const patch: ProjectPatch = { episodes: merged.episodes }
    if (logline) patch.logline = logline
    const failed = await commit(() => writePatch(ctx.projectName, patch))
    if (failed) return failed
    ctx.setSnapshot({ ...p, episodes: merged.episodes, ...(logline ? { logline } : {}) })
    ctx.onProjectDataChanged?.()
    return {
      ok: true,
      summary: `分集已写回：新增 ${merged.added}，更新 ${merged.updated}`,
      counts: { added: merged.added, updated: merged.updated, total: merged.episodes.length },
    }
  }

  if (contractId === 'shots-v1') {
    const shots = Array.isArray((payload as { shots?: ProjectShot[] }).shots)
      ? (payload as { shots: ProjectShot[] }).shots
      : []
    const { shots: merged, added, updated } = mergeShotsDraft(p.shots || [], shots, epNo, 'merge', 'agent')
    const withIds = merged.map((s) => {
      const no = String(s.no ?? '').trim()
      if (s.id || !no) return s
      const ep = Number(s.episode) || epNo
      const base = blankShot(ep, no)
      return { ...base, ...s, id: base.id, episode: ep }
    })
    const failed = await commit(() => writeShots(ctx.projectName, withIds))
    if (failed) return failed
    ctx.setSnapshot({ ...p, shots: withIds })
    ctx.onProjectDataChanged?.()
    return {
      ok: true,
      summary: `分镜已写回：新增 ${added}，更新 ${updated}`,
      counts: { added, updated, total: shots.length },
    }
  }

  if (contractId === 'characters-v1') {
    const incoming = Array.isArray((payload as { characters?: ExtractedChar[] }).characters)
      ? (payload as { characters: ExtractedChar[] }).characters
      : Array.isArray(payload)
        ? (payload as ExtractedChar[])
        : []
    const merged = mergeCharacters((p.characters || []) as CharacterSheet[], incoming)
    const failed = await commit(() => writePatch(ctx.projectName, { characters: merged.next }))
    if (failed) return failed
    ctx.setSnapshot({ ...p, characters: merged.next })
    ctx.onProjectDataChanged?.()
    const subjects = [...merged.added, ...merged.updated]
    return {
      ok: true,
      summary: `角色表：新增 ${merged.added.length}，更新 ${merged.updated.length}`,
      counts: { total: incoming.length, added: merged.added.length, updated: merged.updated.length },
      ...(subjects.length ? { subjects } : {}),
    }
  }

  if (contractId === 'prompts-v1') {
    const items = Array.isArray((payload as { shots?: unknown[] }).shots)
      ? (payload as { shots: Parameters<typeof mergePromptDraft>[1] }).shots
      : []
    const { shots, patched, missing, unresolved } = mergePromptDraft(
      p.shots || [],
      items,
      epNo,
      (p.characters || []) as CharacterSheet[],
    )
    const failed = await commit(() => writeShots(ctx.projectName, shots))
    if (failed) return failed
    ctx.setSnapshot({ ...p, shots })
    ctx.onProjectDataChanged?.()
    return {
      ok: true,
      summary: `提示词已写回 ${patched} 镜${missing ? `，${missing} 镜未找到` : ''}${unresolved ? `，${unresolved} 处锚点未解析` : ''}`,
      counts: { patched, missing, unresolved },
    }
  }

  if (contractId === 'joins-v1') {
    const joins = Array.isArray((payload as { joins?: JoinDraft[] }).joins)
      ? (payload as { joins: JoinDraft[] }).joins
      : []
    const r = applyJoinsToShots(p.shots || [], joins)
    const failed = await commit(() => writeShots(ctx.projectName, r.shots))
    if (failed) return failed
    ctx.setSnapshot({ ...p, shots: r.shots })
    ctx.onProjectDataChanged?.()
    return {
      ok: true,
      summary: `镜间接缝：应用 ${r.applied}，硬切 ${r.cuts}，特效 ${r.effects}，生成 ${r.generated}`,
      counts: { applied: r.applied, cuts: r.cuts, effects: r.effects, generated: r.generated },
    }
  }

  if (contractId === 'designs-v1') {
    // 合并而非替换：未出现在本次写回里的卡必须保留，已有图片与手工锚点不能被抹
    const merged = mergeDesignDraft((p.designs || []) as DesignSheet[], payload)
    const failed = await commit(() => writePatch(ctx.projectName, { designs: merged.next }))
    if (failed) return failed
    ctx.setSnapshot({ ...p, designs: merged.next })
    ctx.onProjectDataChanged?.()
    return {
      ok: true,
      summary: `素材设定：新增 ${merged.added.length}，更新 ${merged.updated.length}`,
      counts: { total: merged.incoming.length, added: merged.added.length, updated: merged.updated.length },
    }
  }

  if (contractId === 'assets-v1') {
    const incoming = Array.isArray((payload as { assets?: ProjectAsset[] }).assets)
      ? (payload as { assets: ProjectAsset[] }).assets
      : []
    if (!incoming.length) return { ok: false, summary: '', error: 'assets 至少一张卡' }
    // 地址校验整批做：一张坏地址就整批拒绝，避免「部分成功」留下半套素材
    let urls: string[]
    try {
      if (ctx.listMediaUrls) {
        urls = await ctx.listMediaUrls(ctx.projectName)
      } else {
        const bundle = await listMedia(ctx.projectName)
        urls = [...bundle.images, ...bundle.videos].map((m) => m.url)
      }
    } catch (e) {
      return { ok: false, summary: '', error: `读取项目媒体失败：${asError(e)}` }
    }
    const bad = incoming.filter((a) => !isProjectMediaUrl(String(a?.url ?? ''), urls)).map((a) => String(a?.url ?? ''))
    if (bad.length) {
      return {
        ok: false,
        summary: '',
        error: `地址不在当前项目媒体里，已整批拒绝：${[...new Set(bad)].join('、')}`,
      }
    }
    const merged = mergeAssetCards(p.assets, incoming)
    const failed = await commit(() => writePatch(ctx.projectName, { assets: merged.next }))
    if (failed) return failed
    ctx.setSnapshot({ ...p, assets: merged.next })
    // 画布节点必须同步写：只写项目时，画布已有节点就不会再从 assets 重建，
    // 用户会看到「提交成功但画布上没有卡」。
    try {
      await ctx.onAssetsWritten?.(merged.next)
    } catch (e) {
      return {
        ok: false,
        summary: `已写入项目素材 ${merged.added.length} 张，但画布同步失败`,
        error: asError(e),
      }
    }
    ctx.onProjectDataChanged?.()
    return {
      ok: true,
      summary: `素材卡：新增 ${merged.added.length}，更新 ${merged.updated.length}`,
      counts: { total: incoming.length, added: merged.added.length, updated: merged.updated.length },
    }
  }

  return { ok: false, summary: '', error: `不支持写回契约：${contractId}` }
}

export const PLATFORM_WRITE_TOOLS: Array<{ tool: string; contract: string; label: string }> = [
  { tool: 'submit_episodes', contract: 'script-v1', label: '分集剧本' },
  { tool: 'submit_characters', contract: 'characters-v1', label: '角色' },
  { tool: 'submit_designs', contract: 'designs-v1', label: '素材/设定' },
  { tool: 'submit_assets', contract: 'assets-v1', label: '素材卡' },
  { tool: 'submit_shots', contract: 'shots-v1', label: '镜头表' },
  { tool: 'submit_prompts', contract: 'prompts-v1', label: '提示词' },
  { tool: 'submit_joins', contract: 'joins-v1', label: '镜间接缝' },
]