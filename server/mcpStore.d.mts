export type McpServerRow = {
  id: string
  marketId?: string
  name: string
  description?: string
  transport: string
  url: string
  command?: string
  args?: string[]
  headers?: Record<string, string>
  environment?: Record<string, string>
  authType?: string
  authSecret?: string
  timeoutSec?: number
  creativeChat?: boolean
  iconUrl?: string
}

export declare function mcpMarketSearch(opts?: { keyword?: string; category?: string }): unknown[]
export declare function listConfiguredMcpServers(): McpServerRow[]
export declare function installMcpFromMarket(marketId: string): McpServerRow
export declare function saveMcpServerPatch(id: string, patch: Record<string, unknown>): McpServerRow
export declare function removeMcpServer(id: string): void
export declare function creativeMcpServers(): McpServerRow[]
export declare function getMcpServerWithSecret(id: string): McpServerRow | undefined
