import type { ProjectAsset } from './api'
import type { ClipFrameRole } from './clipBoundaryFrames'
import { assetNodeId, canvasIdFromNodeId } from './canvasLayoutStore'
import { shortHash } from './hash'
import type { ShotNodeType } from './data'
import { SHOT_PREV, neighborShots } from './shotReferences'
import { appendRefToken } from './clipFrameRef'

export type { ClipFrameRole } from './clipBoundaryFrames'

export function clipFingerprint(videoUrl: string): string {
  return shortHash(String(videoUrl || '').trim())
}

export function clipFrameAssetTitle(shotNo: string, role: ClipFrameRole): string {
  const no = String(shotNo || '').trim() || '未编号'
  return `${no} · 成片${role === 'head' ? '首帧' : '尾帧'}`
}

export function findClipFrameAsset(
  assets: ProjectAsset[],
  sourceShotId: string,
  frameRole: ClipFrameRole,
): ProjectAsset | undefined {
  const sid = String(sourceShotId || '').trim()
  if (!sid) return undefined
  return assets.find((a) => a.sourceShotId === sid && a.frameRole === frameRole)
}

export function findClipFrameAssetNode(
  nodes: ShotNodeType[],
  sourceShotId: string,
  frameRole: ClipFrameRole,
): ShotNodeType | undefined {
  const sid = String(sourceShotId || '').trim()
  if (!sid) return undefined
  return nodes.find((n) => {
    if ((n as unknown as { type?: string }).type !== 'asset') return false
    const d = n.data as unknown as { sourceShotId?: string; frameRole?: ClipFrameRole }
    return d.sourceShotId === sid && d.frameRole === frameRole
  })
}

export function buildClipFrameAssetFields(input: {
  shotId: string
  shotNo: string
  videoUrl: string
  frameUrl: string
  role: ClipFrameRole
  canvasId?: string
}): ProjectAsset {
  return {
    kind: 'image',
    title: clipFrameAssetTitle(input.shotNo, input.role),
    url: input.frameUrl,
    sourceShotId: input.shotId,
    frameRole: input.role,
    sourceClipFingerprint: clipFingerprint(input.videoUrl),
    ...(input.canvasId ? { canvasId: input.canvasId } : {}),
  }
}

export function clipFrameAssetToken(canvasId: string): string {
  return assetNodeId(canvasId)
}

export function mergeClipFrameIntoAssets(
  assets: ProjectAsset[],
  next: ProjectAsset,
): ProjectAsset[] {
  const sid = String(next.sourceShotId || '')
  const role = next.frameRole
  if (!sid || !role) return [...assets, next]
  const idx = assets.findIndex((a) => a.sourceShotId === sid && a.frameRole === role)
  if (idx < 0) return [...assets, next]
  const out = assets.slice()
  const prev = assets[idx]
  out[idx] = {
    ...next,
    canvasId: next.canvasId || prev.canvasId,
  }
  return out
}

/** 纯逻辑：上一镜尾帧 token + refIds，供脚本与 Agent 回归。 */
export function linkPrevTailRefIds(
  nodes: ShotNodeType[],
  targetNode: ShotNodeType,
  prevTailToken: string,
): { ok: true; refIds: string[] } | { ok: false; error: string } {
  const { prev } = neighborShots(targetNode, nodes)
  if (!prev) return { ok: false, error: '没有上一镜' }
  const cur = (targetNode.data as unknown as { refIds?: string[] }).refIds ?? []
  if (cur.includes(SHOT_PREV)) {
    /* 仅确保不混用邻镜 token 与本动作；保留既有 shot-prev 由用户管理 */
  }
  const refIds = appendRefToken(cur, prevTailToken)
  return { ok: true, refIds }
}

export function canvasIdFromAssetNode(node: ShotNodeType): string | undefined {
  return canvasIdFromNodeId(node.id) || undefined
}