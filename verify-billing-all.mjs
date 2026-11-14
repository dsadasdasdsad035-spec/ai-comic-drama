import { spawnSync } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const root = path.dirname(fileURLToPath(import.meta.url))
const scripts = fs
  .readdirSync(root)
  .filter((f) => /^verify-billing-.+\.mjs$/.test(f) && f !== 'verify-billing-all.mjs')
  .sort()

let bad = 0
for (const s of scripts) {
  const r = spawnSync(process.execPath, [path.join(root, s)], { stdio: 'inherit' })
  if (r.status !== 0) bad++
}
process.exit(bad ? 1 : 0)