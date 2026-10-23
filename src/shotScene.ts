import type { ProjectShot } from './api'
import type { SceneLayout, ShotData, ShotScene } from './types'
import { fallbackSceneLayout, sceneLayoutId } from './scheduleGeometry'

/**
 * 每镜空间解析：
 * - 新数据直接用 shotScene；
 * - 旧镜头从同集同场 sceneLayouts 懒复制一份；
 * - 都没有时用兜底。
 * 返回值中的 migrated 表示当前镜头还没有持久化 shotScene。
 */
export type ResolvedShotScene = {
  scene: ShotScene
  migrated: boolean
  seedFrom?: string
}

export function sceneForShot(
  base: SceneLayout,
  shotId: string,
  episode: number,
  sceneNo: number,
  sceneSlug?: string,
  seedFrom?: string,
): ShotScene {
  return {
    ...structuredClone(base),
    id: shotId,
    episode,
    sceneNo,
    ...(sceneSlug ? { sceneSlug } : {}),
    ...(seedFrom ? { seedFrom } : {}),
  }
}

export function resolveShotScene(
  data: ShotData,
  opts: {
    shotId: string
    sceneLayouts?: SceneLayout[]
    episode?: number
    sceneNo?: number
    sceneSlug?: string
  },
): ResolvedShotScene {
  const episode = Math.max(1, Number(data.episode ?? opts.episode) || 1)
  const sceneNo = Math.max(1, Number(data.sceneNo ?? opts.sceneNo) || 1)
  const sceneSlug = data.sceneSlug || opts.sceneSlug
  if (data.shotScene) {
    return {
      scene: {
        ...structuredClone(data.shotScene),
        id: data.shotScene.id || opts.shotId,
        episode,
        sceneNo,
        ...(sceneSlug ? { sceneSlug } : {}),
      },
      migrated: false,
      ...(data.shotSceneSeed ? { seedFrom: data.shotSceneSeed } : {}),
    }
  }
  const legacy = (opts.sceneLayouts ?? []).find((l) => l.episode === episode && l.sceneNo === sceneNo)
  if (legacy) {
    return {
      scene: {
        ...sceneForShot(legacy, opts.shotId, episode, sceneNo, sceneSlug || legacy.sceneSlug),
        source: 'legacy',
      },
      migrated: true,
      seedFrom: undefined,
    }
  }
  return {
    scene: sceneForShot(
      fallbackSceneLayout(episode, sceneNo, sceneSlug),
      opts.shotId,
      episode,
      sceneNo,
      sceneSlug,
    ),
    migrated: true,
    seedFrom: undefined,
  }
}

export function resolveShotSceneForProjectShot(
  shot: ProjectShot,
  sceneLayouts: SceneLayout[],
): ResolvedShotScene {
  if (shot.shot_scene) {
    return {
      scene: {
        ...structuredClone(shot.shot_scene),
        id: shot.shot_scene.id || shot.id,
        episode: Number(shot.episode) || 1,
        sceneNo: Math.max(1, Number(shot.scene_no) || 1),
        ...(shot.scene_slug ? { sceneSlug: shot.scene_slug } : {}),
      },
      migrated: false,
      ...(shot.shot_scene_seed ? { seedFrom: shot.shot_scene_seed } : {}),
    }
  }
  const legacy = sceneLayouts.find(
    (l) => l.episode === (Number(shot.episode) || 1) && l.sceneNo === (Math.max(1, Number(shot.scene_no) || 1)),
  )
  if (legacy) {
    return {
      scene: {
        ...sceneForShot(
          legacy,
          shot.id,
          Number(shot.episode) || 1,
          Math.max(1, Number(shot.scene_no) || 1),
          shot.scene_slug || legacy.sceneSlug,
        ),
        source: 'legacy',
      },
      migrated: true,
    }
  }
  return {
    scene: sceneForShot(
      fallbackSceneLayout(Number(shot.episode) || 1, Math.max(1, Number(shot.scene_no) || 1), shot.scene_slug),
      shot.id,
      Number(shot.episode) || 1,
      Math.max(1, Number(shot.scene_no) || 1),
      shot.scene_slug,
    ),
    migrated: true,
  }
}

/** 同集同场、镜头顺序在前的最近一镜；跳过没有空间且没有旧布局可迁移的镜头 */
export function previousShotFor(
  shots: ProjectShot[],
  currentShotId: string,
  sceneLayouts: SceneLayout[],
): { shot: ProjectShot; scene: ShotScene } | null {
  const idx = shots.findIndex((s) => s.id === currentShotId)
  if (idx <= 0) return null
  const current = shots[idx]
  const ep = Number(current.episode) || 1
  const sceneNo = Math.max(1, Number(current.scene_no) || 1)
  for (let i = idx - 1; i >= 0; i--) {
    const s = shots[i]
    if ((Number(s.episode) || 1) !== ep) continue
    if (Math.max(1, Number(s.scene_no) || 1) !== sceneNo) continue
    const hasScene =
      Boolean(s.shot_scene) ||
      sceneLayouts.some(
        (l) => l.episode === ep && l.sceneNo === sceneNo,
      )
    if (!hasScene) continue
    const resolved = resolveShotSceneForProjectShot(s, sceneLayouts)
    return { shot: s, scene: resolved.scene }
  }
  return null
}

export type ContinuityWarning = {
  kind: 'size' | 'wall' | 'opening' | 'prop'
  message: string
  previousShotId: string
}

const wallMid = (w: SceneLayout['walls'][number]) => ({
  x: (w.x1 + w.x2) / 2,
  z: (w.z1 + w.z2) / 2,
  len: Math.hypot(w.x2 - w.x1, w.z2 - w.z1),
})

/** 结构差异只警告，不阻断；不比较材质、颜色和不可见细节 */
export function continuityWarnings(
  current: ShotScene,
  previous: ShotScene,
  previousShotId: string,
): ContinuityWarning[] {
  const out: ContinuityWarning[] = []
  const maxW = Math.max(current.w, previous.w)
  const maxH = Math.max(current.h, previous.h)
  if (Math.abs(current.w - previous.w) / Math.max(1, maxW) > 0.15 || Math.abs(current.h - previous.h) / Math.max(1, maxH) > 0.15) {
    out.push({
      kind: 'size',
      previousShotId,
      message: `场地尺寸与 ${previousShotId} 差异较大（${previous.w}×${previous.h} → ${current.w}×${current.h} 米）`,
    })
  }
  if (current.walls.length !== previous.walls.length) {
    out.push({
      kind: 'wall',
      previousShotId,
      message: `墙体数量与 ${previousShotId} 不同（${previous.walls.length} → ${current.walls.length}）`,
    })
  } else {
    for (const cw of current.walls) {
      const cm = wallMid(cw)
      const pw = previous.walls.find((w) => {
        const pm = wallMid(w)
        return Math.hypot(pm.x - cm.x, pm.z - cm.z) < 0.5 && Math.abs(pm.len - cm.len) < 0.5
      })
      if (!pw) {
        out.push({ kind: 'wall', previousShotId, message: `墙体 ${cw.id} 在 ${previousShotId} 中没有对应结构` })
        break
      }
    }
  }
  const doorCount = (l: SceneLayout) => l.walls.reduce((n, w) => n + (w.openings?.length ?? 0), 0)
  if (doorCount(current) !== doorCount(previous)) {
    out.push({
      kind: 'opening',
      previousShotId,
      message: `门窗数量与 ${previousShotId} 不同（${doorCount(previous)} → ${doorCount(current)}）`,
    })
  } else {
    for (const cw of current.walls) {
      const cm = wallMid(cw)
      const pw = previous.walls.find((w) => {
        const pm = wallMid(w)
        return Math.hypot(pm.x - cm.x, pm.z - cm.z) < 0.5 && Math.abs(pm.len - cm.len) < 0.5
      })
      if (!pw) continue
      for (const co of cw.openings ?? []) {
        const po = (pw.openings ?? []).find((o) => Math.abs(o.at - co.at) <= 0.8)
        if (!po) {
          out.push({
            kind: 'opening',
            previousShotId,
            message: `门窗位置与 ${previousShotId} 差异超过 0.8 米（墙 ${cw.id}）`,
          })
          break
        }
      }
    }
  }
  for (const p of current.props) {
    const old = previous.props.find((x) => x.name === p.name)
    if (!old) {
      out.push({ kind: 'prop', previousShotId, message: `固定物「${p.name}」在 ${previousShotId} 中不存在` })
      continue
    }
    if (Math.hypot(p.x - old.x, p.z - old.z) > 1) {
      out.push({ kind: 'prop', previousShotId, message: `固定物「${p.name}」与 ${previousShotId} 的位置差异超过 1 米` })
    }
  }
  return out.slice(0, 5)
}

/** 旧项目/旧镜头的 sceneNo 缺失时统一按第 1 场读取，不写回 */
export function shotSceneKey(episode: number | undefined, sceneNo: number | undefined): string {
  return sceneLayoutId(Number(episode) || 1, Math.max(1, Number(sceneNo) || 1))
}
