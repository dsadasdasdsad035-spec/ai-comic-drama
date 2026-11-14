/**
 * verify-paths.mjs — 媒体根解析
 *
 * 覆盖：默认回退 public/、SB_MEDIA_ROOT 生效、../ 穿越被拒、ensureMediaDir 建目录。
 * 用法：node verify-paths.mjs
 */
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { ensureMediaDir, mediaPath, mediaPathFromUrl, resolveMediaRoot, resolveStaticRoot } from './server/paths.mjs'

const appRoot = process.cwd()
const results = []
function check(name, fn) {
  try {
    fn()
    results.push({ name, ok: true })
  } catch (e) {
    results.push({ name, ok: false, message: e.message })
  }
}

const originalEnv = process.env.SB_MEDIA_ROOT

check('未设 SB_MEDIA_ROOT 时回退 public/', () => {
  delete process.env.SB_MEDIA_ROOT
  assert.equal(resolveMediaRoot(appRoot), path.join(appRoot, 'public'))
  assert.equal(mediaPath(appRoot, 'generated', 'a.png'), path.join(appRoot, 'public', 'generated', 'a.png'))
})

check('SB_MEDIA_ROOT 生效', () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'sb-media-'))
  process.env.SB_MEDIA_ROOT = tmp
  assert.equal(resolveMediaRoot(appRoot), path.resolve(tmp))
  assert.equal(mediaPath(appRoot, 'videos', 'b.mp4'), path.join(tmp, 'videos', 'b.mp4'))
  // 只读资产根不受媒体根影响
  assert.equal(resolveStaticRoot(appRoot), path.join(appRoot, 'public'))
})

check('路径穿越被拒', () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'sb-media-'))
  process.env.SB_MEDIA_ROOT = tmp
  assert.throws(() => mediaPath(appRoot, '..', 'evil.txt'), /越界/)
  assert.throws(() => mediaPath(appRoot, 'generated', '..', '..', 'evil.txt'), /越界/)
  assert.throws(() => mediaPathFromUrl(appRoot, '/../../etc/passwd'), /越界/)
})

check('ensureMediaDir 创建目录', () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'sb-media-'))
  process.env.SB_MEDIA_ROOT = tmp
  const dir = ensureMediaDir(appRoot, 'exports', 'ep1')
  assert.ok(fs.existsSync(dir))
  assert.ok(fs.statSync(dir).isDirectory())
})

if (originalEnv === undefined) delete process.env.SB_MEDIA_ROOT
else process.env.SB_MEDIA_ROOT = originalEnv

let failed = 0
for (const r of results) {
  if (r.ok) console.log(`  ok   ${r.name}`)
  else {
    failed++
    console.log(`  FAIL ${r.name}\n       ${r.message}`)
  }
}
console.log(`\n${results.length - failed}/${results.length} passed`)
process.exit(failed ? 1 : 0)
