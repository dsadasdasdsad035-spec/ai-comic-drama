import type { SceneCodeMeta, ShotData } from './types'
import { effectiveSeconds, isRenderableSceneCode, sceneCodeRuntime } from './types'
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
 * 代码视频是否仍对应当前代码/素材/选择/时长/画幅/引擎版本。
 * 素材文件内容替换（同 URL）不在同步检查范围内；编辑器重新运行/渲染会更新内容哈希。
 * 旧 three 代码与其视频一律视为过期：它们不能被当前宿主渲染。
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
  if (meta.selectionFingerprint && input.context) {
    if (meta.selectionFingerprint !== contextFingerprint(input.context)) return false
  }
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

/** 画布右键出片时，工作台有未保存草稿则必须阻止静默使用已保存旧代码。 */
export function shouldBlockCanvasCodeRender(
  editorNodeId: string | null,
  editorDirty: boolean,
  nodeId: string,
): boolean {
  return Boolean(editorNodeId && editorDirty && editorNodeId === nodeId)
}
