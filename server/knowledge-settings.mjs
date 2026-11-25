/**
 * 知识库设置层：归一化、环境变量兜底与读取脱敏。
 *
 * 与 `server/stock-settings.mjs` 同构：只管配置形状与密钥边界，不发起任何网络请求。
 * 独立于 app.ts 是为了能直接单测，也为了让「Key 不回传」这条边界只有一个实现。
 */
import { DEFAULT_KB_BASE_URL, validateKbBaseUrl } from './knowledge.mjs'

/** 环境变量名。容器部署时用它们兜底，设置库优先。 */
export const KB_ENV_BASE_URL = 'ANYTHINGLLM_BASE_URL'
export const KB_ENV_API_KEY = 'ANYTHINGLLM_API_KEY'

/** @type {{ baseUrl: string, apiKey: string, enabled: boolean }} */
const EMPTY = { baseUrl: '', apiKey: '', enabled: false }

/**
 * 归一化。
 *
 * 注意 `enabled` 的推导：地址为空就是关闭，不允许「开着但没地址」这种半配置态，
 * 否则页面会拿空地址去请求，报出一个与真实原因无关的错。
 */
export function normalizeKbSettings(raw) {
  const r = raw || {}
  const baseUrl = String(r.baseUrl || '').trim().replace(/\/+$/, '')
  const apiKey = String(r.apiKey || '').trim()
  const wanted = r.enabled === true || Boolean(baseUrl)
  const enabled = wanted && Boolean(baseUrl) && !validateKbBaseUrl(baseUrl)
  // 推给上游的对话模型名；空 = 用调用方给的默认（MiniMax-M3.1-Flash）
  const llmModel = String(r.llmModel || '').trim()
  return { baseUrl, apiKey, enabled, ...(llmModel ? { llmModel } : {}) }
}

/**
 * 环境变量兜底：设置库里的值优先，环境只补空位。
 *
 * 与 DTK 的规则一致（`applyCreativeEnvDefaults`）：逐字段判断，而不是只看地址。
 * 只看地址会漏掉「地址填在设置库、Key 来自 .env」这种半配置状态。
 *
 * @returns settings 与各字段是否来自环境，供设置页显示「来自环境变量」
 */
export function applyKbEnvDefaults(input, env = {}) {
  const base = normalizeKbSettings(input)
  const envBaseUrl = String(env[KB_ENV_BASE_URL] || '').trim().replace(/\/+$/, '')
  const envApiKey = String(env[KB_ENV_API_KEY] || '').trim()

  const baseUrlFromEnv = !base.baseUrl && Boolean(envBaseUrl)
  const apiKeyFromEnv = !base.apiKey && Boolean(envApiKey)

  const merged = normalizeKbSettings({
    baseUrl: base.baseUrl || envBaseUrl,
    apiKey: base.apiKey || envApiKey,
    // 地址可用就算启用；`normalizeKbSettings` 会再校验一次地址格式
    enabled: true,
  })
  return { settings: merged, fromEnv: { baseUrl: baseUrlFromEnv, apiKey: apiKeyFromEnv } }
}

/** 设置库为空时的默认值（用于表单初始值） */
export function kbSettingsDefaults() {
  return { ...EMPTY }
}

/**
 * 读取脱敏：Key 只回「有没有」，地址原文可以回传（它要显示在表单里）。
 *
 * 与 `redactCreativeSettings` / `redactStockSettings` 同一规矩：密钥原文永不出服务端。
 */
export function redactKbSettings(input, env = {}) {
  const { settings, fromEnv } = applyKbEnvDefaults(input, env)
  return {
    baseUrl: settings.baseUrl,
    enabled: settings.enabled,
    hasApiKey: Boolean(settings.apiKey),
    llmModel: settings.llmModel || '',
    compact: { baseUrlFromEnv: fromEnv.baseUrl, apiKeyFromEnv: fromEnv.apiKey },
    defaultBaseUrl: DEFAULT_KB_BASE_URL,
  }
}

/**
 * 保存合并：Key 回读被脱敏成空串，保存时不能因此把它清掉。
 *
 * 语义与 `mergeStockSettings` / 创意 DTK Key 一致：请求里给了非空 Key 才覆盖，
 * 空串表示「沿用旧值」。要真正清空 Key 用显式的 `clearApiKey`。
 */
export function mergeKbSettings(current, patch) {
  const cur = normalizeKbSettings(current)
  if (patch === undefined) return cur
  const p = patch || {}
  const nextBase = p.baseUrl !== undefined ? String(p.baseUrl || '').trim() : cur.baseUrl
  const nextKey = p.clearApiKey
    ? ''
    : String(p.apiKey || '').trim() || cur.apiKey
  return normalizeKbSettings({
    baseUrl: nextBase.replace(/\/+$/, ''),
    apiKey: nextKey,
    // 模型名同样遵循「未提交=保留」：脱敏回读里没有它时就别清掉
    llmModel: p.llmModel !== undefined ? p.llmModel : cur.llmModel,
    enabled: p.enabled !== undefined ? Boolean(p.enabled) || Boolean(nextBase) : undefined,
  })
}
