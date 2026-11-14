import { z } from 'zod'
import { fetchCreativeMcpToolDescriptors, type McpToolDescriptor } from '../mcp/mcpApi'
import { defineTool, type ToolDef } from './tool'

const mcpArgsSchema = z.record(z.string(), z.unknown())

function toolFromDescriptor(desc: McpToolDescriptor): ToolDef | null {
  if (!desc.externalName || !desc.name) return null
  const title = desc.description || `MCP：${desc.name}`
  return defineTool({
    name: desc.externalName,
    description: `[MCP · ${desc.serverId}] ${title}`.slice(0, 4000),
    schema: mcpArgsSchema,
    run: async (args) => {
      const res = await fetch('/api/mcp/call', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ tool: desc.externalName, arguments: args || {} }),
      })
      let j: Record<string, unknown> = {}
      try {
        j = (await res.json()) as Record<string, unknown>
      } catch {
        /* 非 JSON */
      }
      if (!res.ok || j.ok === false) {
        return { ok: false, error: String(j.message || `MCP 调用失败（HTTP ${res.status}）`) }
      }
      return { ok: true, serverId: desc.serverId, tool: desc.name, result: j.result ?? j.text ?? j }
    },
  })
}

/** 加载已勾选「创意聊天」的 MCP 工具定义（经服务端代理调用）。 */
export async function loadCreativeMcpTools(): Promise<ToolDef[]> {
  const descriptors = await fetchCreativeMcpToolDescriptors()
  const tools: ToolDef[] = []
  for (const desc of descriptors) {
    if (desc.error) continue
    const tool = toolFromDescriptor(desc)
    if (tool) tools.push(tool)
  }
  return tools
}

export function creativeMcpToolNames(descriptors: McpToolDescriptor[]): string[] {
  return descriptors.filter((d) => d.externalName && !d.error).map((d) => d.externalName)
}
