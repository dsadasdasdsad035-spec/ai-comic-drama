/** server/knowledge-settings.mjs 的类型声明 */

export interface KbSettings {
  baseUrl: string
  apiKey: string
  enabled: boolean
  /** 推给上游的对话模型名；缺省用 MiniMax-M3.1-Flash */
  llmModel?: string
}

export declare const KB_ENV_BASE_URL: string
export declare const KB_ENV_API_KEY: string
/** 内置知识库标记：为 1 时地址/Key 强制取环境变量（桌面端随包时注入） */
export declare const KB_ENV_BUILTIN: string

export declare function normalizeKbSettings(raw: unknown): KbSettings
export declare function applyKbEnvDefaults(
  input: unknown,
  env?: Record<string, string | undefined>,
): {
  settings: KbSettings
  /** 是否为桌面端内置知识库（此时地址/Key 以 env 为准） */
  builtin: boolean
  fromEnv: { baseUrl: boolean; apiKey: boolean }
}
export declare function kbSettingsDefaults(): KbSettings
export declare function redactKbSettings(
  input: unknown,
  env?: Record<string, string | undefined>,
): {
  baseUrl: string
  enabled: boolean
  hasApiKey: boolean
  llmModel: string
  /** 桌面端自带知识库：设置页据此说明地址由应用管理 */
  builtin: boolean
  compact: { baseUrlFromEnv: boolean; apiKeyFromEnv: boolean }
  defaultBaseUrl: string
}
export declare function mergeKbSettings(current: unknown, patch: unknown): KbSettings
