/**
 * presetsVersion 迁移验证：
 * 1) v1 设置读取后合并 ark-plan / volc-tts / v3 视频参考 / v4-v5 DeepSeek Flash 预设，默认值不变
 * 2) v3 设置升级后补回文本和视觉 Flash，已删除的 v2 预设不复活
 * 3) v4 设置升级只补视觉 Flash
 * 4) 已迁到 v5 后删除预设，不再补回
 * 跑法：先 npm run dev，再 APP_URL=http://127.0.0.1:5280 node verify-presets-migration.mjs
 */
import { dbPath, resolveRoot, getSetting, setSetting } from './server/db.mjs'

const APP_URL = process.env.APP_URL || 'http://127.0.0.1:5273'
const CURRENT_PRESETS_VERSION = 5
const DEEPSEEK_FLASH_KEY = 'ark-plan-text-deepseek-flash'
const DEEPSEEK_VISION_KEY = 'ark-plan-vision-deepseek-flash'
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
const readSettings = async () => (await fetch(`${APP_URL}/api/settings`).then((r) => r.json())).settings

try {
  // 模拟 v1：去掉版本号和新预设
  const v1 = { ...original }
  delete v1.presetsVersion
  v1.providers = (v1.providers || []).filter((p) => p.id !== 'ark-plan' && p.id !== 'volc-tts')
  v1.models = (v1.models || []).filter((m) => m.provider !== 'ark-plan' && m.provider !== 'volc-tts')
  setSetting('app', v1)

  const migrated = await readSettings()
  check('迁移后出现 ark-plan', migrated.providers.some((p) => p.id === 'ark-plan'))
  check('迁移后出现 volc-tts', migrated.providers.some((p) => p.id === 'volc-tts'))
  check(
    '迁移后保留文本模型预设',
    migrated.models.some((m) => m.key === 'ark-plan-text-lite' && m.model === 'doubao-seed-2-1-lite-260915'),
  )
  check(
    '迁移后出现 DeepSeek Flash 文本',
    migrated.models.some((m) => m.key === DEEPSEEK_FLASH_KEY && m.model === 'deepseek-v4-flash' && m.thinking === 'auto'),
  )
  check(
    '迁移后出现 DeepSeek Flash 视觉',
    migrated.models.some((m) => m.key === DEEPSEEK_VISION_KEY && m.cap === 'vision' && m.model === 'deepseek-v4-flash'),
  )
  check(
    '迁移不覆盖默认值',
    JSON.stringify(migrated.defaults) === JSON.stringify(settings.defaults),
    JSON.stringify(migrated.defaults),
  )
  check('迁移版本写回 5', Number(migrated.presetsVersion) === CURRENT_PRESETS_VERSION, String(migrated.presetsVersion))

  // 模拟 v3：删掉 v4/v5 新增项后升级，补回两个 Flash，已删除的 v2 预设不复活
  const afterV1 = getSetting('app')
  const v3 = {
    ...afterV1,
    models: (afterV1.models || []).filter(
      (m) => m.key !== DEEPSEEK_FLASH_KEY && m.key !== DEEPSEEK_VISION_KEY && m.key !== 'ark-plan-text-kimi',
    ),
    presetsVersion: 3,
  }
  setSetting('app', v3)
  const fromV3 = await readSettings()
  check(
    'v3 → v5 补回 DeepSeek Flash 文本',
    fromV3.models.some((m) => m.key === DEEPSEEK_FLASH_KEY),
    JSON.stringify(fromV3.models.filter((m) => m.key.startsWith('ark-plan-text')).map((m) => m.key)),
  )
  check(
    'v3 → v5 补回 DeepSeek Flash 视觉',
    fromV3.models.some((m) => m.key === DEEPSEEK_VISION_KEY),
    JSON.stringify(fromV3.models.filter((m) => m.cap === 'vision').map((m) => m.key)),
  )
  check('v3 已删除的 v2 预设不复活', !fromV3.models.some((m) => m.key === 'ark-plan-text-kimi'))
  check('v3 → v5 版本写回 5', Number(fromV3.presetsVersion) === CURRENT_PRESETS_VERSION, String(fromV3.presetsVersion))

  // 模拟 v4：只缺视觉 Flash，升级只补视觉
  const afterV3 = getSetting('app')
  const v4 = {
    ...afterV3,
    models: (afterV3.models || []).filter((m) => m.key !== DEEPSEEK_VISION_KEY),
    presetsVersion: 4,
  }
  setSetting('app', v4)
  const fromV4 = await readSettings()
  check('v4 → v5 补回视觉 Flash', fromV4.models.some((m) => m.key === DEEPSEEK_VISION_KEY))
  check('v4 → v5 不重复文本 Flash', fromV4.models.filter((m) => m.key === DEEPSEEK_FLASH_KEY).length === 1)
  check('v4 → v5 版本写回 5', Number(fromV4.presetsVersion) === CURRENT_PRESETS_VERSION, String(fromV4.presetsVersion))

  // 已到 v5：用户主动删除的预设不应再补回
  const afterV4 = getSetting('app')
  const v5 = {
    ...afterV4,
    models: (afterV4.models || []).filter((m) => m.key !== DEEPSEEK_FLASH_KEY && m.key !== DEEPSEEK_VISION_KEY),
    presetsVersion: CURRENT_PRESETS_VERSION,
  }
  setSetting('app', v5)
  const afterDelete = await readSettings()
  check(
    'v5 删除的文本 Flash 不复活',
    !afterDelete.models.some((m) => m.key === DEEPSEEK_FLASH_KEY),
    JSON.stringify(afterDelete.models.map((m) => m.key).filter((k) => k.includes('deepseek-flash'))),
  )
  check('v5 删除的视觉 Flash 不复活', !afterDelete.models.some((m) => m.key === DEEPSEEK_VISION_KEY))
} finally {
  setSetting('app', original)
}

console.log(bad === 0 ? '\n全部通过' : `\n${bad} 项失败`)
process.exit(bad === 0 ? 0 : 1)
