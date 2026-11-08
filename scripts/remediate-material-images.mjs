#!/usr/bin/env node
/**
 * 扫描项目内角色三视图等站内图，裁切到视频参考安全宽高比并写回数据库。
 * 依赖 macOS sips（居中裁切，与 materialCropRect 一致）。
 * 用法：node scripts/remediate-material-images.mjs [项目名]
 */
import { execFileSync } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import {
  materialAspectRatio,
  materialCropRect,
  needsMaterialAspectCrop,
} from '../server/imageMaterialCrop.mjs'
import { readProject, resolveRoot, writeProject } from '../server/db.mjs'
import { projectMediaDir, saveProjectImage } from '../server/media.mjs'

const root = path.dirname(fileURLToPath(import.meta.url))
const appRoot = path.join(root, '..')
const projectName = process.argv[2] || 'a'

function sipsSize(file) {
  const out = execFileSync('sips', ['-g', 'pixelWidth', '-g', 'pixelHeight', file], { encoding: 'utf8' })
  const w = Number(out.match(/pixelWidth:\s*(\d+)/)?.[1] || 0)
  const h = Number(out.match(/pixelHeight:\s*(\d+)/)?.[1] || 0)
  return { w, h }
}

/** materialCropRect 为居中裁切，等价于 sips -c height width */
function sipsCenterCrop(inFile, outFile, rect) {
  fs.copyFileSync(inFile, outFile)
  const h = Math.max(1, Math.round(rect.sh))
  const w = Math.max(1, Math.round(rect.sw))
  execFileSync('sips', ['-c', String(h), String(w), outFile])
}

function remediateUrl(name, url, prefix) {
  const m = url.match(/^\/project-assets\/[^/]+\/([^/]+)$/)
  if (!m) return url
  const file = decodeURIComponent(m[1])
  const abs = path.join(projectMediaDir(appRoot, name), file)
  if (!fs.existsSync(abs)) {
    console.warn('跳过缺失文件', url)
    return url
  }
  const { w, h } = sipsSize(abs)
  if (!needsMaterialAspectCrop(w, h)) return url
  const rect = materialCropRect(w, h)
  if (!rect) return url
  const tmp = path.join(projectMediaDir(appRoot, name), `.remediate-${Date.now()}.png`)
  sipsCenterCrop(abs, tmp, rect)
  const bytes = fs.readFileSync(tmp)
  fs.rmSync(tmp, { force: true })
  const { url: next } = saveProjectImage(appRoot, name, bytes, 'png', prefix)
  const r0 = materialAspectRatio(w, h)
  const { w: w2, h: h2 } = sipsSize(path.join(projectMediaDir(appRoot, name), decodeURIComponent(next.split('/').pop())))
  console.log(
    `修图 ${file} ${w}x${h} (${r0.toFixed(3)}) → ${next} ${w2}x${h2} (${materialAspectRatio(w2, h2).toFixed(3)})`,
  )
  return next
}

const dataRoot = resolveRoot(appRoot)
const proj = readProject(dataRoot, projectName)
let touched = 0
const chars = (proj.characters || []).map((c) => {
  let image = c.image
  if (image?.startsWith('/project-assets/')) {
    const next = remediateUrl(projectName, image, 'char')
    if (next !== image) {
      image = next
      touched++
    }
  }
  const candidates = (c.candidates || []).map((u) =>
    u?.startsWith('/project-assets/') ? remediateUrl(projectName, u, 'char') : u,
  )
  return { ...c, image, candidates: candidates.length ? candidates : c.candidates }
})

writeProject(dataRoot, projectName, { characters: chars })
console.log(touched ? `已更新项目「${projectName}」${touched} 张角色主图` : `项目「${projectName}」无需修图`)
