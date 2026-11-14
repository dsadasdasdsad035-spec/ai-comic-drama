// 校验 deploy/merge-env.sh：按 stdin 合并 KEY=VALUE 到 .env，
// 已存在的键被覆盖、未提供的键保留（APIMART 渠道 Key 不能被写空）。
import { execFileSync } from 'node:child_process'
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'

const script = resolve(import.meta.dirname, 'deploy/merge-env.sh')
const dir = mkdtempSync(join(tmpdir(), 'sb-env-'))
const envFile = join(dir, '.env')

const cases = []
function check(name, fn) {
  try {
    fn()
    cases.push({ name, ok: true })
  } catch (e) {
    cases.push({ name, ok: false, message: e.message })
  }
}
function eq(actual, expected, label) {
  if (actual !== expected) throw new Error(`${label}: 期望 ${JSON.stringify(expected)}，实际 ${JSON.stringify(actual)}`)
}

// 首次合并：文件不存在也能创建
writeFileSync(envFile, 'APIMART_API_KEY=sk-old\nARK_API_KEY=ark-old\n')
execFileSync('bash', [script, envFile], {
  input: 'BILLING_TEST_PACK=1\nPROXY_CONF=nginx.conf\n',
})

const read = () => readFileSync(envFile, 'utf8')

check('新增键写入', () => {
  const txt = read()
  eq(txt.includes('BILLING_TEST_PACK=1'), true, 'BILLING_TEST_PACK')
  eq(txt.includes('PROXY_CONF=nginx.conf'), true, 'PROXY_CONF')
})
check('未提供的键保留', () => {
  const txt = read()
  eq(txt.includes('APIMART_API_KEY=sk-old'), true, 'APIMART_API_KEY')
  eq(txt.includes('ARK_API_KEY=ark-old'), true, 'ARK_API_KEY')
})

// 二次合并：已有键被覆盖，且不重复追加
execFileSync('bash', [script, envFile], {
  input: 'BILLING_TEST_PACK=0\nXUNHUPAY_SECRET=abc=def\n',
})
check('已有键覆盖', () => {
  const txt = read()
  eq(txt.includes('BILLING_TEST_PACK=0'), true, 'BILLING_TEST_PACK 覆盖')
  eq(txt.includes('BILLING_TEST_PACK=1'), false, '旧值应消失')
})
check('不重复追加', () => {
  const lines = read().split('\n').filter((l) => l.startsWith('BILLING_TEST_PACK='))
  eq(lines.length, 1, 'BILLING_TEST_PACK 行数')
})
check('值中的等号保留', () => {
  eq(read().includes('XUNHUPAY_SECRET=abc=def'), true, 'XUNHUPAY_SECRET')
})
check('空行与注释被忽略', () => {
  execFileSync('bash', [script, envFile], { input: '\n# 注释\n\n' })
  const txt = read()
  eq(txt.includes('# 注释'), false, '注释不应写入')
})

const failed = cases.filter((c) => !c.ok)
for (const c of cases) console.log(`${c.ok ? '✓' : '✗'} ${c.name}${c.ok ? '' : ' → ' + c.message}`)
if (failed.length) {
  console.error(`deploy/merge-env.sh 校验失败：${failed.length}/${cases.length}`)
  process.exit(1)
}
console.log(`deploy/merge-env.sh 校验通过（${cases.length} 项）`)
