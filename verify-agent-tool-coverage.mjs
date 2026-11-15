/**
 * 本变更（pi-agent-tool-coverage）的纯函数验收总入口。
 *
 * 四类断言各一个文件，互不依赖 dev server：
 * - 清单一致性（含「故意打乱清单必须报错」的否定用例）
 * - 分镜写回字段策略（import / agent）
 * - 剧本按集合并
 * - 破坏性工具与生成工具的 fail-closed
 *
 * 跑法：node verify-agent-tool-coverage.mjs
 */
import { execFileSync } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

const ROOT = process.cwd()
const ESBUILD = path.join(ROOT, 'node_modules', '.bin', 'esbuild')
const TESTS = [
  'tests/platform-tool-coverage.ts',
  'tests/expert-manifests.ts',
  'tests/shot-field-policy.ts',
  'tests/script-writeback.ts',
  'tests/project-lifecycle.ts',
  'tests/platform-generate-tools.ts',
]

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'agent-tool-coverage-'))
let failed = 0
for (const test of TESTS) {
  const out = path.join(tmp, `${path.basename(test, '.ts')}.mjs`)
  console.log(`\n=== ${test} ===`)
  try {
    execFileSync(
      ESBUILD,
      [test, '--bundle', '--platform=node', '--format=esm', '--log-level=warning', `--outfile=${out}`],
      { cwd: ROOT, stdio: 'inherit' },
    )
    execFileSync(process.execPath, [out], { cwd: ROOT, stdio: 'inherit' })
  } catch {
    failed++
  }
}
fs.rmSync(tmp, { recursive: true, force: true })
console.log(failed ? `\n❌ ${failed} 个验收文件失败` : '\n✅ 工具覆盖面验收全部通过')
process.exit(failed ? 1 : 0)
