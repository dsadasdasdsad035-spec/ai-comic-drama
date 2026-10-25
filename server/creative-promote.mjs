/**
 * 创意产物 → 项目的晋升映射，以及提示词包导出。
 *
 * 晋升只走现有的 createProject / updateProject 路径，不直接写表：
 * - 新建项目：createProject + writeProject
 * - 现有项目：mergeShots 保留 handEdited 字段，按稳定 shotId 合并
 */
import { createProject, mergeShots, readProject, writeProject } from './db.mjs'

/** 反推镜头 → 项目镜头；shotId 稳定，重复晋升不会产生重复镜头 */
export function reverseShotToProjectShot(shot, ix, meta = {}) {
  const start = Number(shot?.start) || 0
  const end = Number(shot?.end) || 0
  const seconds = Math.max(0.1, Math.round((end - start) * 100) / 100)
  const no = `CS${String(ix + 1).padStart(2, '0')}`
  const desc = [shot?.subject, shot?.action, shot?.environment].filter(Boolean).join('，')
  // 未知字段直接平铺在镜头上：db 层会把非固定列收进 shots.extra，
  // 写成 `extra: {...}` 反而会被当成固定列丢弃。
  const creativeMeta = {
    creative_source: meta.sourceUrl || '',
    creative_session: meta.sessionId || '',
    creative_evidence: Array.isArray(shot?.evidence_frames) ? shot.evidence_frames : [],
    ...(shot?.lighting || shot?.color
      ? { creative_look: [shot?.lighting, shot?.color].filter(Boolean).join('；') }
      : {}),
    ...(shot?.confidence != null ? { creative_confidence: Number(shot.confidence) } : {}),
  }
  return {
    id: `${meta.sessionId || 'creative'}-${String(ix + 1).padStart(3, '0')}`,
    episode: Number(meta.episode) || 1,
    no,
    seconds,
    size: String(shot?.size || ''),
    move: String(shot?.camera || ''),
    desc,
    cast: [],
    keyframe_prompt: String(shot?.keyframe_prompt || ''),
    video_prompt: String(shot?.video_prompt || ''),
    ...creativeMeta,
  }
}

/**
 * 晋升一个反推产物。
 * @param root 工作区根
 * @param opts { sessionId, sourceId, sourceUrl, title, style, aspect, target: 'new'|'existing', projectName }
 */
export function promoteReversePack(root, payload, opts = {}) {
  const shots = Array.isArray(payload?.shots) ? payload.shots : []
  if (!shots.length) throw new Error('提示词包里没有镜头，无法晋升')
  if (shots.length > 200) throw new Error('镜头数超过 200，请先精简再晋升')

  const target = String(opts.target || 'new')
  const names = shots.map((_, i) => ({
    sessionId: opts.sessionId,
    sourceUrl: opts.sourceUrl,
    episode: opts.episode,
    title: opts.title,
  }))
  const merged = shots.map((s, i) => reverseShotToProjectShot(s, i, names[i]))

  if (target === 'new') {
    const name = String(opts.projectName || '').trim()
    if (!name) throw new Error('新建项目需要填写项目名')
    createProject(root, name, {
      title: String(opts.title || name),
      style: String(opts.style || payload?.global_style || ''),
      aspect: String(opts.aspect || '9:16'),
    })
    const saved = writeProject(root, name, {
      shots: merged,
      ...(payload?.global_style ? { style: String(payload.global_style) } : {}),
      ...(opts.sourceUrl ? { source: `参考视频：${opts.sourceUrl}` } : {}),
    })
    return { projectName: name, created: true, shots: merged.length, updated: 0, kept: 0, savedShots: saved.shots?.length ?? 0 }
  }

  const name = String(opts.projectName || '').trim()
  if (!name) throw new Error('晋升到现有项目需要指定项目名')
  const project = readProject(root, name)
  if (!project) throw new Error(`项目不存在：${name}`)

  const existing = Array.isArray(project.shots) ? project.shots : []
  const before = new Set(existing.map((s) => s.id))
  const mergedShots = mergeShots(existing, merged)
  const updated = merged.filter((s) => before.has(s.id)).length
  const created = merged.length - updated
  const kept = mergedShots.filter((s) => s.orphan).length
  const saved = writeProject(root, name, { shots: mergedShots })
  return {
    projectName: name,
    created: false,
    shots: merged.length,
    updated,
    newShots: created,
    kept,
    savedShots: saved.shots?.length ?? 0,
  }
}

/** 可读文本：按镜分组，不含内部 id 与文件路径 */
export function reversePackToText(payload, title = '') {
  const lines = []
  if (title) lines.push(`# ${title}`, '')
  if (payload?.global_style) lines.push(`整体风格：${payload.global_style}`, '')
  if (payload?.source?.platform || payload?.source?.url) {
    lines.push(`来源：${[payload.source?.platform, payload.source?.url].filter(Boolean).join(' · ')}`, '')
  }
  const shots = Array.isArray(payload?.shots) ? payload.shots : []
  shots.forEach((shot, i) => {
    const span = `${Number(shot.start).toFixed(2)}s–${Number(shot.end).toFixed(2)}s`
    const spec = [shot.size, shot.camera, shot.lighting, shot.color].filter(Boolean).join(' · ')
    lines.push(`## 镜头 ${i + 1}　${span}${spec ? `　${spec}` : ''}`)
    if (shot.subject) lines.push(`主体：${shot.subject}`)
    if (shot.action) lines.push(`动作：${shot.action}`)
    if (shot.environment) lines.push(`环境：${shot.environment}`)
    if (shot.audio) lines.push(`声音：${shot.audio}`)
    lines.push('', `首帧提示词：${shot.keyframe_prompt}`, '', `运动提示词：${shot.video_prompt}`, '')
  })
  if (payload?.negative_prompt) lines.push(`负面词：${payload.negative_prompt}`)
  if (payload?.notes) lines.push('', `备注：${payload.notes}`)
  return lines.join('\n').trim()
}
