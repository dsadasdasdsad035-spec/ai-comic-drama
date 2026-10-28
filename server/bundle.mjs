/**
 * 压缩包导入：解包到系统临时目录，返回文件清单；确认导入后清理。
 *
 * 分类不在这里做——分类规则会随真实输入快速演进，放前端改一次就生效，
 * 不必重启服务。服务端只负责「安全解开 + 如实列清单」。
 */
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import crypto from 'node:crypto'
import { listZip, extractZip, entryKind, MAX_ENTRIES, MAX_TOTAL_BYTES } from './zip.mjs'

/** 临时目录每次启动一套；空闲 10 分钟后回收，避免用户关页面留下垃圾 */
const BUNDLE_ROOT = path.join(os.tmpdir(), `sb-bundle-${process.pid}`)
const bundles = new Map()
const IDLE_MS = 10 * 60 * 1000
const MAX_PREVIEW_CHARS = 4000

let sweeper = null
function startSweeper() {
  if (sweeper) return
  sweeper = setInterval(() => {
    const now = Date.now()
    for (const [id, b] of bundles) {
      if (now - b.touchedAt < IDLE_MS) continue
      cleanupBundle(id)
    }
  }, 60_000)
  sweeper.unref?.()
}

export function cleanupBundle(id) {
  const b = bundles.get(id)
  if (!b) return false
  bundles.delete(id)
  try {
    fs.rmSync(b.dir, { recursive: true, force: true })
  } catch {
    /* 清理失败不阻塞主流程 */
  }
  return true
}

/** 进程退出时尽量清干净 */
export function cleanupAllBundles() {
  for (const id of [...bundles.keys()]) cleanupBundle(id)
  try {
    fs.rmSync(BUNDLE_ROOT, { recursive: true, force: true })
  } catch {
    /* ignore */
  }
}

/** 取 bundle 元信息（导入确认时用） */
export function getBundle(id) {
  const b = bundles.get(id)
  if (!b) return null
  b.touchedAt = Date.now()
  return b
}

/** 解析上传的 zip 字节并解包；返回清单（不含文件内容，文本给预览） */
export function openBundle(bytes) {
  const entries = listZip(bytes)
  const id = crypto.randomBytes(8).toString('hex')
  const dir = path.join(BUNDLE_ROOT, id)
  fs.mkdirSync(dir, { recursive: true })
  const result = extractZip(bytes, entries, dir, fs)

  // 文本文件带一段预览，供前端分类与用户判断；图片只给 id 与大小
  const files = result.written.map((w) => {
    const base = { id: w.id, path: w.path, name: w.name, kind: w.kind, size: w.size }
    if (w.kind !== 'text') return base
    let preview = ''
    try {
      preview = w.bytes.toString('utf8').slice(0, MAX_PREVIEW_CHARS)
    } catch {
      preview = ''
    }
    return { ...base, textPreview: preview, encoding: w.encoding }
  })

  const bundle = {
    id,
    dir,
    createdAt: Date.now(),
    touchedAt: Date.now(),
    files,
    rejected: result.rejected,
    ignored: result.ignored,
    warnings: result.warnings,
  }
  bundles.set(id, bundle)
  startSweeper()
  return {
    bundleId: id,
    files,
    rejected: result.rejected,
    ignored: result.ignored,
    warnings: result.warnings,
    limits: { maxEntries: MAX_ENTRIES, maxTotalBytes: MAX_TOTAL_BYTES, maxPreviewChars: MAX_PREVIEW_CHARS },
  }
}

/** 读某个条目的字节（图片分派用）；fileId 必须是本 bundle 的安全名 */
export function readBundleFile(bundleId, fileId) {
  const b = getBundle(bundleId)
  if (!b) return null
  const name = String(fileId || '')
  // 只接受纯安全名：任何路径分隔或 .. 直接拒绝
  if (!name || /[\\/]/.test(name) || name.includes('..')) return null
  const rec = b.files.find((f) => f.id === name)
  if (!rec) return null
  const full = path.join(b.dir, name)
  const rel = path.relative(b.dir, full)
  if (!rel || rel.startsWith('..') || path.isAbsolute(rel)) return null
  if (!fs.existsSync(full)) return null
  return { bytes: fs.readFileSync(full), file: rec }
}
