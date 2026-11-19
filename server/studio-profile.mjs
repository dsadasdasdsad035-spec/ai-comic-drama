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

/**
 * 旧版单一 provider id。
 *
 * 已退场：新版按应用渠道拆成多条路由（`sb-<渠道 id>`）。这个常量只用于识别并迁移
 * 上一版写下的 `agent-default-model` 与 providers 键，不再写入任何新配置。
 */
export const STUDIO_LEGACY_PROVIDER_ID = 'storyboard'
/** 渠道路由的 id 前缀；`sb-<渠道 id>` 与模型 id 的 `sb/` 前缀刻意区分开 */
export const STUDIO_ROUTE_PREFIX = 'sb-'
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
 * 把应用侧渠道 id 转成宿主可用的 route id。
 *
 * 用渠道 id 而不是渠道 label：label 可被用户编辑（中文、空格、改名），
 * 一旦参与 id，改名就等于换路由，已保存会话的模型选择会全部失效。
 * 渠道 id 由预设写死或自动生成（`custom-xxxx`），设置页不可编辑，因此稳定。
 *
 * 宿主 route id 只作配置键与选择器分组标识，不要求可读。
 * @param {string} providerId - 应用侧渠道 id，如 `ark-plan`。
 * @returns {string} route id，如 `sb-ark-plan`。
 */
export function routeIdForProvider(providerId) {
  const slug = String(providerId ?? '')
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
  if (!slug) throw new Error(`渠道 id 无法转成路由 id：${JSON.stringify(providerId)}`)
  return `${STUDIO_ROUTE_PREFIX}${slug}`
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
    const source = parsed?.source === 'unrecorded' || parsed?.source === 'host' ? parsed.source : undefined
    return provider && model ? { provider, model, explicit: parsed?.explicit === true, source } : null
  } catch (e) {
    if (e?.code !== 'ENOENT') log(`[studio-profile] 默认模型记录不可读，按未知来源处理：${e?.message || String(e)}`)
    return null
  }
}

function writeLastWrittenDefault(dshHome, value, log = () => {}) {
  const file = studioDefaultStatePath(dshHome)
  const tmp = `${file}.tmp-${process.pid}`
  const content = JSON.stringify({
    provider: value.provider,
    model: value.model,
    explicit: value.explicit === true,
    ...(value.source ? { source: value.source } : {}),
  })
  try {
    if (fs.readFileSync(file, 'utf8') === content) return
  } catch {
    /* 首次写入或旧格式：继续覆盖 */
  }
  try {
    fs.mkdirSync(path.dirname(file), { recursive: true })
    fs.writeFileSync(tmp, content, 'utf8')
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

/**
 * 应用自己写过的渠道路由清单。
 *
 * 宿主「设置 → 模型」页允许用户自建 provider，配置里因此同时存在「我们写的」与
 * 「别人写的」两类键。这份清单是唯一能区分二者的依据：同步时只增删改清单内的键，
 * 其余原样保留。与 `studio-default.json` 分开存放 —— 默认模型的来源判定与路由
 * 归属判定互不牵连，一处损坏不拖垮另一处。
 */
export function studioRoutesStatePath(dshHome) {
  return path.join(dshHome, 'studio-routes.json')
}

/**
 * 读自有路由清单。
 *
 * 文件缺失（升级首轮）按空集处理，这是正常状态而不是错误；内容损坏也只记一条日志
 * 并退化为空集 —— 退化的后果是多写一轮、不会误删用户自建 provider。
 * @param {string} dshHome
 * @param {(line: string) => void} log
 * @returns {string[]} 上一次同步写入的路由 id
 */
export function readStudioRoutes(dshHome, log = () => {}) {
  const file = studioRoutesStatePath(dshHome)
  try {
    const parsed = JSON.parse(fs.readFileSync(file, 'utf8'))
    const routes = Array.isArray(parsed?.routes) ? parsed.routes : []
    return routes.map((id) => String(id || '').trim()).filter(Boolean)
  } catch (e) {
    if (e?.code !== 'ENOENT') log(`[studio-profile] 路由清单不可读，按空集处理：${e?.message || String(e)}`)
    return []
  }
}

export function writeStudioRoutes(dshHome, routes, log = () => {}) {
  const file = studioRoutesStatePath(dshHome)
  const tmp = `${file}.tmp-${process.pid}`
  const content = JSON.stringify({ routes })
  try {
    if (fs.readFileSync(file, 'utf8') === content) return
  } catch {
    /* 首次写入：继续覆盖 */
  }
  try {
    fs.mkdirSync(path.dirname(file), { recursive: true })
    fs.writeFileSync(tmp, content, 'utf8')
    fs.renameSync(tmp, file)
  } catch (e) {
    try {
      fs.rmSync(tmp, { force: true })
    } catch {
      /* 清理失败不影响主流程 */
    }
    log(`[studio-profile] 路由清单写入失败：${e?.message || String(e)}`)
  }
}

function sameSelection(a, b) {
  return Boolean(a && b) && a.provider === b.provider && a.model === b.model
}

/**
 * 算出本次同步要删除与写入哪些路由。
 *
 * 归属清单（`owned`）里但本次不再产出的键才删；`owned` 之外的键一律不碰 ——
 * 那是宿主或用户在「设置 → 模型」里自建的 provider，抹掉它等于替用户删配置。
 * 首轮升级时 `owned` 为空，因此只写不删；退场的旧 provider 由迁移逻辑单独处理。
 * @param {{ owned: string[], next: string[] }} input
 * @returns {{ remove: string[], write: string[] }}
 */
export function planRouteChanges({ owned = [], next = [] } = {}) {
  const ownedSet = new Set(owned)
  const nextSet = new Set(next)
  return {
    remove: [...ownedSet].filter((id) => !nextSet.has(id)),
    write: [...nextSet],
  }
}

/**
 * 判定是否改写 `agent-default-model`。
 *
 * 默认选择是一个**配对**（provider + model），只校验 model 会让默认模型停在一条
 * 已不存在或不属于该模型的路由上。`routes` 提供「模型 id → 路由 id」的归属映射。
 *
 * 六种情形：
 * 1. 没有现值 → 写 fallback；
 * 2. 现值来自旧版单一 provider → 迁移到模型所属渠道，模型不变；
 * 3. 现值指向不属于本次路由集合的 provider → 用户在宿主里选的，保留并封存；
 * 4. 现值有效但配对与模型所属渠道不符 → 纠正配对，模型不变；
 * 5. 配对正确且等于上次我们写入的播种值 → 跟随 fallback 更新；
 * 6. 其余（来源未知但现值有效）→ 保留；等于当前 fallback 时记为可更新，否则封存。
 *
 * `explicit: true` 是修掉「默认永久冻结」的落点：来源记录缺失时只保留一次现值，
 * 同时把它落成显式标记，下一次同步不再反复走同一段歧义。
 */
export function decideDefaultModel({ existing, lastWritten, fallback, routes = [], owned = [] }) {
  const fallbackPair = { provider: String(fallback?.provider || ''), model: String(fallback?.model || '') }
  if (!fallbackPair.provider || !fallbackPair.model) {
    throw new Error('默认模型的 fallback 必须是完整配对（provider + model）')
  }
  if (!existing?.model) return { write: true, ...fallbackPair, explicit: false }

  const owner = new Map()
  for (const route of routes) {
    for (const m of route.models || []) owner.set(String(m.id), route.id)
  }
  const routeIds = new Set(routes.map((route) => route.id))
  const keep = (explicit, source) => ({
    write: false,
    provider: existing.provider,
    model: existing.model,
    explicit,
    ...(source ? { source } : {}),
  })

  // 旧版单一 provider 一定是应用侧播种的：把路由换到模型所属渠道，模型本身不动
  if (existing.provider === STUDIO_LEGACY_PROVIDER_ID) {
    const target = owner.get(existing.model)
    return target
      ? { write: true, provider: target, model: existing.model, explicit: false }
      : { write: true, ...fallbackPair, explicit: false }
  }

  // 不属于本次路由集合：先看它是不是我们上一轮写过、这次已退场的路由
  if (!routeIds.has(existing.provider)) {
    if (owned.includes(existing.provider)) {
      // 我们自己的旧路由：模型还在别的渠道就改配对，否则换回默认，绝不留悬空
      const target = owner.get(existing.model)
      return target
        ? { write: true, provider: target, model: existing.model, explicit: false }
        : { write: true, ...fallbackPair, explicit: false }
    }
    // 宿主内置或用户自建：绝不覆盖
    return keep(true)
  }

  const target = owner.get(existing.model)
  // 模型已不在任何渠道路由里：换回应用默认，否则宿主会撞 NO_ADAPTER
  if (!target) return { write: true, ...fallbackPair, explicit: false }
  // 配对与模型所属渠道不符：只纠正 provider
  if (target !== existing.provider) return { write: true, provider: target, model: existing.model, explicit: false }

  // 配对正确：等于上次播种值才跟随，否则是用户在宿主里的显式选择
  if (lastWritten && lastWritten.explicit !== true && sameSelection(existing, lastWritten)) {
    return sameSelection(existing, fallbackPair)
      ? { write: false, ...fallbackPair, explicit: false }
      : { write: true, ...fallbackPair, explicit: false }
  }

  // 来源未知但现值有效：等于当前默认说明它就是我们上一轮的播种值，记成可更新；
  // 否则先保留并封存，但区分封存来源 ——
  //   `unrecorded`：记录文件丢了，这个值也可能是我们上一轮的播种值，下一轮允许被设置页纠正；
  //   `host`      ：记录在、值却和它不同，只能是用户在宿主里选的，永久保留。
  if (!lastWritten) {
    return sameSelection(existing, fallbackPair) ? keep(false) : keep(true, 'unrecorded')
  }
  if (sameSelection(existing, lastWritten) && lastWritten.explicit === true) {
    // 之前封存过且没人再动：`unrecorded` 允许跟随新的设置页默认，`host` 保持封存
    if (lastWritten.source === 'unrecorded') {
      return sameSelection(existing, fallbackPair)
        ? keep(false)
        : { write: true, ...fallbackPair, explicit: false }
    }
    return keep(true, 'host')
  }
  return keep(true, 'host')
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
 * 写盘前自检：任何一条不合格就整份放弃。
 *
 * 宿主的 `assertServiceable` 会在读到坏配置时拒绝整段路由，症状是「改了没生效」——
 * 与其让宿主在后台静默拒绝，不如在这里抛出，让调用方保留上一份可用配置并记日志。
 */
function assertRoutesWritable(routes) {
  const seen = new Set()
  for (const route of routes) {
    const id = String(route?.id || '').trim()
    if (!id) throw new Error('路由 id 为空')
    if (seen.has(id)) throw new Error(`路由 id 重复：${id}`)
    seen.add(id)
    if (!String(route?.label || '').trim()) throw new Error(`路由 ${id} 缺少显示名`)
    const models = Array.isArray(route?.models) ? route.models : []
    if (models.length === 0) throw new Error(`路由 ${id} 没有模型`)
    const modelIds = new Set()
    for (const model of models) {
      const modelId = String(model?.id || '').trim()
      if (!modelId) throw new Error(`路由 ${id} 存在空模型 id`)
      if (modelIds.has(modelId)) throw new Error(`路由 ${id} 存在重复模型：${modelId}`)
      modelIds.add(modelId)
      if (Array.isArray(model.input) && model.input.length === 0) {
        throw new Error(`路由 ${id} 的模型 ${modelId} 声明了空 input`)
      }
    }
  }
}

/**
 * 应用没有任何可用文本模型时的兜底路由。
 *
 * 目的是保住「绝不回落到宿主内置官方路由」这条性质：路由为空时宿主会去用内建的
 * DeepSeek 官方路由，绕过账本。占位模型由门面在 `/v1/chat/completions` 上转成
 * 可读的未配置提示，因此这里只需要让它「存在且指向门面」。
 */
export function studioFallbackRoute() {
  return {
    id: `${STUDIO_ROUTE_PREFIX}app`,
    provider: '',
    label: '应用模型',
    models: [{ id: 'sb/default', key: 'default', label: '（未配置模型）', vision: false }],
  }
}

/**
 * 写入宿主模型配置。返回实际生效的默认模型 id。
 *
 * `routes` 形如 `[{ id: 'sb-ark', provider: 'ark', label: '字节 · 火山方舟',
 * models: [{ id: 'sb/ark-text-lite', key, label, vision? }] }]`。
 *
 * 归属规则见 `planRouteChanges`：只删改 `studio-routes.json` 里记过的路由，
 * 其余 provider（宿主或用户在「设置 → 模型」里自建的）原样保留。
 * 旧版单一 provider `storyboard` 视为应用自有，一次同步后彻底退场。
 */
export function writeStudioProfile({
  dshHome,
  gatewayBaseUrl,
  routes = [],
  defaultModelId,
  log = () => {},
}) {
  const file = profilePatchPath(dshHome)
  // 一条可用文本模型都没有时也要有一条路由：否则宿主回落到内建官方路由，绕过账本
  const effectiveRoutes = routes.length > 0 ? routes : [studioFallbackRoute()]
  const routed = effectiveRoutes.map((route) => ({
    id: route.id,
    label: route.label,
    models: (route.models || []).map((m) => ({
      id: m.id,
      name: m.label,
      ...(m.vision ? { input: ['text', 'image'] } : {}),
    })),
  }))
  assertRoutesWritable(routed)
  fs.mkdirSync(path.dirname(file), { recursive: true })

  const entries = readProfilePatch(file, log)

  const owned = readStudioRoutes(dshHome, log)
  const next = routed.map((route) => route.id)
  const plan = planRouteChanges({ owned, next })

  // providers 必须逐 key 合并：整段替换会把用户在设置页加的其它 provider 抹掉
  const llmIndex = entries.findIndex((item) => item && typeof item === 'object' && item.id === 'llm-pi-ai')
  const llmEntry = llmIndex >= 0 ? { ...entries[llmIndex] } : { id: 'llm-pi-ai' }
  const llmConfig = { ...(llmEntry.config || {}) }
  const providers = { ...(llmConfig.providers || {}) }
  // 旧版单一 provider 恒视为应用自有：它的模型现在分散在各渠道路由里
  delete providers[STUDIO_LEGACY_PROVIDER_ID]
  for (const id of plan.remove) delete providers[id]
  for (const route of routed) {
    providers[route.id] = {
      displayName: route.label,
      apiKeyEnv: STUDIO_KEY_ENV,
      api: 'openai-completions',
      baseURL: gatewayBaseUrl,
      models: route.models,
    }
  }
  llmConfig.providers = providers
  llmEntry.config = llmConfig
  if (llmIndex >= 0) entries[llmIndex] = llmEntry
  else entries.push(llmEntry)
  writeStudioRoutes(dshHome, next, log)

  // 默认模型的回退值要带上路由：模型 id 全局唯一，但宿主把 provider 与 model 一起存
  const fallback = {
    provider:
      routed.find((route) => route.models.some((m) => m.id === defaultModelId))?.id
      || routed[0]?.id
      || `${STUDIO_ROUTE_PREFIX}app`,
    model: defaultModelId,
  }

  // 默认模型：新会话直接可用，不必让用户先去模型选择器里挑一次。
  // 但这里可能已经是宿主里用户自己选的模型 —— 只在我们确认是自己写的那份时才更新。
  const defaultEntry = entries.find((item) => item && typeof item === 'object' && item.id === 'agent-default-model')
  const existing = defaultEntry?.config?.model
    ? { provider: String(defaultEntry.config.provider || ''), model: String(defaultEntry.config.model) }
    : null
  const decision = decideDefaultModel({
    existing,
    lastWritten: readLastWrittenDefault(dshHome, log),
    fallback,
    routes: routed,
    owned,
  })
  if (decision.write) {
    upsertEntry(entries, 'agent-default-model', {
      config: { provider: decision.provider, model: decision.model },
    })
  }
  // 无论写没写都落一份记录：文件丢失后能靠这次同步补回来，
  // 否则「记录缺失 + 现值有效」的歧义会每一轮重新出现（默认模型永久冻结）。
  writeLastWrittenDefault(dshHome, decision, log)

  // 预览版说明预置成已确认：不这么做，首次进入创意会话会被宿主的引导弹窗挡住
  upsertEntry(entries, WELCOME_NOTICE_ENTRY_ID, {
    config: { [WELCOME_NOTICE_FIELD]: WELCOME_NOTICE_VERSION },
  })

  // 内容没变就不落盘：宿主的 watchConfig 靠文件改动触发重载，
  // 无意义的写入会让选择器跟着闪一下。
  const nextContent = stringifyYaml(entries)
  let previousContent = null
  try {
    previousContent = fs.readFileSync(file, 'utf8')
  } catch {
    /* 首次写入没有旧内容 */
  }
  const changed = previousContent !== nextContent
  if (changed) fs.writeFileSync(file, nextContent, 'utf8')
  const modelCount = routed.reduce((sum, route) => sum + route.models.length, 0)
  log(
    `[studio-profile] ${changed ? '已写入' : '无变化，跳过'} ${file}（${routed.length} 个渠道路由 / ${modelCount} 个模型，默认 ${decision.provider}/${decision.model}` +
      `${decision.write ? '' : '，保留宿主已有选择'}）`,
  )
  return decision.model
}