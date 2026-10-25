/**
 * 技能/聊天单元测试总入口：用 esbuild 打包 tests/*.ts 后逐个运行。
 * 跑法：node verify-skills-unit.mjs
 */
import { execFileSync } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

const ROOT = process.cwd()
const ESBUILD = path.join(ROOT, 'node_modules', '.bin', 'esbuild')
const TESTS = [
  'tests/skill-prompts.ts',
  'tests/skill-parser.ts',
  'tests/skill-migration.ts',
  'tests/drafts.ts',
  'tests/stage-runtime.ts',
  'tests/chat-model.ts',
  'tests/stage-agent.ts',
  'tests/creative-contract.ts',
  'tests/creative-tools.ts',
  'tests/publish-chat.ts',
]
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'skill-unit-'))
let failed = 0
for (const test of TESTS) {
  const out = path.join(tmp, `${path.basename(test, '.ts')}.mjs`)
  console.log(`\n=== ${test} ===`)
  try {
    execFileSync(ESBUILD, [
      test,
      '--bundle',
      '--platform=node',
      '--format=esm',
      '--log-level=warning',
      `--outfile=${out}`,
    ], { cwd: ROOT, stdio: 'inherit' })
    execFileSync(process.execPath, [out], { cwd: ROOT, stdio: 'inherit' })
  } catch {
    failed++
  }
}
fs.rmSync(tmp, { recursive: true, force: true })
console.log(failed ? `\n❌ ${failed} 个测试文件失败` : '\n✅ 全部单元测试通过')
process.exit(failed ? 1 : 0)
