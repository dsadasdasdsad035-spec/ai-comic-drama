/**
 * 创意外壳测试（第 6 组）：容器收敛、主题桥、日间对比度、导航稳定性。
 *
 * 这里断言的是「这一层自己负责的东西」：
 * - 创意视图只渲染 StudioFrame，旧的三列壳/托盘/卡片模块已不存在；
 * - 主题映射函数真的把 `--dsw-*` 与明暗标记写到宿主文档上；
 * - 日间 token 组合的对比度 ≥ 4.5:1；
 * - 容器样式不会把外壳导航挤出原位（不出现 fixed / 全局 token 改写）。
 */
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { build as esbuild } from 'esbuild'

const ROOT = path.resolve(import.meta.dirname, '..')
const APP = fs.readFileSync(path.join(ROOT, 'src/App.tsx'), 'utf8')
const THEME_CSS = fs.readFileSync(path.join(ROOT, 'src/theme.css'), 'utf8')
const FRAME = fs.readFileSync(path.join(ROOT, 'src/creative/StudioFrame.tsx'), 'utf8')

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

/* ---------------------------------------------------------------- 6.1 容器收敛 */

await check('创意视图只渲染 StudioFrame', async () => {
  const start = APP.indexOf(") : view === 'creative' ? (")
  const end = APP.indexOf(") : view === 'account' ? (")
  assert.ok(start > 0 && end > start, '找不到创意分支')
  const branch = APP.slice(start, end)
  assert.match(branch, /<StudioFrame \/>/)
  for (const forbidden of ['CreativeStudio', 'CapabilityTray', 'CreativeCards', 'CreativeComposerBar', 'CreativeArtifacts']) {
    assert.ok(!branch.includes(forbidden), `创意分支还在渲染 ${forbidden}`)
  }
})

await check('旧的创意专属模块已删除', async () => {
  const removed = [
    'CreativeStudio.tsx',
    'CapabilityTray.tsx',
    'CreativeCards.tsx',
    'CreativeComposerBar.tsx',
    'CreativeSessionList.tsx',
    'CreativeMessageParts.tsx',
    'CreativeArtifacts.tsx',
    'CreativeHeader.tsx',
    'CreativeEmpty.tsx',
  ]
  for (const name of removed) {
    assert.ok(!fs.existsSync(path.join(ROOT, 'src/creative', name)), `${name} 还在`)
  }
  assert.ok(!fs.existsSync(path.join(ROOT, 'src/settings/ExpertSettingsPanel.tsx')), '专家设置页还在')
})

await check('没有任何模块再引用已删除的创意模块', async () => {
  const walk = (dir) => {
    const out = []
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const p = path.join(dir, entry.name)
      if (entry.isDirectory()) out.push(...walk(p))
      else if (/\.(ts|tsx)$/.test(entry.name)) out.push(p)
    }
    return out
  }
  const forbidden = [
    'creative/CreativeStudio',
    'creative/CapabilityTray',
    'creative/CreativeCards',
    'creative/CreativeComposerBar',
    'creative/CreativeSessionList',
    'creative/expertTools',
    'creative/creativeTurnPayload',
    'settings/ExpertSettingsPanel',
  ]
  for (const file of walk(path.join(ROOT, 'src'))) {
    const text = fs.readFileSync(file, 'utf8')
    for (const token of forbidden) {
      assert.ok(!text.includes(token), `${path.relative(ROOT, file)} 仍在引用 ${token}`)
    }
  }
})

/* ---------------------------------------------------------------- 6.2 主题桥 */

const entry = path.join(ROOT, '.tmp-studio-frame-test.ts')
// React 在 data: URL 里解析不到：用一个只提供「建 context」所需 API 的桩，
// 我们只要 applyStudioTheme 这个纯函数，不渲染任何组件。
const reactShim = path.join(ROOT, '.tmp-react-shim.mjs')
const jsxRuntimeShim = path.join(ROOT, '.tmp-react-jsx-shim.mjs')
fs.writeFileSync(
  jsxRuntimeShim,
  [
    'export const jsx = () => null',
    'export const jsxs = () => null',
    'export const Fragment = Symbol("Fragment")',
  ].join('\n'),
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
fs.writeFileSync(entry, `export { applyStudioTheme } from './src/creative/StudioFrame'`)
let applyStudioTheme
try {
  const out = await esbuild({
    entryPoints: [entry],
    bundle: true,
    format: 'esm',
    platform: 'browser',
    write: false,
    logLevel: 'error',
    alias: { react: reactShim, 'react/jsx-runtime': jsxRuntimeShim, 'react/jsx-dev-runtime': jsxRuntimeShim },
    jsx: 'transform',
    jsxFactory: 'createElement',
    jsxFragment: 'Fragment',
  })
  const mod = await import(`data:text/javascript;base64,${Buffer.from(out.outputFiles[0].text).toString('base64')}`)
  applyStudioTheme = mod.applyStudioTheme
} finally {
  fs.rmSync(entry, { force: true })
  fs.rmSync(reactShim, { force: true })
  fs.rmSync(jsxRuntimeShim, { force: true })
}

function fakeDoc() {
  const vars = new Map()
  const attrs = new Map()
  return {
    vars,
    attrs,
    documentElement: {
      style: {
        colorScheme: '',
        setProperty(name, value) {
          vars.set(name, value)
        },
      },
    },
    body: {
      setAttribute(name, value) {
        attrs.set(name, value)
      },
      removeAttribute(name) {
        attrs.delete(name)
      },
    },
  }
}

await check('夜间主题写入宿主变量与暗色标记', async () => {
  const doc = fakeDoc()
  applyStudioTheme(doc, 'night')
  assert.equal(doc.vars.get('--dsw-alias-bg-base'), '#070b11')
  assert.equal(doc.vars.get('--dsw-alias-brand-primary'), '#38bdf8')
  assert.equal(doc.documentElement.style.colorScheme, 'dark')
  assert.ok(doc.attrs.has('data-ds-dark-theme'), '没有打暗色标记')
})

await check('日间主题翻转变量并去掉暗色标记', async () => {
  const doc = fakeDoc()
  applyStudioTheme(doc, 'night')
  applyStudioTheme(doc, 'day')
  assert.equal(doc.vars.get('--dsw-alias-bg-base'), '#f4f1ea')
  assert.equal(doc.documentElement.style.colorScheme, 'light')
  assert.ok(!doc.attrs.has('data-ds-dark-theme'), '日间仍带着暗色标记')
})

await check('壳在 iframe 首帧前就铺好底色（不闪错主题）', async () => {
  assert.match(THEME_CSS, /\.studio-frame-iframe\s*\{[^}]*background:\s*var\(--bg\)/s)
  assert.match(THEME_CSS, /\.studio-frame\s*\{[^}]*background:\s*var\(--bg\)/s)
  // 主题变化要重新同步，不能只在 onLoad 跑一次
  assert.match(FRAME, /useEffect\(\(\) => \{\s*syncTheme\(\)/s)
})

/* ---------------------------------------------------------------- 6.3 对比度 */

function parseTokens(block) {
  const out = new Map()
  for (const m of block.matchAll(/(--[a-z0-9-]+):\s*([^;]+);/gi)) out.set(m[1], m[2].trim())
  return out
}

function srgbToLinear(c) {
  const v = c / 255
  return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4
}

function luminance(hex) {
  const m = /^#([0-9a-f]{6})$/i.exec(hex.trim())
  if (!m) throw new Error(`不是可计算的十六进制色：${hex}`)
  const n = parseInt(m[1], 16)
  const r = (n >> 16) & 255
  const g = (n >> 8) & 255
  const b = n & 255
  return 0.2126 * srgbToLinear(r) + 0.7152 * srgbToLinear(g) + 0.0722 * srgbToLinear(b)
}

function contrast(a, b) {
  const la = luminance(a)
  const lb = luminance(b)
  const [hi, lo] = la > lb ? [la, lb] : [lb, la]
  return (hi + 0.05) / (lo + 0.05)
}

function blockFor(selector) {
  // 注释里也有花括号，先去掉注释再定位，否则切出来的是半截块
  const css = THEME_CSS.replace(/\/\*[\s\S]*?\*\//g, '')
  const idx = css.indexOf(selector)
  assert.ok(idx >= 0, `找不到样式块 ${selector}`)
  const open = css.indexOf('{', idx)
  const close = css.indexOf('}', open)
  return css.slice(open + 1, close)
}

const day = parseTokens(blockFor("html[data-theme='day'] {"))
const night = parseTokens(blockFor(':root {'))

await check('日间关键文字对比度 ≥ 4.5:1', async () => {
  const pairs = [
    ['--text', '--bg'],
    ['--text', '--panel'],
    ['--text-2', '--panel'],
    ['--muted', '--panel'],
    ['--muted', '--bg'],
  ]
  for (const [fg, bg] of pairs) {
    const ratio = contrast(day.get(fg), day.get(bg))
    assert.ok(ratio >= 4.5, `${fg} on ${bg} 只有 ${ratio.toFixed(2)}:1`)
  }
})

await check('夜间关键文字对比度 ≥ 4.5:1', async () => {
  const pairs = [
    ['--text', '--bg'],
    ['--text', '--panel'],
    ['--text-2', '--panel'],
    ['--muted', '--panel'],
    ['--muted', '--bg'],
  ]
  for (const [fg, bg] of pairs) {
    const ratio = contrast(night.get(fg), night.get(bg))
    assert.ok(ratio >= 4.5, `${fg} on ${bg} 只有 ${ratio.toFixed(2)}:1`)
  }
})

await check('工具卡片标签与时间戳用的 muted 在两种主题都达标', async () => {
  for (const [name, tokens] of [
    ['day', day],
    ['night', night],
  ]) {
    for (const bg of ['--panel', '--panel-2', '--bg-2']) {
      const ratio = contrast(tokens.get('--muted'), tokens.get(bg))
      assert.ok(ratio >= 4.5, `${name}: muted on ${bg} 只有 ${ratio.toFixed(2)}:1`)
    }
  }
})

/* ---------------------------------------------------------------- 6.4 导航稳定性 */

function rulesFor(selector) {
  const out = []
  let from = 0
  for (;;) {
    const idx = THEME_CSS.indexOf(selector, from)
    if (idx < 0) break
    const open = THEME_CSS.indexOf('{', idx)
    const close = THEME_CSS.indexOf('}', open)
    out.push(THEME_CSS.slice(open + 1, close))
    from = close
  }
  return out
}

await check('容器不改外壳定位（不出现 fixed 与全局 token 覆写）', async () => {
  const rules = [...rulesFor('.studio-frame'), ...rulesFor('.studio-frame-iframe')]
  assert.ok(rules.length >= 2, '找不到容器样式')
  for (const body of rules) {
    assert.ok(!/position:\s*fixed/.test(body), '容器用了 fixed，会把导航挤走')
    assert.ok(!/^\s*--/m.test(body), '容器在改全局 token，会连带改变外壳配色')
  }
  // 覆盖层只相对容器定位，因此不会占掉导航的位置
  const overlay = rulesFor('.studio-frame-loading')
  assert.ok(
    overlay.some((body) => /position:\s*absolute/.test(body)),
    '加载/错误覆盖层不是相对容器定位',
  )
})

await check('导航结构不依赖创意视图（外壳包住内容槽）', async () => {
  const shell = fs.readFileSync(path.join(ROOT, 'src/App.tsx'), 'utf8')
  const studio = shell.indexOf('<StudioFrame />')
  const shellStart = shell.lastIndexOf('<AppShell', studio)
  assert.ok(shellStart > 0, 'StudioFrame 不在 AppShell 内')
  // 导航由 AppShell 自己渲染，创意视图只是 children
  const nav = fs.readFileSync(path.join(ROOT, 'src/shell/AppShell.tsx'), 'utf8')
  assert.match(nav, /\{children\}/)
  assert.ok(!nav.includes('studio-frame'), '外壳不该知道创意容器的样式')
})

if (bad) {
  console.error(`\n${bad} 项未通过`)
  process.exit(1)
}
console.log('\n创意外壳测试全部通过')
process.exit(0)
