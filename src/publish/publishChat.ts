/**
 * 发布助手的宿主契约与准备度计算。
 *
 * 和 WorkbenchChatAdapter 的区别：发布台没有「产物草稿」，
 * 只有一份发布配置 + 可撤销的轮次快照 + 一次暂存提交。
 * 所以这里用窄类型的 ConfigPatch，模型无法整份覆盖配置。
 */
import type {
  CoverAspect,
  Deliverable,
  DeliverableConfig,
  PlatformCapability,
  PreflightResult,
  PublishAccount,
  PublishIntent,
  PublishJob,
  PublishMode,
  PlatformHealth,
} from './types'
import type { ChatThreadKey } from '../agent/threads'

export type PublishSnapshot = {
  deliverable: Deliverable | null
  deliverables: Deliverable[]
  config: DeliverableConfig
  platforms: PlatformCapability[]
  accounts: PublishAccount[]
  preflight: PreflightResult | null
  jobs: PublishJob[]
  health: PlatformHealth | null
}

export type TargetPatch = {
  selected?: boolean
  accountId?: string
  mode?: PublishMode
}

export type CopyPatch = {
  title?: string
  description?: string
  tags?: string[]
  aiGenerated?: boolean
}

/** 只列模型可写的四类字段；不接收整份 DeliverableConfig */
export type ConfigPatch = {
  targets?: Record<string, TargetPatch>
  master?: CopyPatch
  /** 按平台覆写；null 表示清除该平台覆写 */
  override?: Record<string, { title?: string; description?: string; tags?: string[] } | null>
  cover?: Partial<Record<CoverAspect, string | null>>
}

export type ConfigChange = {
  field: string
  from: string
  to: string
}

export type PublishWriteResult = {
  ok: boolean
  roundId: string
  changes: ConfigChange[]
  error?: string
}

export type StageInput = {
  targets: { platform: string; accountId: string; mode: PublishMode }[]
  note?: string
}

export type StageResult = {
  ok: boolean
  intent?: PublishIntent
  error?: string
  code?: string
}

export type ConnectResult = {
  ok: boolean
  platform: string
  status: string
  message: string
  accountId?: string
}

/**
 * 发布助手宿主适配器。
 * 抽屉/回执只通过这里读写，不直接 fetch，也不直接碰 PublishBoard 的 state。
 */
export type PublishChatAdapter = {
  threadKey: ChatThreadKey
  /** 头部显示的编辑范围，例如「E03 · v3」 */
  scope: () => string
  snapshot: () => PublishSnapshot
  /** 每轮首个写工具前调用，返回 roundId 并记录撤销快照 */
  beginRound: () => string
  undoRound: (roundId: string) => boolean
  applyPatch: (patch: ConfigPatch) => PublishWriteResult
  stage: (input: StageInput) => Promise<StageResult>
  connectAccount: (platform: string) => Promise<ConnectResult>
  /** 准备度格点击：把对应区块展开并滚到视口；不聚焦输入框 */
  onReadinessJump?: (key: ReadinessItem['key']) => void
  /** 当前集没有成片时的两个入口；由宿主提供，面板只负责渲染 */
  onImportDeliverable?: () => void
  onGoExport?: () => void
}

export type ReadinessCell = 'ok' | 'warn' | 'danger' | 'not-applicable'

export type ReadinessItem = {
  key: 'targets' | 'copy' | 'cover' | 'accounts' | 'preflight'
  label: string
  state: ReadinessCell
  detail: string
}

export type Readiness = {
  items: ReadinessItem[]
  done: number
  total: number
}

/** 未选平台时，其余四格是「不适用」而不是错误 */
export function computeReadiness(input: {
  config: DeliverableConfig
  platforms: PlatformCapability[]
  accounts: PublishAccount[]
  preflight: PreflightResult | null
}): Readiness {
  const selected = Object.entries(input.config.targets || {}).filter(([, t]) => t.selected)
  const selectedIds = selected.map(([id]) => id)
  const platformOf = (id: string) => input.platforms.find((p) => p.id === id)

  const items: ReadinessItem[] = []

  items.push({
    key: 'targets',
    label: '目标',
    state: selectedIds.length ? 'ok' : 'warn',
    detail: selectedIds.length
      ? `${selectedIds.map((id) => platformOf(id)?.label || id).join('、')}`
      : '还没有选择平台',
  })

  if (!selectedIds.length) {
    for (const [key, label] of [
      ['copy', '文案'],
      ['cover', '封面'],
      ['accounts', '账号'],
      ['preflight', '预检'],
    ] as const) {
      items.push({ key, label, state: 'not-applicable', detail: '先选择平台' })
    }
    // 一格都没完成：目标本身还是 warn，不能把「未选平台」算成已完成
    return { items, done: 0, total: 5 }
  }

  const master = input.config.master
  const copyIssues = (input.preflight?.blocking || []).filter((b) => b.field.startsWith('copy'))
  const copyMissing = !String(master?.title || '').trim()
  items.push({
    key: 'copy',
    label: '文案',
    state: copyMissing || copyIssues.length ? 'danger' : 'ok',
    detail: copyMissing
      ? '标题为空'
      : copyIssues.length
        ? copyIssues[0].message
        : `${String(master?.title || '').length} 字标题`,
  })

  const required = new Set<CoverAspect>()
  for (const id of selectedIds) {
    for (const a of platformOf(id)?.coverAspects || []) required.add(a as CoverAspect)
  }
  const missingCover = [...required].filter((a) => !input.config.cover?.[a])
  items.push({
    key: 'cover',
    label: '封面',
    state: missingCover.length ? 'warn' : required.size ? 'ok' : 'not-applicable',
    detail: missingCover.length ? `缺 ${missingCover.join(' / ')}` : required.size ? '已备齐' : '该平台不需要封面',
  })

  const badAccounts = selected.filter(([, t]) => {
    if (t.mode === 'package') return false
    const acc = input.accounts.find((a) => a.id === t.accountId)
    return !acc || acc.status !== 'connected'
  })
  items.push({
    key: 'accounts',
    label: '账号',
    state: badAccounts.length ? 'warn' : 'ok',
    detail: badAccounts.length
      ? `${badAccounts.map(([id]) => platformOf(id)?.label || id).join('、')} 未连接`
      : '已连接',
  })

  const blocking = input.preflight?.blocking?.length || 0
  items.push({
    key: 'preflight',
    label: '预检',
    state: !input.preflight ? 'warn' : blocking ? 'danger' : 'ok',
    detail: !input.preflight ? '等待预检' : blocking ? `${blocking} 条阻断` : '通过',
  })

  const done = items.filter((i) => i.state === 'ok').length
  return { items, done, total: items.length }
}

/** 供技能输入与准备度条共用的一段话；不塞整份配置进每一轮上下文 */
export function readinessSummary(readiness: Readiness): string {
  return readiness.items
    .map((i) => `${i.label}：${i.state === 'ok' ? '已完成' : i.state === 'not-applicable' ? '不适用' : i.detail}`)
    .join('；')
}

const MODE_TEXT: Record<PublishMode, string> = {
  draft: '保存草稿',
  publish: '立即发布',
  package: '发布包',
}

/**
 * 窄 patch → 新配置 + 逐字段变更。
 * 纯函数：不读 state、不发请求，便于断言「只改了传入的字段」。
 * 撤销与持久化都由宿主负责。
 */
export function applyConfigPatch(input: {
  config: DeliverableConfig
  patch: ConfigPatch
  accounts: PublishAccount[]
  platformLabel: (id: string) => string
}): { next: DeliverableConfig; changes: ConfigChange[] } {
  const { patch, accounts, platformLabel } = input
  const cur = input.config
  const next: DeliverableConfig = {
    master: { ...cur.master },
    cover: { ...cur.cover },
    targets: Object.fromEntries(Object.entries(cur.targets).map(([k, v]) => [k, { ...v }])),
  }
  const changes: ConfigChange[] = []

  if (patch.master) {
    const m = patch.master
    if (m.title !== undefined && m.title !== cur.master.title) {
      changes.push({ field: '主标题', from: cur.master.title, to: m.title })
      next.master.title = m.title
    }
    if (m.description !== undefined && m.description !== cur.master.description) {
      changes.push({ field: '主简介', from: cur.master.description, to: m.description })
      next.master.description = m.description
    }
    if (m.tags !== undefined && JSON.stringify(m.tags) !== JSON.stringify(cur.master.tags)) {
      changes.push({ field: '标签', from: cur.master.tags.join(','), to: m.tags.join(',') })
      next.master.tags = m.tags
    }
    if (m.aiGenerated !== undefined && m.aiGenerated !== cur.master.aiGenerated) {
      changes.push({
        field: 'AI 声明',
        from: cur.master.aiGenerated ? '已确认' : '未确认',
        to: m.aiGenerated ? '已确认' : '未确认',
      })
      next.master.aiGenerated = m.aiGenerated
    }
  }

  if (patch.override) {
    for (const [platform, value] of Object.entries(patch.override)) {
      const prev =
        next.targets[platform] || { selected: false, accountId: '', mode: 'draft' as PublishMode, override: null }
      const before = prev.override ? prev.override.title || '（空标题）' : '（继承主文案）'
      if (value === null) {
        if (prev.override) changes.push({ field: `${platformLabel(platform)}覆写`, from: before, to: '（继承主文案）' })
        next.targets[platform] = { ...prev, override: null }
      } else {
        const merged = {
          title: value.title ?? prev.override?.title ?? '',
          description: value.description ?? prev.override?.description ?? '',
          tags: value.tags ?? prev.override?.tags ?? [],
        }
        changes.push({ field: `${platformLabel(platform)}覆写`, from: before, to: merged.title || '（空标题）' })
        next.targets[platform] = { ...prev, override: merged }
      }
    }
  }

  if (patch.targets) {
    for (const [platform, value] of Object.entries(patch.targets)) {
      const prev =
        next.targets[platform] || { selected: false, accountId: '', mode: 'draft' as PublishMode, override: null }
      const nextT = { ...prev }
      if (value.selected !== undefined && value.selected !== prev.selected) {
        changes.push({
          field: `${platformLabel(platform)}已选`,
          from: prev.selected ? '是' : '否',
          to: value.selected ? '是' : '否',
        })
        nextT.selected = value.selected
        // 勾选时补默认账号：与手动勾选的行为保持一致
        if (value.selected && !nextT.accountId) {
          const def = accounts.find((a) => a.platform === platform)
          if (def) nextT.accountId = def.id
        }
      }
      if (value.accountId !== undefined && value.accountId !== prev.accountId) {
        const accName = accounts.find((a) => a.id === value.accountId)?.label || value.accountId || '未选'
        changes.push({ field: `${platformLabel(platform)}账号`, from: prev.accountId || '未选', to: accName })
        nextT.accountId = value.accountId
      }
      if (value.mode !== undefined && value.mode !== prev.mode) {
        changes.push({
          field: `${platformLabel(platform)}方式`,
          from: MODE_TEXT[prev.mode],
          to: MODE_TEXT[value.mode],
        })
        nextT.mode = value.mode
      }
      next.targets[platform] = nextT
    }
  }

  if (patch.cover) {
    for (const [aspect, url] of Object.entries(patch.cover)) {
      const key = aspect as CoverAspect
      const before = next.cover[key]
      const after = url === null ? undefined : url
      if (before === after) continue
      changes.push({
        field: `${key} 封面`,
        from: before ? '已准备' : '未准备',
        to: after ? '已准备' : '已清除',
      })
      if (after) next.cover[key] = after
      else delete next.cover[key]
    }
  }

  return { next, changes }
}

/** 撤销栈上限：只服务「刚刚这一下」，不做跨会话历史 */
export const UNDO_DEPTH = 10

/**
 * 轮次撤销栈。只存配置快照，不碰任务与发布记录。
 * 撤销某一轮时，该轮之后的快照一并丢弃，避免出现「撤销了第二轮还留着第三轮基线」的错序。
 */
export type RoundSnapshot = { roundId: string; config: DeliverableConfig }

export function pushRound(stack: RoundSnapshot[], roundId: string, config: DeliverableConfig): RoundSnapshot[] {
  const next = [...stack, { roundId, config }]
  return next.length > UNDO_DEPTH ? next.slice(next.length - UNDO_DEPTH) : next
}

export function takeRound(
  stack: RoundSnapshot[],
  roundId: string,
): { stack: RoundSnapshot[]; config: DeliverableConfig } | null {
  const ix = stack.findIndex((x) => x.roundId === roundId)
  if (ix < 0) return null
  return { stack: stack.slice(0, ix), config: stack[ix].config }
}
