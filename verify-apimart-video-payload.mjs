/**
 * APIMart 视频族 payload：Seedance 2.5 / Kling v3。
 * 跑法：node verify-apimart-video-payload.mjs
 */
import { buildVideoPayload, isSupportedVideoModel, videoFamilyFor } from './server/apimart.mjs'

let bad = 0
const check = (name, cond, extra = '') => {
  console.log(`${cond ? '✅' : '❌'} ${name}${extra ? ' | ' + extra : ''}`)
  if (!cond) bad++
}
const kindOf = (fn) => {
  try {
    fn()
    return 'ok'
  } catch (e) {
    return e.kind
  }
}

check('Seedance 别名', videoFamilyFor('seedance-2-5') === 'seedance-2.5')
check('Kling 族', videoFamilyFor('kling-v3') === 'kling-v3')
check('Kling omni 走通用适配', videoFamilyFor('kling-v3-omni') === 'generic')
/**
 * 目录里同族常有后缀/无分隔变体。精确匹配会把它们甩进 generic，而 generic 不带
 * omni_reference_task_type，带参考视频时会被上游判成「视频编辑」。
 */
for (const id of ['seedance-2.5-pro', 'seedance-2.5.hd', 'seedance2.5', 'SEEDANCE-2.5']) {
  check(`Seedance 变体归族：${id}`, videoFamilyFor(id) === 'seedance-2.5', videoFamilyFor(id))
}
// 不能把相邻版本误判进来
check('seedance-2.0 不归 2.5', videoFamilyFor('seedance-2.0') === 'generic', videoFamilyFor('seedance-2.0'))
check('seedance-20 不归 2.5', videoFamilyFor('seedance-20') === 'generic', videoFamilyFor('seedance-20'))

const sd = buildVideoPayload({
  family: 'seedance-2.5',
  model: 'seedance-2.5',
  prompt: '夜雨街头',
  ratio: '16:9',
  seconds: 5,
  resolution: '720p',
  firstFrame: 'https://cdn/first.png',
  lastFrame: 'https://cdn/last.png',
  referenceImages: ['https://cdn/ref.png'],
  referenceVideos: ['https://cdn/ref.mp4'],
})
check('Seedance 角色图', sd.image_with_roles?.length === 3, JSON.stringify(sd.image_with_roles))
check(
  'Seedance 角色顺序',
  sd.image_with_roles?.[0]?.role === 'first_frame' &&
    sd.image_with_roles?.[1]?.role === 'last_frame' &&
    sd.image_with_roles?.[2]?.role === 'reference_image',
)
check('Seedance 参考视频', sd.video_urls?.[0] === 'https://cdn/ref.mp4')
/**
 * 带参考视频必须声明「参考」任务类型，否则上游按提示词把任务判成「视频编辑」，
 * 要求 ratio=adaptive、duration=-1 并整单失败（2026-11-24 实测报错原文）。
 * 同一条请求真跑通过：task_01M87114YP1A68DFB1RQ4Q1VY3（5.04s / 1280x720）。
 */
check(
  'Seedance 参考视频声明参考任务类型',
  sd.omni_reference_task_type === 'reference',
  String(sd.omni_reference_task_type),
)
check(
  '无参考视频时不声明任务类型',
  buildVideoPayload({
    family: 'seedance-2.5',
    model: 'seedance-2.5',
    prompt: 'x',
    seconds: 5,
    referenceImages: ['https://cdn/ref.png'],
  }).omni_reference_task_type === undefined,
)
check('Seedance 分辨率/时长', sd.resolution === '720p' && sd.duration === 5)
check('Seedance 静音', sd.generate_audio === false && sd.watermark === false)
check('Seedance 时长下限', kindOf(() => buildVideoPayload({
  family: 'seedance-2.5',
  model: 'seedance-2.5',
  prompt: 'x',
  seconds: 2,
  firstFrame: 'https://cdn/a.png',
})) === 'bad-request')

const kl = buildVideoPayload({
  family: 'kling-v3',
  model: 'kling-v3',
  prompt: '推镜',
  ratio: '16:9',
  seconds: 5,
  resolution: '1080p',
  firstFrame: 'https://cdn/first.png',
})
check('Kling 首帧', kl.image_urls?.length === 1 && kl.image_urls[0] === 'https://cdn/first.png')
check('Kling 1080p → pro', kl.mode === 'pro')
check('Kling 比例', kl.aspect_ratio === '16:9')
check('Kling 静音', kl.audio === false)

const klLast = buildVideoPayload({
  family: 'kling-v3',
  model: 'kling-v3',
  prompt: '推镜',
  ratio: '9:16',
  seconds: 4,
  firstFrame: 'https://cdn/first.png',
  lastFrame: 'https://cdn/last.png',
})
check('Kling 首尾帧', klLast.image_urls?.length === 2 && klLast.image_urls[1] === 'https://cdn/last.png')

check(
  'Kling 多参考图拒绝',
  kindOf(() =>
    buildVideoPayload({
      family: 'kling-v3',
      model: 'kling-v3',
      prompt: 'x',
      seconds: 5,
      firstFrame: 'https://cdn/a.png',
      referenceImages: ['https://cdn/b.png'],
    }),
  ) === 'unsupported',
)
check(
  'Kling 4:3 拒绝',
  kindOf(() =>
    buildVideoPayload({
      family: 'kling-v3',
      model: 'kling-v3',
      prompt: 'x',
      ratio: '4:3',
      seconds: 5,
      firstFrame: 'https://cdn/a.png',
    }),
  ) === 'bad-request',
)
check(
  'Kling 参考视频拒绝',
  kindOf(() =>
    buildVideoPayload({
      family: 'kling-v3',
      model: 'kling-v3',
      prompt: 'x',
      seconds: 5,
      firstFrame: 'https://cdn/a.png',
      referenceVideos: ['https://cdn/a.mp4'],
    }),
  ) === 'unsupported',
)
const generic = buildVideoPayload({
  family: 'generic',
  model: 'veo3.1-fast',
  prompt: '城市夜景',
  ratio: '9:16',
  seconds: 5,
  resolution: '720p',
  firstFrame: 'https://cdn/first.png',
  lastFrame: 'https://cdn/last.png',
  referenceImages: ['https://cdn/ref.png'],
  referenceVideos: ['https://cdn/ref.mp4'],
})
check('通用视频首帧字段', generic.first_frame_image === 'https://cdn/first.png')
check('通用视频尾帧字段', generic.last_frame_image === 'https://cdn/last.png')
check('通用视频参考图字段', generic.image_urls?.[0] === 'https://cdn/ref.png')
check('通用视频参考视频字段', generic.video_urls?.[0] === 'https://cdn/ref.mp4')
/**
 * Seedance 2.x 若因名字没被识别而掉进 generic 兜底，带参考视频会被上游判成
 * 「视频编辑」（要求 ratio=adaptive + duration=-1）。这种组合必须本地拒绝并
 * 说明改法，而不是发一个注定失败的请求。其他族的通用 schema 照常放行。
 */
check(
  'seedance 2.x 掉进 generic 带视频被拒绝',
  kindOf(() =>
    buildVideoPayload({
      family: 'generic',
      model: 'seedance-2-0-260128',
      prompt: 'x',
      seconds: 5,
      referenceVideos: ['https://cdn/ref.mp4'],
    }),
  ) === 'unsupported',
)
check(
  'seedance 2.x 无视频仍可走 generic',
  buildVideoPayload({ family: 'generic', model: 'seedance-2-0-260128', prompt: 'x', seconds: 5 }).duration === 5,
)
check('通用视频比例/分辨率', generic.aspect_ratio === '9:16' && generic.resolution === '720p')
check(
  'Omni-Flash-Ext 480p 映射 720p',
  buildVideoPayload({
    family: 'generic',
    model: 'Omni-Flash-Ext',
    prompt: 'x',
    seconds: 5,
    resolution: '480p',
    firstFrame: 'https://cdn/a.png',
  }).resolution === '720p',
)

check(
  '空族拒绝',
  kindOf(() =>
    buildVideoPayload({
      family: '',
      model: 'veo3',
      prompt: 'x',
      seconds: 5,
      firstFrame: 'https://cdn/a.png',
    }),
  ) === 'unsupported',
)

console.log(bad ? `\n${bad} 项失败` : '\n全部通过')
process.exit(bad ? 1 : 0)
