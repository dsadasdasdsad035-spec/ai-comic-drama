import type { ProjectShot } from './api'
import type { ScheduleMeta, SceneCode, SceneCodeMeta, Shot3DContext } from './types'

export type Shot3DSaveInput = {
  sceneCode: SceneCode
  shot3DContext: Shot3DContext
  sceneCodeMeta?: SceneCodeMeta
}

export type Shot3DRenderInput = Shot3DSaveInput & {
  video: string
  scheduleMeta: ScheduleMeta
  frames?: string[]
  existingMotionNote?: string
}

/**
 * 提示词工作台打开 3D 编辑器后的写回补丁。
 * 只含 3D 字段：提示词、描述、表演、台词和旧参考开关都不在补丁里，
 * mergeShots 会保留项目中的原值。
 */
export function shot3DSavePatch(input: Shot3DSaveInput): Partial<ProjectShot> {
  return {
    scene_code: input.sceneCode,
    shot_3d_context: input.shot3DContext,
    ...(input.sceneCodeMeta ? { scene_code_meta: input.sceneCodeMeta } : {}),
  }
}

export function shot3DRenderPatch(input: Shot3DRenderInput): Partial<ProjectShot> {
  return {
    ...shot3DSavePatch(input),
    schedule_video: input.video,
    schedule_meta: input.scheduleMeta,
    motion_note: input.sceneCode.motionNote || input.existingMotionNote || '',
    ...(input.frames?.length ? { schedule_frames: input.frames } : {}),
  }
}
