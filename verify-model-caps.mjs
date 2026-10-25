/**
 * 模型能力谓词验证：
 * 1) 旧条目只认 cap
 * 2) 新条目按 caps 精确判断
 * 3) 视频参考可由 supportsVideoRef 提供
 * 4) 目录未接入模型不可运行
 *
 * 跑法：node verify-model-caps.mjs
 */
import { build } from 'esbuild'

const out = await build({
  entryPoints: ['src/modelCaps.ts'],
  bundle: true,
  format: 'esm',
  platform: 'node',
  write: false,
})
const mod = await import(
  'data:text/javascript;base64,' + Buffer.from(out.outputFiles[0].text).toString('base64')
)
const { modelHasCap, isRunnableModel, modelCapsLabel } = mod

let bad = 0
const check = (name, cond, extra = '') => {
  console.log(`${cond ? '✅' : '❌'} ${name}${extra ? ' | ' + extra : ''}`)
  if (!cond) bad++
}

const legacyText = { key: 't', label: 'T', cap: 'text', provider: 'x', model: 'm' }
check('旧文本条目 text', modelHasCap(legacyText, 'text'))
check('旧文本条目不冒充高质量', !modelHasCap(legacyText, 'textPro'))

const multi = { ...legacyText, caps: ['text', 'textPro', 'vision'] }
check('多能力 text', modelHasCap(multi, 'text'))
check('多能力 textPro', modelHasCap(multi, 'textPro'))
check('多能力 vision', modelHasCap(multi, 'vision'))
check('多能力不含 video', !modelHasCap(multi, 'video'))

const image = { key: 'i', label: 'I', cap: 'image', provider: 'x', model: 'm', caps: ['image', 'view'] }
check('图像+三视图 image', modelHasCap(image, 'image'))
check('图像+三视图 view', modelHasCap(image, 'view'))

const legacyImage = { key: 'i2', label: 'I2', cap: 'image', provider: 'x', model: 'm' }
check('旧图像条目不自动承接三视图', !modelHasCap(legacyImage, 'view'))

const video = {
  key: 'v',
  label: 'V',
  cap: 'video',
  provider: 'x',
  model: 'seedance-2.5',
  caps: ['video'],
  supportsVideoRef: true,
}
check('视频 video', modelHasCap(video, 'video'))
check('视频参考由 supportsVideoRef 提供', modelHasCap(video, 'videoRef'))

const legacyRef = { key: 'vr', label: 'VR', cap: 'videoRef', provider: 'x', model: 'm' }
check('旧视频参考条目', modelHasCap(legacyRef, 'videoRef'))

check('目录未接入不可运行', !isRunnableModel({ ...multi, runtime: 'catalog-only' }))
check('普通条目可运行', isRunnableModel(multi))
check('能力标签', modelCapsLabel(multi) === '文本 / 高质量文本 / 视觉', modelCapsLabel(multi))
check('视频参考标签补齐', modelCapsLabel(video) === '视频 / 视频参考', modelCapsLabel(video))

console.log(bad ? `\n${bad} 项失败` : '\n全部通过')
process.exit(bad ? 1 : 0)
