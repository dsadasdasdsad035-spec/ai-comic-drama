/**
 * 角色长效资产持久化验证（临时库 + 老库升级，不花真实额度）：
 * 1) 老 schema 的 characters 表能自动补列（表情总图/旧表情/音色/试音样本）
 * 2) POST characters 写表情总图 + 8 格裁剪 + 音色后，GET 读回不丢
 * 3) 【模拟刷新】重新起一次 GET（相当于页面 reload 后重新拉项目）仍在
 * 4) 旧 /generated 引用的总图/裁剪/试音样本被迁进项目目录并改写
 * 5) expressions 列是坏 JSON 时不影响项目读取
 * 跑法：node verify-character-media-db.mjs
 */
import { spawn } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { DatabaseSync } from 'node:sqlite'

const ROOT = process.cwd()
const PORT = 5311
const APP = `http://127.0.0.1:${PORT}`
const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'char-media-db-'))
const PROJECT = 'char-media'
const LEGACY_IMAGE = `char-media-legacy-${process.pid}.png`
const LEGACY_AUDIO = `char-media-legacy-${process.pid}.wav`
const PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=',
  'base64',
)

let bad = 0
const check = (name, cond, extra = '') => {
  console.log(`${cond ? '✅' : '❌'} ${name}${extra ? ' | ' + extra : ''}`)
  if (!cond) bad++
}
const api = (p, init) =>
  fetch(`${APP}${p}`, init).then(async (r) => {
    const j = await r.json().catch(() => ({}))
    return { status: r.status, ...j }
  })
const postProject = (body) =>
  api(`/api/project?name=${PROJECT}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
const getProject = () => api(`/api/project?name=${PROJECT}`).then((r) => r.project)

// ---- 0. 造一个「老 schema」库：characters 只有迁移前的 12 列 ----
const legacyDb = new DatabaseSync(path.join(TMP, 'storyboard.sqlite'))
legacyDb.exec(`
CREATE TABLE projects (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL UNIQUE,
  title TEXT DEFAULT '', style TEXT DEFAULT '', aspect TEXT DEFAULT '16:9',
  source TEXT DEFAULT '', logline TEXT DEFAULT '', created_at TEXT, updated_at TEXT
);
CREATE TABLE characters (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  project_id INTEGER NOT NULL,
  name TEXT NOT NULL,
  role TEXT DEFAULT '', age TEXT DEFAULT '', look_cn TEXT DEFAULT '',
  look_en TEXT DEFAULT '', palette TEXT DEFAULT '', keywords TEXT DEFAULT '[]',
  sort INTEGER DEFAULT 0,
  image TEXT DEFAULT '', candidates TEXT DEFAULT '[]', active_idx INTEGER,
  UNIQUE(project_id, name)
);
`)
const now = new Date().toISOString()
legacyDb
  .prepare('INSERT INTO projects (name,title,created_at,updated_at) VALUES (?,?,?,?)')
  .run(PROJECT, '角色资产', now, now)
legacyDb
  .prepare(
    `INSERT INTO characters (project_id,name,role,look_cn,look_en,palette,keywords,sort,image,candidates)
     VALUES (1,?,?,?,?,?,?,?,?,?)`,
  )
  .run('陈默', '主角', '三十出头', 'a lean man with a mechanical left hand', '铁灰', '[]', 0, '', '[]')
legacyDb.close()

// 旧公共产物：迁移时要复制进项目目录
const genDir = path.join(ROOT, 'public', 'generated')
fs.mkdirSync(genDir, { recursive: true })
fs.writeFileSync(path.join(genDir, LEGACY_IMAGE), PNG)
fs.writeFileSync(path.join(genDir, LEGACY_AUDIO), Buffer.alloc(1600))

const child = spawn(
  process.execPath,
  [path.join(ROOT, 'node_modules', 'vite', 'bin', 'vite.js'), '--port', String(PORT), '--strictPort'],
  { cwd: ROOT, env: { ...process.env, SB_PROJECTS_DIR: TMP }, stdio: 'ignore' },
)

const cleanup = () => {
  try {
    child.kill('SIGTERM')
  } catch {
    /* ignore */
  }
  fs.rmSync(TMP, { recursive: true, force: true })
  fs.rmSync(path.join(genDir, LEGACY_IMAGE), { force: true })
  fs.rmSync(path.join(genDir, LEGACY_AUDIO), { force: true })
}
process.on('exit', cleanup)

const waitServer = async () => {
  for (let i = 0; i < 120; i++) {
    try {
      const r = await fetch(`${APP}/api/health`)
      if (r.ok) return true
    } catch {
      /* retry */
    }
    await new Promise((r) => setTimeout(r, 120))
  }
  return false
}

const sheet = (image, cropUrl) => ({
  image,
  columns: 4,
  rows: 2,
  source: 'generated',
  fingerprint: 'a lean man with a mechanical left hand|铁灰',
  modelKey: 'seedream-test',
  createdAt: now,
  cells: ['neutral', 'happy', 'sad', 'angry', 'fearful', 'disgusted', 'surprised', 'calm'].map(
    (emotion, i) => ({
      emotion,
      x: (i % 4) * 0.25,
      y: Math.floor(i / 4) * 0.5,
      w: 0.25,
      h: 0.5,
      cropUrl,
      cropFingerprint: `crop-${emotion}`,
    }),
  ),
})

try {
  if (!(await waitServer())) throw new Error(`dev server 未启动（${PORT}）`)

  // ---- 1. 老库自动补列 ----
  const upgraded = new DatabaseSync(path.join(TMP, 'storyboard.sqlite'))
  const cols = new Set(upgraded.prepare('PRAGMA table_info(characters)').all().map((r) => r.name))
  upgraded.close()
  const needed = [
    'expressions',
    'expression_sheet',
    'voice',
    'voice_provider',
    'voice_model_key',
    'voice_sample',
  ]
  check('老库自动补列', needed.every((c) => cols.has(c)), needed.filter((c) => !cols.has(c)).join(','))
  check('老角色行仍可读', (await getProject()).characters.length === 1)

  // ---- 2. 写入表情总图 + 音色，GET 读回 ----
  const localSheet = `/project-assets/${PROJECT}/char-expr-sheet.png`
  const localCrop = `/project-assets/${PROJECT}/char-expr-neutral.png`
  const payload = {
    characters: [
      {
        name: '陈默',
        role: '主角',
        look_cn: '三十出头',
        look_en: 'a lean man with a mechanical left hand',
        palette: '铁灰',
        keywords: [],
        voice: 'male-qn-qingse',
        voice_provider: 'minimax',
        voice_model_key: 'speech-2.8-hd',
        expression_sheet: sheet(localSheet, localCrop),
        voice_sample: {
          url: `/project-assets/${PROJECT}/sample.wav`,
          text: '试音',
          seconds: 5,
          engine: 'minimax',
          voiceId: 'male-qn-qingse',
          modelKey: 'speech-2.8-hd',
          fingerprint: 'fp-1',
        },
      },
    ],
  }
  const saved = await postProject(payload)
  check('POST characters 成功', saved.ok === true, saved.message || '')
  const c1 = (await getProject()).characters[0]
  check('表情总图读回', c1.expression_sheet?.image === localSheet, String(c1.expression_sheet?.image))
  check(
    '八格裁剪读回',
    c1.expression_sheet?.cells?.length === 8 &&
      c1.expression_sheet.cells.every((cell) => cell.cropUrl === localCrop),
    `cells=${c1.expression_sheet?.cells?.length}`,
  )
  check('裁剪指纹保留', c1.expression_sheet?.cells?.[0]?.cropFingerprint === 'crop-neutral')
  check('总图指纹保留', c1.expression_sheet?.fingerprint === payload.characters[0].expression_sheet.fingerprint)
  check('音色 id 读回', c1.voice === 'male-qn-qingse', String(c1.voice))
  check('音色渠道读回', c1.voice_provider === 'minimax' && c1.voice_model_key === 'speech-2.8-hd')
  check('试音样本读回', c1.voice_sample?.url.endsWith('/sample.wav') && c1.voice_sample?.seconds === 5)

  // ---- 3. 模拟刷新：再拉一次仍是同一份（不是只在第一次响应里带回来） ----
  const c2 = (await getProject()).characters[0]
  check(
    '模拟刷新后仍在',
    c2.expression_sheet?.image === localSheet && c2.voice_sample?.url === c1.voice_sample?.url,
    String(c2.expression_sheet?.image),
  )

  // 反证：DB 里确实落了这一列，而不是从别处拼出来的
  const raw = new DatabaseSync(path.join(TMP, 'storyboard.sqlite'))
  const row = raw.prepare('SELECT expression_sheet, voice, voice_sample FROM characters').get()
  raw.close()
  check('DB expression_sheet 非空', Boolean(row?.expression_sheet), String(row?.expression_sheet || '').slice(0, 40))
  check('DB voice 非空', row?.voice === 'male-qn-qingse', String(row?.voice))
  check('DB voice_sample 非空', Boolean(row?.voice_sample))

  // ---- 4. 旧 /generated 引用迁移到项目目录 ----
  const legacy = await postProject({
    characters: [
      {
        ...payload.characters[0],
        expression_sheet: sheet(`/generated/${LEGACY_IMAGE}`, `/generated/${LEGACY_IMAGE}`),
        voice_sample: {
          ...payload.characters[0].voice_sample,
          url: `/generated/${LEGACY_AUDIO}`,
        },
      },
    ],
  })
  check('写入旧引用成功', legacy.ok === true, legacy.message || '')
  const c3 = (await getProject()).characters[0]
  const sheetUrl = c3.expression_sheet?.image || ''
  const cropUrl = c3.expression_sheet?.cells?.[0]?.cropUrl || ''
  check(
    '总图迁进项目目录',
    sheetUrl.startsWith(`/project-assets/${PROJECT}/`),
    sheetUrl,
  )
  check('裁剪格迁进项目目录', cropUrl.startsWith(`/project-assets/${PROJECT}/`) && !cropUrl.startsWith('/generated/'), cropUrl)
  check(
    '试音样本迁进项目目录',
    (c3.voice_sample?.url || '').startsWith(`/project-assets/${PROJECT}/`),
    c3.voice_sample?.url || '',
  )
  const migratedFile = path.join(TMP, PROJECT, 'assets', decodeURIComponent(sheetUrl.split('/').pop()))
  check('迁移后的文件真的存在', fs.existsSync(migratedFile), path.basename(migratedFile))

  // ---- 5. 脏 JSON 不影响读取 ----
  const dirty = new DatabaseSync(path.join(TMP, 'storyboard.sqlite'))
  dirty.prepare('UPDATE characters SET expressions = ?').run('{not json')
  dirty.close()
  const c4 = await getProject()
  check('坏 expressions 不炸读取', c4.characters.length === 1, String(c4.message || ''))
  check('坏行不影响其他字段', c4.characters[0].expression_sheet?.image === sheetUrl)
} catch (e) {
  check('脚本异常', false, e.message)
} finally {
  cleanup()
}

console.log(bad ? `\n${bad} 项失败` : '\n全部通过')
process.exit(bad ? 1 : 0)
