/**
 * 确认聊天附件模块不再拼参考板。
 * 跑法：node verify-chat-attachments.mjs
 */
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { execFileSync } from 'node:child_process'

const root = path.dirname(fileURLToPath(import.meta.url))
const outDir = fs.mkdtempSync(path.join(root, '.verify-chat-attach-'))
const esbuild = path.join(root, 'node_modules', '.bin', 'esbuild')
const out = path.join(outDir, 'attachments.mjs')
execFileSync(esbuild, [
  path.join(root, 'src/agent/chatAttachments.ts'),
  '--bundle',
  '--platform=node',
  '--format=esm',
  '--log-level=error',
  `--outfile=${out}`,
])
const A = await import(out)

let bad = 0
const check = (n, c, e = '') => {
  console.log(`${c ? '✅' : '❌'} ${n}${e ? ' | ' + e : ''}`)
  if (!c) bad++
}

check('附件上限仍是 4', A.CHAT_ATTACHMENT_LIMIT === 4)
check('不再导出参考板', typeof A.buildReferenceSheet !== 'function')
check('不再导出视觉摘要', typeof A.digestAttachments !== 'function')
const images = A.imageAttachments([
  { key: 'a', kind: 'image', label: '甲', url: '/a.png' },
  { key: 'b', kind: 'video', label: '片', url: '/b.mp4' },
  { key: 'c', kind: 'image', label: '无地址' },
])
check('只留下带地址的图片', images.length === 1 && images[0].key === 'a')

if (bad) process.exit(1)
