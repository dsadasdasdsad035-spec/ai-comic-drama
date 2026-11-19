/**
 * 专家变更判据（creative-experts 的「变更判据覆盖 persona 与白名单内容」）。
 *
 * 旧实现把签名拼成 `id:工具数:技能数:是否通配`，于是改 soul、或用同数量的
 * 工具/技能替换时签名完全不变——界面显示已保存，宿主却继续跑旧 persona。
 * 这类失效没有任何报错，只能靠契约钉住。
 *
 * 跑法：`node tests/studio-expert-signature.mjs`
 */
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { expertFingerprint, writeExpertsPatch } from '../server/dsh-experts.mjs'
import { dbPath } from '../server/db.mjs'

const ROOT = path.resolve(import.meta.dirname, '..')
const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'expert-sig-'))
// 自定义专家的「家」是 `<状态根>/dsh/experts`：把状态根也指到临时目录，
// 否则测试会往真实仓库里写专家，且不同用例互相污染。
process.env.SB_STATE_ROOT = TMP
// 专家集合来自设置库 + 仓库 experts/：开真库，保证 listAllExperts 走真实链路
dbPath(TMP)

let bad = 0
async function check(name, fn) {
  try {
    await fn()
    console.log(`✅ ${name}`)
  } catch (e) {
    bad += 1
    console.error(`❌ ${name}\n   ${e?.message || e}`)
  }
}

/** 最小专家：只包含参与指纹的字段 */
function expert(overrides = {}) {
  return {
    id: 'sig-demo',
    name: '签名演示',
    description: '用于验证指纹',
    soul: '你是分镜助理。',
    skillIds: ['skill-a', 'skill-b'],
    toolIds: ['read_source', 'read_shots'],
    ...overrides,
  }
}

const base = expertFingerprint(expert())

await check('同样的内容得到同样的指纹', () => {
  assert.equal(expertFingerprint(expert()), base, '未改动时不应误判为变化')
  // 白名单顺序不同但内容相同：不能因为数组顺序触发重启
  assert.equal(
    expertFingerprint(expert({ skillIds: ['skill-b', 'skill-a'], toolIds: ['read_shots', 'read_source'] })),
    base,
    '白名单顺序不应影响指纹',
  )
})

await check('改 soul 必定改变指纹', () => {
  const next = expertFingerprint(expert({ soul: '你是分镜助理！' }))
  assert.notEqual(next, base, 'soul 改一个字符也必须触发重同步')
})

await check('同数量替换工具必须改变指纹', () => {
  const next = expertFingerprint(expert({ toolIds: ['read_source', 'submit_shots'] }))
  assert.notEqual(next, base, '工具数量不变但内容变了，旧实现会漏掉')
})

await check('同数量替换技能必须改变指纹', () => {
  const next = expertFingerprint(expert({ skillIds: ['skill-a', 'skill-c'] }))
  assert.notEqual(next, base, '技能数量不变但内容变了，旧实现会漏掉')
})

await check('改名或改说明也参与指纹', () => {
  assert.notEqual(expertFingerprint(expert({ name: '签名演示 2' })), base, '显示名会出现在 preset 上')
  assert.notEqual(expertFingerprint(expert({ description: '换一句说明' })), base, '说明会出现在 preset 上')
})

await check('不影响 preset 的字段不参与指纹', () => {
  const withIcon = expertFingerprint(
    expert({ iconUrl: '/api/experts/sig-demo/icon', imageDescription: '一张图', source: 'custom' }),
  )
  assert.equal(withIcon, base, '图标与来源不影响 preset，算进去会造成无意义重启')
})

await check('通配与显式列表区分开', () => {
  assert.notEqual(expertFingerprint(expert({ skillIds: ['*'] })), base, '通配是另一种白名单语义')
})

await check('缺字段或不合法输入不抛错', () => {
  assert.doesNotThrow(() => expertFingerprint({}))
  assert.doesNotThrow(() => expertFingerprint(null))
  // 非数组的白名单按空处理，而不是 TypeError
  assert.doesNotThrow(() => expertFingerprint({ id: 'x', skillIds: 'oops', toolIds: null }))
})

await check('writeExpertsPatch 返回整批签名', () => {
  const dshHome = fs.mkdtempSync(path.join(TMP, 'dsh-'))
  const registeredNames = ['read_source', 'read_shots', 'list_experts', 'list_installed_skills']
  const first = writeExpertsPatch({ dshHome, root: ROOT, registeredNames })
  assert.equal(typeof first.signature, 'string')
  assert.ok(first.compiled.length > 0, '至少要编译出仓库内置专家')
  // 每行都要带指纹，签名才能拼出来
  for (const row of first.compiled) {
    assert.match(row.fingerprint, /^[0-9a-f]{16}$/, `${row.id} 缺少内容指纹`)
  }
  // 签名必须覆盖每个专家：格式为 `id@fingerprint` 的排序拼接
  const expected = first.compiled
    .map((row) => `${row.id}@${row.fingerprint}`)
    .sort()
    .join(',')
  assert.equal(first.signature, expected, '签名应与编译结果严格对应')

  // 再算一次：内容没变，签名必须稳定（否则每次保存都会重启宿主）
  const second = writeExpertsPatch({ dshHome, root: ROOT, registeredNames })
  assert.equal(second.signature, first.signature, '内容未变时签名必须一致')
})

await check('新增专家会改变整批签名', () => {
  const dshHome = fs.mkdtempSync(path.join(TMP, 'dsh-add-'))
  const registeredNames = ['read_source', 'read_shots', 'list_experts', 'list_installed_skills']
  const before = writeExpertsPatch({ dshHome, root: ROOT, registeredNames })
  // 自定义专家要落在 `<状态根>/dsh/experts/<id>`，listAllExperts 才读得到
  const dir = path.join(TMP, 'dsh', 'experts', 'sig-added')
  fs.mkdirSync(dir, { recursive: true })
  fs.writeFileSync(
    path.join(dir, 'manifest.json'),
    `${JSON.stringify({ id: 'sig-added', name: '新增专家', skillIds: [], toolIds: [] }, null, 2)}\n`,
    'utf8',
  )
  fs.writeFileSync(path.join(dir, 'soul.md'), '你是新增专家。', 'utf8')
  try {
    const after = writeExpertsPatch({ dshHome, root: ROOT, registeredNames })
    assert.notEqual(after.signature, before.signature, '专家增删必须改变签名')
    assert.ok(after.compiled.some((row) => row.id === 'sig-added'))
  } finally {
    fs.rmSync(dir, { recursive: true, force: true })
  }
})

if (bad > 0) {
  console.error(`\n❌ 专家指纹测试失败 ${bad} 项`)
  process.exit(1)
}
console.log('\n✅ 专家变更指纹测试全部通过')
