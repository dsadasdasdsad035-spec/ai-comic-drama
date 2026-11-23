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
  assert.ok(start > 0, '找不到创意分支')
  // 结束标记不能钉死某个具体分支：`account` 视图删掉后这条断言就整体失效了。
  // 取创意分支之后的下一个 `) : view === ` 三元分支作为边界。
  const nextBranch = APP.slice(start + 1).search(/\) : view === '/)
  assert.ok(nextBranch > 0, '找不到创意分支的结束位置')
  const branch = APP.slice(start, start + 1 + nextBranch)
  // 只认组件本身：props 会随上下文增删（例如 projectName），不影响这条断言
  assert.match(branch, /<StudioFrame\b[^>]*\/>/)
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
  // 专家管理面板是应用侧的能力（`creative-expert-settings-pane` 起恢复），不属于被删的宿主内 UI
  assert.ok(
    fs.existsSync(path.join(ROOT, 'src/settings/ExpertSettingsPanel.tsx')),
    '专家设置页应存在：设置 → 创意专家 仍要有管理入口',
  )
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
fs.writeFileSync(
  entry,
  `export { applyStudioTheme, applyStudioTokens, studioStyleText, hideHostAppearanceRow, applyStudioTitle, LIGHT_TOKENS, DARK_TOKENS, STUDIO_RADIUS, APP_TITLE, loadingCaption, CAPTION_CONNECTING, CAPTION_STARTING_HOST, CAPTION_LOADING_UI } from './src/creative/StudioFrame'`,
)
let applyStudioTheme
let applyStudioTokens
let studioStyleText
let hideHostAppearanceRow
let applyStudioTitle
let LIGHT_TOKENS
let DARK_TOKENS
let STUDIO_RADIUS
let APP_TITLE
let loadingCaption
let CAPTION_CONNECTING
let CAPTION_STARTING_HOST
let CAPTION_LOADING_UI
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
  applyStudioTokens = mod.applyStudioTokens
  studioStyleText = mod.studioStyleText
  hideHostAppearanceRow = mod.hideHostAppearanceRow
  applyStudioTitle = mod.applyStudioTitle
  LIGHT_TOKENS = mod.LIGHT_TOKENS
  DARK_TOKENS = mod.DARK_TOKENS
  STUDIO_RADIUS = mod.STUDIO_RADIUS
  APP_TITLE = mod.APP_TITLE
  loadingCaption = mod.loadingCaption
  CAPTION_CONNECTING = mod.CAPTION_CONNECTING
  CAPTION_STARTING_HOST = mod.CAPTION_STARTING_HOST
  CAPTION_LOADING_UI = mod.CAPTION_LOADING_UI
} finally {
  fs.rmSync(entry, { force: true })
  fs.rmSync(reactShim, { force: true })
  fs.rmSync(jsxRuntimeShim, { force: true })
}

function fakeDoc() {
  /** body 内联样式上的变量：主题桥真正该写的地方 */
  const vars = new Map()
  /** 根节点上的变量：只允许 color-scheme，不允许出现任何 --dsw-* */
  const rootVars = new Map()
  const attrs = new Map()
  let writes = 0
  const bodyStyle = {
    colorScheme: '',
    getPropertyValue(name) {
      return vars.get(name) ?? ''
    },
    setProperty(name, value) {
      writes += 1
      vars.set(name, value)
      // 没在根节点上写变量，才不会诱发「继承了就生效」的错觉
      rootVars.delete(name)
    },
    removeProperty(name) {
      vars.delete(name)
    },
  }
  const doc = {
    vars,
    rootVars,
    attrs,
    get writes() {
      return writes
    },
    title: '',
    documentElement: {
      style: {
        colorScheme: '',
        setProperty(name, value) {
          rootVars.set(name, value)
        },
      },
    },
    body: {
      style: bodyStyle,
      hasAttribute(name) {
        return attrs.has(name)
      },
      getAttribute(name) {
        return attrs.has(name) ? attrs.get(name) : null
      },
      setAttribute(name, value) {
        attrs.set(name, value)
      },
      removeAttribute(name) {
        attrs.delete(name)
      },
    },
  }
  return doc
}

await check('夜间主题写入 body 变量与暗色标记', async () => {
  const doc = fakeDoc()
  applyStudioTheme(doc, 'night')
  assert.equal(doc.vars.get('--dsw-alias-bg-base'), '#070b11')
  assert.equal(doc.vars.get('--dsw-alias-brand-primary'), '#38bdf8')
  assert.equal(doc.body.style.colorScheme, 'dark')
  assert.ok(doc.attrs.has('data-ds-dark-theme'), '没有打暗色标记')
})

await check('日间主题翻转变量并去掉暗色标记', async () => {
  const doc = fakeDoc()
  applyStudioTheme(doc, 'night')
  applyStudioTheme(doc, 'day')
  assert.equal(doc.vars.get('--dsw-alias-bg-base'), '#f4f1ea')
  assert.equal(doc.body.style.colorScheme, 'light')
  assert.ok(!doc.attrs.has('data-ds-dark-theme'), '日间仍带着暗色标记')
})

await check('调色板写在 body 而不是根节点', async () => {
  for (const mode of ['day', 'night']) {
    const doc = fakeDoc()
    applyStudioTheme(doc, mode)
    const stray = [...doc.rootVars.keys()].filter((name) => name.startsWith('--dsw-'))
    assert.deepEqual(stray, [], `${mode} 主题把调色板写到了 documentElement 上，宿主 body 的声明会压掉它`)
    assert.ok(doc.vars.size >= 25, `${mode} 主题只映射了 ${doc.vars.size} 个变量，文字三层会漏`)
    // 根节点仍然要有 color-scheme：原生滚动条与表单跟它走
    assert.equal(doc.documentElement.style.colorScheme, mode === 'day' ? 'light' : 'dark')
  }
})

await check('文字三层都接上了应用色板', async () => {
  const night = fakeDoc()
  applyStudioTheme(night, 'night')
  assert.equal(night.vars.get('--dsw-alias-label-primary'), '#dbe7f3')
  assert.equal(night.vars.get('--dsw-alias-label-secondary'), '#b6c8da')
  assert.equal(night.vars.get('--dsw-alias-label-tertiary'), '#7d93ab')
  const dayDoc = fakeDoc()
  applyStudioTheme(dayDoc, 'day')
  assert.equal(dayDoc.vars.get('--dsw-alias-label-primary'), '#1d2733')
  assert.equal(dayDoc.vars.get('--dsw-alias-label-secondary'), '#465666')
  assert.equal(dayDoc.vars.get('--dsw-alias-label-tertiary'), '#586673')
})

await check('重复写同一主题是幂等的（观察者不自激）', async () => {
  const doc = fakeDoc()
  applyStudioTheme(doc, 'night')
  const after = doc.writes
  applyStudioTheme(doc, 'night')
  assert.equal(doc.writes, after, '同一主题第二次写入仍在改样式，观察者会空转')
})

await check('映射表有缺口时不抛错，其余变量照常写入', async () => {
  const vars = new Map()
  const style = {
    getPropertyValue: (name) => vars.get(name) ?? '',
    setProperty: (name, value) => vars.set(name, value),
  }
  const written = applyStudioTokens(style, {
    '--dsw-alias-bg-base': '#070b11',
    '--dsw-alias-label-primary': '',
    '--dsw-alias-brand-primary': undefined,
  })
  assert.equal(written, 1)
  assert.equal(vars.get('--dsw-alias-bg-base'), '#070b11')
  assert.equal(vars.size, 1)
})

await check('壳在 iframe 首帧前就铺好底色（不闪错主题）', async () => {
  assert.match(THEME_CSS, /\.studio-frame-iframe\s*\{[^}]*background:\s*var\(--bg\)/s)
  assert.match(THEME_CSS, /\.studio-frame\s*\{[^}]*background:\s*var\(--bg\)/s)
  // 主题变化要重新同步，不能只在 onLoad 跑一次
  assert.match(FRAME, /useEffect\(\(\) => \{[\s\S]*?syncTheme\(\)\s*\}, \[mode, syncTheme\]\)/s, '主题变化没有触发重新同步')
  // 观察者回调必须读最新的主题引用，否则旧闭包会把刚写入的新主题翻回去
  assert.match(FRAME, /applyStudioTheme\(doc, modeRef\.current\)/, '观察者读的是旧闭包里的主题')
  assert.match(FRAME, /modeRef\.current = mode/, '主题引用没有随渲染更新')
  // 遮罩撤掉之前桥必须已经跑过：onLoad 里先 attachBridge 再置 ready
  const onLoad = FRAME.slice(FRAME.indexOf('onLoad={() => {'))
  assert.ok(onLoad.indexOf('attachBridge()') < onLoad.indexOf("setState((prev) => (prev === 'error' ? prev : 'ready'))"), '先置 ready 再同步主题，会闪一帧错主题')
})

/* ---------------------------------------------------------------- 6.2b 尺度与降噪 */

await check('注入样式把宿主圆角压到应用体系', async () => {
  const css = studioStyleText()
  const expected = {
    '--dsw-radius-xs': '4px',
    '--dsw-radius-sm': '5px',
    '--dsw-radius-md': '7px',
    '--dsw-radius-lg': '10px',
    '--dsw-radius-xl': '10px',
    '--dsw-radius-panel': '10px',
  }
  assert.deepEqual(STUDIO_RADIUS, expected, '圆角映射与 design.md D5 不一致')
  for (const [name, value] of Object.entries(expected)) {
    assert.ok(css.includes(`${name}: ${value};`), `注入样式缺少 ${name}`)
  }
  // 写在 body 上：宿主把圆角声明在 :root，body 声明能稳定盖住继承值
  assert.match(css, /body\s*\{[^}]*--dsw-radius-md:\s*7px/s)
  // px 之外的单位说明映射写错了
  for (const value of Object.values(STUDIO_RADIUS)) assert.match(value, /^\d+px$/)
})

await check('圆角注入与主题无关（两套主题同一份）', async () => {
  const css = studioStyleText()
  assert.ok(!/background|color:|--dsw-alias-/.test(css), '圆角样式里混进了颜色，会随主题漂移')
  // 圆角走注入样式表；主题桥只写调色板，切换主题不该把圆角写进内联变量
  for (const mode of ['day', 'night']) {
    const doc = fakeDoc()
    applyStudioTheme(doc, mode)
    const radius = [...doc.vars.keys()].filter((name) => name.startsWith('--dsw-radius-'))
    assert.deepEqual(radius, [], `${mode} 主题把圆角写进了内联变量，尺度会随主题漂移`)
  }
})

await check('侧栏顶部带与导航行按应用密度收敛', async () => {
  const css = studioStyleText()
  // 顶部带：60px 只剩空白，压到 8 + 28（折叠按钮）+ 8
  assert.match(
    css,
    /\[class\*="_sidebarCol"\]\s+\[class\*="_logoRow"\]\s*\{[^}]*height:\s*44px\s*!important/s,
    '侧栏顶部带没有压到 44px，展开态仍会留一段空带',
  )
  // 折叠轨道是展开控件的落点，不能跟着压
  assert.match(
    css,
    /\[class\*="_sidebarCol"\]\s+\[class\*="_collapsed"\]\s+\[class\*="_logoRow"\]\s*\{[^}]*height:\s*36px/s,
    '折叠轨道的顶部带没有单独保留 36px，展开控件会下沉',
  )
  // 导航行：留白走宿主变量（它自己再减 paint inset），行高压到约 30px
  assert.match(
    css,
    /\[class\*="_sidebarCol"\]\s+\[class\*="_panelRow"\]\s*\{[^}]*--dsh-sidebar-row-padding:\s*9px/s,
    '导航行没有改宿主自己的留白变量，硬写 padding 会抹掉 paint inset',
  )
  assert.match(
    css,
    /\[class\*="_sidebarCol"\]\s+\[class\*="_panelRow"\]\s*\{[^}]*min-height:\s*30px/s,
    '导航行没有压到 30px',
  )
  assert.match(
    css,
    /\[class\*="_sidebarCol"\]\s+\[class\*="_panelRow"\]\s*\{[^}]*line-height:\s*18px/s,
    '导航行行高没跟着收，文字仍会撑出 32px',
  )
})

await check('尺度规则不越出侧栏子树', async () => {
  const css = studioStyleText()
  // 除圆角与降噪之外，新增的尺度规则必须挂在 _sidebarCol 作用域下：
  // 裸写 [class*="_title"] 之类会命中对话区与工具卡片
  const scale = css
    .split('\n')
    .filter((line) => /logoRow|panelRow|sidebarCol/.test(line))
  assert.ok(scale.length >= 3, '尺度规则缺失')
  for (const line of scale) {
    assert.ok(line.includes('_sidebarCol'), `尺度规则没有侧栏作用域：${line}`)
  }
})

await check('类名子串不带尾部下划线', async () => {
  const css = studioStyleText()
  const tokens = [...css.matchAll(/\[class\*="([^"]+)"\]/g)].map((m) => m[1])
  assert.ok(tokens.length >= 8, '注入样式里的类名子串太少，选择器可能写坏了')
  // 宿主有两种命名形态：开发态 `_logoRow_1rdzk_1`、构建产物 `<hash>_logoRow`。
  // 子串以 `_` 结尾只能命中前者，生产构建里整条规则会静默失效。
  for (const token of tokens) {
    assert.ok(
      !token.endsWith('_'),
      `子串 "${token}" 以 _ 结尾，构建产物里的局部名是 <hash>${token.slice(0, -1)}，这条规则在生产构建里永不命中`,
    )
  }
})

await check('字号统一到应用正文的 13px', async () => {
  const css = studioStyleText()
  // 宿主把字号内联写在 body 上：不带 !important 只是"看起来改了"
  assert.match(
    css,
    /body\s*\{[^}]*--dsh-content-font-size:\s*13px\s*!important/s,
    '正文没取应用字号，或没带 !important（会被宿主内联声明压回去）',
  )
  // 侧栏根节点写死 14px，不继承 body
  assert.match(
    css,
    /\[class\*="_sidebarCol"\]\s+\[class\*="_root"\]\s*\{[^}]*font-size:\s*13px/s,
    '侧栏根节点没有单独点名，导航标签仍是 14px',
  )
  // 会话列表标题、搜索标题、重命名输入写死 14px/20px
  for (const local of ['_title', '_searchResultTitle', '_renameInput']) {
    assert.ok(
      css.includes(`[class*="_sidebarCol"] [class*="${local}"]`),
      `会话列表的 ${local} 没有跟随字号，会出现导航小、会话大的混排`,
    )
  }
  assert.match(
    css,
    /\[class\*="_sidebarCol"\]\s+\[class\*="_title"\]\s*,\s*\[class\*="_sidebarCol"\]\s+\[class\*="_searchResultTitle"\]\s*,\s*\[class\*="_sidebarCol"\]\s+\[class\*="_renameInput"\]\s*\{[^}]*font-size:\s*13px[^}]*line-height:\s*18px/s,
    '会话行的字号与行高没有一起改，行框会跟着文字一起变高变松',
  )
})

await check('降噪只做减法：隐去徽标与吉祥物，不引入新图形', async () => {
  const css = studioStyleText()
  assert.ok(css.includes('[class*="_buildVersion"]'), '没隐藏宿主版本徽标')
  assert.ok(css.includes('[class*="_localBuildBrand"]'), '没隐藏宿主本地构建身份')
  assert.ok(css.includes('[class*="_brandName"]'), '没隐藏宿主产品名')
  assert.ok(css.includes('[class*="_fish"]'), '没隐藏首页吉祥物')
  assert.ok(css.includes('[class*="_brandMark"]'), '没隐藏侧栏品牌标记')
  assert.ok(css.includes('[class*="_railMark"]'), '没隐藏折叠轨道的品牌图标')
  assert.ok(css.includes('[data-home-whale]'), '没隐藏空白首页的像素鲸水印')
  assert.ok(css.includes('[class*="_previewBadge"]'), '没隐藏首页标题旁的预览版标签')
  assert.ok(
    !/url\(|background-image|content:\s*["']/.test(css),
    '降噪样式引入了背景图或 content 文案，等于自造品牌素材',
  )
})

await check('品牌降噪不留下不可见热区，也不弄丢展开入口', async () => {
  const css = studioStyleText()
  // 品牌标记同时是 New Session 入口：只藏图形会留一块看不见但可点的区域
  assert.match(
    css,
    /\[class\*="_brand"\]\[class\*="_wide"\]\s*\{[^}]*pointer-events:\s*none\s*!important/s,
    '品牌按钮没有停掉指针事件，空白处仍会误触发新建会话',
  )
  // 折叠轨道的静止标记被收掉后，展开按钮必须仍有可见图形
  assert.match(
    css,
    /\[class\*="_toggle"\]\s+\[class\*="_panelIcon"\]\s*\{[^}]*display:\s*inline\s*!important/s,
    '折叠轨道的面板图标没有常驻，展开按钮会变成无图形的热区',
  )
})

await check('外观设置行按中英文文案命中并限定在设置面板内', async () => {
  const cubic = (text) => {
    const hidden = []
    const row = {
      textContent: text,
      getAttribute: () => null,
      setAttribute(name) {
        hidden.push(name)
      },
    }
    const cube = { parentElement: { parentElement: row } }
    const scope = {
      querySelectorAll(sel) {
        return sel === 'button[aria-pressed]' ? [cube, cube, cube] : []
      },
    }
    const doc = { querySelectorAll: () => [scope] }
    return { doc, row, hidden }
  }

  const zh = cubic('外观浅色深色跟随系统')
  assert.equal(hideHostAppearanceRow(zh.doc), true, '中文外观行没被命中')
  assert.deepEqual(zh.hidden, ['data-studio-hidden'])

  const en = cubic('AppearanceLightDarkSystem')
  assert.equal(hideHostAppearanceRow(en.doc), true, '英文外观行没被命中')

  // 文案匹配必须可辨认：随便一个含三枚 aria-pressed 的行不该被藏
  const other = cubic('语言中文English日本語')
  assert.equal(hideHostAppearanceRow(other.doc), false)
  assert.deepEqual(other.hidden, [], '误伤了设置页的其它行')
})

await check('隐藏失败时静默退化，不抛错也不动其它行', async () => {
  // 文案漂移：结构在、文案不在
  const drifted = {
    querySelectorAll: () => [{
      querySelectorAll: () => [
        { parentElement: { parentElement: { textContent: 'Appearance v2 未本地化', getAttribute: () => null, setAttribute() {} } } },
      ],
    }],
  }
  assert.doesNotThrow(() => hideHostAppearanceRow(drifted))

  // 结构漂移：querySelectorAll 直接抛错
  const broken = {
    querySelectorAll() {
      throw new Error('detached document')
    },
  }
  assert.doesNotThrow(() => hideHostAppearanceRow(broken))
  assert.equal(hideHostAppearanceRow(broken), false)

  // 空文档
  assert.doesNotThrow(() => hideHostAppearanceRow({ querySelectorAll: () => [] }))
})

await check('加载文案区分「启动宿主」与「加载界面」', async () => {
  // 两段耗时量级不同：宿主冷启动数秒，外壳载入数百毫秒。
  // 文案必须能说明卡在哪一段，否则用户无从判断该等还是该重试。
  assert.equal(loadingCaption('idle'), CAPTION_STARTING_HOST, '宿主未启动时是「正在启动」')
  assert.equal(loadingCaption('starting'), CAPTION_STARTING_HOST, '启动中同样是「正在启动」')
  assert.equal(loadingCaption('ready'), CAPTION_LOADING_UI, '宿主就绪后是「正在加载界面」')
  // 探针还没答复时退回既有文案，不凭空断言进度
  assert.equal(loadingCaption('unknown'), CAPTION_CONNECTING)
  assert.equal(loadingCaption('failed'), CAPTION_CONNECTING, '失败由错误页接管，不走加载文案')
  assert.notEqual(CAPTION_STARTING_HOST, CAPTION_LOADING_UI, '两段文案必须可区分')
  // 骨架里只用推导结果，不写死文案
  assert.match(FRAME, /loadingCaption\(hostPhase\)/, '骨架文案必须由宿主阶段派生')
})

await check('标签页标题改成应用名', async () => {
  const doc = { title: 'DeepSeek Harness' }
  applyStudioTitle(doc)
  assert.equal(doc.title, APP_TITLE)
  assert.ok(!APP_TITLE.includes('DeepSeek'), '应用标题里不该出现宿主产品名')
  // 已经正确时不重复赋值（避免观察者空转）
  let writes = 0
  const stable = {
    get title() {
      return APP_TITLE
    },
    set title(_v) {
      writes += 1
    },
  }
  applyStudioTitle(stable)
  assert.equal(writes, 0)
})

await check('观察者盯属性并提供卸载清理', async () => {
  assert.match(FRAME, /new MutationObserver\(/, '没有回写守卫，宿主能改回自己的主题')
  assert.match(FRAME, /attributeFilter:\s*\[\s*'data-ds-dark-theme'\s*,\s*'style'\s*\]/s, '观察者没盯明暗标记与内联样式')
  assert.match(FRAME, /observerRef\.current\?\.disconnect\(\)/, '卸载时没断开观察者')
  // 回调里必须重新贴主题，而不是只打日志
  const cb = FRAME.slice(FRAME.indexOf('new MutationObserver('))
  assert.ok(cb.includes('syncTheme()'), '观察回调没有重新贴主题')
  // 宿主启动时会自己写一次 document.title，属性观察盯不到，只能盯 head 子树
  assert.match(FRAME, /observe\(doc\.head,\s*\{[^}]*childList:\s*true[^}]*characterData:\s*true/s, '没有盯标题，宿主改回后不会写回')
  assert.ok(cb.includes('applyStudioTitle(doc)'), '观察回调没有重新写回标题')
})

/* ---------------------------------------------------------------- 6.2c 调色板与主题变量一致 */

/* 下面两组色板既要给镜像一致性断言用，也要给 6.3 的对比度断言用，所以先取一次 */
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

await check('映射值与 src/theme.css 的语义变量逐项一致', async () => {
  // 桥的取值必须就是应用色板的字面量：写死另一套色值等于再造一份配色
  const pairs = {
    '--dsw-alias-bg-base': '--bg',
    '--dsw-alias-bg-layer-1': '--panel',
    '--dsw-alias-bg-layer-2': '--panel-2',
    '--dsw-alias-bg-layer-3': '--bg-2',
    '--dsw-alias-border-l1': '--line',
    '--dsw-alias-border-l2': '--chrome-line',
    '--dsw-alias-border-l3': '--line-2',
    '--dsw-alias-label-primary': '--text',
    '--dsw-alias-label-secondary': '--text-2',
    '--dsw-alias-label-tertiary': '--muted',
    '--dsw-alias-brand-primary': '--accent',
    '--dsw-alias-state-error-primary': '--danger',
    '--dsw-alias-state-warn-primary': '--warn',
    '--dsw-alias-state-success-primary': '--ok',
  }
  for (const [dsw, app] of Object.entries(pairs)) {
    assert.equal(DARK_TOKENS[dsw], night.get(app), `夜间 ${dsw} 与 ${app} 不一致`)
    assert.equal(LIGHT_TOKENS[dsw], day.get(app), `日间 ${dsw} 与 ${app} 不一致`)
  }
})

await check('镜像后的文字在镜像后的表面上仍达标', async () => {
  for (const [name, tokens] of [
    ['day', LIGHT_TOKENS],
    ['night', DARK_TOKENS],
  ]) {
    for (const bg of ['--dsw-alias-bg-base', '--dsw-alias-bg-layer-1', '--dsw-alias-bg-layer-2']) {
      for (const fg of ['--dsw-alias-label-primary', '--dsw-alias-label-secondary', '--dsw-alias-label-tertiary']) {
        const ratio = contrast(tokens[fg], tokens[bg])
        assert.ok(ratio >= 4.5, `${name}: ${fg} on ${bg} 只有 ${ratio.toFixed(2)}:1`)
      }
    }
  }
})

/* ---------------------------------------------------------------- 6.3 对比度 */

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
  const studio = shell.search(/<StudioFrame\b/)
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
