/**
 * 把创意会话宿主的模型配置写进它自己的 profile patch。
 *
 * 宿主的模型来源是一份 Cordis 配置文档（`$DSH_HOME/profiles/web/cordis.patch.yml`），
 * 也就是设置页「模型」写的那一份。应用要在启动时把自己的 OpenAI 兼容门面登记成
 * 一个 provider，并把默认模型指过去，否则宿主会用内置的 DeepSeek 官方路由直连上游，
 * 绕过账本。
 *
 * 合并策略：只改 `llm-pi-ai` 里我们自己那个 provider 段与 `agent-default-model`，
 * 其余条目、其它 provider 与字段一律原样保留 —— 用户可能在设置页调过别的东西。
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

export function profilePatchPath(dshHome) {
  return path.join(dshHome, 'profiles', 'web', 'cordis.patch.yml')
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

  // 默认模型：新会话直接可用，不必让用户先去模型选择器里挑一次
  upsertEntry(entries, 'agent-default-model', {
    config: { provider: STUDIO_PROVIDER_ID, model: defaultModelId },
  })

  fs.writeFileSync(file, stringifyYaml(entries), 'utf8')
  log(`[studio-profile] 已写入 ${file}（${models.length} 个模型，默认 ${defaultModelId}）`)
  return defaultModelId
}
