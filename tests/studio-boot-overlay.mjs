/**
 * 加载期宿主启动页遮罩（creative-dsh-host 的「加载期呈现应用自有加载态」）。
 *
 * 这里约束三件在浏览器里才看得出、但在代码里可以钉死的事：
 * 1. 同源文档上真的插进了一条 `[data-dsh-boot]` 隐藏规则；
 * 2. 跨源/只读文档上失败要静默退化，绝不能把加载流程抛断；
 * 3. 错误态必须撤掉遮罩——用户需要看到宿主的真实失败报告。
 *
 * 跑法：`node tests/studio-boot-overlay.mjs`
 */
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { build as esbuild } from 'esbuild'

const ROOT = path.resolve(import.meta.dirname, '..')

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

/* ------------------------------------------------ 把 StudioFrame 的纯函数取出来 */

const tmp = fs.mkdtempSync(path.join(ROOT, '.verify-boot-'))
const entry = path.join(tmp, 'entry.ts')
const reactShim = path.join(tmp, 'react.mjs')
const jsxShim = path.join(tmp, 'jsx.mjs')
fs.writeFileSync(
  jsxShim,
  ['export const jsx = () => null', 'export const jsxs = () => null', 'export const Fragment = Symbol("Fragment")'].join(
    '\n',
  ),
)
fs.writeFileSync(
  reactShim,
  [
    'export const createElement = () => null',
    'export const createContext = (v) => ({ value: v, Provider: ({ children }) => children })',
    'export const useContext = (c) => c.value',
    'export const useCallback = (fn) => fn',
    'export const useEffect = () => {}',
    'export const useMemo = (fn) => fn()',
    'export const useRef = (v) => ({ current: v })',
    'export const useState = (v) => [v, () => {}]',
    'export default { createElement, createContext, useContext, useCallback, useEffect, useMemo, useRef, useState }',
  ].join('\n'),
)
fs.writeFileSync(
  entry,
  `export { shouldSuppressHostBoot, bootHideStyleText, installBootHideStyle, removeHostBootStyle, hostFailureDetail, HOST_BOOT_ATTR, BOOT_HIDE_STYLE_ID } from '${path.join(ROOT, 'src/creative/StudioFrame').replace(/\\/g, '/')}'`,
)

let mod
try {
  const out = await esbuild({
    entryPoints: [entry],
    bundle: true,
    format: 'esm',
    platform: 'browser',
    write: false,
    logLevel: 'error',
    alias: { react: reactShim, 'react/jsx-runtime': jsxShim, 'react/jsx-dev-runtime': jsxShim },
    jsx: 'transform',
    jsxFactory: 'createElement',
    jsxFragment: 'Fragment',
  })
  mod = await import(`data:text/javascript;base64,${Buffer.from(out.outputFiles[0].text).toString('base64')}`)
} finally {
  fs.rmSync(tmp, { recursive: true, force: true })
}

/* ---------------------------------------------------------------- 假文档 */

/** 足够小的文档替身：只实现遮罩真正用到的接口 */
function fakeDoc({ failOnAppend = false, throwOnGet = false } = {}) {
  const nodes = []
  const doc = {
    head: {
      appendChild(node) {
        if (failOnAppend) throw new Error('文档只读')
        nodes.push(node)
      },
    },
    documentElement: { appendChild: (node) => nodes.push(node) },
    readyState: 'loading',
    createElement(tag) {
      return {
        tag,
        id: '',
        textContent: '',
        remove() {
          const i = nodes.indexOf(this)
          if (i >= 0) nodes.splice(i, 1)
        },
      }
    },
    getElementById(id) {
      if (throwOnGet) throw new Error('跨源文档不可访问')
      return nodes.find((n) => n.id === id) ?? null
    },
    _nodes: nodes,
  }
  return doc
}

/* ---------------------------------------------------------------- 断言 */

await check('加载期才隐藏宿主启动页', () => {
  assert.equal(mod.shouldSuppressHostBoot('loading'), true)
  assert.equal(mod.shouldSuppressHostBoot('error'), false, '错误态必须放行，否则唯一线索被抹掉')
})

await check('同源文档：注入成功且只注入一次', () => {
  const doc = fakeDoc()
  assert.equal(mod.installBootHideStyle(doc), true)
  const style = doc._nodes.find((n) => n.id === mod.BOOT_HIDE_STYLE_ID)
  assert.ok(style, '应插入一条隐藏样式')
  assert.equal(style.tag, 'style')
  assert.match(style.textContent, /\[data-dsh-boot\]/, '选择器必须用宿主启动页的稳定标记')
  assert.match(style.textContent, /display:\s*none/, '必须真的隐藏')

  // 轮询会重复调用：不能越插越多
  assert.equal(mod.installBootHideStyle(doc), true)
  assert.equal(
    doc._nodes.filter((n) => n.id === mod.BOOT_HIDE_STYLE_ID).length,
    1,
    '重复调用不应插入第二条',
  )
})

await check('跨源或只读文档：静默退化，不抛错', () => {
  assert.equal(mod.installBootHideStyle(null), false)
  assert.equal(mod.installBootHideStyle(undefined), false)
  assert.equal(mod.installBootHideStyle(fakeDoc({ throwOnGet: true })), false)
  assert.equal(mod.installBootHideStyle(fakeDoc({ failOnAppend: true })), false)
  // 撤样式同样不能抛
  assert.equal(mod.removeHostBootStyle(null), false)
  assert.equal(mod.removeHostBootStyle(fakeDoc({ throwOnGet: true })), false)
})

await check('错误态撤掉遮罩', () => {
  const doc = fakeDoc()
  mod.installBootHideStyle(doc)
  assert.equal(doc._nodes.length, 1)
  assert.equal(mod.removeHostBootStyle(doc), true)
  assert.equal(doc._nodes.length, 0, '错误态不应再留着隐藏样式')
  // 没装过时撤也是安全的
  assert.equal(mod.removeHostBootStyle(doc), false)
})

await check('失败摘要只取尾部若干行', () => {
  const log = Array.from({ length: 40 }, (_, i) => `line-${i}`).join('\n')
  const detail = mod.hostFailureDetail({ log })
  const lines = detail.split('\n')
  assert.equal(lines.length, 12, '截到 12 行，避免错误页变成终端')
  assert.equal(lines.at(-1), 'line-39', '必须保留最后一行（真正的原因通常在这里）')
  assert.equal(mod.hostFailureDetail({}), '')
  assert.equal(mod.hostFailureDetail(null), '')
  assert.equal(mod.hostFailureDetail({ error: '启动失败' }), '启动失败', '没有日志时用 error 兜底')
})

await check('样式文本只针对启动页，不波及其它节点', () => {
  const text = mod.bootHideStyleText()
  assert.equal(text.trim(), `[${mod.HOST_BOOT_ATTR}]{display:none !important}`)
  assert.ok(!/body|html/.test(text), '不应命中 body/html，否则整页都会消失')
})

if (bad > 0) {
  console.error(`\n❌ 启动页遮罩测试失败 ${bad} 项`)
  process.exit(1)
}
console.log('\n✅ 启动页遮罩测试全部通过')
