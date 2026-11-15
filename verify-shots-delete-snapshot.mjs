/**
 * 镜头级删除快照验收（服务端，无浏览器）。
 *
 * 背景：「清空画布」从"只删画布节点"改成"真删当前集镜头"。删镜头不可撤销，
 * 所以服务端必须在删除前把会被删掉的镜头写进快照；写不进去就不能删。
 *
 * 断言点：
 * 1) 带 deleteShotIds 的 POST 会在 <项目根>/.deleted 留下 shots-<项目>-<时间>.json；
 * 2) 快照内容只含真正被删掉的镜头（传进来但不存在的 id 不进快照）；
 * 3) 快照里有 deletedAt / kind / project，能和项目快照区分；
 * 4) 删除确实生效，且指向被删镜头的 transition_out 被清（含跨集边界）；
 * 5) 快照写不进去时整次请求失败，项目镜头一个不少（fail-closed）；
 * 6) 没有 deleteShotIds 的普通写入不产生镜头快照。
 *
 * 跑法：node verify-shots-delete-snapshot.mjs
 */
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { DELETED_DIR, writeShotsSnapshot } from './server/project-lifecycle.mjs'

const root = path.dirname(fileURLToPath(import.meta.url))
let bad = 0
const check = (name, cond, extra = '') => {
  console.log(`${cond ? '✅' : '❌'} ${name}${extra ? ` | ${extra}` : ''}`)
  if (!cond) bad++
}

const work = fs.mkdtempSync(path.join(os.tmpdir(), 'verify-shots-snapshot-'))

/** 快照目录里的镜头快照 */
const shotSnaps = () => {
  const dir = path.join(work, DELETED_DIR)
  if (!fs.existsSync(dir)) return []
  return fs
    .readdirSync(dir)
    .filter((f) => f.startsWith('shots-') && f.endsWith('.json'))
    .map((f) => ({ file: f, full: path.join(dir, f) }))
}

const shot = (ep, no, extra = {}) => ({
  id: `E${String(ep).padStart(2, '0')}-${no}`,
  episode: ep,
  no,
  scene_no: 1,
  scene_slug: 'SC01',
  seconds: 3,
  size: '中景',
  move: '固定',
  desc: `第 ${ep} 集 ${no}`,
  dialogue: [],
  cast: [],
  keyframe_prompt: '雨夜街头',
  video_prompt: '雨夜街头，推镜头',
  ...extra,
})

// ---------------------------------------------------------------- 纯函数层：快照文件
const doomed = [shot(1, 'S01'), shot(1, 'S02')]
const file = writeShotsSnapshot(work, 'proj-a', doomed)
const parsed = JSON.parse(fs.readFileSync(file, 'utf8'))
check('快照文件名带 shots- 前缀', path.basename(file).startsWith('shots-proj-a-'), path.basename(file))
check('快照落在 .deleted 目录', path.dirname(file) === path.join(work, DELETED_DIR), path.dirname(file))
check('快照标记 kind=shots', parsed.kind === 'shots', String(parsed.kind))
check('快照记录项目名', parsed.project === 'proj-a', String(parsed.project))
check('快照含被删镜头', Array.isArray(parsed.shots) && parsed.shots.length === 2, String(parsed.shots?.length))
check('快照有删除时间', typeof parsed.deletedAt === 'string' && parsed.deletedAt.length > 10, parsed.deletedAt)
check('快照保留镜头业务字段', parsed.shots[0]?.keyframe_prompt === '雨夜街头', parsed.shots[0]?.keyframe_prompt)

// 项目名不合法要拒绝（safeProjectName 是校验不是转义），绝不能写到 .deleted 之外
let badNameThrew = false
try {
  writeShotsSnapshot(work, '../../escape', [shot(1, 'S01')])
} catch {
  badNameThrew = true
}
check('非法项目名被拒绝而不是写到目录外', badNameThrew)

// ---------------------------------------------------------------- 写失败要抛错
const blocked = path.join(work, 'blocked')
fs.mkdirSync(path.join(blocked, DELETED_DIR, 'occupied.json.tmp'), { recursive: true })
// 让目录变成只读，模拟写不进去
let threw = false
try {
  fs.chmodSync(path.join(blocked, DELETED_DIR), 0o500)
  writeShotsSnapshot(blocked, 'p', [shot(1, 'S01')])
} catch {
  threw = true
} finally {
  try {
    fs.chmodSync(path.join(blocked, DELETED_DIR), 0o700)
  } catch {
    /* 恢复失败不影响断言 */
  }
}
check('快照写失败会抛错（调用方据此拒绝删除）', threw)

// ---------------------------------------------------------------- 接口层
const PORT = 5396
const APP = `http://127.0.0.1:${PORT}`
const PROJECT = 'snap-proj'
const child = (await import('node:child_process')).spawn(
  process.execPath,
  [path.join(root, 'node_modules', 'vite', 'bin', 'vite.js'), '--port', String(PORT), '--strictPort'],
  { cwd: root, env: { ...process.env, SB_PROJECTS_DIR: work }, stdio: 'ignore' },
)
const api = async (p, init) => {
  const r = await fetch(`${APP}${p}`, init)
  return { status: r.status, body: await r.json().catch(() => ({})) }
}

try {
  for (let i = 0; i < 80; i++) {
    try {
      const r = await fetch(`${APP}/api/health`)
      if (r.ok) break
    } catch {
      /* 等 vite 起来 */
    }
    await new Promise((r) => setTimeout(r, 400))
  }

  await api(`/api/project?name=${encodeURIComponent(PROJECT)}&create=1`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ title: PROJECT, aspect: '16:9' }),
  })
  // E02-S01 指向 E01-S02：验证跨集边界转场会被清理
  const seed = [
    shot(1, 'S01'),
    shot(1, 'S02'),
    shot(1, 'S03', { transition_out: { type: 'cut', to: 'E01-S04' } }),
    shot(2, 'S01', { transition_out: { type: 'fade', to: 'E01-S02' } }),
    shot(2, 'S02'),
  ]
  await api(`/api/project?name=${encodeURIComponent(PROJECT)}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      source: '镜头快照验收',
      style: '写实',
      aspect: '16:9',
      episodes: [
        { no: 1, title: 'EP1' },
        { no: 2, title: 'EP2' },
      ],
      characters: [],
      shots: seed,
      designs: [],
    }),
  })

  // 普通写入不产生镜头快照
  const beforeSnaps = shotSnaps().length
  await api(`/api/project?name=${encodeURIComponent(PROJECT)}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ shots: [shot(1, 'S01', { desc: '改过的描述' })] }),
  })
  check('普通写入不产生镜头快照', shotSnaps().length === beforeSnaps, `${beforeSnaps} -> ${shotSnaps().length}`)

  // 删除 E01 全部镜头，并混入一个不存在的 id
  const del = await api(`/api/project?name=${encodeURIComponent(PROJECT)}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ deleteShotIds: ['E01-S01', 'E01-S02', 'E01-S03', 'E01-NOPE'] }),
  })
  check('删除请求成功', del.body.ok === true, JSON.stringify(del.body).slice(0, 120))

  const snaps = shotSnaps()
  check('删除后产生一份镜头快照', snaps.length === beforeSnaps + 1, `${snaps.length}`)
  const latest = JSON.parse(fs.readFileSync(snaps[snaps.length - 1].full, 'utf8'))
  const ids = (latest.shots ?? []).map((s) => s.id).sort()
  check('快照只含真正被删的 3 镜', ids.join(',') === 'E01-S01,E01-S02,E01-S03', ids.join(','))
  check('快照不含不存在的 id', !ids.includes('E01-NOPE'))

  const after = (await api(`/api/project?name=${encodeURIComponent(PROJECT)}`)).body.project?.shots ?? []
  check('E01 镜头已删除', !after.some((s) => Number(s.episode) === 1), after.map((s) => s.id).join(','))
  check('E02 镜头不受影响', after.filter((s) => Number(s.episode) === 2).length === 2, after.map((s) => s.id).join(','))

  const e2 = after.find((s) => s.id === 'E02-S01')
  check('跨集边界转场被清理', !e2?.transition_out?.to, JSON.stringify(e2?.transition_out ?? null))
  const e1s03Gone = !after.some((s) => s.id === 'E01-S03')
  check('指向被删镜头的同集转场随镜头一起消失', e1s03Gone)

  // ---------------------------------------------------------------- fail-closed
  // 把 .deleted 换成同名文件：目录建不出来，快照必失败
  const delDir = path.join(work, DELETED_DIR)
  fs.rmSync(delDir, { recursive: true, force: true })
  fs.writeFileSync(delDir, 'not a dir')
  const beforeFail = (await api(`/api/project?name=${encodeURIComponent(PROJECT)}`)).body.project?.shots ?? []
  const failed = await api(`/api/project?name=${encodeURIComponent(PROJECT)}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ deleteShotIds: ['E02-S01', 'E02-S02'] }),
  })
  check('快照失败时请求报错', failed.body.ok === false, JSON.stringify(failed.body).slice(0, 160))
  check('快照失败提示点名快照', /快照/.test(String(failed.body.message ?? '')), String(failed.body.message ?? '').slice(0, 120))
  const afterFail = (await api(`/api/project?name=${encodeURIComponent(PROJECT)}`)).body.project?.shots ?? []
  check(
    '快照失败时镜头一个不少',
    JSON.stringify(afterFail.map((s) => s.id).sort()) === JSON.stringify(beforeFail.map((s) => s.id).sort()),
    afterFail.map((s) => s.id).join(','),
  )
} finally {
  child.kill('SIGTERM')
  fs.rmSync(work, { recursive: true, force: true })
}

console.log(bad === 0 ? '\n全部通过' : `\n${bad} 项失败`)
process.exit(bad === 0 ? 0 : 1)
