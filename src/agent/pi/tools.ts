import { Type } from 'typebox'
import type { TSchema } from 'typebox'
import type { AgentTool, AgentToolResult } from '@earendil-works/pi-agent-core'
import { createSceneAgentTools, type SceneAgentSession } from '../sceneAgentTools'
import { DEFAULT_AGENT_LIMITS, type SceneAgentDeps } from '../sceneAgentTypes'
import { modelFacingResult } from '../agentToolResult'

type RawTool = {
  name: string
  description?: string
  invoke: (input: Record<string, unknown>) => Promise<unknown>
}

type PiToolSpec = {
  name: string
  label: string
  parameters: TSchema
  /** 成功时提示模型结束本轮（只有 finish 需要） */
  terminateOnSuccess?: boolean
}

/**
 * 12 个工具的 TypeBox 参数 schema。
 * 与 sceneAgentTools 里的 zod 定义逐项对齐：字段、必填、上下界一致。
 */
const SPECS: PiToolSpec[] = [
  { name: 'get_shot_context', label: '读取镜头上下文', parameters: Type.Object({}) },
  { name: 'begin_scene_draft', label: '创建代码草稿', parameters: Type.Object({}) },
  {
    name: 'append_scene_draft',
    label: '追加代码分片',
    parameters: Type.Object({
      chunk: Type.String({ minLength: 1, maxLength: 8000 }),
    }),
  },
  {
    name: 'read_scene_draft',
    label: '读取代码草稿',
    parameters: Type.Object({
      startLine: Type.Optional(Type.Integer({ minimum: 1 })),
      endLine: Type.Optional(Type.Integer({ minimum: 2 })),
    }),
  },
  {
    name: 'patch_scene_draft',
    label: '替换代码行范围',
    parameters: Type.Object({
      startLine: Type.Integer({ minimum: 1 }),
      endLine: Type.Integer({ minimum: 1 }),
      text: Type.String(),
    }),
  },
  { name: 'commit_scene_draft', label: '提交代码草稿', parameters: Type.Object({}) },
  { name: 'discard_scene_draft', label: '丢弃代码草稿', parameters: Type.Object({}) },
  {
    name: 'set_scene_code',
    label: '提交完整代码',
    parameters: Type.Object({ code: Type.String({ minLength: 1 }) }),
  },
  { name: 'run_render', label: '渲染试运行', parameters: Type.Object({}) },
  {
    name: 'capture_frames',
    label: '抓取关键帧',
    parameters: Type.Object({
      times: Type.Optional(
        Type.Array(Type.Number({ minimum: 0 }), {
          minItems: 1,
          maxItems: DEFAULT_AGENT_LIMITS.maxFrames,
        }),
      ),
    }),
  },
  {
    name: 'review_frames',
    label: '视觉验收',
    parameters: Type.Object({
      requirements: Type.Optional(Type.Array(Type.String(), { maxItems: 12 })),
    }),
  },
  {
    name: 'finish',
    label: '结束场景',
    parameters: Type.Object({ summary: Type.String({ minLength: 1, maxLength: 500 }) }),
    terminateOnSuccess: true,
  },
]

function isErrorResult(result: unknown): boolean {
  return Boolean(result && typeof result === 'object' && (result as { ok?: unknown }).ok === false)
}

/**
 * 把现有 LangChain 工具包成 pi 的 AgentTool。
 *
 * 业务逻辑不复制：execute 直接调用原工具，参数仍由原 zod schema 再校验一次。
 * content 只放模型可见摘要（经 modelFacingResult 裁剪），details 放完整结果给 UI。
 */
export function createPiAgentTools(
  deps: SceneAgentDeps,
  session: SceneAgentSession,
  defaultRequirements: string[] = ['画面主体可见', '构图与镜头符合用户描述'],
): { tools: AgentTool[]; byName: Map<string, AgentTool> } {
  const { byName: raw } = createSceneAgentTools(deps, session, defaultRequirements)

  const tools = SPECS.map((spec): AgentTool => {
    const source = raw.get(spec.name) as RawTool | undefined
    if (!source) throw new Error(`缺少工具实现：${spec.name}`)
    return {
      name: spec.name,
      label: spec.label,
      description: String(source.description || spec.name),
      parameters: spec.parameters,
      execute: async (_toolCallId, params): Promise<AgentToolResult<unknown>> => {
        const result = await source.invoke(params as Record<string, unknown>)
        const failed = isErrorResult(result)
        return {
          content: [{ type: 'text', text: JSON.stringify(modelFacingResult(spec.name, result)) }],
          details: result,
          isError: failed,
          ...(spec.terminateOnSuccess && !failed ? { terminate: true } : {}),
        }
      },
    }
  })

  return { tools, byName: new Map(tools.map((tool) => [tool.name, tool])) }
}

export { SPECS as PI_TOOL_SPECS }
