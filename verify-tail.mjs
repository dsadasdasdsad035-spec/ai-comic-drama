/**
 * 尾帧功能移除回归：源码中不再有 last_frame / return_last_frame / tailImage / 尾帧 UI。
 * 跑法：node verify-tail.mjs
 */
import fs from 'node:fs'
let bad = 0
const check = (name, cond, extra = '') => {
  console.log(`${cond ? '✅' : '❌'} ${name}${extra ? ` | ${extra}` : ''}`)
  if (!cond) bad++
}
const files = [
  'src/App.tsx', 'src/Inspector.tsx', 'src/api.ts', 'src/types.ts', 'src/shotSync.ts',
  'server/video.mjs', 'server/video.d.mts', 'vite.config.ts',
]
const forbidden = [
  /\blastFrame\b/,
  /\breturnLastFrame\b/,
  /\btailImage\b/,
  /\btail_image\b/,
  /\blast_frame\b/,
  /\breturn_last_frame\b/,
  /以下一镜画面作尾帧/,
  /本镜尾帧/,
  /用上一镜尾帧/,
  /\.tail-row\b/,
]
for (const file of files) {
  const text = fs.existsSync(file) ? fs.readFileSync(file, 'utf8') : ''
  const hits = forbidden.filter((re) => re.test(text)).map(String)
  check(`${file} 无尾帧残留`, hits.length === 0, hits.join(', '))
}
const theme = fs.readFileSync('src/theme.css', 'utf8')
check('主题无尾帧样式', !/\.tail-row\b|Inspector：尾帧接龙/.test(theme))
console.log(bad ? `\n${bad} failed` : '\nall passed')
process.exit(bad ? 1 : 0)
