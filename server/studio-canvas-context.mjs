/**
 * 创意宿主可读的画布实况：由浏览器推送，工具桥在每次调用时注入 `getCanvasContext`。
 *
 * 与 `studioProject` 同构单槽位：只服务当前顶栏项目；切项目或清空时一并丢弃。
 * 未推送时桥退化为「仅用 SQLite 项目快照重建节点」，与旧行为一致。
 */

/** @type {StudioCanvasPayload | null} */
let studioCanvas = null

/** 每次成功 POST 画布实况 +1（进程内单调） */
let canvasRevisionSeq = 0

/**
 * @typedef {object} StudioCanvasPayload
 * @property {string} name
 * @property {number} episode
 * @property {unknown[]} nodes
 * @property {unknown[]} characters
 * @property {string[]} missingMedia
 * @property {object | null} [videoModel]
 * @property {string} [resolution]
 * @property {number} projectRevision
 * @property {number} canvasRevision
 * @property {number} [updatedAt]
 */

export function clearStudioCanvasContext() {
  studioCanvas = null
}

/**
 * @param {unknown} body
 * @param {{ listProjectNames: () => string[] }} deps
 * @returns {{ ok: true } | { ok: false, status: number, message: string, name?: string }}
 */
export function setStudioCanvasContext(body, deps) {
  const name = String(body?.name ?? '').trim()
  if (!name) {
    clearStudioCanvasContext()
    return { ok: true }
  }
  const known = deps.listProjectNames().some((row) => row === name)
  if (!known) {
    return { ok: false, status: 400, message: `项目不存在：${name}`, name: studioCanvas?.name || '' }
  }
  const episode = Number(body?.episode)
  const ep = Number.isFinite(episode) && episode > 0 ? episode : 1
  const projectRevision = Math.max(0, Math.floor(Number(body?.projectRevision) || 0))
  canvasRevisionSeq += 1
  studioCanvas = {
    name,
    episode: ep,
    nodes: Array.isArray(body?.nodes) ? body.nodes : [],
    characters: Array.isArray(body?.characters) ? body.characters : [],
    missingMedia: Array.isArray(body?.missingMedia) ? body.missingMedia.map(String) : [],
    videoModel: body?.videoModel && typeof body.videoModel === 'object' ? body.videoModel : null,
    resolution: typeof body?.resolution === 'string' ? body.resolution : '',
    projectRevision,
    canvasRevision: canvasRevisionSeq,
    updatedAt: Date.now(),
  }
  return { ok: true }
}

/** @returns {StudioCanvasPayload | null} */
export function getStudioCanvasContext() {
  return studioCanvas
}

/**
 * 供工具桥注入：项目名不一致时不注入实况，避免错项目连线。
 * @param {string} projectName
 */
export function canvasContextForProject(projectName) {
  const want = String(projectName || '').trim()
  if (!want || !studioCanvas || studioCanvas.name !== want) return null
  return studioCanvas
}