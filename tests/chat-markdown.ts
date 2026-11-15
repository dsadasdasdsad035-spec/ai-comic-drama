/**
 * 会话消息 Markdown 渲染契约（chat-message-markdown）的纯函数验收。
 *
 * 用 react-dom/server 的 renderToStaticMarkup 断言渲染结果，不需要 DOM 环境或 dev server。
 * 跑法：node verify-chat-markdown.mjs
 */
import assert from 'node:assert/strict'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { ChatText } from '../src/chat-ui/ChatText'

let bad = 0
function check(name: string, fn: () => void) {
  try {
    fn()
    console.log(`✅ ${name}`)
  } catch (e) {
    bad++
    console.log(`❌ ${name}\n   ${(e as Error).message}`)
  }
}

const render = (text: string) => renderToStaticMarkup(createElement(ChatText, { text }))

check('标题渲染为层级标题且不露源符号', () => {
  const html = render('## 步骤')
  assert.match(html, /<h2>步骤<\/h2>/)
  assert.ok(!html.includes('##'), '不应残留 ## 源符号')
})

check('粗体渲染为 strong 且不露源符号', () => {
  const html = render('**重点**')
  assert.match(html, /<strong>重点<\/strong>/)
  assert.ok(!html.includes('**'), '不应残留 ** 源符号')
})

check('无序列表渲染为 ul/li', () => {
  const html = render('- 项一\n- 项二')
  assert.match(html, /<ul>/)
  assert.match(html, /<li>项一<\/li>/)
  assert.match(html, /<li>项二<\/li>/)
})

check('有序列表渲染为 ol/li', () => {
  const html = render('1. 第一步\n2. 第二步')
  assert.match(html, /<ol>/)
  assert.match(html, /<li>第一步<\/li>/)
})

check('行内代码带 chat-md-inline-code 且不露反引号', () => {
  const html = render('用 `read_asset_inventory` 取物料')
  assert.match(html, /<code class="chat-md-inline-code">read_asset_inventory<\/code>/)
  assert.ok(!html.includes('`'), '不应残留反引号')
})

check('围栏代码走 ChatCodeBlock 折叠块', () => {
  const html = render('```ts\nconst a = 1\nconst b = 2\n```')
  assert.match(html, /data-chat-code="true"/)
  assert.match(html, /data-open="false"/)
  assert.match(html, /ts · 2 行/)
  assert.ok(!html.includes('```'), '不应残留围栏标记')
})

check('无语言围栏仍可折叠且回落 text', () => {
  const html = render('```\nplain text\n```')
  assert.match(html, /data-chat-code="true"/)
  assert.match(html, /text · 1 行/)
})

check('表格包横向滚动容器且自身 min-w-max', () => {
  const html = render(
    ['| 镜头 | 时长 | 景别 | 运镜 | 画面 |', '| --- | --- | --- | --- | --- |', '| S01 | 4s | 全景 | 环绕 | 山顶对打 |'].join('\n'),
  )
  assert.match(html, /<div class="chat-md-table-wrap[^"]*overflow-x-auto[^"]*">/)
  assert.match(html, /<table class="chat-md-table min-w-max"/)
  assert.match(html, /<th>镜头<\/th>/)
  assert.match(html, /<td>S01<\/td>/)
})

check('单换行保留为 br', () => {
  const html = render('第一行\n第二行\n第三行')
  assert.match(html, /第一行<br\/>\s*第二行<br\/>\s*第三行/)
})

check('外链新窗口且不带来源', () => {
  const html = render('[文档](https://example.com/a)')
  assert.match(html, /<a href="https:\/\/example\.com\/a" target="_blank" rel="noreferrer">文档<\/a>/)
})

check('javascript 协议被过滤为空 href', () => {
  const html = render('[坏链](javascript:alert(1))')
  assert.match(html, /<a href="" /)
  assert.ok(!/href="javascript:/.test(html), 'javascript: 必须被过滤')
})

check('原始 script 标签按纯文本显示', () => {
  const html = render('<script>alert(1)</script>')
  assert.ok(!html.includes('<script'), '不得产生可执行 script 节点')
  assert.match(html, /&lt;script&gt;/)
})

check('带事件属性的 img 按纯文本显示', () => {
  const html = render('<img src=x onerror="alert(1)">')
  assert.ok(!html.includes('<img'), '不得产生 img 节点')
  assert.match(html, /&lt;img/)
})

check('纯中文段落不被包装成额外结构', () => {
  const html = render('这是一段没有任何 Markdown 语法的说明。')
  assert.match(
    html,
    /^<div class="chat-md" data-chat-md="true"><p>这是一段没有任何 Markdown 语法的说明。<\/p><\/div>$/,
  )
})

console.log(bad ? `\n❌ ${bad} 项断言失败` : '\n✅ 全部 Markdown 渲染断言通过')
process.exit(bad ? 1 : 0)
