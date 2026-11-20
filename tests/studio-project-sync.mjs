import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { execFileSync } from 'node:child_process'
import {
  bumpStudioProjectRevision,
  readProjectRevision,
  peekStudioProjectLedger,
} from '../server/studio-project-sync.mjs'

const ROOT = path.resolve(import.meta.dirname, '..')
const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'studio-proj-sync-'))
const PROJECT = 'sync-fixture'

const seed = path.join(TMP, 'seed.mjs')
fs.writeFileSync(
  seed,
  `
import { createProject, writeProject } from ${JSON.stringify(path.join(ROOT, 'server', 'db.mjs'))}
createProject(${JSON.stringify(TMP)}, ${JSON.stringify(PROJECT)}, { title: 'sync' })
writeProject(${JSON.stringify(TMP)}, ${JSON.stringify(PROJECT)}, {
  episodes: [{ no: 1, title: '第一集' }],
  shots: [],
})
`,
)
execFileSync(process.execPath, [seed], { cwd: ROOT, env: { ...process.env, SB_PROJECTS_DIR: TMP } })
process.env.SB_PROJECTS_DIR = TMP

const r0 = readProjectRevision(ROOT, PROJECT)
assert.ok(r0 >= 0)
bumpStudioProjectRevision(ROOT, PROJECT)
const led = peekStudioProjectLedger(PROJECT)
assert.ok(led && led.revision === r0, `登记 revision=${led?.revision} 应与库 ${r0} 一致`)
console.log('✅ studio-project-sync 登记与读取')