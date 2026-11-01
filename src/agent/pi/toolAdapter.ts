import { z } from 'zod'
import type { AgentTool } from '@earendil-works/pi-agent-core'
import type { ToolDef } from '../tool'
import { modelFacingResult } from '../agentToolResult'

/** 成功时提示模型结束本轮的工具（只有 finish 用） */
const TERMINATE_TOOLS = new Set(['finish'])

function isErrorResult(result: unknown): boolean {
  return Boolean(result && typeof result === 'object' && (result as { ok?: unknown }).ok === false)
}

/**
 * 参数声明必须按 input 语义生成。
 *
 * zod 默认 `io:'output'` 会把带 `.default()` 的字段算进 `required`，
 * 模型漏传就被判为非法；`io:'input'` 才与「省略则用默认值」一致。
 * 例如 designs-v1 的 scenes/props、reverse-v1 的 evidence_frames。
 */
export function toolParameters(schema: z.ZodType): Record<string, unknown> {
  const json = z.toJSONSchema(schema, { io: 'input' }) as Record<string, unknown>
  const { $schema: _schema, $id: _id, ...rest } = json
  return rest
}

/**
 * ToolDef → pi 的 AgentTool。
 *
 * 业务逻辑不复制：execute 直接调 `tool.run`。结果按约定拆成两半——
 * `content` 是模型可见的摘要（经 modelFacingResult 裁剪，不含帧数据与整段代码），
 * `details` 是界面可见的完整结果。失败通过 `isError` 上报，不靠文本描述。
 */
export function toPiTool(tool: ToolDef, label?: string): AgentTool {
  return {
    name: tool.name,
    label: label || tool.name,
    description: tool.description,
    parameters: toolParameters(tool.schema) as AgentTool['parameters'],
    execute: async (_toolCallId, params) => {
      let result: unknown
      try {
        // pi 在循环里已用 JSON Schema 校验过；这里仍用 zod 再校验一次，
        // 保证直接调用 execute 的路径与模型路径有同一套拒绝语义。
        result = await tool.run(tool.schema.parse(params) as never)
      } catch (e) {
        const message = (e as Error)?.message || String(e)
        return {
          content: [{ type: 'text', text: JSON.stringify({ ok: false, error: message }) }],
          details: { ok: false, error: message },
          isError: true,
        }
      }
      const failed = isErrorResult(result)
      return {
        content: [{ type: 'text', text: JSON.stringify(modelFacingResult(tool.name, result)) }],
        details: result,
        ...(failed ? { isError: true } : {}),
        ...(TERMINATE_TOOLS.has(tool.name) && !failed ? { terminate: true } : {}),
      }
    },
  }
}

export function toPiTools(tools: readonly ToolDef[], labels?: Record<string, string>): AgentTool[] {
  return tools.map((tool) => toPiTool(tool, labels?.[tool.name]))
}
