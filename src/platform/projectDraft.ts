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
import { checkCharacterWriteback, readCharacters, toProject } from '../charMap'
import { mergeScriptDraft } from '../agent/drafts'
import { isProjectMediaUrl, mergeAssetCards } from '../assetCards'
import type { ProjectEpisode } from '../api'
import { auditVideoPromptCore } from '../promptAuditCore.mjs'
import { AUDIT_VOCAB } from '../videoPromptVocab'

export type ProjectDraftCtx = {
  projectName: string
  epNo: number | (() => number)
  getSnapshot: () => ProjectData | null
  setSnapshot: (p: ProjectData) => void
  onProjectDataChanged?: () => void
  /** 可选：落库实现；默认走 HTTP。测试借此注入失败，宿主也可换成别的写入通道。 */
  writer?: {
    patch?: (name: string, patch: ProjectPatch) => Promise<unknown>
    mergeShots?: (
      name: string,
      shots: ProjectShot[],
      opts?: { deleteShotIds?: string[]; mode?: 'partial' | 'full' },
    ) => Promise<unknown>
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

/**
 * 视频提示词内容审计（写回前）。
 *
 * 只审本次提交涉及的镜头：把每条提交项与快照里的原镜头合并成「将要写入的样子」，
 * 再跑审计核。返回非空即表示阻断——调用方不得落库。
 *
 * 上下文来源都在快照里：场次 beats 从 `episodes[].scenes` 取，角色卡走
 * `readCharacters`，参考集从 `refIds` / `refExtras` 与素材卡标题拼摘要。
 */
function auditPromptsBeforeWrite(
  items: Array<{ no?: unknown; keyframe_prompt?: unknown; video_prompt?: unknown }>,
  p: ProjectData,
  epNo: number,
): DraftApplyResult | null {
  if (!Array.isArray(items) || items.length === 0) return null

  const shots = p.shots || []
  const characters = readCharacters(p.characters)
  const assets = p.assets || []
  const ep = (p.episodes || []).find((e) => (Number(e.no) || 0) === epNo)
  const scenes = ep?.scenes ?? []

  // 角色名 → lookEn（与首帧审计同一份数据）
  const chars = characters.map((c) => ({ name: c.name, lookEn: c.lookEn }))
  // 场景 / 道具已建档名称，供「该有参考」判定
  const sceneNames = assets.filter((a) => a.kind === 'scene').map((a) => a.title).filter(Boolean)
  const propNames = assets.filter((a) => a.kind === 'prop').map((a) => a.title).filter(Boolean)
  // 定稿文本：剧本场次正文 + 镜头描述 + 台词，供发声引文守真比对
  const dialogueSource = [
    ...scenes.map((s) => String(s.beats ?? '')),
    ...shots.map((s) => `${String(s.desc ?? '')} ${JSON.stringify(s.dialogue ?? '')}`),
    ...characters.map((c) => `${c.name ?? ''} ${c.lookCn ?? ''}`),
  ].join('\n')

  const epShots = shots
    .filter((s) => (Number(s.episode) || 1) === epNo)
    .slice()
    .sort((a, b) => String(a.no ?? '').localeCompare(String(b.no ?? ''), undefined, { numeric: true }))

  const failures: Array<Record<string, unknown>> = []

  for (const item of items) {
    const no = String(item?.no ?? '')
    const existing = shots.find(
      (s) => String(s.no ?? '') === no && (Number(s.episode) || 1) === epNo,
    )
    if (!existing) continue

    const sceneSlug = String(existing.scene_slug ?? '')
    const scene = scenes.find((s) => String(s.slug ?? '') === sceneSlug)
    const idx = epShots.findIndex((s) => String(s.no ?? '') === no)
    const nextShot = idx >= 0 ? epShots[idx + 1] : undefined

    // 参考摘要：refIds（asset-<canvasId> / char-<name>）+ refExtras 标题
    const refs: Array<{ kind: string; name: string }> = []
    for (const token of existing.refIds ?? []) {
      const t = String(token)
      if (t.startsWith('char-')) refs.push({ kind: 'character', name: t.slice(5) })
      else if (t.startsWith('asset-')) {
        const id = t.slice(6)
        const a = assets.find((x) => String(x.canvasId ?? '') === id)
        if (a) refs.push({ kind: a.kind === 'scene' ? 'scene' : a.kind === 'prop' ? 'prop' : 'other', name: a.title })
      }
    }
    for (const url of existing.refExtras ?? []) {
      const a = assets.find((x) => String(x.url ?? '') === String(url))
      if (a) refs.push({ kind: a.kind === 'scene' ? 'scene' : a.kind === 'prop' ? 'prop' : 'other', name: a.title })
    }
    if (existing.keyframe) refs.push({ kind: 'frame', name: '首帧' })

    const audit = auditVideoPromptCore(
      { ...existing, video_prompt: String(item?.video_prompt ?? existing.video_prompt ?? '') },
      {
        vocab: AUDIT_VOCAB,
        sceneBeats: String(scene?.beats ?? ''),
        refs,
        chars,
        castSceneNames: sceneNames,
        propNames,
        dialogueSource,
        nextShot,
        isLastShot: idx >= 0 && idx === epShots.length - 1,
      },
    )

    if (audit.blockers.length > 0) {
      failures.push({ no, blockers: audit.blockers, warnings: audit.warnings })
    }
  }

  if (failures.length === 0) return null

  const checks = failures.flatMap((f) =>
    (f.blockers as Array<Record<string, unknown>>).map((b) => ({ ...b, no: f.no })),
  )
  const warnCount = failures.reduce((n, f) => n + (f.warnings as unknown[]).length, 0)
  return {
    ok: false,
    summary: '',
    error:
      `视频提示词审计未通过：${failures.length} 镜存在硬项问题，本次未写入任何数据` +
      (warnCount ? `（另有 ${warnCount} 条提示）` : ''),
    ...(checks.length ? { checks, hint: '按每条 checks 的 evidence 与 hint 修改后重新提交；只改这些项，不要重写未涉及的段落' } : {}),
  } as DraftApplyResult
}

/** 按平台契约把 payload 合并进当前项目（创意 / 内置 Pi 工具共用） */
export async function applyProjectDraft(
  contractId: string,
  payload: unknown,
  ctx: ProjectDraftCtx,
  opts?: { partial?: boolean },
): Promise<DraftApplyResult> {
  const p = ctx.getSnapshot()
  if (!p) return { ok: false, summary: '', error: '未加载项目：请先在顶栏选择项目' }
  const epNo = resolveDraftEpNo(ctx)
  const writePatch = ctx.writer?.patch ?? patchProject
  const writeShots = ctx.writer?.mergeShots ?? mergeProjectShots
  /**
   * 一次性写回都是「按当前快照重算出的全集」：缺席=被删是模型/合并的意图，
   * 因此显式声明 full，让服务端把缺席的旧镜头标成 orphan 而不是静默丢弃。
   *
   * 分批写回相反：一批只带一部分镜头，缺席的那些还在后续批次里，
   * 必须走 partial，否则第一批就会把没提交的镜头判成删除。
   */
  const FULL = { mode: opts?.partial ? ('partial' as const) : ('full' as const) }

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
    const failed = await commit(() => writeShots(ctx.projectName, withIds, FULL))
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
    // 快照里的角色是接口形状（蛇形），必须先转成界面模型再合并，否则同名角色命中时读不到锚点
    const current = readCharacters(p.characters)
    const merged = mergeCharacters(current, incoming)
    // 合并结果是界面模型，写库前必须转回接口形状：服务端只认 look_cn / look_en
    const payloadForDb = merged.next.map(toProject)
    const rejected = checkCharacterWriteback(payloadForDb, merged.next)
    if (rejected) return { ok: false, summary: '', error: rejected }
    const failed = await commit(() => writePatch(ctx.projectName, { characters: payloadForDb }))
    if (failed) return failed
    // 快照统一保存接口形状，与服务端读回的一致，避免同一会话里出现混合形状
    ctx.setSnapshot({ ...p, characters: payloadForDb })
    ctx.onProjectDataChanged?.()
    const subjects = [...merged.added, ...merged.updated]
    const parts = [`新增 ${merged.added.length}`, `更新 ${merged.updated.length}`]
    if (merged.filled.length) parts.push(`补锚点 ${merged.filled.length}`)
    if (merged.skipped.length) parts.push(`跳过 ${merged.skipped.length}`)
    const written = [...merged.added, ...merged.filled, ...merged.updated]
    return {
      ok: true,
      summary: `角色表：${parts.join('，')}${written.length ? `｜${written.join('、')}` : ''}`,
      counts: { total: incoming.length, added: merged.added.length, updated: merged.updated.length },
      ...(subjects.length ? { subjects } : {}),
    }
  }

  if (contractId === 'prompts-v1') {
    const items = Array.isArray((payload as { shots?: unknown[] }).shots)
      ? (payload as { shots: Parameters<typeof mergePromptDraft>[1] }).shots
      : []

    // 内容审计：在落库之前用「合并后的镜头」判定，硬项不通过即整体拒绝、
    // 不写任何数据。用合并后的结果而不是提交原文，因为锚点展开会补全字段。
    const auditFail = auditPromptsBeforeWrite(items, p, epNo)
    if (auditFail) return auditFail

    const { shots, patched, missing, unresolved } = mergePromptDraft(
      p.shots || [],
      items,
      epNo,
      // 锚点展开读的是驼峰字段 lookEn，必须先转成界面模型，否则蛇形角色永远解析不出锚点
      readCharacters(p.characters),
    )
    const failed = await commit(() => writeShots(ctx.projectName, shots, FULL))
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
    const failed = await commit(() => writeShots(ctx.projectName, r.shots, FULL))
    if (failed) return failed
    ctx.setSnapshot({ ...p, shots: r.shots })
    ctx.onProjectDataChanged?.()
    return {
      ok: true,
      summary: `镜间接缝：应用 ${r.applied}，硬切 ${r.cuts}，特效 ${r.effects}`,
      counts: { applied: r.applied, cuts: r.cuts, effects: r.effects },
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