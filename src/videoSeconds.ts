/**
 * 出片请求时长的唯一求解入口。
 * 顺序：四舍五入 → 夹 2–12 秒 → 抬到模型下限 → 原生音频再抬到能力探测的下限。
 * 纯函数、无依赖，界面、拼装器、转场与服务端对齐都用这一份结果。
 */

export const SHOT_SECONDS_MIN = 2
export const SHOT_SECONDS_MAX = 12

export type SecondsFloorKind = 'model-min' | 'native-audio'

export type SecondsFloor = {
  kind: SecondsFloorKind
  /** 抬升后的请求秒数 */
  value: number
  /** 触发抬升的门槛：模型最小视频秒数（原生音频的下限也是含边界的） */
  min: number
}

export type RequestSeconds = {
  /** 实际提交给视频接口的整数秒数 */
  seconds: number
  /** 相对镜头时长被抬升的原因；null 表示只有四舍五入或 2–12 夹取 */
  floor: SecondsFloor | null
}

/** 已登记模型的时长下限；未登记返回 2，行为与改动前一致 */
export function videoMinSeconds(modelId?: string): number {
  const id = String(modelId || '').toLowerCase()
  if (!id) return SHOT_SECONDS_MIN
  if (/seedance[-_]?2[-_.]?5(?:[-_.]|$)/.test(id)) return 4
  if (/seedance[-_]?1[-_.]?5(?:[-_.]|$)/.test(id)) return 4
  if (/seedance[-_]?1[-_.]?0(?:[-_.]|$)/.test(id)) return SHOT_SECONDS_MIN
  if (/kling/.test(id)) return 3
  return SHOT_SECONDS_MIN
}

/** 已登记模型的时长上限；未登记按客户端夹取上限返回 */
export function videoMaxSeconds(modelId?: string): number {
  const id = String(modelId || '').toLowerCase()
  if (!id) return SHOT_SECONDS_MAX
  if (/seedance[-_]?2[-_.]?5(?:[-_.]|$)/.test(id)) return 30
  if (/seedance[-_]?1[-_.]?5(?:[-_.]|$)/.test(id)) return 12
  if (/seedance[-_]?1[-_.]?0(?:[-_.]|$)/.test(id)) return 12
  if (/kling/.test(id)) return 15
  return SHOT_SECONDS_MAX
}

/**
 * 求解本次出片的请求秒数。
 * `nativeAudioMinVideoSeconds` 来自能力探测；缺省表示没有原生音频能力信息，此时只套用模型下限。
 */
export function shotRequestSeconds(input: {
  seconds: number
  modelId?: string
  nativeAudio?: boolean
  nativeAudioMinVideoSeconds?: number
}): RequestSeconds {
  const shot = Math.min(
    SHOT_SECONDS_MAX,
    Math.max(SHOT_SECONDS_MIN, Math.round(Number(input.seconds) || 0)),
  )
  const modelMin = videoMinSeconds(input.modelId)
  let seconds = Math.max(shot, modelMin)
  let floor: SecondsFloor | null =
    modelMin > shot ? { kind: 'model-min', value: seconds, min: modelMin } : null

  const probeMin = Number(input.nativeAudioMinVideoSeconds)
  if (input.nativeAudio && Number.isFinite(probeMin) && probeMin > 0) {
    // 原生音频下限是含边界的：Seedance 2.5 实测 4 秒合法，不再 +1 抬到 5 秒
    const audioMin = Math.max(modelMin, Math.round(probeMin))
    if (seconds < audioMin) {
      seconds = audioMin
      floor = { kind: 'native-audio', value: seconds, min: audioMin }
    }
  }
  return { seconds, floor }
}

/** 抬升原因的一句话说明；无抬升返回空串 */
export function secondsFloorReason(floor: SecondsFloor | null): string {
  if (!floor) return ''
  if (floor.kind === 'native-audio') return `原生音频最短 ${floor.min} 秒`
  return `模型下限 ${floor.min} 秒`
}

/** 面板一行说明：秒数一致时只给请求秒数，不一致时同时给出镜头时长与原因 */
export function requestSecondsNote(
  shotSeconds: number,
  seconds: number,
  floor: SecondsFloor | null,
): string {
  const shot = Math.round((Number(shotSeconds) || 0) * 10) / 10
  if (shot === seconds) return `${seconds}s`
  return `镜头 ${shot.toFixed(1)}s → 请求 ${seconds}s（${secondsFloorReason(floor) || '四舍五入取整'}）`
}
