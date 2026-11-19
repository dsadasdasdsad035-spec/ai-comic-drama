/**
 * 宿主入口解析、失败语义与版本自检的回归测试。
 *
 * 这里锁死四件事：
 * 1. 三级优先级：显式覆盖 > 源码构建产物 > 已安装包；
 * 2. 三种不可用原因的文案互不相同，且各自带对应补救命令；
 * 3. 版本自检能区分「一致 / 不一致 / 读不到」；
 * 4. 宿主跳过的 bundle 能按 profile 清单核出缺失项。
 *
 * 全部用临时目录伪造，不依赖真实宿主安装。
 */
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import {
  collectSkippedBundles,
  createCreativeHost,
  dshEntryFailureMessage,
  dshEntryPaths,
  dshVersionIssue,
  expectedDshVersion,
  isDshInstalled,
  missingExpectedBundles,
  resolveDshEntry,
  resolveDshEntryInfo,
} from '../server/creative-host.mjs'
import { expectedBundles, profileDir } from '../server/dsh-bundle.mjs'

let bad = 0
function check(name, fn) {
  try {
    fn()
    console.log(`✅ ${name}`)
  } catch (e) {
    bad += 1
    console.error(`❌ ${name}\n   ${e?.message || e}`)
  }
}

const PINNED = '0.2.2-rc.5'

function fakeRoot() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'dsh-entry-'))
}

function writeRootManifest(root, version = PINNED) {
  fs.writeFileSync(
    path.join(root, 'package.json'),
    JSON.stringify({ name: 'app', dependencies: { '@deepseek-ai/dsh': version } }),
  )
}

/** 造源码树：built=false 时只留 apps/cli/package.json，没有 lib/bin.js */
function makeSource(root, { built = true, version = PINNED } = {}) {
  const dir = path.join(root, 'deepseek-harness', 'apps', 'cli')
  fs.mkdirSync(path.join(dir, 'lib'), { recursive: true })
  fs.writeFileSync(
    path.join(dir, 'package.json'),
    JSON.stringify({ name: '@deepseek-ai/dsh', version }),
  )
  if (built) fs.writeFileSync(path.join(dir, 'lib', 'bin.js'), '// stub\n')
}

function makePackage(root, { version = PINNED } = {}) {
  const dir = path.join(root, 'node_modules', '@deepseek-ai', 'dsh')
  fs.mkdirSync(path.join(dir, 'lib'), { recursive: true })
  fs.writeFileSync(
    path.join(dir, 'package.json'),
    JSON.stringify({ name: '@deepseek-ai/dsh', version }),
  )
  fs.writeFileSync(path.join(dir, 'lib', 'bin.js'), '// stub\n')
}

const roots = []
function root(fn) {
  const dir = fakeRoot()
  roots.push(dir)
  fn(dir)
  return dir
}

check('显式覆盖优先于源码与安装包', () => {
  const dir = root((d) => {
    makeSource(d)
    makePackage(d)
  })
  const info = resolveDshEntryInfo(dir, { DSH_ENTRY: '/opt/dsh/bin.js' })
  assert.equal(info.source, 'override')
  assert.equal(info.entry, '/opt/dsh/bin.js')
})

check('源码构建产物优先于已安装包', () => {
  const dir = root((d) => {
    makeSource(d)
    makePackage(d)
  })
  const info = resolveDshEntryInfo(dir, {})
  assert.equal(info.source, 'source')
  assert.equal(info.entry, dshEntryPaths(dir).sourceEntry)
  assert.equal(resolveDshEntry(dir, {}), dshEntryPaths(dir).sourceEntry)
})

check('源码未构建时回退已安装包并留下提示', () => {
  const dir = root((d) => {
    makeSource(d, { built: false })
    makePackage(d)
  })
  const info = resolveDshEntryInfo(dir, {})
  assert.equal(info.source, 'package')
  assert.equal(info.note, 'source-unbuilt-fallback')
})

check('三种不可用原因互不相同且各带补救命令', () => {
  const uninitialized = root((d) => fs.mkdirSync(path.join(d, 'deepseek-harness')))
  const unbuilt = root((d) => {
    makeSource(d, { built: false })
  })
  const nothing = root(() => {})

  const a = resolveDshEntryInfo(uninitialized, {})
  const b = resolveDshEntryInfo(unbuilt, {})
  const c = resolveDshEntryInfo(nothing, {})
  assert.equal(a.reason, 'source-uninitialized')
  assert.equal(b.reason, 'source-unbuilt')
  assert.equal(c.reason, 'missing')

  const messageA = dshEntryFailureMessage(uninitialized, a)
  const messageB = dshEntryFailureMessage(unbuilt, b)
  const messageC = dshEntryFailureMessage(nothing, c)
  assert.notEqual(messageA, messageB)
  assert.notEqual(messageB, messageC)
  assert.notEqual(messageA, messageC)

  assert.match(messageA, /submodule update --init/)
  assert.match(messageB, /build:dsh/)
  assert.match(messageC, /npm ci/)
  assert.match(messageC, /未安装创意会话宿主/)

  assert.equal(isDshInstalled(uninitialized, {}), false)
})

check('版本一致时不报问题', () => {
  const dir = root((d) => {
    makeSource(d)
    writeRootManifest(d)
  })
  const info = resolveDshEntryInfo(dir, {})
  assert.equal(expectedDshVersion(dir), PINNED)
  assert.equal(dshVersionIssue(info.entry, expectedDshVersion(dir)), null)
})

check('版本不一致时给出双方版本', () => {
  const dir = root((d) => {
    makeSource(d, { version: '0.2.1-alpha.2' })
    writeRootManifest(d, PINNED)
  })
  const info = resolveDshEntryInfo(dir, {})
  const issue = dshVersionIssue(info.entry, expectedDshVersion(dir))
  assert.ok(issue, '应报告不一致')
  assert.match(issue, /0\.2\.1-alpha\.2/)
  assert.match(issue, new RegExp(PINNED.replace(/\./g, '\\.')))
})

check('读不到版本时严格模式报错、宽松模式放行', () => {
  const dir = root((d) => fs.mkdirSync(d, { recursive: true }))
  const entry = path.join(dir, 'missing', 'lib', 'bin.js')
  assert.match(dshVersionIssue(entry, PINNED, { strict: true }), /无法确认/)
  assert.equal(dshVersionIssue(entry, PINNED, { strict: false }), null)
})

check('跳过日志能解析出去重后的 bundle 名', () => {
  const text = [
    'dsh: skipping profile bundle "@deepseek-ai/dsh-web-app": not found',
    'dsh: skipping profile bundle "dsh-plugin-creative-tools": no dsh.bundle',
    'dsh: skipping profile bundle "@deepseek-ai/dsh-web-app": not found',
    'dsh web: http://127.0.0.1:1234/?token=x',
  ].join('\n')
  assert.deepEqual(collectSkippedBundles(text), [
    '@deepseek-ai/dsh-web-app',
    'dsh-plugin-creative-tools',
  ])
})

check('缺失项只报预期清单里的那些', () => {
  const expected = ['@deepseek-ai/dsh-base', '@deepseek-ai/dsh-web-app', 'dsh-plugin-creative-tools']
  const skipped = ['@deepseek-ai/dsh-web-app', 'some-platform-only-bundle']
  assert.deepEqual(missingExpectedBundles(expected, skipped), ['@deepseek-ai/dsh-web-app'])
  assert.deepEqual(missingExpectedBundles(expected, []), [])
})

check('profile 清单能读出声明的 bundle 层', () => {
  const dshHome = fakeRoot()
  roots.push(dshHome)
  fs.mkdirSync(profileDir(dshHome), { recursive: true })
  fs.writeFileSync(
    path.join(profileDir(dshHome), 'package.json'),
    JSON.stringify({
      name: 'dsh-profile-web',
      dsh: { profile: { bundles: ['@deepseek-ai/dsh-base', 'dsh-plugin-creative-tools'] } },
    }),
  )
  assert.deepEqual(expectedBundles(dshHome), [
    '@deepseek-ai/dsh-base',
    'dsh-plugin-creative-tools',
  ])
  assert.deepEqual(expectedBundles(path.join(dshHome, 'nowhere')), [])
})

// 3.3：入口不可用时 start() 必须是「返回 false + 可读错误」，不能抛异常
const hostCases = [
  ['源码未初始化', (d) => fs.mkdirSync(path.join(d, 'deepseek-harness')), /submodule update --init/],
  ['源码未构建', (d) => makeSource(d, { built: false }), /build:dsh/],
  ['两者都没有', () => {}, /npm ci/],
]
await Promise.all(hostCases.map(async ([label, populate, expected]) => {
  await check(`入口不可用时 start 不抛异常：${label}`, async () => {
    const dir = fakeRoot()
    roots.push(dir)
    populate(dir)
    const host = createCreativeHost({ root: dir, dshHome: dir, log: () => {} })
    assert.equal(await host.start(), false)
    const status = host.status()
    assert.equal(status.state, 'failed')
    assert.equal(status.installed, false)
    assert.match(status.error, expected)
  })
}))

for (const dir of roots) fs.rmSync(dir, { recursive: true, force: true })

console.log(bad ? `\n❌ ${bad} 项失败` : '\n✅ 宿主入口解析测试通过')
process.exit(bad ? 1 : 0)
