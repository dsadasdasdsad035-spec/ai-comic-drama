import { isSceneCodeFresh } from './sceneCodeFreshness'
import {
  fallbackBlocking,
  isScheduleFresh,
  legacyLayoutToBlocking,
  rosterOf,
} from './scheduleGeometry'
import { resolveShotScene } from './shotScene'
import { effectiveSeconds, type SceneLayout, type ShotBlocking, type ShotData } from './types'

export type ShotScheduleState = {
  scene: SceneLayout
  blocking: ShotBlocking
  duration: number
  ready: boolean
  status: '未渲染' | '生效' | '仅审阅' | '已过期'
  reason: string
}

/**
 * 提示词工作台的 3D 调度状态判断；motionNote 推导也用它。
 * 3D 调度不再作为出片参考附件，过期也不阻止出片。
 */
export function resolveShotSchedule(input: {
  data: ShotData
  shotId: string
  sceneLayouts: SceneLayout[]
  projectAspect: string
}): ShotScheduleState {
  const d = input.data
  const sceneNo = Math.max(1, Math.round(Number(d.sceneNo) || 1))
  const scene = resolveShotScene(d, {
    shotId: d.shotId || input.shotId,
    sceneLayouts: input.sceneLayouts,
    episode: Number(d.episode) || 1,
    sceneNo,
    sceneSlug: d.sceneSlug,
  }).scene
  const blocking =
    d.shotBlocking ??
    legacyLayoutToBlocking(d.layout) ??
    fallbackBlocking(rosterOf(d.cast, d.dialogue), scene)
  const duration = effectiveSeconds(d.seconds)
  const fresh = d.sceneCode
    ? isSceneCodeFresh({
        sceneCode: d.sceneCode,
        meta: d.sceneCodeMeta,
        context: d.shot3DContext,
        seconds: d.seconds,
        aspect: input.projectAspect,
        hasVideo: Boolean(d.scheduleVideo),
      })
    : Boolean(
        d.scheduleVideo &&
          d.scheduleMeta &&
          isScheduleFresh(d.scheduleMeta, {
            layout: scene,
            blocking,
            duration,
            aspect: input.projectAspect,
            mode: 'clean',
          }),
      )
  const status: ShotScheduleState['status'] = !d.scheduleVideo
    ? '未渲染'
    : d.sceneCode
      ? fresh
        ? '生效'
        : '已过期'
      : d.scheduleMeta?.mode === 'review'
        ? '仅审阅'
        : fresh
          ? '生效'
          : '已过期'
  const reason = !d.scheduleVideo
    ? '还没有 3D 调度视频'
    : !d.sceneCode && d.scheduleMeta?.mode === 'review'
      ? '当前调度视频是审阅视角，仅用于看空间'
      : '调度视频已过期，请重新渲染'
  return { scene, blocking, duration, ready: fresh, status, reason }
}
