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

const characterItem = passthrough({
  name: z.string().min(1),
  role: z.string().optional(),
  age: z.string().optional(),
  look_cn: z.string().optional(),
  look_en: z.string().optional(),
  palette: z.string().optional(),
  keywords: z.array(z.string()).optional(),
})

/**
 * 角色锚点。允许「一个都没找到」这种合法结果：
 * 内容里本来就没有具名角色时，模型返回空数组是正确的，不该报成契约违规。
 * 调用方拿到空列表后给「没给出角色，换个范围再试」这种可执行提示。
 *
 * 同时接受顶层数组（部分模型会省掉 characters 外壳），
 * pickExtracted 两种形状都能读，契约不该比消费方更严。
 */
const charactersV1 = z.union([
  passthrough({ characters: z.array(characterItem) }),
  z.array(characterItem),
])

const designItem = passthrough({
  name: z.string().min(1),
  refs: z.array(z.string()).optional(),
  summary_cn: z.string().optional(),
  prompt_en: z.string().optional(),
  keywords: z.array(z.string()).optional(),
})

/**
 * 场景/道具设定。与角色锚点同理：内容里确实没有可拆的素材时，
 * 空结果是合法的，由调用方给「没给出场景或道具，换个范围再试」的提示。
 */
const designsV1 = passthrough({
  scenes: z.array(designItem).optional().default([]),
  props: z.array(designItem).optional().default([]),
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

const reverseShot = passthrough({
  index: z.number().int().min(1).optional(),
  start: z.number().min(0),
  end: z.number().min(0),
  size: z.string().min(1),
  camera: z.string().optional(),
  subject: z.string().optional(),
  action: z.string().optional(),
  environment: z.string().optional(),
  lighting: z.string().optional(),
  color: z.string().optional(),
  audio: z.string().optional(),
  keyframe_prompt: z.string().min(1),
  video_prompt: z.string().min(1),
  evidence_frames: z.array(z.string()).default([]),
  confidence: z.number().min(0).max(1).optional(),
})

/**
 * 反推提示词包：逐镜规格 + 两段提示词。
 * 时间范围必须 start < end；镜头段之间允许留空（模型可能漏镜），但不允许倒置。
 */
const reverseV1 = passthrough({
  source: passthrough({
    platform: z.string().optional(),
    url: z.string().optional(),
    duration: z.number().min(0).optional(),
    width: z.number().int().min(0).optional(),
    height: z.number().int().min(0).optional(),
  }),
  global_style: z.string().optional(),
  shots: z.array(reverseShot).min(1),
  negative_prompt: z.string().optional(),
  notes: z.string().optional(),
}).superRefine((v, ctx) => {
  const seen = new Set<number>()
  v.shots.forEach((shot, i) => {
    if (!(shot.end > shot.start)) {
      ctx.addIssue({
        code: 'custom',
        message: `镜头 ${i + 1} 的时间范围非法：end 必须大于 start`,
        path: ['shots', i, 'end'],
      })
    }
    const key = Math.round(shot.start * 1000)
    if (seen.has(key)) {
      ctx.addIssue({
        code: 'custom',
        message: `镜头 ${i + 1} 的起始时间与前面的镜头重复`,
        path: ['shots', i, 'start'],
      })
    }
    seen.add(key)
  })
})

/** 发布助手：只要求一段给用户的回复；配置改动与提交意图走工具，不要求结构化产物。 */
const publishPlanV1 = passthrough({
  reply: z.string().min(1),
  intent: z.enum(['answer', 'apply', 'stage']).optional(),
  notes: z.array(z.string()).optional(),
})
const creativePlanV1 = passthrough({
  reply: z.string().min(1),
  directions: z
    .array(
      passthrough({
        title: z.string().optional(),
        pitch: z.string().optional(),
        hook: z.string().optional(),
        cost: z.string().optional(),
      }),
    )
    .optional(),
  shots: z
    .array(
      passthrough({
        no: noLike.optional(),
        seconds: z.number().optional(),
        size: z.string().optional(),
        action: z.string().optional(),
        line: z.string().optional(),
      }),
    )
    .optional(),
})

const REGISTRY: Record<string, SkillContract> = {
  'script-v1': { id: 'script-v1', label: '分集剧本', schema: scriptV1 },
  'characters-v1': { id: 'characters-v1', label: '角色锚点', schema: charactersV1 },
  'designs-v1': { id: 'designs-v1', label: '场景/道具设定', schema: designsV1 },
  'shots-v1': { id: 'shots-v1', label: '镜头表', schema: shotsV1 },
  'prompts-v1': { id: 'prompts-v1', label: '首帧/视频提示词', schema: promptsV1 },
  'reverse-v1': { id: 'reverse-v1', label: '视频反推提示词包', schema: reverseV1 },
  'creative-plan-v1': { id: 'creative-plan-v1', label: '创意方向与镜头草案', schema: creativePlanV1 },
  'scene3d-code-v1': {
    id: 'scene3d-code-v1',
    label: 'Blender 场景代码',
    schema: scene3dCodeV1,
    lockedBlock: SCENE_CODE_ABI,
  },
  'publish-plan-v1': { id: 'publish-plan-v1', label: '发布助手回复', schema: publishPlanV1 },
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
