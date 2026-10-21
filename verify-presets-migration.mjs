/**
 * presetsVersion 迁移验证：
 * 1) 写入一个没有 presetsVersion、缺少新渠道/模型的 v1 设置
 * 2) 通过 /api/settings 读取后应合并 ark-plan / volc-tts 预设，默认值不变
 * 3) 删除一个 v2 预设后再次读取，不应被重新加回来
 * 跑法：先 npm run dev，再 node verify-presets-migration.mjs
 */
import { dbPath, resolveRoot, getSetting, setSetting } from './server/db.mjs'

const APP_URL = 'http://127.0.0.1:5273'
let bad = 0
const check = (name, cond, extra = '') => {
  console.log(`${cond ? '✅' : '❌'} ${name}${extra ? ' | ' + extra : ''}`)
  if (!cond) bad++
}

const health = await fetch(`${APP_URL}/api/health`).then((r) => r.json()).catch(() => null)
if (!health) {
  console.error('dev server 未启动：先运行 npm run dev')
  process.exit(1)
}

dbPath(resolveRoot(process.cwd()))
const original = getSetting('app')
if (!original) {
  console.error('settings 表还没有 app 配置，先打开一次应用')
  process.exit(1)
}

const settings = (await fetch(`${APP_URL}/api/settings`).then((r) => r.json())).settings

try {
  // 模拟 v1：去掉版本号和新预设
  const v1 = { ...original }
  delete v1.presetsVersion
  v1.providers = (v1.providers || []).filter((p) => p.id !== 'ark-plan' && p.id !== 'volc-tts')
  v1.models = (v1.models || []).filter((m) => m.provider !== 'ark-plan' && m.provider !== 'volc-tts')
  setSetting('app', v1)

  const migrated = (await fetch(`${APP_URL}/api/settings`).then((r) => r.json())).settings
  check('迁移后出现 ark-plan', migrated.providers.some((p) => p.id === 'ark-plan'))
  check('迁移后出现 volc-tts', migrated.providers.some((p) => p.id === 'volc-tts'))
  check(
    '迁移后保留文本模型预设',
    migrated.models.some((m) => m.key === 'ark-plan-text-lite' && m.model === 'doubao-seed-2-1-lite-260915'),
  )
  check(
    '迁移不覆盖默认值',
    JSON.stringify(migrated.defaults) === JSON.stringify(settings.defaults),
    JSON.stringify(migrated.defaults),
  )
  check('迁移版本写回 2', Number(migrated.presetsVersion) === 2, String(migrated.presetsVersion))

  // 模拟用户删除一个 v2 预设：再次读取不应复活
  const after = getSetting('app')
  const removed = {
    ...after,
    models: (after.models || []).filter((m) => m.key !== 'ark-plan-text-kimi'),
    presetsVersion: 2,
  }
  setSetting('app', removed)
  const afterDelete = (await fetch(`${APP_URL}/api/settings`).then((r) => r.json())).settings
  check(
    '删除的预设不复活',
    !afterDelete.models.some((m) => m.key === 'ark-plan-text-kimi'),
    JSON.stringify(afterDelete.models.map((m) => m.key).filter((k) => k.startsWith('ark-plan'))),
  )
} finally {
  setSetting('app', original)
}

console.log(bad === 0 ? '\n全部通过' : `\n${bad} 项失败`)
process.exit(bad === 0 ? 0 : 1)
