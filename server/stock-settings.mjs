/**
 * 在线素材来源的设置层：归一化、默认关闭、环境变量兜底与读取脱敏。
 *
 * 独立于 vite.config，便于直接单测。这里只管配置形状与密钥边界，
 * 不发起任何网络请求。
 */

/** 来源 id 与官方地址；新增来源要同时改这里和 server/stock.mjs 的注册表 */
export const STOCK_PROVIDER_DEFAULTS = {
  pexels: { label: 'Pexels', baseUrl: 'https://api.pexels.com', envKey: 'PEXELS_API_KEY', requiresKey: true },
  pixabay: { label: 'Pixabay', baseUrl: 'https://pixabay.com', envKey: 'PIXABAY_API_KEY', requiresKey: true },
  openverse: {
    label: 'Openverse',
    baseUrl: 'https://api.openverse.org',
    envKey: 'OPENVERSE_API_KEY',
    requiresKey: false,
  },
}

export const STOCK_PROVIDER_IDS = Object.keys(STOCK_PROVIDER_DEFAULTS)

function str(v) {
  return typeof v === 'string' ? v.trim() : ''
}

function httpsUrl(v, fallback) {
  const s = str(v)
  if (!s) return fallback
  try {
    const u = new URL(s)
    return u.protocol === 'http:' || u.protocol === 'https:' ? s.replace(/\/+$/, '') : fallback
  } catch {
    return fallback
  }
}

/**
 * 归一化 stock 配置：只保留已知来源，未出现的来源即关闭。
 * 空对象等价于「全部关闭」，调用方据此判断用户有没有配置过。
 */
export function normalizeStockSettings(raw) {
  const o = raw && typeof raw === 'object' ? raw : {}
  const providersRaw = o.providers && typeof o.providers === 'object' ? o.providers : {}
  const providers = {}
  for (const id of STOCK_PROVIDER_IDS) {
    const p = providersRaw[id]
    if (!p || typeof p !== 'object') continue
    const def = STOCK_PROVIDER_DEFAULTS[id]
    providers[id] = {
      enabled: p.enabled === true,
      apiKey: str(p.apiKey),
      baseUrl: httpsUrl(p.baseUrl, def.baseUrl),
    }
  }
  return { providers }
}

/**
 * 环境变量兜底：设置库里的值优先，环境只补空位。
 * Openverse 不填 Key 也能匿名检索，所以它不会被标记为「来自环境」。
 */
export function applyStockEnvDefaults(settings, env = process.env) {
  const base = normalizeStockSettings(settings)
  const providers = { ...base.providers }
  const fromEnv = {}
  for (const id of STOCK_PROVIDER_IDS) {
    const def = STOCK_PROVIDER_DEFAULTS[id]
    const cur = providers[id] || { enabled: false, apiKey: '', baseUrl: def.baseUrl }
    const envKey = str(env?.[def.envKey])
    const apiKey = cur.apiKey || envKey
    if (envKey && !cur.apiKey) fromEnv[id] = true
    providers[id] = {
      enabled: cur.enabled || Boolean(envKey && def.requiresKey),
      apiKey,
      baseUrl: cur.baseUrl || def.baseUrl,
    }
  }
  return { settings: { providers }, fromEnv }
}

/** 读取时脱敏：apiKey 只回报是否存在，绝不回传原文 */
export function redactStockSettings(settings, env = process.env) {
  const { settings: applied, fromEnv } = applyStockEnvDefaults(settings, env)
  const providers = {}
  for (const [id, p] of Object.entries(applied.providers)) {
    providers[id] = {
      enabled: p.enabled,
      baseUrl: p.baseUrl,
      hasApiKey: Boolean(p.apiKey),
      ...(fromEnv[id] ? { keyFromEnv: true } : {}),
    }
  }
  return { providers }
}

/**
 * 保存时合并：请求里没有 apiKey 字段或它是空串时沿用旧 Key，
 * 避免「留空即清空」把已保存的凭据误删。
 */
export function mergeStockSettings(current, patch) {
  const cur = normalizeStockSettings(current)
  const next = normalizeStockSettings(patch)
  const providers = { ...cur.providers }
  for (const id of STOCK_PROVIDER_IDS) {
    if (!next.providers[id]) continue
    const incoming = next.providers[id]
    const prev = cur.providers[id]
    providers[id] = {
      ...incoming,
      apiKey: incoming.apiKey || prev?.apiKey || '',
    }
  }
  return { providers }
}

/** 单个来源的有效配置（含 Key）；只给服务端用 */
export function resolveStockProvider(raw, id, env = process.env) {
  const { settings } = applyStockEnvDefaults(raw, env)
  const def = STOCK_PROVIDER_DEFAULTS[id]
  if (!def) return null
  const p = settings.providers[id] || { enabled: false, apiKey: '', baseUrl: def.baseUrl }
  return { ...p, baseUrl: p.baseUrl || def.baseUrl }
}
