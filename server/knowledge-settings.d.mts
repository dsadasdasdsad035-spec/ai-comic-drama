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

export declare function normalizeKbSettings(raw: unknown): KbSettings
export declare function applyKbEnvDefaults(
  input: unknown,
  env?: Record<string, string | undefined>,
): { settings: KbSettings; fromEnv: { baseUrl: boolean; apiKey: boolean } }
export declare function kbSettingsDefaults(): KbSettings
export declare function redactKbSettings(
  input: unknown,
  env?: Record<string, string | undefined>,
): {
  baseUrl: string
  enabled: boolean
  hasApiKey: boolean
  llmModel: string
  compact: { baseUrlFromEnv: boolean; apiKeyFromEnv: boolean }
  defaultBaseUrl: string
}
export declare function mergeKbSettings(current: unknown, patch: unknown): KbSettings
