/**
 * 发布预检：服务端是判定权威。
 *
 * 前端会为了即时反馈做同样展示，但上限一律以这里为准：
 * 客户端传上来的 limits 会被忽略，避免「改请求体就能绕过平台上限」。
 *
 * 输出 issue 的形状固定为 { level, code, target, field, message }，
 * 界面按 level 分组、按 field 定位到具体输入框。
 */
import fs from 'node:fs'
import { getPlatform, platformSupports, requiredCoverAspects } from './publish-platforms.mjs'
import { resolvePublishFile } from './publish-utils.mjs'
import { accountUsable } from './publish-accounts.mjs'
import { adapterCanPublishFinal, adapterCanAttachCover, getAdapter } from './publish-adapters.mjs'

export const ISSUE_CODES = {
  deliverableMissing: 'deliverable_missing',
  deliverableFileMissing: 'deliverable_file_missing',
  noTargets: 'no_targets',
  unknownPlatform: 'unknown_platform',
  modeUnsupported: 'mode_unsupported',
  manualOnly: 'manual_only',
  accountMissing: 'account_missing',
  accountUnusable: 'account_unusable',
  titleOverLimit: 'title_over_limit',
  titleTooShort: 'title_too_short',
  titleEmpty: 'title_empty',
  draftUnavailable: 'draft_unavailable',
  descriptionOverLimit: 'description_over_limit',
  descriptionEmpty: 'description_empty',
  tagsOverLimit: 'tags_over_limit',
  coverMissing: 'cover_missing',
  coverManual: 'cover_manual',
  aiUnconfirmed: 'ai_unconfirmed',
  fileTooLarge: 'file_too_large',
  durationTooLong: 'duration_too_long',
  aspectMismatch: 'aspect_mismatch',
  sizeUnknown: 'size_unknown',
  adapterUnverified: 'adapter_unverified',
}

function issue(level, code, target, field, message) {
  return { level: code === undefined ? level : level, code, target, field, message }
}

/** 平台封面比例与成片画幅的关系：只警告，V1 不重渲染 */
function aspectOf(width, height) {
  if (!width || !height) return ''
  const r = width / height
  if (Math.abs(r - 9 / 16) < 0.02) return '9:16'
  if (Math.abs(r - 16 / 9) < 0.02) return '16:9'
  if (Math.abs(r - 3 / 4) < 0.02) return '3:4'
  if (Math.abs(r - 4 / 3) < 0.02) return '4:3'
  return ''
}

function textOf(v) {
  return typeof v === 'string' ? v : ''
}

/**
 * @param {object} input
 * @param {string} input.appRoot
 * @param {object} input.deliverable  DeliverableRecord
 * @param {object[]} input.targets    [{ platform, accountId, mode }]
 * @param {object} input.config       { master, cover, targets }
 * @param {Map<string,object>} input.accounts  账号 id → 账号
 * @param {(url:string)=>boolean} [input.fileExists] 覆盖文件存在判定（测试用）
 */
export function runPreflight(input) {
  const issues = []
  const deliverable = input.deliverable
  const config = input.config || { master: {}, cover: {}, targets: {} }
  const master = config.master || {}
  const cover = config.cover || {}
  const targets = Array.isArray(input.targets) ? input.targets : []
  const accounts = input.accounts instanceof Map ? input.accounts : new Map()

  if (!deliverable) {
    return {
      ok: false,
      blocking: [
        { level: 'block', code: ISSUE_CODES.deliverableMissing, target: '', field: 'deliverable', message: '没有选中成片' },
      ],
      warnings: [],
      issues: [{ level: 'block', code: ISSUE_CODES.deliverableMissing, target: '', field: 'deliverable', message: '没有选中成片' }],
    }
  }

  let deliverablePath = ''
  try {
    const resolved = resolvePublishFile(input.appRoot, deliverable.url, { projectsRoot: input.projectsRoot })
    deliverablePath = resolved.path
    if (!fs.existsSync(deliverablePath)) {
      issues.push({
        level: 'block',
        code: ISSUE_CODES.deliverableFileMissing,
        target: '',
        field: 'deliverable',
        message: '成片文件已不在磁盘上，请重新导出或重新导入',
      })
    }
  } catch (e) {
    issues.push({
      level: 'block',
      code: ISSUE_CODES.deliverableFileMissing,
      target: '',
      field: 'deliverable',
      message: `成片文件不可用：${(e && e.message) || '地址非法'}`,
    })
  }

  if (targets.length === 0) {
    issues.push({
      level: 'block',
      code: ISSUE_CODES.noTargets,
      target: '',
      field: 'targets',
      message: '至少选择一个发布平台',
    })
  }

  const selected = []
  for (const t of targets) {
    const platformId = String(t?.platform || '')
    let platform
    try {
      platform = getPlatform(platformId)
    } catch (e) {
      issues.push({
        level: 'block',
        code: ISSUE_CODES.unknownPlatform,
        target: platformId,
        field: 'targets',
        message: (e && e.message) || '未知平台',
      })
      continue
    }
    selected.push(platform.id)
    const override = config.targets?.[platform.id]?.override || null
    const title = textOf(override?.title) || textOf(master.title)
    const description = textOf(override?.description) || textOf(master.description)
    const tags = Array.isArray(override?.tags) && override.tags.length ? override.tags : Array.isArray(master.tags) ? master.tags : []
    const mode = t.mode === 'publish' || t.mode === 'package' ? t.mode : 'draft'

    if (!platformSupports(platform.id, mode)) {
      issues.push({
        level: 'block',
        code: ISSUE_CODES.modeUnsupported,
        target: platform.id,
        field: 'mode',
        message: `${platform.label}不支持该发布方式`,
      })
    }
    if (mode === 'publish' && !adapterCanPublishFinal(platform.id)) {
      issues.push({
        level: 'block',
        code: ISSUE_CODES.adapterUnverified,
        target: platform.id,
        field: 'mode',
        message: `${platform.label}适配器尚未验证，只能保存草稿或导出发布包`,
      })
    }
    if (platform.manualOnly && mode !== 'package') {
      issues.push({
        level: 'block',
        code: ISSUE_CODES.manualOnly,
        target: platform.id,
        field: 'mode',
        message: `${platform.label}当前只能人工发布或导出发布包`,
      })
    }

    const accountId = String(t.accountId || '')
    if (mode !== 'package') {
      if (!accountId) {
        issues.push({
          level: 'block',
          code: ISSUE_CODES.accountMissing,
          target: platform.id,
          field: 'accounts',
          message: `${platform.label}还没有选择账号`,
        })
      } else {
        const account = accounts.get(accountId)
        if (!account || account.platform !== platform.id) {
          issues.push({
            level: 'block',
            code: ISSUE_CODES.accountMissing,
            target: platform.id,
            field: 'accounts',
            message: `${platform.label}的账号不存在，请重新连接`,
          })
        } else if (!accountUsable(account)) {
          issues.push({
            level: 'block',
            code: ISSUE_CODES.accountUnusable,
            target: platform.id,
            field: 'accounts',
            message:
              account.status === 'expired'
                ? `${platform.label}登录已失效，请重新登录`
                : `${platform.label}账号状态未知，请先检查登录`,
          })
        }
      }
    }

    // 没有独立标题的平台不校验标题；有下限的平台要区分「太短」与「超长」
    const titleOptional = Boolean(platform.limits.titleOptional)
    const titleMin = platform.limits.titleMin
    const titleMax = platform.limits.titleMax
    if (!titleOptional) {
      if (!title.trim()) {
        issues.push({
          level: 'block',
          code: ISSUE_CODES.titleEmpty,
          target: platform.id,
          field: 'copy.title',
          message: `${platform.label}标题不能为空`,
        })
      } else if (titleMin && title.length < titleMin) {
        issues.push({
          level: 'block',
          code: ISSUE_CODES.titleTooShort,
          target: platform.id,
          field: 'copy.title',
          message: `${platform.label}标题 ${title.length}/${titleMin} 字，太短（至少 ${titleMin} 字）`,
        })
      } else if (titleMax && title.length > titleMax) {
        issues.push({
          level: 'block',
          code: ISSUE_CODES.titleOverLimit,
          target: platform.id,
          field: 'copy.title',
          message: `${platform.label}标题 ${title.length}/${titleMax} 字，已超限`,
        })
      }
    }

    // 声明可存草稿但实际没有草稿时，别让用户以为存进了平台
    if (mode === 'draft' && (platform.draftKind || 'none') === 'none') {
      issues.push({
        level: 'block',
        code: ISSUE_CODES.draftUnavailable,
        target: platform.id,
        field: 'publish.mode',
        message: `${platform.label}没有可用的草稿，改为打开后台人工发布或导出发布包`,
      })
    }
    if (description.length > (platform.limits.descriptionMax ?? 0)) {
      issues.push({
        level: 'block',
        code: ISSUE_CODES.descriptionOverLimit,
        target: platform.id,
        field: 'copy.description',
        message: `${platform.label}简介 ${description.length}/${platform.limits.descriptionMax} 字，已超限`,
      })
    } else if (!description.trim()) {
      issues.push({
        level: 'warn',
        code: ISSUE_CODES.descriptionEmpty,
        target: platform.id,
        field: 'copy.description',
        message: `${platform.label}简介为空`,
      })
    }
    if (tags.length > (platform.limits.tagsMax ?? 0)) {
      issues.push({
        level: 'block',
        code: ISSUE_CODES.tagsOverLimit,
        target: platform.id,
        field: 'copy.tags',
        message: `${platform.label}标签 ${tags.length}/${platform.limits.tagsMax} 个，已超限`,
      })
    }

    for (const aspect of platform.coverAspects) {
      if (!cover[aspect]) {
        issues.push({
          level: 'block',
          code: ISSUE_CODES.coverMissing,
          target: platform.id,
          field: `cover.${aspect}`,
          message: `${platform.label}需要 ${aspect} 封面`,
        })
      }
    }

    // 封面已备好但适配器还不能自动投递：不阻断，但必须说清要人工设置
    if (mode !== 'package' && platform.coverAspects.some((a) => cover[a]) && !adapterCanAttachCover(platform.id)) {
      const adapter = getAdapter(platform.id)
      issues.push({
        level: 'warn',
        code: ISSUE_CODES.coverManual,
        target: platform.id,
        field: 'cover',
        message:
          adapter?.coverSupport === 'unsupported'
            ? `${platform.label}不支持自定义封面，草稿里的封面由平台自动生成`
            : `${platform.label}封面不会自动上传，草稿保存后需在平台后台手动设置`,
      })
    }

    if (deliverable?.bytes && platform.max?.bytes && deliverable.bytes > platform.max.bytes) {
      issues.push({
        level: 'block',
        code: ISSUE_CODES.fileTooLarge,
        target: platform.id,
        field: 'deliverable',
        message: `${platform.label}有大小上限，当前 ${(deliverable.bytes / 1024 / 1024).toFixed(0)}MB`,
      })
    }
    if (deliverable?.duration && platform.max?.durationSec && deliverable.duration > platform.max.durationSec) {
      issues.push({
        level: 'block',
        code: ISSUE_CODES.durationTooLong,
        target: platform.id,
        field: 'deliverable',
        message: `${platform.label}有时长上限，当前 ${Math.round(deliverable.duration)}s`,
      })
    }
    const sourceAspect = aspectOf(deliverable?.width, deliverable?.height)
    if (sourceAspect && platform.coverAspects.length && !platform.coverAspects.includes(sourceAspect)) {
      issues.push({
        level: 'warn',
        code: ISSUE_CODES.aspectMismatch,
        target: platform.id,
        field: 'cover',
        message: `成片是 ${sourceAspect}，${platform.label}偏好 ${platform.coverAspects.join(' / ')}，可能出现留黑边`,
      })
    }
  }

  // 封面文件本身也要存在，否则打包/上传到一半才失败
  for (const aspect of requiredCoverAspects(selected)) {
    const url = cover[aspect]
    if (!url) continue
    try {
      const resolved = resolvePublishFile(input.appRoot, url, { projectsRoot: input.projectsRoot })
      if (!fs.existsSync(resolved.path)) {
        issues.push({
          level: 'block',
          code: ISSUE_CODES.coverMissing,
          target: '',
          field: `cover.${aspect}`,
          message: `${aspect} 封面文件已丢失，请重新选择`,
        })
      }
    } catch (e) {
      issues.push({
        level: 'block',
        code: ISSUE_CODES.coverMissing,
        target: '',
        field: `cover.${aspect}`,
        message: `${aspect} 封面不可用：${(e && e.message) || '地址非法'}`,
      })
    }
  }

  if (master.aiGenerated !== true) {
    issues.push({
      level: 'block',
      code: ISSUE_CODES.aiUnconfirmed,
      target: '',
      field: 'ai',
      message: '需要确认 AI 生成内容声明后才能发布',
    })
  }

  const seen = new Set()
  const deduped = []
  for (const it of issues) {
    const key = `${it.level}|${it.code}|${it.target}|${it.field}`
    if (seen.has(key)) continue
    seen.add(key)
    deduped.push(it)
  }

  const blocking = deduped.filter((i) => i.level === 'block')
  const warnings = deduped.filter((i) => i.level === 'warn')
  return { ok: blocking.length === 0, blocking, warnings, issues: deduped }
}
