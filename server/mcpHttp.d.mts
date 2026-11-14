export declare function mcpToolExternalName(serverId: string, toolName: string): string
export declare function parseMcpToolExternalName(
  external: string,
  serverIds: string[],
): { serverId: string; toolName: string } | null
export declare function listMcpTools(server: unknown): Promise<unknown[]>
export declare function callMcpTool(
  server: unknown,
  toolName: string,
  args: Record<string, unknown>,
): Promise<{ ok: boolean; text: string; raw: unknown }>
export declare function listCreativeMcpToolDescriptors(servers: unknown[]): Promise<unknown[]>
