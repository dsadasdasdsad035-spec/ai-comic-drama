/**
 * 3D 镜头参考视频摄取：平台链接 / 上传 → 项目 assets。
 */
import fs from 'node:fs'
import path from 'node:path'
import crypto from 'node:crypto'
import { ingestSourceToDir, MAX_SOURCE_BYTES } from './ingest.mjs'
import { probeMedia } from './video-analyze.mjs'
import { projectMediaDir, projectMediaUrl } from './media.mjs'
import { readProject, resolveRoot, safeProjectName, writeProject } from './db.mjs'

function normAssetUrl(url) {
  return String(url || '').split('?')[0]
}

/** 摄取成功后在 project.assets 登记视频条目（同 URL 去重更新） */
function upsertIngestVideoAsset(project, { videoUrl, title, adapter }) {
  const url = normAssetUrl(videoUrl)
  const assets = Array.isArray(project.assets) ? [...project.assets] : []
  const note = adapter ? `平台链接下载 · ${adapter}` : '平台链接下载'
  const entry = {
    kind: 'video',
    title: String(title || '链接下载').slice(0, 120),
    url,
    note,
    tags: [],
    designId: '',
  }
  const idx = assets.findIndex((a) => normAssetUrl(a?.url) === url)
  if (idx >= 0) assets[idx] = { ...assets[idx], ...entry }
  else assets.push(entry)
  return assets
}

export async function ingestShot3dReference(appRoot, body, creativeConfig = {}) {
  const projectName = safeProjectName(String(body?.projectName || ''))
  if (!projectName) throw new Error('缺少项目名称')
  const root = resolveRoot(appRoot)
  const project = readProject(root, projectName)
  if (!project) throw new Error(`项目不存在：${projectName}`)

  const dir = projectMediaDir(appRoot, projectName)
  const sourceId = `ref-${Date.now().toString(36)}-${crypto.randomBytes(3).toString('hex')}`
  const got = await ingestSourceToDir(
    {
      url: body?.url,
      data: body?.data,
      name: body?.name,
      adapter: body?.adapter,
    },
    { sourceId, sourcesDir: dir },
    creativeConfig,
  )

  const bytes = Number(got.bytes) || fs.statSync(got.file).size
  if (bytes > MAX_SOURCE_BYTES) {
    try {
      fs.unlinkSync(got.file)
    } catch {
      /* ignore */
    }
    throw new Error('视频超过大小上限')
  }

  const base = path.basename(got.file)
  const videoUrl = projectMediaUrl(projectName, base)
  let probe = null
  let probeError = ''
  try {
    probe = await probeMedia(got.file)
  } catch (e) {
    probeError = e?.message || String(e)
    try {
      fs.unlinkSync(got.file)
    } catch {
      /* ignore */
    }
    throw new Error(probeError || '无法读取视频信息')
  }

  const title =
    String(got.meta?.title || got.meta?.description || '').trim() ||
    path.basename(base, path.extname(base)) ||
    '链接下载'
  const assets = upsertIngestVideoAsset(project, {
    videoUrl,
    title,
    adapter: got.adapterLabel || got.adapter,
  })
  writeProject(root, projectName, { assets })

  return {
    videoUrl,
    bytes,
    adapter: got.adapter,
    adapterLabel: got.adapterLabel,
    meta: got.meta || {},
    warnings: got.warnings || [],
    probe: {
      duration: probe.duration,
      width: probe.width,
      height: probe.height,
      fps: probe.fps,
      hasAudio: probe.hasAudio,
    },
    shotId: String(body?.shotId || ''),
  }
}
