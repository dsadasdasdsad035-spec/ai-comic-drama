/**
 * 折叠原语验收：
 * 1) 结构：aria-expanded / aria-controls / hidden 与受控状态同步；
 * 2) 样式：折叠态高度小于展开态，摘要行单行不换行、不裁切。
 *
 * 跑法：node verify-fold.mjs
 */
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { execFileSync } from 'node:child_process'
import { chromium } from 'playwright-core'

const root = path.dirname(fileURLToPath(import.meta.url))
const BASE = process.env.APP_URL || 'http://localhost:5273'
const outDir = fs.mkdtempSync(path.join(root, '.verify-fold-'))
const esbuild = path.join(root, 'node_modules', '.bin', 'esbuild')

let bad = 0
const check = (name, cond, extra = '') => {
  console.log(`${cond ? '✅' : '❌'} ${name}${extra ? ` | ${extra}` : ''}`)
  if (!cond) bad++
}

// ---------------------------------------------------------------- 结构（SSR）
const entry = path.join(outDir, 'fold-probe.tsx')
fs.writeFileSync(
  entry,
  `import { createElement as h } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import Fold from ${JSON.stringify(path.join(root, 'src/Fold.tsx'))}

export function render(open: boolean, withMeta: boolean) {
  return renderToStaticMarkup(
    h(
      Fold,
      {
        open,
        onToggle: () => {},
        title: '出片设置',
        meta: withMeta ? 'Seedance · 720p · 5s · ¥0.40' : undefined,
        idPrefix: 'probe',
        peek: open ? undefined : h('span', null, '有 1 条阻断'),
      },
      h('div', { className: 'probe-body' }, '正文'),
    ),
  )
}
`,
)
const probeOut = path.join(outDir, 'fold-probe.mjs')
execFileSync(esbuild, [
  entry,
  '--bundle',
  '--platform=node',
  '--format=esm',
  // react / react-dom 保持外部引用，避免把 react-dom/server 的 CJS 依赖打进 ESM
  '--packages=external',
  '--log-level=error',
  `--outfile=${probeOut}`,
])
const probe = await import(probeOut)

const closed = probe.render(false, true)
const opened = probe.render(true, true)

check('折叠态 aria-expanded=false', closed.includes('aria-expanded="false"'))
check('展开态 aria-expanded=true', opened.includes('aria-expanded="true"'))
check('折叠态 body 带 hidden', /class="fold-body[^"]*"[^>]*hidden/.test(closed) || closed.includes('hidden=""'))
check('展开态 body 不带 hidden', opened.includes('class="fold-body"') && !/fold-body"[^>]*hidden/.test(opened))
check('aria-controls 指向 body id', /aria-controls="probe-body"/.test(opened) && opened.includes('id="probe-body"'))
check('摘要行渲染 meta', opened.includes('fold-meta') && opened.includes('¥0.40'))
check('折叠态露出 peek', closed.includes('fold-peek') && closed.includes('有 1 条阻断'))
check('展开态不渲染 peek', !opened.includes('fold-peek'))
check('data-open 同步输出', closed.includes('data-open="false"') && opened.includes('data-open="true"'))

// ---------------------------------------------------------------- 折叠结构一致性
// 分镜视频 Tab 与转场生成区的「出片设置」共用同一原语，摘要行子节点顺序必须一致
const headOrder = (html) => {
  const head = html.match(/<button[^>]*class="fold-head"[\s\S]*?<\/button>/)?.[0] ?? ''
  return [...head.matchAll(/class="(fold-[a-z]+)"/g)]
    .map((m) => m[1])
    .filter((c) => c !== 'fold-head')
}
const noMeta = probe.render(true, false)
const orderWithMeta = headOrder(opened)
check(
  '摘要行子节点顺序为 chevron → title → meta',
  JSON.stringify(orderWithMeta) === JSON.stringify(['fold-chevron', 'fold-title', 'fold-meta']),
  JSON.stringify(orderWithMeta),
)
const orderNoMeta = headOrder(noMeta)
check(
  '无 meta 时顺序为 chevron → title',
  JSON.stringify(orderNoMeta) === JSON.stringify(['fold-chevron', 'fold-title']),
  JSON.stringify(orderNoMeta),
)
const inspFoldSrc = fs.readFileSync(path.join(root, 'src/Inspector.tsx'), 'utf8')
const transFoldSrc = fs.readFileSync(path.join(root, 'src/TransitionPanel.tsx'), 'utf8')
check(
  '两条路径的出片设置折叠参数一致',
  inspFoldSrc.includes('title="出片设置"') &&
    transFoldSrc.includes('title="出片设置"') &&
    inspFoldSrc.includes('sectionId="videoSettings"') &&
    transFoldSrc.includes('sectionId="videoSettings"') &&
    inspFoldSrc.includes('idPrefix="vid-settings"') &&
    transFoldSrc.includes('idPrefix="tr-settings"'),
)

// ---------------------------------------------------------------- 样式（真实样式表）
const b = await chromium.launch({ headless: true, channel: 'chrome' })
const p = await b.newPage({ viewport: { width: 1200, height: 900 } })
await p.goto(BASE, { waitUntil: 'networkidle' })
await p.waitForTimeout(800)

const style = await p.evaluate(() => {
  const host = document.createElement('div')
  host.id = 'fold-probe-host'
  host.style.cssText = 'position:absolute;left:0;top:0;width:320px;z-index:9999;background:#111'
  host.innerHTML = `
    <div class="fold" data-open="true" id="probe-open">
      <button type="button" class="fold-head" aria-expanded="true">
        <span class="fold-chevron" aria-hidden="true"></span>
        <span class="fold-title">出片设置</span>
        <span class="fold-meta">Seedance 1.0 pro · 720p · 5s · ¥0.40</span>
      </button>
      <div class="fold-body">
        <p>模型</p><p>分辨率</p><p>原生音频</p><p>挂载已有视频</p><p>说明</p>
      </div>
    </div>
    <div class="fold" data-open="false" id="probe-closed">
      <button type="button" class="fold-head" aria-expanded="false">
        <span class="fold-chevron" aria-hidden="true"></span>
        <span class="fold-title">出片设置</span>
        <span class="fold-meta">Seedance 1.0 pro · 720p · 5s · ¥0.40</span>
      </button>
      <div class="fold-body" hidden>
        <p>模型</p><p>分辨率</p><p>原生音频</p><p>挂载已有视频</p><p>说明</p>
      </div>
    </div>`
  document.body.appendChild(host)
  const measure = (id) => {
    const fold = document.getElementById(id)
    const head = fold.querySelector('.fold-head')
    const body = fold.querySelector('.fold-body')
    const title = fold.querySelector('.fold-title')
    const meta = fold.querySelector('.fold-meta')
    return {
      foldH: fold.getBoundingClientRect().height,
      headH: head.getBoundingClientRect().height,
      bodyH: body.getBoundingClientRect().height,
      headWrap: head.scrollWidth - head.clientWidth,
      titleOverflow: title.scrollWidth - title.clientWidth,
      metaOverflow: meta.scrollWidth - meta.clientWidth,
      chevron: getComputedStyle(fold.querySelector('.fold-chevron'), '::before').content,
      headDisplay: getComputedStyle(head).display,
    }
  }
  const open = measure('probe-open')
  const closed = measure('probe-closed')
  host.remove()
  return { open, closed }
})

check('折叠态高度明显小于展开态', style.closed.foldH < style.open.foldH - 40, JSON.stringify(style))
check('折叠态 body 不可见', style.closed.bodyH === 0, String(style.closed.bodyH))
check('展开态 body 有高度', style.open.bodyH > 40, String(style.open.bodyH))
check('摘要行单行', style.open.headH > 0 && style.open.headH < 34, String(style.open.headH))
check('标题不裁切', style.open.titleOverflow <= 0, String(style.open.titleOverflow))
check('meta 不溢出容器', style.open.headWrap <= 1, String(style.open.headWrap))
check('chevron 使用 ▾', style.open.chevron.includes('▾'), style.open.chevron)

await b.close()

// ---------------------------------------------------------------- DOM / 类名契约
// 既有验收脚本 verify-video-prompt-preview / verify-transitions-ui 已陈旧
// （仍按旧默认模式与已移除流程断言），改由源码契约检查覆盖本次"类名不回归"的要求。
const panelSrc = fs.readFileSync(path.join(root, 'src/OutgoingVideoPromptPanel.tsx'), 'utf8')
const transSrc = fs.readFileSync(path.join(root, 'src/TransitionPanel.tsx'), 'utf8')
const inspSrc = fs.readFileSync(path.join(root, 'src/Inspector.tsx'), 'utf8')

check('保留 vp-panel 容器与 data-open', panelSrc.includes('className="vp-panel"') && panelSrc.includes('data-open={open'))
check('保留 vp-summary 摘要行', panelSrc.includes('className="vp-summary"'))
check('保留 vp-refs 槽位列表', panelSrc.includes('className="vp-refs"'))
check('保留 vp-issue 阻断/提示', panelSrc.includes('vp-issue'))
check('保留 vp-text 正文', panelSrc.includes('vp-text'))
check('转场保留 tr-advanced 外观挂点', transSrc.includes('"tr-advanced"'))
check('四个折叠点统一走 Fold', [panelSrc, transSrc, inspSrc].every((s) => s.includes("from './Fold'")))
check('旧的折叠外观类已移除', !panelSrc.includes('vp-disclosure-trigger') && !panelSrc.includes('vp-refs-summary-chevron') && !inspSrc.includes('si-section-chevron'))
check('分镜分区不再用原生 details', !/details[\s\S]{0,80}si-section/.test(inspSrc) && inspSrc.includes('className={`si-section'))

fs.rmSync(outDir, { recursive: true, force: true })
console.log(bad === 0 ? '\n全部通过' : `\n${bad} 项未通过`)
process.exit(bad === 0 ? 0 : 1)
