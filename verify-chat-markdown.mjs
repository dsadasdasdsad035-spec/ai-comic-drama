/**
 * 本变更（chat-markdown-render）的纯函数验收入口。
 *
 * 断言会话消息 Markdown 渲染契约：标题/强调/列表/行内代码/表格滚动容器/
 * 代码块折叠/单换行保留/原始 HTML 不执行。不需要 DOM 或 dev server。
 *
 * 渲染用的是 react-dom/server，所以 esbuild 必须外部化三方包，
 * 并把产物写在仓库内——否则 Node 从 /tmp 起解析不到 node_modules。
 *
 * 跑法：node verify-chat-markdown.mjs
 */
import { execFileSync } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'

const ROOT = process.cwd()
const ESBUILD = path.join(ROOT, 'node_modules', '.bin', 'esbuild')
const TESTS = ['tests/chat-markdown.ts']

const tmp = fs.mkdtempSync(path.join(ROOT, '.verify-chat-md-'))
let failed = 0
for (const test of TESTS) {
  const out = path.join(tmp, `${path.basename(test, '.ts')}.mjs`)
  console.log(`\n=== ${test} ===`)
  try {
    execFileSync(
      ESBUILD,
      [
        test,
        '--bundle',
        '--platform=node',
        '--format=esm',
        '--packages=external',
        '--alias:@=./src',
        '--log-level=warning',
        `--outfile=${out}`,
      ],
      { cwd: ROOT, stdio: 'inherit' },
    )
    execFileSync(process.execPath, [out], { cwd: ROOT, stdio: 'inherit' })
  } catch {
    failed++
  }
}
fs.rmSync(tmp, { recursive: true, force: true })
console.log(failed ? `\n❌ ${failed} 个测试文件失败` : '\n✅ 全部 Markdown 渲染验收通过')
process.exit(failed ? 1 : 0)
