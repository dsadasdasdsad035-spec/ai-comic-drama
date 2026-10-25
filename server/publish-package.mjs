/**
 * 发布包：自动化不可用或用户主动选择时的离线兜底。
 *
 * 目录结构：
 *   public/publish-packages/<id>/
 *     video.mp4
 *     cover-9x16.jpg / cover-16x9.jpg
 *     subtitles.srt
 *     copy.json
 *   有系统 zip 时额外生成 <id>.zip
 */
import fs from 'node:fs'
import path from 'node:path'
import crypto from 'node:crypto'
import { execFile } from 'node:child_process'
import { getPlatform, requiredCoverAspects } from './publish-platforms.mjs'
import { packagesRoot, resolvePublishFile, sanitizeError } from './publish-utils.mjs'

function stamp() {
  return new Date().toISOString().replace(/[:.]/g, '-')
}

function aspectSlug(aspect) {
  return aspect.replace(':', 'x')
}

function hasZip() {
  return ['/usr/bin/zip', '/opt/homebrew/bin/zip'].some((p) => fs.existsSync(p))
}

function runZip(cwd, zipName, files) {
  return new Promise((resolve) => {
    const bin = ['/usr/bin/zip', '/opt/homebrew/bin/zip'].find((p) => fs.existsSync(p))
    if (!bin) return resolve(false)
    execFile(bin, ['-q', '-r', zipName, ...files], { cwd, timeout: 120_000 }, (err) => resolve(!err))
  })
}

/**
 * 生成发布包。deliverable 与封面必须已通过路径白名单校验。
 * 缺 SRT 时跳过，不阻塞其余文件。
 */
export async function buildPublishPackage(appRoot, input = {}) {
  // appRoot 是静态资源根；public/* 与发布包都落在这里
  const projectsRoot = input.projectsRoot || undefined
  const deliverable = input.deliverable
  if (!deliverable) throw new Error('没有选中成片')
  const config = input.config || { master: {}, cover: {}, targets: {} }
  const platformIds = Array.isArray(input.platforms) && input.platforms.length
    ? input.platforms
    : Object.keys(config.targets || {}).filter((id) => config.targets[id]?.selected)

  const id = `pkg-${stamp()}-${crypto.randomBytes(3).toString('hex')}`
  const dir = path.join(packagesRoot(appRoot), id)
  fs.mkdirSync(dir, { recursive: true })

  const files = []
  const video = resolvePublishFile(appRoot, deliverable.url, { projectsRoot })
  const videoName = `video${path.extname(video.path) || '.mp4'}`
  fs.copyFileSync(video.path, path.join(dir, videoName))
  files.push(videoName)

  const coverFiles = {}
  for (const aspect of requiredCoverAspects(platformIds)) {
    const url = config.cover?.[aspect]
    if (!url) continue
    try {
      const resolved = resolvePublishFile(appRoot, url, { projectsRoot })
      const name = `cover-${aspectSlug(aspect)}${path.extname(resolved.path) || '.jpg'}`
      fs.copyFileSync(resolved.path, path.join(dir, name))
      coverFiles[aspect] = name
      files.push(name)
    } catch {
      /* 缺失封面在预检里已报；这里跳过不阻塞 */
    }
  }

  let srtFile = ''
  if (deliverable.srtUrl) {
    try {
      const srt = resolvePublishFile(appRoot, deliverable.srtUrl, { projectsRoot })
      srtFile = 'subtitles.srt'
      fs.copyFileSync(srt.path, path.join(dir, srtFile))
      files.push(srtFile)
    } catch {
      srtFile = ''
    }
  }

  const platforms = {}
  for (const platformId of platformIds) {
    let platform
    try {
      platform = getPlatform(platformId)
    } catch {
      continue
    }
    const ov = config.targets?.[platformId]?.override || null
    platforms[platformId] = {
      label: platform.label,
      backendUrl: platform.backendUrl,
      title: String(ov?.title || config.master?.title || ''),
      description: String(ov?.description || config.master?.description || ''),
      tags: Array.isArray(ov?.tags) && ov.tags.length ? ov.tags : Array.isArray(config.master?.tags) ? config.master.tags : [],
      coverAspect: platform.coverAspects.join(' / '),
      limits: platform.limits,
      notes: platform.notes,
    }
  }

  const copy = {
    deliverableId: deliverable.id,
    title: deliverable.title || '',
    project: deliverable.project,
    episode: deliverable.episode,
    version: deliverable.version,
    duration: deliverable.duration,
    width: deliverable.width,
    height: deliverable.height,
    aiGenerated: config.master?.aiGenerated !== false,
    master: {
      title: config.master?.title || '',
      description: config.master?.description || '',
      tags: Array.isArray(config.master?.tags) ? config.master.tags : [],
    },
    covers: coverFiles,
    subtitles: srtFile || null,
    platforms,
    generatedAt: new Date().toISOString(),
    note: 'AI 生成内容请在各平台后台手动勾选「AI 生成」声明；本文件不含任何账号凭据。',
  }
  fs.writeFileSync(path.join(dir, 'copy.json'), JSON.stringify(copy, null, 2), 'utf8')
  files.push('copy.json')

  const zipName = `${id}.zip`
  // 在包目录里打包，产物放到上一级；否则 file 列表相对 cwd 找不到
  const zipped = hasZip() ? await runZip(dir, path.join('..', zipName), files) : false

  return {
    ok: true,
    id,
    dirUrl: `/publish-packages/${id}/`,
    zipUrl: zipped ? `/publish-packages/${zipName}` : '',
    files,
    copy,
  }
}

/** 发布包列表（给界面做「最近的包」） */
export function listPackages(appRoot, limit = 20) {
  const root = packagesRoot(appRoot)
  if (!fs.existsSync(root)) return []
  return fs
    .readdirSync(root, { withFileTypes: true })
    .filter((d) => d.isDirectory())
    .map((d) => {
      const full = path.join(root, d.name)
      let copy = null
      try {
        copy = JSON.parse(fs.readFileSync(path.join(full, 'copy.json'), 'utf8'))
      } catch {
        copy = null
      }
      return {
        id: d.name,
        dirUrl: `/publish-packages/${d.name}/`,
        zipUrl: fs.existsSync(path.join(root, `${d.name}.zip`)) ? `/publish-packages/${d.name}.zip` : '',
        title: copy?.title || '',
        createdAt: copy?.generatedAt || '',
      }
    })
    .sort((a, b) => String(b.createdAt).localeCompare(String(a.createdAt)))
    .slice(0, Math.max(1, limit))
}

export function describePackageError(e) {
  return sanitizeError(e)
}
