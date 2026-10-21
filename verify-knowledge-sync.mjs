/**
 * 校验：技能守则是否真的拼进四段 system 提示词，且 TS / Python 两侧一字不差。
 *
 * 为什么不能 grep 源码：提示词是模板字符串拼接，靠肉眼核对必然漏。
 * 这里用 esbuild 把 TS 打成临时 mjs 后真实 import，再拼 Python 的输出做逐字 diff。
 *
 * 跑法：node verify-knowledge-sync.mjs
 */
import { execFileSync } from 'node:child_process'
import { mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const dir = mkdtempSync(join(tmpdir(), 'kbsync-'))
const out = join(dir, 'prompts.mjs')
execFileSync('node_modules/.bin/esbuild', ['src/prompts.ts', '--bundle', '--format=esm', '--outfile=' + out], {
  stdio: 'inherit',
})
const TS = await import('file://' + out)

const py = execFileSync(
  '/Users/mjy/.workbuddy/binaries/python/versions/3.13.12/bin/python3',
  [
    '-c',
    `import sys, json; sys.path.insert(0, '../manga-pipeline')
import prompts as P
print(json.dumps({k: getattr(P, k) for k in ['SCRIPT_SYS','CHARACTER_SYS','STORYBOARD_SYS','PROMPT_SYS']}, ensure_ascii=False))`,
  ],
  { encoding: 'utf8' },
)
const PY = JSON.parse(py)

const MARKS = {
  STORYBOARD_SYS: '【转接与运镜硬规则】',
  PROMPT_SYS: '【词汇与参数规范】',
  SCRIPT_SYS: '【场景要素提取',
  CHARACTER_SYS: '【一致性铁律',
}

let bad = 0
for (const [k, mark] of Object.entries(MARKS)) {
  const t = TS[k] || ''
  const p = PY[k] || ''
  const hasMark = t.includes(mark)
  const same = t === p
  if (!hasMark || !same) bad++
  console.log(
    `${hasMark && same ? '✅' : '❌'} ${k.padEnd(15)} TS ${String(t.length).padStart(5)} 字符 | PY ${String(
      p.length,
    ).padStart(5)} 字符 | 守则 ${hasMark ? '已注入' : '缺失'} | 两侧 ${same ? '一字不差' : '不一致'}`,
  )
}

// 剧本环节的强度/基调字段必须落到输出契约里
const scriptHasFields = TS.SCRIPT_SYS.includes('"intensity"') && TS.SCRIPT_SYS.includes('"tone"')
console.log(`${scriptHasFields ? '✅' : '❌'} SCRIPT_SYS 输出契约含 intensity / tone`)
if (!scriptHasFields) bad++

process.exit(bad ? 1 : 0)
