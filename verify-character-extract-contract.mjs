/**
 * 「从全局/本集拆角色」的空结果与形状兼容回归。
 *
 * 起因：内容里确实没有具名角色时，模型返回 {"characters":[]}，
 * 而 characters-v1 曾要求至少 1 条，于是被报成「模型输出不符合技能契约」——
 * 用户看到像 bug 的报错，实际是合法的空结果被当成违规。
 *
 * 覆盖：
 * 1) characters-v1 / designs-v1 的空结果不再算违规
 * 2) 顶层数组形状（部分模型省掉外壳）也被接受
 * 3) 真正的坏形状（缺 name、没有 characters/list 键）仍然拒绝
 * 4) 空结果经 pickExtracted / pickExtractedDesigns 得到空列表，交给调用方给友好提示
 *
 * 跑法：node verify-character-extract-contract.mjs
 */
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { execFileSync } from 'node:child_process'

const root = path.dirname(fileURLToPath(import.meta.url))
const outDir = fs.mkdtempSync(path.join(root, '.verify-char-contract-'))
const esbuild = path.join(root, 'node_modules', '.bin', 'esbuild')
const bundle = (entry, name) => {
  const out = path.join(outDir, `${name}.mjs`)
  execFileSync(esbuild, [entry, '--bundle', '--platform=node', '--format=esm', '--log-level=error', `--outfile=${out}`])
  return out
}

let bad = 0
const check = (n, c, e = '') => {
  console.log(`${c ? '✅' : '❌'} ${n}${e ? ' | ' + e : ''}`)
  if (!c) bad++
}

const C = await import(bundle('src/skills/contracts.ts', 'contracts'))
const X = await import(bundle('src/charExtract.ts', 'charExtract'))
const D = await import(bundle('src/designExtract.ts', 'designExtract'))

const oneChar = { name: '陈默', look_en: 'buzz cut, grey jacket, brass hand' }

// ---------------------------------------------------------------- 角色契约
check('characters：正常对象壳通过', C.validateContract('characters-v1', { characters: [oneChar] }).ok)
check(
  'characters：空数组不再算契约违规（原报错来源）',
  C.validateContract('characters-v1', { characters: [] }).ok,
  JSON.stringify(C.validateContract('characters-v1', { characters: [] })),
)
check('characters：顶层数组通过', C.validateContract('characters-v1', [oneChar]).ok)
check('characters：空顶层数组通过', C.validateContract('characters-v1', []).ok)
check('characters：缺 name 仍拒绝', !C.validateContract('characters-v1', { characters: [{ look_en: 'x' }] }).ok)
check('characters：无关形状仍拒绝', !C.validateContract('characters-v1', { list: [] }).ok)

// 空结果经消费方得到空列表 → 调用方给「没给出角色，换个范围再试」
const emptyRes = C.validateContract('characters-v1', { characters: [] })
check('空结果通过校验', emptyRes.ok)
check('空结果经 pickExtracted 为空列表', emptyRes.ok && X.pickExtracted(emptyRes.value).length === 0)
const bareRes = C.validateContract('characters-v1', [oneChar])
check('顶层数组经 pickExtracted 能读到角色', bareRes.ok && X.pickExtracted(bareRes.value).length === 1)

// ---------------------------------------------------------------- 素材契约
check('designs：空结果合法', C.validateContract('designs-v1', { scenes: [], props: [] }).ok)
check('designs：只有场景合法', C.validateContract('designs-v1', { scenes: [{ name: '井道' }], props: [] }).ok)
check('designs：缺 name 仍拒绝', !C.validateContract('designs-v1', { scenes: [{ prompt_en: 'x' }], props: [] }).ok)
const emptyDesigns = C.validateContract('designs-v1', { scenes: [], props: [] })
check('designs：空结果经 pickExtractedDesigns 为空列表', emptyDesigns.ok && D.pickExtractedDesigns(emptyDesigns.value).length === 0)

// ---------------------------------------------------------------- 其它契约不受影响
check('shots-v1 仍要求至少一镜', !C.validateContract('shots-v1', { shots: [] }).ok)
check('prompts-v1 仍要求至少一条', !C.validateContract('prompts-v1', { shots: [] }).ok)
check('script-v1 仍要求至少一集', !C.validateContract('script-v1', { episodes: [] }).ok)

fs.rmSync(outDir, { recursive: true, force: true })
console.log(bad === 0 ? '\n全部通过' : `\n${bad} 项未通过`)
process.exit(bad === 0 ? 0 : 1)
