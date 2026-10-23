/**
 * 代码优先 3D：选择/指纹纯函数 + project shots.extra 持久化回归。
 * 跑法：先 npm run dev -- --port 5280，再 APP_URL=http://127.0.0.1:5280 node verify-code-api.mjs
 */
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { execFileSync } from 'node:child_process'

const URL = process.env.APP_URL || 'http://127.0.0.1:5280'
const STAMP = Date.now()
const A = `vcodea-${STAMP}`
const B = `vcodeb-${STAMP}`
const root = path.dirname(fileURLToPath(import.meta.url))
const tmp = fs.mkdtempSync(path.join(root, '.verify-code-api-'))
const esbuild = path.join(root, 'node_modules', '.bin', 'esbuild')
let bad = 0
const check = (name, cond, extra = '') => {
  console.log(`${cond ? '✅' : '❌'} ${name}${extra ? ` | ${extra}` : ''}`)
  if (!cond) bad++
}

const entry = path.join(tmp, 'entry.ts')
fs.writeFileSync(
  entry,
  `export * from ${JSON.stringify(path.join(root, 'src/shot3dContext.ts'))}\n` +
    `export * from ${JSON.stringify(path.join(root, 'src/sceneCodeFingerprint.ts'))}\n`,
)
const bundle = path.join(tmp, 'bundle.mjs')
execFileSync(esbuild, [entry, '--bundle', '--platform=node', '--format=esm', '--log-level=error', `--outfile=${bundle}`])
const lib = await import(bundle)

const dialogue = 'A：第一句\nB：第二句\nA：第三句'
const lines = lib.parseDialogueLines(dialogue)
check('台词逐句解析', lines.length === 3 && lines[1].speaker === 'B' && lines[1].index === 1)
const hash = lib.dialogueHashOf(dialogue)
const ctx = lib.defaultShot3DContext({
  characterIds: ['chenmo', 'chenmo', 'crow'],
  imageUrls: ['/generated/a.jpg', '/generated/a.jpg'],
  dialogueHash: hash,
})
check('默认选择去重', ctx.characterIds.length === 2 && ctx.imageUrls.length === 1)
check('逐句选择只返回选中行', lib.selectedDialogue({ ...ctx, text: { ...ctx.text, dialogue: [1] } }, dialogue)[0]?.text === '第二句')
check('台词变化重置逐句', lib.inheritShot3DContext({ ...ctx, text: { ...ctx.text, dialogue: [1] } }, 'changed').text.dialogue === 'all')
const assets = [
  { key: 'image:a', kind: 'image', contentHash: '111' },
  { key: 'character:b', kind: 'image', contentHash: '222' },
]
const fp1 = lib.sceneCodeFingerprint({ codeHash: 'abc', abiVersion: 1, assets, duration: 3, aspect: '16:9', mode: 'clean' })
const fp2 = lib.sceneCodeFingerprint({ codeHash: 'abc', abiVersion: 1, assets: [...assets].reverse(), duration: 3, aspect: '16:9', mode: 'clean' })
check('指纹与素材顺序无关', fp1 === fp2)
check('指纹随时长变化', fp1 !== lib.sceneCodeFingerprint({ codeHash: 'abc', abiVersion: 1, assets, duration: 4, aspect: '16:9', mode: 'clean' }))
const codeHash = await lib.codeHashOf('function init() {}\nfunction renderAt() {}\nfunction dispose() {}')
check('代码哈希稳定且为 SHA-256', codeHash.length === 64 && codeHash === (await lib.codeHashOf('function init() {}\nfunction renderAt() {}\nfunction dispose() {}')))

const api = async (p, init) => (await fetch(`${URL}${p}`, init)).json()
const create = async (name) => {
  const r = await api(`/api/project?name=${encodeURIComponent(name)}&create=1`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ title: name }),
  })
  if (!r.ok) throw new Error(r.message || 'create failed')
}
await create(A)
await create(B)

const code = {
  version: 1,
  abiVersion: 1,
  code: 'function init(ctx) {}\nfunction renderAt(t, mode) {}\nfunction dispose() {}',
  codeHash,
  source: 'ai',
  motionNote: '镜头缓慢前推，冷色顶光',
  updatedAt: '2026-10-22T00:00:00.000Z',
}
const selection = {
  ...ctx,
  designIds: ['scene-1'],
  sceneKeys: ['E01-SC02'],
  assetUrls: ['/generated/prop.jpg'],
  videoUrls: ['/videos/a.mp4'],
  updatedAt: '2026-10-22T00:00:00.000Z',
}
const meta = {
  version: 1,
  fingerprint: fp1,
  codeHash,
  abiVersion: 1,
  assets: [{ key: 'image:a', url: '/generated/a.jpg', kind: 'image', source: 'image', label: '首帧', contentHash: '111' }],
  duration: 3,
  aspect: '16:9',
  width: 960,
  height: 540,
  fps: 30,
  mode: 'clean',
  renderedAt: '2026-10-22T00:00:00.000Z',
}
const legacyScene = {
  id: 'E01-S01', episode: 1, sceneNo: 1, w: 10, h: 8, walls: [], props: [], zones: [], source: 'legacy',
}
const legacyBlocking = {
  keys: [{ t: 0, actors: [], camera: { x: 0.5, y: 0.9, lookX: 0.5, lookY: 0.5, height: 1.6, fov: 45 } }],
  source: 'legacy',
}
const shot = {
  id: 'E01-S01',
  episode: 1,
  no: 'S01',
  seconds: 3,
  size: '中景',
  move: '推',
  keyframe_prompt: '井道尽头，冷光',
  cast: ['陈默'],
  scene_code: code,
  scene_code_meta: meta,
  shot_3d_context: selection,
  shot_scene: legacyScene,
  shot_blocking: legacyBlocking,
  motion_note: code.motionNote,
}
const saved = await api(`/api/project?name=${encodeURIComponent(A)}`, {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ shots: [shot] }),
})
check('保存代码镜头成功', saved.ok, saved.message || '')
const got = await api(`/api/project?name=${encodeURIComponent(A)}`)
const loaded = got.project?.shots?.find((s) => s.id === 'E01-S01')
check('重新读取代码镜头', Boolean(loaded))
check('scene_code 完整', JSON.stringify(loaded?.scene_code) === JSON.stringify(code), JSON.stringify(loaded?.scene_code))
check('scene_code_meta 完整', JSON.stringify(loaded?.scene_code_meta) === JSON.stringify(meta))
check('shot_3d_context 完整', JSON.stringify(loaded?.shot_3d_context) === JSON.stringify(selection))
check('旧 shot_scene 保留', JSON.stringify(loaded?.shot_scene) === JSON.stringify(legacyScene))
check('旧 shot_blocking 保留', JSON.stringify(loaded?.shot_blocking) === JSON.stringify(legacyBlocking))
check('motion_note 保留', loaded?.motion_note === code.motionNote)

const other = await api(`/api/project?name=${encodeURIComponent(B)}`)
check('项目隔离：B 没有 A 的镜头', !(other.project?.shots ?? []).some((s) => s.id === 'E01-S01'))

// 更新只动代码，选择/旧字段仍在
code.code = `${code.code}\n// changed`
code.codeHash = await lib.codeHashOf(code.code)
await api(`/api/project?name=${encodeURIComponent(A)}`, {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ shots: [{ ...shot, scene_code: code }] }),
})
const again = await api(`/api/project?name=${encodeURIComponent(A)}`)
const changed = again.project?.shots?.find((s) => s.id === 'E01-S01')
check('更新代码后选择仍在', JSON.stringify(changed?.shot_3d_context) === JSON.stringify(selection))
check('更新代码后旧结构化仍在', Boolean(changed?.shot_scene && changed?.shot_blocking))

fs.rmSync(tmp, { recursive: true, force: true })
console.log(bad ? `\n${bad} failed` : '\nall passed')
process.exit(bad ? 1 : 0)
