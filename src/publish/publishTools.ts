/**
 * 发布助手的工具集。
 *
 * 三类工具，权限不同：
 * - read_*：只读当前界面事实（含未落库配置），结果按 8k 截断。
 * - set_*：只改发布配置，必须带 roundId 以便撤销；只走 adapter.applyPatch。
 * - stage_*：只暂存一次提交意图，服务端只写 intent 行；工具内部没有任何提交分支。
 * - connect_account / ask_user：拉起登录、向用户澄清，不产生平台副作用。
 *
 * 这里刻意没有 retry_job / cancel_job / mark_published：
 * 前两个是任务回执上的宿主按钮，最后一个属于「用户对平台事实的确认」，助手不碰。
 */
import { DynamicStructuredTool } from '@langchain/core/tools'
import type { StructuredToolInterface } from '@langchain/core/tools'
import { z } from 'zod'
import { boundJson } from '../agent/workbenchChat'
import { loadVideoFrameAt } from './frames'
import { readinessSummary, computeReadiness, type PublishChatAdapter } from './publishChat'
import type { CoverAspect } from './types'

const ASPECTS: CoverAspect[] = ['9:16', '3:4', '4:3', '16:9']

function shortDeliverable(d: {
  id: string
  episode: number
  version: number
  url: string
  width: number | null
  height: number | null
  duration: number | null
  createdAt: string
}) {
  return {
    id: d.id,
    episode: d.episode,
    version: d.version,
    url: d.url,
    width: d.width,
    height: d.height,
    duration: d.duration,
    createdAt: d.createdAt,
  }
}

/** 平台只回助手决策需要的字段；完整能力表进上下文会白占 token */
function shortPlatform(p: {
  id: string
  label: string
  modes: string[]
  manualOnly: boolean
  verified: boolean
  coverAspects: string[]
  limits: { titleMax: number; titleMin?: number; titleOptional?: true; descriptionMax: number; tagsMax: number }
  draftKind?: string
}) {
  return {
    id: p.id,
    label: p.label,
    modes: p.modes,
    manualOnly: p.manualOnly,
    verified: p.verified,
    coverAspects: p.coverAspects,
    limits: p.limits,
    draftKind: p.draftKind || 'none',
  }
}

function shortJob(j: {
  id: string
  platform: string
  state: string
  stage: string
  mode: string
  errorMessage: string
  createdAt: string
  payload?: { source?: string }
}) {
  return {
    id: j.id,
    platform: j.platform,
    state: j.state,
    stage: j.stage,
    mode: j.mode,
    error: j.errorMessage,
    source: j.payload?.source || 'manual',
    createdAt: j.createdAt,
  }
}

export type PublishToolOptions = {
  /** 抽帧实现；测试可注入，生产走浏览器 canvas */
  extractFrame?: (src: string, atPercent: number) => Promise<string>
}

export function createPublishToolSet(
  adapter: PublishChatAdapter,
  options: PublishToolOptions = {},
): Map<string, StructuredToolInterface> {
  const extractFrame = options.extractFrame || loadVideoFrameAt
  const tools = new Map<string, StructuredToolInterface>()
  const add = (tool: StructuredToolInterface) => tools.set(tool.name, tool)

  // ---------------- 读 ----------------

  add(
    new DynamicStructuredTool({
      name: 'read_publish_state',
      description: '读取发布台此刻的完整概况：当前成片、已选平台、准备度、预检结论、最近任务。只读。',
      schema: z.object({}),
      func: async () => {
        const s = adapter.snapshot()
        const readiness = computeReadiness({
          config: s.config,
          platforms: s.platforms,
          accounts: s.accounts,
          preflight: s.preflight,
        })
        return {
          ok: true,
          deliverable: s.deliverable ? shortDeliverable(s.deliverable) : null,
          deliverableCount: s.deliverables.length,
          readiness: readiness.items.map((i) => ({ key: i.key, state: i.state, detail: i.detail })),
          readinessText: readinessSummary(readiness),
          selectedTargets: Object.entries(s.config.targets || {})
            .filter(([, t]) => t.selected)
            .map(([platform, t]) => ({ platform, accountId: t.accountId, mode: t.mode })),
          browserAvailable: Boolean(s.health?.browserAvailable),
          aiGenerated: s.config.master?.aiGenerated !== false,
        }
      },
    }),
  )

  add(
    new DynamicStructuredTool({
      name: 'read_deliverables',
      description: '读取当前集可发布的成片列表（含版本、时长、分辨率）。只读。',
      schema: z.object({}),
      func: async () => {
        const s = adapter.snapshot()
        return {
          ok: true,
          activeId: s.deliverable?.id || '',
          deliverables: boundJson(s.deliverables.map(shortDeliverable)),
          total: s.deliverables.length,
        }
      },
    }),
  )

  add(
    new DynamicStructuredTool({
      name: 'read_config',
      description: '读取当前发布配置：主文案、各平台选择与覆写、已准备的封面。只读。',
      schema: z.object({}),
      func: async () => {
        const s = adapter.snapshot()
        const selected = Object.entries(s.config.targets || {})
          .filter(([, t]) => t.selected)
          .map(([platform, t]) => ({
            platform,
            accountId: t.accountId,
            mode: t.mode,
            override: t.override,
          }))
        return {
          ok: true,
          master: s.config.master,
          selected,
          cover: s.config.cover,
        }
      },
    }),
  )

  add(
    new DynamicStructuredTool({
      name: 'read_accounts',
      description: '读取平台账号的连接状态。只读；不返回任何凭据或 profile 路径。',
      schema: z.object({}),
      func: async () => {
        const s = adapter.snapshot()
        return {
          ok: true,
          accounts: s.accounts.map((a) => ({
            id: a.id,
            platform: a.platform,
            label: a.label,
            status: a.status,
            autoDraft: a.autoDraft,
            lastCheckedAt: a.lastCheckedAt,
          })),
        }
      },
    }),
  )

  add(
    new DynamicStructuredTool({
      name: 'read_platforms',
      description: '读取平台能力表：支持的发布方式、封面比例、标题与简介限制、是否只能人工。只读。',
      schema: z.object({}),
      func: async () => {
        const s = adapter.snapshot()
        return { ok: true, platforms: boundJson(s.platforms.map(shortPlatform)) }
      },
    }),
  )

  add(
    new DynamicStructuredTool({
      name: 'read_preflight',
      description: '读取当前配置的预检结果：阻断项与警告项，含定位字段。只读。',
      schema: z.object({}),
      func: async () => {
        const s = adapter.snapshot()
        if (!s.preflight) return { ok: true, pending: true, blocking: [], warnings: [] }
        return {
          ok: true,
          pass: Boolean(s.preflight.ok),
          blocking: boundJson(s.preflight.blocking),
          warnings: boundJson(s.preflight.warnings),
        }
      },
    }),
  )

  add(
    new DynamicStructuredTool({
      name: 'read_jobs',
      description: '读取最近 10 条发布任务的状态摘要。只读。',
      schema: z.object({}),
      func: async () => {
        const s = adapter.snapshot()
        return { ok: true, jobs: s.jobs.slice(0, 10).map(shortJob), total: s.jobs.length }
      },
    }),
  )

  // ---------------- 写配置 ----------------

  add(
    new DynamicStructuredTool({
      name: 'set_targets',
      description:
        '勾选或取消发布平台。只改「选/不选」与账号，不改文案、封面或方式。批量写一次，产生一张可撤销回执。',
      schema: z.object({
        select: z.array(z.string()).optional().describe('要勾选的平台 id'),
        deselect: z.array(z.string()).optional().describe('要取消勾选的平台 id'),
        accountId: z.string().optional().describe('为本次勾选的平台统一指定账号 id'),
      }),
      func: async ({ select, deselect, accountId }) => {
        const s = adapter.snapshot()
        const known = new Set(s.platforms.map((p) => p.id))
        const roundId = adapter.beginRound()
        const targets: Record<string, { selected: boolean; accountId?: string }> = {}
        for (const id of select || []) {
          if (!known.has(id)) continue
          targets[id] = { selected: true, ...(accountId ? { accountId } : {}) }
        }
        for (const id of deselect || []) {
          if (!known.has(id)) continue
          targets[id] = { selected: false }
        }
        if (!Object.keys(targets).length) {
          return { ok: false, roundId, changes: [], error: '没有可写的平台：请检查平台 id' }
        }
        const r = adapter.applyPatch({ targets })
        return { ok: r.ok, roundId: r.roundId || roundId, changes: r.changes, ...(r.error ? { error: r.error } : {}) }
      },
    }),
  )

  add(
    new DynamicStructuredTool({
      name: 'set_copy',
      description:
        '写主标题、主简介、标签或 AI 声明；也可写某个平台自己的覆写。只动传入的字段。',
      schema: z.object({
        title: z.string().optional().describe('主标题'),
        description: z.string().optional().describe('主简介'),
        tags: z.array(z.string()).optional().describe('标签数组'),
        aiGenerated: z.boolean().optional().describe('AI 生成内容声明'),
        platform: z.string().optional().describe('填写则写该平台的覆写，而不是主文案'),
        clearOverride: z.boolean().optional().describe('为 true 时清除该平台覆写，恢复继承主文案'),
      }),
      func: async ({ title, description, tags, aiGenerated, platform, clearOverride }) => {
        const roundId = adapter.beginRound()
        if (platform) {
          const override = clearOverride
            ? null
            : {
                ...(title !== undefined ? { title } : {}),
                ...(description !== undefined ? { description } : {}),
                ...(tags !== undefined ? { tags } : {}),
              }
          const r = adapter.applyPatch({ override: { [platform]: override } })
          return { ok: r.ok, roundId: r.roundId || roundId, changes: r.changes, ...(r.error ? { error: r.error } : {}) }
        }
        const master = {
          ...(title !== undefined ? { title } : {}),
          ...(description !== undefined ? { description } : {}),
          ...(tags !== undefined ? { tags } : {}),
          ...(aiGenerated !== undefined ? { aiGenerated } : {}),
        }
        if (!Object.keys(master).length) {
          return { ok: false, roundId, changes: [], error: '没有要写的字段' }
        }
        const r = adapter.applyPatch({ master })
        return { ok: r.ok, roundId: r.roundId || roundId, changes: r.changes, ...(r.error ? { error: r.error } : {}) }
      },
    }),
  )

  add(
    new DynamicStructuredTool({
      name: 'set_mode',
      description:
        '设置某个平台的发布方式：draft 保存草稿、publish 立即发布、package 只导出发布包。助手的任务只能是草稿或发布包。',
      schema: z.object({
        platform: z.string().describe('平台 id'),
        mode: z.enum(['draft', 'publish', 'package']),
      }),
      func: async ({ platform, mode }) => {
        const roundId = adapter.beginRound()
        const r = adapter.applyPatch({ targets: { [platform]: { mode } } })
        return { ok: r.ok, roundId: r.roundId || roundId, changes: r.changes, ...(r.error ? { error: r.error } : {}) }
      },
    }),
  )

  add(
    new DynamicStructuredTool({
      name: 'set_cover',
      description:
        '为某个比例准备封面。source=frame 时从成片按比例位置抽一帧（atPercent 0-1），source=url 时使用已存在的图片地址。',
      schema: z.object({
        aspect: z.enum(['9:16', '3:4', '4:3', '16:9']),
        source: z.enum(['frame', 'url', 'clear']).describe('frame 抽帧、url 用现成地址、clear 清除'),
        atPercent: z.number().min(0).max(1).optional().describe('抽帧位置，0.1 表示 10% 处'),
        url: z.string().optional().describe('source=url 时的图片地址'),
      }),
      func: async ({ aspect, source, atPercent, url }) => {
        if (!ASPECTS.includes(aspect)) return { ok: false, roundId: '', changes: [], error: '未知封面比例' }
        if (source === 'clear') {
          const roundId = adapter.beginRound()
          const r = adapter.applyPatch({ cover: { [aspect]: null } })
          return { ok: r.ok, roundId: r.roundId || roundId, changes: r.changes, ...(r.error ? { error: r.error } : {}) }
        }
        let value = String(url || '').trim()
        if (source === 'frame') {
          const s = adapter.snapshot()
          if (!s.deliverable) return { ok: false, roundId: '', changes: [], error: '当前没有选中成片' }
          try {
            value = await extractFrame(s.deliverable.url, atPercent ?? 0.5)
          } catch (e) {
            return { ok: false, roundId: '', changes: [], error: (e as Error).message || '抽帧失败' }
          }
        }
        if (!value) return { ok: false, roundId: '', changes: [], error: '没有可用的封面地址' }
        const roundId = adapter.beginRound()
        const r = adapter.applyPatch({ cover: { [aspect]: value } })
        return { ok: r.ok, roundId: r.roundId || roundId, changes: r.changes, ...(r.error ? { error: r.error } : {}) }
      },
    }),
  )

  // ---------------- 暂存提交（没有提交能力） ----------------

  add(
    new DynamicStructuredTool({
      name: 'stage_submit',
      description:
        '暂存一次草稿提交：只生成待确认卡，不创建任务。用户在卡上确认后系统才提交。绝不能把它说成已经提交。',
      schema: z.object({
        platforms: z.array(z.string()).optional().describe('要提交的平台 id；省略则用当前已勾选的平台'),
        note: z.string().optional().describe('给用户的一句话说明，例如为什么这样选'),
      }),
      func: async ({ platforms, note }) => {
        const s = adapter.snapshot()
        const wanted = platforms?.length ? new Set(platforms) : null
        const targetEntries = Object.entries(s.config.targets || {}).filter(
          ([platform, t]) => t.selected && (!wanted || wanted.has(platform)),
        )
        const targets = targetEntries.map(([platform, t]) => ({
          platform,
          accountId: t.accountId,
          mode: t.mode === 'publish' ? ('draft' as const) : t.mode,
        }))
        if (!targets.length) {
          return { ok: false, staged: false, error: '没有选中任何平台，先确认要发哪些平台' }
        }
        const r = await adapter.stage({ targets, note })
        if (!r.ok || !r.intent) {
          return { ok: false, staged: false, error: r.error || '暂存失败', ...(r.code ? { code: r.code } : {}) }
        }
        return {
          ok: true,
          staged: true,
          intentId: r.intent.id,
          hash: r.intent.hash,
          state: r.intent.state,
          targets: r.intent.targets,
          preflightPass: Boolean((r.intent.preflight as { ok?: boolean })?.ok),
          message: '已生成待确认卡，等待用户确认；没有创建任何任务。',
        }
      },
    }),
  )

  add(
    new DynamicStructuredTool({
      name: 'stage_package',
      description:
        '暂存一次发布包导出：只生成待确认卡，不创建任务。平台不可自动上传时用这个。',
      schema: z.object({
        platforms: z.array(z.string()).optional().describe('要打包的平台 id；省略则用当前已勾选的平台'),
        note: z.string().optional(),
      }),
      func: async ({ platforms, note }) => {
        const s = adapter.snapshot()
        const wanted = platforms?.length ? new Set(platforms) : null
        const targets = Object.entries(s.config.targets || {})
          .filter(([platform, t]) => t.selected && (!wanted || wanted.has(platform)))
          .map(([platform]) => ({ platform, accountId: '', mode: 'package' as const }))
        if (!targets.length) {
          return { ok: false, staged: false, error: '没有选中任何平台' }
        }
        const r = await adapter.stage({ targets, note })
        if (!r.ok || !r.intent) {
          return { ok: false, staged: false, error: r.error || '暂存失败', ...(r.code ? { code: r.code } : {}) }
        }
        return {
          ok: true,
          staged: true,
          intentId: r.intent.id,
          state: r.intent.state,
          targets: r.intent.targets,
          message: '已生成待确认卡，等待用户确认；没有创建任何任务。',
        }
      },
    }),
  )

  // ---------------- 人机交界 ----------------

  add(
    new DynamicStructuredTool({
      name: 'connect_account',
      description: '为某个平台拉起本机登录窗口，等用户扫码。只负责打开窗口，不判断登录成功。',
      schema: z.object({
        platform: z.string().describe('平台 id'),
      }),
      func: async ({ platform }) => {
        const r = await adapter.connectAccount(platform)
        return { ...r, message: r.message || (r.ok ? '已打开登录窗口，等用户完成扫码' : '无法打开登录窗口') }
      },
    }),
  )

  add(
    new DynamicStructuredTool({
      name: 'ask_user',
      description:
        '当成片或平台不明确时向用户澄清。给出最多 4 个可直接点选的选项；不要在上下文明确时使用。',
      schema: z.object({
        question: z.string().min(1),
        options: z
          .array(
            z.object({
              value: z.string().min(1),
              label: z.string().min(1),
            }),
          )
          .min(1)
          .max(4),
      }),
      func: async ({ question, options }) => {
        return { ok: true, question, options: options.slice(0, 4) }
      },
    }),
  )

  return tools
}
