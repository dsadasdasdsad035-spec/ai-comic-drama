/**
 * 场景草稿存储：agent 分段写代码的临时文件。
 *
 * 安全边界：
 * - 目录固定为 <appRoot>/.scene-drafts/<project>/<shot>/draft.py
 * - 路径由服务端拼接，模型只能拿到随机草稿 id
 * - 拒绝路径穿越、绝对路径和符号链接
 * - 只当纯文本读写，不执行草稿
 */
import fs from 'node:fs'
import path from 'node:path'
import crypto from 'node:crypto'
import { safeProjectName } from './db.mjs'

const ROOT_DIR = '.scene-drafts'
export const MAX_DRAFT_BYTES = 200 * 1024
export const MAX_WRITE_BYTES = 32 * 1024
export const MAX_READ_LINES = 200
export const MAX_READ_BYTES = 8 * 1024

const drafts = new Map()

export class DraftError extends Error {
  constructor(message, code = 'invalid') {
    super(message)
    this.name = 'DraftError'
    this.code = code
  }
}

function safeShotId(value) {
  const raw = String(value || '').trim()
  if (!raw || raw === '.' || raw === '..') throw new DraftError('无效的镜头标识')
  // 镜头标识由应用生成（E01-S01 / UUID），不允许分隔符或 .. 进入路径。
  if (raw.includes('/') || raw.includes('\\') || raw.includes('..')) {
    throw new DraftError('镜头标识不能包含路径分隔符或 ..')
  }
  const safe = raw.replace(/[^a-zA-Z0-9._-]+/g, '-').slice(0, 80)
  if (!safe) throw new DraftError('无效的镜头标识')
  return safe
}

function draftsRoot(appRoot) {
  return path.join(appRoot, ROOT_DIR)
}

function draftDir(appRoot, project, shotId) {
  const root = draftsRoot(appRoot)
  const dir = path.join(root, safeProjectName(project), safeShotId(shotId))
  const rel = path.relative(root, dir)
  if (!rel || rel.startsWith('..') || path.isAbsolute(rel)) throw new DraftError('草稿路径越界')
  return dir
}

/** 固定目录链上任何一级都不能是符号链接，避免 append/patch 写到目录外。 */
function assertNoSymlinkChain(appRoot, dir) {
  const root = draftsRoot(appRoot)
  if (fs.existsSync(root) && fs.lstatSync(root).isSymbolicLink()) {
    throw new DraftError('草稿根目录不能是符号链接')
  }
  const rel = path.relative(root, dir)
  if (!rel || rel.startsWith('..') || path.isAbsolute(rel)) throw new DraftError('草稿路径越界')
  let current = root
  for (const part of rel.split(path.sep).filter(Boolean)) {
    current = path.join(current, part)
    if (fs.existsSync(current) && fs.lstatSync(current).isSymbolicLink()) {
      throw new DraftError('草稿目录不能是符号链接')
    }
  }
}

function ensureSafeDir(dir) {
  if (fs.existsSync(dir)) {
    const stat = fs.lstatSync(dir)
    if (stat.isSymbolicLink()) throw new DraftError('草稿目录不能是符号链接')
  }
}

function ensureSafeFile(file) {
  if (fs.existsSync(file)) {
    const stat = fs.lstatSync(file)
    if (stat.isSymbolicLink() || !stat.isFile()) throw new DraftError('草稿文件类型不合法')
  }
}

function entryOf(id) {
  const entry = drafts.get(String(id || ''))
  if (!entry) throw new DraftError('草稿不存在或已清理', 'not-found')
  return entry
}

function readText(entry) {
  assertNoSymlinkChain(entry.appRoot, entry.dir)
  ensureSafeDir(entry.dir)
  ensureSafeFile(entry.file)
  if (!fs.existsSync(entry.file)) return ''
  return fs.readFileSync(entry.file, 'utf8')
}

function writeText(entry, text) {
  if (Buffer.byteLength(text, 'utf8') > MAX_DRAFT_BYTES) {
    throw new DraftError(`草稿超过 ${Math.round(MAX_DRAFT_BYTES / 1024)}KB 上限`)
  }
  assertNoSymlinkChain(entry.appRoot, entry.dir)
  ensureSafeDir(entry.dir)
  fs.mkdirSync(entry.dir, { recursive: true })
  assertNoSymlinkChain(entry.appRoot, entry.dir)
  ensureSafeFile(entry.file)
  fs.writeFileSync(entry.file, text, 'utf8')
}

function linesOf(text) {
  return text ? text.split('\n') : []
}

function statsOf(text) {
  return { lines: linesOf(text).length, chars: text.length }
}

function stateOf(entry, text) {
  return { id: entry.id, project: entry.project, shotId: entry.shotId, ...statsOf(text) }
}

export function beginDraft(input, appRoot) {
  const project = String(input?.project || '').trim()
  if (!project) throw new DraftError('缺少项目')
  const shotId = safeShotId(input?.shotId)
  const dir = draftDir(appRoot, project, shotId)
  assertNoSymlinkChain(appRoot, dir)
  fs.rmSync(dir, { recursive: true, force: true })
  fs.mkdirSync(dir, { recursive: true })
  const file = path.join(dir, 'draft.py')
  fs.writeFileSync(file, '', 'utf8')
  const id = crypto.randomBytes(12).toString('hex')
  const entry = {
    id,
    project: safeProjectName(project),
    shotId,
    dir,
    file,
    appRoot,
    createdAt: Date.now(),
  }
  drafts.set(id, entry)
  return stateOf(entry, '')
}

export function appendDraft(id, chunk) {
  const entry = entryOf(id)
  const add = String(chunk ?? '')
  if (!add) throw new DraftError('追加内容为空')
  if (Buffer.byteLength(add, 'utf8') > MAX_WRITE_BYTES) {
    throw new DraftError(`单次追加超过 ${Math.round(MAX_WRITE_BYTES / 1024)}KB 上限`)
  }
  const next = readText(entry) + add
  writeText(entry, next)
  return stateOf(entry, next)
}

export function readDraft(id, startLine, endLine) {
  const entry = entryOf(id)
  const text = readText(entry)
  const lines = linesOf(text)
  const total = lines.length
  if (!total) return { ...stateOf(entry, text), text: '', totalLines: 0, startLine: 1, endLine: 1 }
  const start = Math.min(Math.max(1, Math.round(Number(startLine) || 1)), total)
  const requestedEnd = endLine != null ? Math.round(Number(endLine)) : start + MAX_READ_LINES
  const end = Math.min(Math.max(start + 1, requestedEnd), start + MAX_READ_LINES, total + 1)
  let slice = lines.slice(start - 1, end - 1)
  let numbered = slice.map((line, i) => `${start + i}: ${line}`).join('\n')
  while (Buffer.byteLength(numbered, 'utf8') > MAX_READ_BYTES && slice.length > 1) {
    slice = slice.slice(0, -1)
    numbered = slice.map((line, i) => `${start + i}: ${line}`).join('\n')
  }
  // 单行本身超过 8KB 时按字节截断，保证读取上限不被单行绕过。
  if (Buffer.byteLength(numbered, 'utf8') > MAX_READ_BYTES) {
    const note = '\n…（本行过长，已截断）'
    const budget = MAX_READ_BYTES - Buffer.byteLength(note, 'utf8')
    let cut = ''
    for (const ch of numbered) {
      if (Buffer.byteLength(cut + ch, 'utf8') > budget) break
      cut += ch
    }
    numbered = cut + note
  }
  return {
    ...stateOf(entry, text),
    text: numbered,
    totalLines: total,
    startLine: start,
    endLine: start + slice.length,
  }
}

export function patchDraft(id, startLine, endLine, text) {
  const entry = entryOf(id)
  const current = readText(entry)
  const lines = linesOf(current)
  const start = Math.round(Number(startLine))
  const end = Math.round(Number(endLine))
  if (!Number.isFinite(start) || !Number.isFinite(end)) throw new DraftError('patch 需要 startLine/endLine')
  if (start < 1 || end < start || end > lines.length + 1) {
    throw new DraftError(`patch 行范围越界：${start}-${end}，当前 ${lines.length} 行`)
  }
  const replacement = String(text ?? '')
  if (Buffer.byteLength(replacement, 'utf8') > MAX_WRITE_BYTES) {
    throw new DraftError(`单次替换超过 ${Math.round(MAX_WRITE_BYTES / 1024)}KB 上限`)
  }
  const insert = replacement ? replacement.split('\n') : []
  const nextLines = [...lines.slice(0, start - 1), ...insert, ...lines.slice(end - 1)]
  const next = nextLines.join('\n')
  writeText(entry, next)
  return stateOf(entry, next)
}

export function commitDraft(id) {
  const entry = entryOf(id)
  const text = readText(entry)
  return { ...stateOf(entry, text), code: text }
}

export function draftText(id) {
  const entry = entryOf(id)
  return { ...stateOf(entry, readText(entry)), draft: readText(entry) }
}

export function discardDraft(id) {
  const entry = entryOf(id)
  try {
    fs.rmSync(entry.dir, { recursive: true, force: true })
  } catch {
    /* 清理失败不阻塞会话 */
  }
  drafts.delete(entry.id)
  return { id: entry.id, discarded: true }
}

export function discardAllDrafts() {
  for (const entry of drafts.values()) {
    try {
      fs.rmSync(entry.dir, { recursive: true, force: true })
    } catch {
      /* ignore */
    }
  }
  drafts.clear()
}

/** dev server 启动时清理上次残留的草稿目录。 */
export function sweepStaleDrafts(appRoot, maxAgeMs = 2 * 60 * 60 * 1000) {
  const root = draftsRoot(appRoot)
  if (!fs.existsSync(root)) return 0
  let removed = 0
  for (const project of fs.readdirSync(root)) {
    const projectDir = path.join(root, project)
    let stat
    try {
      stat = fs.lstatSync(projectDir)
    } catch {
      continue
    }
    if (stat.isSymbolicLink()) continue
    if (Date.now() - stat.mtimeMs > maxAgeMs) {
      try {
        fs.rmSync(projectDir, { recursive: true, force: true })
        removed++
      } catch {
        /* ignore */
      }
    }
  }
  return removed
}
