import { z } from 'zod'
import { SCENE_CODE_ABI } from '../sceneCodePrompt'

export type ContractResult = { ok: true; value: unknown } | { ok: false; errors: string[] }

export type SkillContract = {
  id: string
  label: string
  schema: z.ZodType
  /** 追加到 system 的锁定段；不可被用户编辑 */
  lockedBlock?: string
}

const noLike = z.union([z.string(), z.number()])
const passthrough = <T extends z.ZodRawShape>(shape: T) => z.object(shape).passthrough()

const scriptV1 = passthrough({
  logline: z.string().optional(),
  episodes: z
    .array(
      passthrough({
        no: noLike,
        title: z.string().optional(),
        hook: z.string().optional(),
        scenes: z
          .array(
            passthrough({
              no: noLike.optional(),
              slug: z.string().optional(),
              place: z.string().optional(),
              time: z.string().optional(),
              beats: z.string().optional(),
              characters: z.array(z.string()).optional(),
              intensity: z.number().optional(),
              tone: z.string().optional(),
            }),
          )
          .default([]),
      }),
    )
    .min(1),
})

const charactersV1 = passthrough({
  characters: z
    .array(
      passthrough({
        name: z.string().min(1),
        role: z.string().optional(),
        age: z.string().optional(),
        look_cn: z.string().optional(),
        look_en: z.string().optional(),
        palette: z.string().optional(),
        keywords: z.array(z.string()).optional(),
      }),
    )
    .min(1),
})

const designItem = passthrough({
  name: z.string().min(1),
  refs: z.array(z.string()).optional(),
  summary_cn: z.string().optional(),
  prompt_en: z.string().optional(),
  keywords: z.array(z.string()).optional(),
})

const designsV1 = passthrough({
  scenes: z.array(designItem).optional().default([]),
  props: z.array(designItem).optional().default([]),
}).superRefine((v, ctx) => {
  if ((v.scenes?.length ?? 0) + (v.props?.length ?? 0) === 0) {
    ctx.addIssue({ code: 'custom', message: 'scenes 与 props 至少有一项', path: [] })
  }
})

const emotionEnum = z.enum([
  'neutral',
  'happy',
  'sad',
  'angry',
  'fearful',
  'disgusted',
  'surprised',
  'calm',
])

const performanceEntry = passthrough({
  character: z.string().min(1),
  emotion: emotionEnum.optional(),
  intensity: z.number().min(0).max(5).optional(),
  action: z.string().optional(),
  gaze: z.string().optional(),
  speaks: z.boolean().optional(),
})

const dialogueDelivery = passthrough({
  emotion: emotionEnum.optional(),
  intensity: z.number().min(0).max(5).optional(),
  pace: z.enum(['slow', 'normal', 'fast']).optional(),
  volume: z.enum(['whisper', 'soft', 'normal', 'loud', 'shout']).optional(),
  emphasis: z.string().optional(),
})

const shotsV1 = passthrough({
  shots: z
    .array(
      passthrough({
        no: noLike,
        scene_no: z.union([z.number(), z.string()]).optional(),
        scene_slug: z.string().optional(),
        seconds: z.number().optional(),
        size: z.string().optional(),
        move: z.string().optional(),
        desc: z.string().optional(),
        dialogue: z
          .array(
            passthrough({
              speaker: z.string().optional(),
              text: z.string().optional(),
              ...dialogueDelivery.shape,
            }),
          )
          .optional(),
        performance: z.array(performanceEntry).optional(),
        cast: z.array(z.string()).optional(),
      }),
    )
    .min(1),
})

const promptsV1 = passthrough({
  shots: z
    .array(
      passthrough({
        no: noLike,
        keyframe_prompt: z.string().min(1),
        video_prompt: z.string().min(1),
      }),
    )
    .min(1),
})

const scene3dCodeV1 = passthrough({
  reply: z.string().optional(),
  code: z.string().min(1),
  motionNote: z.string().optional(),
})

const REGISTRY: Record<string, SkillContract> = {
  'script-v1': { id: 'script-v1', label: '分集剧本', schema: scriptV1 },
  'characters-v1': { id: 'characters-v1', label: '角色锚点', schema: charactersV1 },
  'designs-v1': { id: 'designs-v1', label: '场景/道具设定', schema: designsV1 },
  'shots-v1': { id: 'shots-v1', label: '镜头表', schema: shotsV1 },
  'prompts-v1': { id: 'prompts-v1', label: '首帧/视频提示词', schema: promptsV1 },
  'scene3d-code-v1': {
    id: 'scene3d-code-v1',
    label: 'Blender 场景代码',
    schema: scene3dCodeV1,
    lockedBlock: SCENE_CODE_ABI,
  },
}

export function getContract(id: string): SkillContract | undefined {
  return REGISTRY[id]
}

/** 给工具参数复用同一份输出 schema，避免提示词形状与工具校验两套。 */
export function getContractSchema(id: string): z.ZodType | undefined {
  return REGISTRY[id]?.schema
}

export function contractIds(): string[] {
  return Object.keys(REGISTRY)
}

export function contractBlocks(ids: string[]): string {
  const blocks = ids
    .map((id) => REGISTRY[id]?.lockedBlock)
    .filter((x): x is string => Boolean(x && x.trim()))
  return blocks.join('\n\n')
}

export function validateContract(id: string, raw: unknown): ContractResult {
  const contract = REGISTRY[id]
  if (!contract) return { ok: false, errors: [`未知输出契约：${id}`] }
  const parsed = contract.schema.safeParse(raw)
  if (parsed.success) return { ok: true, value: parsed.data }
  return {
    ok: false,
    errors: parsed.error.issues.slice(0, 6).map((issue) => {
      const path = issue.path.length ? issue.path.join('.') : '输出'
      return `${path}：${issue.message}`
    }),
  }
}
