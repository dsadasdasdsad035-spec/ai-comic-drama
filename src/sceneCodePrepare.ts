import type { AppSettings } from './api'
import type { MediaBrief } from './mediaBrief'
import type { PreparedSceneAsset } from './sceneCodeAssets'
import type { StagePick } from './ModelSelect'

export type PreparedCodeContext = {
  contextFp: string
  assets: PreparedSceneAsset[]
  missing: { key: string; label: string; url: string; reason: string }[]
  warnings: string[]
  mediaBrief: MediaBrief
  videoBrief?: string
  usedVideoVision: boolean
  imageCount: number
  videoCount: number
}

const emptyBrief = (): MediaBrief => ({
  version: 1,
  usedVision: false,
  items: [],
  fingerprint: '',
})

/** 3D 工作台不再维护镜头级参考选择；仅保留渲染用资产槽位。 */
export async function prepareSceneCodeContext(input?: {
  settings?: AppSettings | null
  stagePick?: StagePick
  signal?: AbortSignal
}): Promise<PreparedCodeContext> {
  void input
  return {
    contextFp: '',
    assets: [],
    missing: [],
    warnings: [],
    mediaBrief: emptyBrief(),
    usedVideoVision: false,
    imageCount: 0,
    videoCount: 0,
  }
}
