import type { SceneCodeMeta, ShotData } from './types'
import { effectiveSeconds } from './types'
import { contextFingerprint } from './shot3dContext'
import { sceneCodeFingerprint } from './sceneCodeFingerprint'

export type SceneCodeFreshnessInput = {
  sceneCode?: ShotData['sceneCode']
  meta?: SceneCodeMeta
  context?: ShotData['shot3DContext']
  seconds?: number
  aspect: string
  hasVideo: boolean
}

/**
 * 代码视频是否仍对应当前代码/素材/选择/时长/画幅。
 * 素材文件内容替换（同 URL）不在同步检查范围内；编辑器重新运行/渲染会更新内容哈希。
 */
export function isSceneCodeFresh(input: SceneCodeFreshnessInput): boolean {
  if (!input.hasVideo || !input.sceneCode || !input.meta) return false
  const meta = input.meta
  const code = input.sceneCode
  if (meta.version !== 1 || meta.mode !== 'clean') return false
  if (meta.codeHash !== code.codeHash || meta.abiVersion !== code.abiVersion) return false
  if (Math.abs(meta.duration - effectiveSeconds(input.seconds)) > 1e-6) return false
  if (meta.aspect !== input.aspect) return false
  if (meta.selectionFingerprint && input.context) {
    if (meta.selectionFingerprint !== contextFingerprint(input.context)) return false
  }
  const expected = sceneCodeFingerprint({
    codeHash: meta.codeHash,
    abiVersion: meta.abiVersion,
    assets: meta.assets,
    duration: meta.duration,
    aspect: meta.aspect,
    mode: meta.mode,
  })
  return meta.fingerprint === expected
}

export function scheduleFreshnessForShot(data: ShotData, aspect: string): boolean {
  if (data.sceneCode) {
    return isSceneCodeFresh({
      sceneCode: data.sceneCode,
      meta: data.sceneCodeMeta,
      context: data.shot3DContext,
      seconds: data.seconds,
      aspect,
      hasVideo: Boolean(data.scheduleVideo),
    })
  }
  return false
}
