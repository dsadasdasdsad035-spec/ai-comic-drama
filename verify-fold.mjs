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
fs.rmSync(outDir, { recursive: true, force: true })
console.log(bad === 0 ? '\n全部通过' : `\n${bad} 项未通过`)
process.exit(bad === 0 ? 0 : 1)
