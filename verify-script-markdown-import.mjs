/**
 * 分集剧本 Markdown 导入纯函数验收。
 * 跑法：node verify-script-markdown-import.mjs
 */
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { execFileSync } from 'node:child_process'

const root = path.dirname(fileURLToPath(import.meta.url))
const outDir = fs.mkdtempSync(path.join(root, '.verify-script-md-'))
const esbuild = path.join(root, 'node_modules', '.bin', 'esbuild')
const out = path.join(outDir, 'script-markdown-import.mjs')

execFileSync(esbuild, [
  path.join(root, 'tests/script-markdown-import.ts'),
  '--bundle',
  '--platform=node',
  '--format=esm',
  '--log-level=error',
  `--outfile=${out}`,
])

execFileSync(process.execPath, [out], { stdio: 'inherit', cwd: root })
console.log('verify-script-markdown-import: all green')