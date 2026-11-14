/**
 * verify-paths.mjs — 媒体根与运行期状态根解析
 *
 * 覆盖：默认回退 public/、SB_MEDIA_ROOT 生效、../ 穿越被拒、ensureMediaDir 建目录；
 *      默认回退 appRoot、SB_STATE_ROOT 生效、状态根穿越被拒、ensureStateDir 建目录。
 * 用法：node verify-paths.mjs
 */
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import {
  ensureMediaDir,
  ensureStateDir,
  mediaPath,
  mediaPathFromUrl,
  resolveMediaRoot,
  resolveStateRoot,
  resolveStaticRoot,
  statePath,
} from './server/paths.mjs'

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

// ---------------------------------------------------------------- 运行期状态根

const originalStateEnv = process.env.SB_STATE_ROOT

check('未设 SB_STATE_ROOT 时回退 appRoot', () => {
  delete process.env.SB_STATE_ROOT
  assert.equal(resolveStateRoot(appRoot), path.resolve(appRoot))
  assert.equal(statePath(appRoot, '.agent-jobs', 'a1'), path.join(appRoot, '.agent-jobs', 'a1'))
})

check('SB_STATE_ROOT 生效且与媒体根互不影响', () => {
  const stateTmp = fs.mkdtempSync(path.join(os.tmpdir(), 'sb-state-'))
  const mediaTmp = fs.mkdtempSync(path.join(os.tmpdir(), 'sb-media-'))
  process.env.SB_STATE_ROOT = stateTmp
  process.env.SB_MEDIA_ROOT = mediaTmp
  assert.equal(resolveStateRoot(appRoot), path.resolve(stateTmp))
  assert.equal(statePath(appRoot, '.scene-drafts'), path.join(stateTmp, '.scene-drafts'))
  // 设了状态根不会把媒体根一起带走
  assert.equal(resolveMediaRoot(appRoot), path.resolve(mediaTmp))
  // 反过来：清掉媒体根后仍回退 public/，不受状态根影响
  delete process.env.SB_MEDIA_ROOT
  assert.equal(resolveMediaRoot(appRoot), path.join(appRoot, 'public'))
  process.env.SB_MEDIA_ROOT = mediaTmp
})

check('状态根路径穿越被拒', () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'sb-state-'))
  process.env.SB_STATE_ROOT = tmp
  assert.throws(() => statePath(appRoot, '..', 'evil.txt'), /越界/)
  assert.throws(() => statePath(appRoot, '.agent-jobs', '..', '..', 'evil.txt'), /越界/)
  // 看起来像绝对路径的段会被 path.join 中和到状态根内，而不是落到 /etc
  const neutralized = statePath(appRoot, '/etc/passwd')
  assert.ok(neutralized.startsWith(path.resolve(tmp) + path.sep), `必须中和到状态根内：${neutralized}`)
})

check('ensureStateDir 创建目录', () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'sb-state-'))
  process.env.SB_STATE_ROOT = tmp
  const dir = ensureStateDir(appRoot, '.blender-jobs', 'job1')
  assert.ok(fs.existsSync(dir))
  assert.ok(fs.statSync(dir).isDirectory())
  assert.ok(dir.startsWith(path.resolve(tmp) + path.sep), '目录必须落在状态根内')
})

if (originalStateEnv === undefined) delete process.env.SB_STATE_ROOT
else process.env.SB_STATE_ROOT = originalStateEnv

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
