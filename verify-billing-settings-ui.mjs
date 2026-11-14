import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const root = path.dirname(fileURLToPath(import.meta.url))
const txt = fs.readFileSync(path.join(root, 'src/settings/SettingsPage.tsx'), 'utf8')
let bad = 0
const check = (name, cond) => {
  console.log(`${cond ? '✅' : '❌'} ${name}`)
  if (!cond) bad++
}
check('计费分区', /renderBilling|section === 'billing'/.test(txt))
check('平台积分文案', txt.includes('平台积分'))
process.exit(bad ? 1 : 0)