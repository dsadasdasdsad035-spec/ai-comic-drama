/**
 * 打开项目时：仅 `prod_kind === 'image'` 的镜头迁出序列，落成图片素材卡。
 */
import type { ProjectAsset, ProjectCanvasSpot, ProjectShot } from './api'
import { ASSET_KEY_PREFIX } from './canvasLayoutStore'
import { uid } from './types'
import { SHOT_PREV, SHOT_NEXT } from './shotReferences'

function dialogueText(dialogue: ProjectShot['dialogue']): string {
  if (!dialogue) return ''
  if (typeof dialogue === 'string') return dialogue.trim()
  if (!Array.isArray(dialogue)) return ''
  return dialogue
    .map((row) => {
      const who = String(row.speaker || '').trim()
      const text = String(row.text || '').trim()
      return who ? `${who}: ${text}` : text
    })
    .filter(Boolean)
    .join('\n')
}

function keepRefToken(token: string): boolean {
  if (token === SHOT_PREV || token === SHOT_NEXT) return false
  if (token.startsWith('char-') || token.startsWith('asset-')) return true
  if (token.startsWith('cast:')) return true
  return false
}

export type ImageShotMigrationPlan = {
  shots: ProjectShot[]
  assets: ProjectAsset[]
  canvas: ProjectCanvasSpot[]
  imageShotsToAssetCards: true
  migratedCount: number
}

/** 已迁出则返回 null；未迁出时始终写出 `imageShotsToAssetCards: true`（即便没有生图镜） */
export function planImageShotToAssetCards(input: {
  shots: ProjectShot[]
  assets: ProjectAsset[]
  canvas?: ProjectCanvasSpot[]
  imageShotsToAssetCards?: boolean
}): ImageShotMigrationPlan | null {
  if (input.imageShotsToAssetCards) return null

  const imageShots = input.shots.filter((s) => s.prod_kind === 'image')
  const removed = new Set(imageShots.map((s) => String(s.id)))
  const nextShots: ProjectShot[] = []
  for (const s of input.shots) {
    if (s.prod_kind === 'image') continue
    let shot: ProjectShot = { ...s, prod_kind: 'video' }
    if (shot.transition_out?.to && removed.has(String(shot.transition_out.to))) {
      shot = { ...shot, transition_out: null }
    }
    if (shot.refIds?.length) {
      shot = {
        ...shot,
        refIds: shot.refIds.filter((t) => t !== SHOT_PREV && t !== SHOT_NEXT),
      }
    }
    nextShots.push(shot)
  }

  const nextAssets = [...(input.assets ?? [])]
  const usedCanvas = new Set(
    nextAssets.map((a) => String(a.canvasId || '').trim()).filter(Boolean),
  )
  const canvas = [...(input.canvas ?? [])]

  for (const s of imageShots) {
    let canvasId = ''
    do {
      canvasId = uid()
    } while (usedCanvas.has(canvasId))
    usedCanvas.add(canvasId)

    const existing = nextAssets.find(
      (a) =>
        a.sourceShotId === s.id ||
        (String(a.note || '').includes(s.id) && String(a.prompt || '') === String(s.keyframe_prompt || s.desc || '')),
    )
    if (existing?.canvasId) continue

    const prompt = String(s.keyframe_prompt || s.desc || '').trim()
    const url = String(s.keyframe || '').trim()
    const refIds = (s.refIds ?? []).filter(keepRefToken)
    const noteParts = [dialogueText(s.dialogue)].filter(Boolean)

    nextAssets.push({
      kind: 'image',
      title: `原镜 ${s.no || s.id}`,
      url,
      note: noteParts.join('\n'),
      prompt,
      ...(refIds.length ? { refIds } : {}),
      canvasId,
      sourceShotId: s.id,
    })

    const shotKey = `shot:${s.id}`
    const pos = canvas.find((c) => c.key === shotKey)
    if (pos) {
      const assetKey = `${ASSET_KEY_PREFIX}${canvasId}`
      if (!canvas.some((c) => c.key === assetKey)) {
        canvas.push({ key: assetKey, x: pos.x, y: pos.y })
      }
    }
  }

  return {
    shots: nextShots,
    assets: nextAssets,
    canvas,
    imageShotsToAssetCards: true,
    migratedCount: imageShots.length,
  }
}