/**
 * reverse-v1 契约与两个创意技能文件的单元验收。
 * 跑法：node verify-creative-reverse-contract.mjs
 */
import { execFileSync } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

const ROOT = process.cwd()
const ESBUILD = path.join(ROOT, 'node_modules', '.bin', 'esbuild')
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'creative-contract-'))
const out = path.join(tmp, 'creative-contract.mjs')

try {
  execFileSync(ESBUILD, [
    'tests/creative-contract.ts',
    '--bundle',
    '--platform=node',
    '--format=esm',
    '--log-level=warning',
    `--outfile=${out}`,
  ], { cwd: ROOT, stdio: 'inherit' })
  execFileSync(process.execPath, [out], { cwd: ROOT, stdio: 'inherit' })
} catch {
  fs.rmSync(tmp, { recursive: true, force: true })
  process.exit(1)
}
fs.rmSync(tmp, { recursive: true, force: true })
