import type { ProjectShot } from './api'
import type { ShotData, ShotProdKind } from './types'

export type { ShotProdKind } from './types'

export function hasVideoProdEvidence(
  s: Pick<ShotData, 'videoUrl' | 'vidState' | 'videoMeta'> & { clip?: string },
): boolean {
  if (String(s.videoUrl ?? s.clip ?? '').trim()) return true
  if (s.vidState === 'running' || s.vidState === 'error') return true
  if (s.videoMeta?.createdAt) return true
  return false
}

export function hasImageProdEvidence(
  s: Pick<ShotData, 'refImage' | 'candidates' | 'genState'> & { keyframe?: string },
): boolean {
  if (String(s.refImage ?? s.keyframe ?? '').trim()) return true
  if ((s.candidates?.length ?? 0) > 0) return true
  if (s.genState === 'running' || s.genState === 'error') return true
  return false
}

type ProdKindFallback = Pick<
  ShotData,
  'refImage' | 'videoUrl' | 'vidState' | 'videoMeta' | 'candidates' | 'genState'
>

function mergedVideoEvidence(s: ProjectShot, fallback?: ProdKindFallback) {
  return {
    videoUrl: s.clip ?? fallback?.videoUrl,
    vidState: fallback?.vidState,
    videoMeta: s.video_meta ?? fallback?.videoMeta,
    clip: s.clip,
  }
}

function mergedImageEvidence(s: ProjectShot, fallback?: ProdKindFallback) {
  return {
    refImage: s.keyframe ?? fallback?.refImage,
    keyframe: s.keyframe,
    candidates: fallback?.candidates,
    genState: fallback?.genState,
  }
}

/** 遗留水合：双轨优先出片；合并 project 与画布残留态再推断 */
export function inferProdKindFromProjectShot(
  s: ProjectShot,
  fallback?: ProdKindFallback,
): ShotProdKind {
  const video = mergedVideoEvidence(s, fallback)
  const image = mergedImageEvidence(s, fallback)
  if (hasVideoProdEvidence(video)) return 'video'
  if (hasImageProdEvidence(image)) return 'image'
  return 'video'
}

export function inferProdKindFromShotData(d: ShotData): ShotProdKind {
  if (hasVideoProdEvidence(d)) return 'video'
  if (hasImageProdEvidence(d)) return 'image'
  return 'video'
}

/** 项目已存 prod_kind 时，成片证据为 video 则纠正误锁的 image */
export function resolveProdKind(s: ProjectShot, fallback?: ProdKindFallback): ShotProdKind {
  const inferred = inferProdKindFromProjectShot(s, fallback)
  if (s.prod_kind === 'video') return 'video'
  if (s.prod_kind === 'image') {
    if (inferred === 'video') return 'video'
    return 'image'
  }
  return inferred
}

export function effectiveProdKind(d: Pick<ShotData, 'prodKind'> & ShotData): ShotProdKind {
  if (d.prodKind === 'image' || d.prodKind === 'video') return d.prodKind
  return inferProdKindFromShotData(d as ShotData)
}
