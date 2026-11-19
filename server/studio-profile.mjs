/**
 * 把创意会话宿主的模型配置写进它自己的 profile patch。
 *
 * 宿主的模型来源是一份 Cordis 配置文档（`$DSH_HOME/profiles/web/cordis.patch.yml`），
 * 也就是设置页「模型」写的那一份。应用要在启动时把自己的 OpenAI 兼容门面登记成
 * 一个 provider，并把默认模型指过去，否则宿主会用内置的 DeepSeek 官方路由直连上游，
 * 绕过账本。
 *
 * 合并策略：只改 `llm-pi-ai` 里我们自己那个 provider 段、`agent-default-model`
 * 与 `ui-settings-general` 的欢迎说明确认位，其余条目、其它 provider 与字段
 * 一律原样保留 —— 用户可能在设置页调过别的东西。
 */
import fs from 'node:fs'
import path from 'node:path'
import { parse as parseYaml, stringify as stringifyYaml } from 'yaml'

/** 我们在宿主里使用的 provider id；改动它等于改动已保存会话的模型来源 */
export const STUDIO_PROVIDER_ID = 'storyboard'
/** 凭证走环境变量引用，配置文件里不落明文 */
export const STUDIO_KEY_ENV = 'SB_STUDIO_GATEWAY_KEY'
/** 工具桥内部令牌的环境变量名：插件从这里读，不写进 patch 文件 */
export const STUDIO_INTERNAL_ENV = 'SB_STUDIO_INTERNAL_TOKEN'

/**
 * 宿主「预览版说明」的确认位。
 *
 * 这份公告是宿主自己的首次运行引导：未确认时它会弹遮罩弹窗并把 `#root` 置为
 * inert，创意会话在用户点「继续」之前点不动任何东西 —— 而文案讲的是宿主
 * 0.2 预览阶段的产品动态，与创意会话无关。应用在写 profile 时直接落成已确认，
 * 弹窗就不会出现。条目 id 与 settings namespace 同名，是宿主自己的命名约定。
 *
 * 版本号对齐宿主 `ui-settings-models/src/onboarding-copy.ts` 的
 * `WELCOME_NOTICE_VERSION`：宿主改文案会 bump 它，这里必须跟着改，
 * 否则公告会重新出现（测试会挡住两边的漂移）。
 */
export const WELCOME_NOTICE_ENTRY_ID = 'ui-settings-general'
export const WELCOME_NOTICE_FIELD = 'welcomeNoticeVersion'
export const WELCOME_NOTICE_VERSION = '2026-09-28.1'

export function profilePatchPath(dshHome) {
  return path.join(dshHome, 'profiles', 'web', 'cordis.patch.yml')
}

/**
 * 应用自己写过的默认模型记录。
 *
 * 宿主的「显式选择」和应用播种的回退值落在 patch 的同一个条目里，只能靠这份记录区分：
 * 文件里的值仍等于它 = 还是我们写的，可以更新；不等 = 宿主改过，必须保留。
 * 刻意不写进 patch —— `agent-default-model` 是严格 schema，多一个字段会被宿主拒绝。
 */
export function studioDefaultStatePath(dshHome) {
  return path.join(dshHome, 'studio-default.json')
}

function readLastWrittenDefault(dshHome, log = () => {}) {
  const file = studioDefaultStatePath(dshHome)
  try {
    const parsed = JSON.parse(fs.readFileSync(file, 'utf8'))
    const provider = String(parsed?.provider || '')
    const model = String(parsed?.model || '')
    return provider && model ? { provider, model } : null
  } catch (e) {
    if (e?.code !== 'ENOENT') log(`[studio-profile] 默认模型记录不可读，按未知来源处理：${e?.message || String(e)}`)
    return null
  }
}

function writeLastWrittenDefault(dshHome, value, log = () => {}) {
  const file = studioDefaultStatePath(dshHome)
  const tmp = `${file}.tmp-${process.pid}`
  try {
    fs.mkdirSync(path.dirname(file), { recursive: true })
    fs.writeFileSync(tmp, JSON.stringify({ provider: value.provider, model: value.model }), 'utf8')
    fs.renameSync(tmp, file)
  } catch (e) {
    try {
      fs.rmSync(tmp, { force: true })
    } catch {
      /* 清理失败不影响主流程 */
    }
    log(`[studio-profile] 默认模型记录写入失败：${e?.message || String(e)}`)
  }
}

function sameSelection(a, b) {
  return Boolean(a && b) && a.provider === b.provider && a.model === b.model
}

/**
 * 判定是否改写 `agent-default-model`。
 *
 * 四段短路：文件里没有 → 写回退值；仍是上次我们写的 → 更新；模型键已失效 → 写回退值；
 * 其余（含记录缺失且现值有效）= 宿主的选择 → 保留。无法判定来源时宁可晚一轮生效，也不抹掉用户选择。
 */
export function decideDefaultModel({ existing, lastWritten, fallbackId, modelIds }) {
  const fallback = { provider: STUDIO_PROVIDER_ID, model: fallbackId }
  if (!existing?.model) return { write: true, ...fallback }
  const keep = { write: false, provider: existing.provider, model: existing.model }
  if (sameSelection(existing, lastWritten)) return sameSelection(existing, fallback) ? keep : { write: true, ...fallback }
  if (!modelIds.includes(existing.model)) return { write: true, ...fallback }
  return keep
}

/** 读现有 patch；文件缺失或内容坏掉时回退成空数组，并把坏文件备份一份 */
export function readProfilePatch(file, log = () => {}) {
  try {
    const raw = fs.readFileSync(file, 'utf8')
    const parsed = parseYaml(raw)
    if (Array.isArray(parsed)) return parsed
    if (parsed == null) return []
    log(`[studio-profile] 忽略非数组 patch 内容：${file}`)
    return []
  } catch (e) {
    if (e?.code === 'ENOENT') return []
    try {
      fs.copyFileSync(file, `${file}.bak-${Date.now()}`)
    } catch {
      /* 备份失败不该阻止启动 */
    }
    log(`[studio-profile] patch 解析失败，已备份并重建：${e?.message || String(e)}`)
    return []
  }
}

function upsertEntry(entries, id, patch) {
  const index = entries.findIndex((item) => item && typeof item === 'object' && item.id === id)
  if (index < 0) {
    entries.push({ id, ...patch })
    return entries
  }
  const current = entries[index] && typeof entries[index] === 'object' ? entries[index] : { id }
  entries[index] = { ...current, ...patch, config: { ...(current.config || {}), ...(patch.config || {}) } }
  return entries
}

/**
 * 写入宿主模型配置。返回实际生效的默认模型 id。
 * `models` 形如 `[{ id: 'sb/main', key: 'main', label, vision? }]`。
 */
export function writeStudioProfile({
  dshHome,
  gatewayBaseUrl,
  models,
  defaultModelId,
  log = () => {},
}) {
  const file = profilePatchPath(dshHome)
  fs.mkdirSync(path.dirname(file), { recursive: true })

  const entries = readProfilePatch(file, log)
  const modelEntries = models.map((m) => ({
    id: m.id,
    ...(m.vision ? { input: ['text', 'image'] } : {}),
  }))

  // providers 必须逐 key 合并：整段替换会把用户在设置页加的其它 provider 抹掉
  const llmIndex = entries.findIndex((item) => item && typeof item === 'object' && item.id === 'llm-pi-ai')
  const llmEntry = llmIndex >= 0 ? { ...entries[llmIndex] } : { id: 'llm-pi-ai' }
  const llmConfig = { ...(llmEntry.config || {}) }
  llmConfig.providers = {
    ...(llmConfig.providers || {}),
    [STUDIO_PROVIDER_ID]: {
      apiKeyEnv: STUDIO_KEY_ENV,
      api: 'openai-completions',
      baseURL: gatewayBaseUrl,
      models: modelEntries,
    },
  }
  llmEntry.config = llmConfig
  if (llmIndex >= 0) entries[llmIndex] = llmEntry
  else entries.push(llmEntry)

  // 默认模型：新会话直接可用，不必让用户先去模型选择器里挑一次。
  // 但这里可能已经是宿主里用户自己选的模型 —— 只在我们确认是自己写的那份时才更新。
  const defaultEntry = entries.find((item) => item && typeof item === 'object' && item.id === 'agent-default-model')
  const existing = defaultEntry?.config?.model
    ? { provider: String(defaultEntry.config.provider || ''), model: String(defaultEntry.config.model) }
    : null
  const decision = decideDefaultModel({
    existing,
    lastWritten: readLastWrittenDefault(dshHome, log),
    fallbackId: defaultModelId,
    modelIds: models.map((m) => m.id),
  })
  if (decision.write) {
    upsertEntry(entries, 'agent-default-model', {
      config: { provider: decision.provider, model: decision.model },
    })
    writeLastWrittenDefault(dshHome, decision, log)
  }

  // 预览版说明预置成已确认：不这么做，首次进入创意会话会被宿主的引导弹窗挡住
  upsertEntry(entries, WELCOME_NOTICE_ENTRY_ID, {
    config: { [WELCOME_NOTICE_FIELD]: WELCOME_NOTICE_VERSION },
  })

  fs.writeFileSync(file, stringifyYaml(entries), 'utf8')
  log(
    `[studio-profile] 已写入 ${file}（${models.length} 个模型，默认 ${decision.model}` +
      `${decision.write ? '' : '，保留宿主已有选择'}）`,
  )
  return decision.model
}
