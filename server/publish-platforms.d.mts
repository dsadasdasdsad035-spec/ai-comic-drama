/** server/publish-platforms.mjs 的类型声明（平台能力注册表） */

export interface PlatformLimits {
  title: number
  description: number
  tags: number
}

export interface PlatformCapability {
  id: string
  label: string
  short: string
  backendUrl: string
  contentTypes: string[]
  modes: string[]
  manualOnly: boolean
  verified: boolean
  coverAspects: string[]
  limits: PlatformLimits
  max: { durationSec?: number; bytes?: number }
  notes: string
}

export declare const PUBLISH_MODES: string[]
export declare const PLATFORMS: PlatformCapability[]
export declare const COVER_ASPECT_ORDER: string[]
/** 封面比例全集；配置规范化与前端枚举共用同一份 */
export declare const COVER_ASPECTS: string[]

export declare function listPlatforms(): PlatformCapability[]
export declare function getPlatform(id: string): PlatformCapability
export declare function platformSupports(platformId: string, mode: string): boolean
export declare function platformCanExecute(platformId: string): boolean
export declare function requiredCoverAspects(platformIds?: string[]): string[]
