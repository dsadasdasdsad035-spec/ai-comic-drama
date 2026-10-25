/**
 * 模型路由谓词：旧 cap、新 caps、视频参考、目录未接入。
 * 跑法：node verify-model-routing.mjs
 */
import { build } from 'esbuild'

const out = await build({
  entryPoints: ['src/modelCaps.ts'],
  bundle: true,
  format: 'esm',
  platform: 'node',
  write: false,
})
const { modelHasCap, isRunnableModel } = await import(
  'data:text/javascript;base64,' + Buffer.from(out.outputFiles[0].text).toString('base64')
)

let bad = 0
const check = (name, cond, extra = '') => {
  console.log(`${cond ? '✅' : '❌'} ${name}${extra ? ' | ' + extra : ''}`)
  if (!cond) bad++
}

const legacy = { key: 'l', label: 'L', cap: 'text', provider: 'p', model: 'm' }
check('旧 cap=text 可路由 text', modelHasCap(legacy, 'text'))
check('旧 cap=text 不冒充 textPro', !modelHasCap(legacy, 'textPro'))

const multi = { ...legacy, caps: ['text', 'textPro', 'vision'] }
check('新 caps 文本', modelHasCap(multi, 'text'))
check('新 caps 高质量', modelHasCap(multi, 'textPro'))
check('新 caps 视觉', modelHasCap(multi, 'vision'))

const image = { key: 'i', label: 'I', cap: 'image', provider: 'p', model: 'm', caps: ['image', 'view'] }
check('新 caps 图像+三视图', modelHasCap(image, 'image') && modelHasCap(image, 'view'))

const video = { key: 'v', label: 'V', cap: 'video', provider: 'p', model: 'seedance-2.5', caps: ['video'], supportsVideoRef: true }
check('视频参考由 supportsVideoRef 提供', modelHasCap(video, 'videoRef'))

check('目录未接入不可运行', !isRunnableModel({ ...legacy, runtime: 'catalog-only' }))
check('普通条目可运行', isRunnableModel(legacy))

console.log(bad ? `\n${bad} 项失败` : '\n全部通过')
process.exit(bad ? 1 : 0)
