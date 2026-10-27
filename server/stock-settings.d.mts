/** server/stock-settings.mjs 的类型声明 */
export declare type StockProviderId = 'pexels' | 'pixabay' | 'openverse'
export declare const STOCK_PROVIDER_IDS: StockProviderId[]
export declare const STOCK_PROVIDER_DEFAULTS: Record<
  StockProviderId,
  { label: string; baseUrl: string; envKey: string; requiresKey: boolean }
>
export declare type StockProviderSettings = {
  enabled: boolean
  apiKey: string
  baseUrl: string
}
export declare type StockSettings = {
  providers: Partial<Record<StockProviderId, StockProviderSettings>>
}
export declare type StockSettingsView = {
  providers: Partial<
    Record<
      StockProviderId,
      { enabled: boolean; baseUrl: string; hasApiKey: boolean; keyFromEnv?: boolean }
    >
  >
}
export declare function normalizeStockSettings(raw: unknown): StockSettings
export declare function applyStockEnvDefaults(
  settings: unknown,
  env?: Record<string, string | undefined>,
): { settings: StockSettings; fromEnv: Partial<Record<StockProviderId, boolean>> }
export declare function redactStockSettings(
  settings: unknown,
  env?: Record<string, string | undefined>,
): StockSettingsView
export declare function mergeStockSettings(current: unknown, patch: unknown): StockSettings
export declare function resolveStockProvider(
  raw: unknown,
  id: StockProviderId,
  env?: Record<string, string | undefined>,
): StockProviderSettings | null
