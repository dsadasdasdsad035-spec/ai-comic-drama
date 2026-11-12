import type { SceneCode, SceneCodeMeta } from './types'
import { effectiveSeconds, isRenderableSceneCode, sceneCodeRuntime } from './types'
import { sceneCodeFingerprint } from './sceneCodeFingerprint'

export type SceneCodeFreshnessInput = {
  sceneCode?: SceneCode
  meta?: SceneCodeMeta
  seconds?: number
  aspect: string
  hasVideo: boolean
}

/**
 * 代码视频是否仍对应当前代码、渲染资产、时长、画幅与引擎版本。
 * 旧 three 代码与其视频一律视为过期。
 */
export function isSceneCodeFresh(input: SceneCodeFreshnessInput): boolean {
  if (!input.hasVideo || !input.sceneCode || !input.meta) return false
  const meta = input.meta
  const code = input.sceneCode
  if (meta.version !== 2 || meta.mode !== 'clean') return false
  if (sceneCodeRuntime(code) !== 'blender' || meta.runtime !== 'blender') return false
  if (Number(code.abiVersion) !== 2 || Number(meta.abiVersion) !== 2) return false
  if (!isRenderableSceneCode(code)) return false
  if ((code.engineVersion || '') !== (meta.engineVersion || '')) return false
  if (meta.codeHash !== code.codeHash) return false
  if (Math.abs(meta.duration - effectiveSeconds(input.seconds)) > 1e-6) return false
  if (meta.aspect !== input.aspect) return false
  const expected = sceneCodeFingerprint({
    codeHash: meta.codeHash,
    abiVersion: meta.abiVersion,
    runtime: meta.runtime,
    engineVersion: meta.engineVersion,
    assets: meta.assets,
    duration: meta.duration,
    aspect: meta.aspect,
    mode: meta.mode,
    fps: meta.fps,
    frames: meta.frames,
  })
  return meta.fingerprint === expected
}
