/**
 * 视频素材参考回归（纯函数，不调用模型）：
 * - collectVideoReferences 只解析连线里的 asset- 视频节点
 * - buildShotVideoRequest 用第一条视频，图片额度不变
 * - 旧 useScheduleVideoRef / useScheduleFrames 不再生效
 * - 缺失视频阻塞、模型不支持警告、原生音频与视频素材冲突
 * 跑法：node verify-video-asset-ref.mjs
 */
import fs from 'node:fs'
import path from 'node:path'
import { execFileSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'

const ROOT = path.dirname(fileURLToPath(import.meta.url))
const TMP = fs.mkdtempSync(path.join(ROOT, '.verify-asset-ref-'))
const entry = path.join(TMP, 'entry.ts')
fs.writeFileSync(
  entry,
  `export * from ${JSON.stringify(path.join(ROOT, 'src/shotReferences.ts'))}\n` +
    `export * from ${JSON.stringify(path.join(ROOT, 'src/videoPrompt.ts'))}\n`,
)
const bundle = path.join(TMP, 'bundle.mjs')
execFileSync(path.join(ROOT, 'node_modules', '.bin', 'esbuild'), [
  entry,
  '--bundle',
  '--platform=node',
  '--format=esm',
  '--log-level=error',
  `--outfile=${bundle}`,
])
const lib = await import(bundle)

let bad = 0
const check = (name, cond, extra = '') => {
  console.log(`${cond ? '✅' : '❌'} ${name}${extra ? ' | ' + extra : ''}`)
  if (!cond) bad++
}

const schedule = {
  scene: { w: 10, h: 10, sceneSlug: '场1' },
  blocking: { keys: [] },
  duration: 5,
  // 故意给过期状态：新拼装器不应再因 3D 过期阻塞出片
  ready: false,
  status: '已过期',
  reason: '调度已过期',
}
const baseShot = {
  no: 'S01',
  seconds: 5,
  size: '中景',
  move: '推',
  dialogue: '',
  prompt: '画面',
  marks: [],
  refImage: '/generated/a.jpg',
  refIds: ['asset-v1', 'asset-v2', 'asset-img', 'asset-missing'],
  refExtras: [],
}
const nodes = [
  { id: 'n1', type: 'shot', position: { x: 0, y: 0 }, data: baseShot },
  {
    id: 'asset-v1',
    type: 'asset',
    data: { title: '调度A', kind: 'video', url: '/videos/a.mp4' },
  },
  {
    id: 'asset-v2',
    type: 'asset',
    data: { title: '调度B', kind: 'video', url: '/videos/b.mp4' },
  },
  {
    id: 'asset-img',
    type: 'asset',
    data: { title: '场景图', kind: 'scene', url: '/generated/scene.jpg' },
  },
  {
    id: 'asset-missing',
    type: 'asset',
    data: { title: '丢失视频', kind: 'video', url: '/videos/missing.mp4' },
  },
]
const missingMedia = new Set(['/videos/missing.mp4'])
const build = (data, model = { key: 'v', model: 'seedance-2.5', supportsVideoRef: true }) =>
  lib.buildShotVideoRequest({
    data,
    nodeId: 'n1',
    nodes: nodes.map((n) => (n.id === 'n1' ? { ...n, data } : n)),
    characters: [],
    missingMedia,
    schedule,
    model,
    resolution: '720p',
  })

const refs = lib.collectVideoReferences({ node: nodes[0], nodes, missingMedia })
check(
  '视频解析只取两条视频，跳过图片',
  refs.refs.length === 2 && refs.refs[0].url === '/videos/a.mp4' && refs.refs[1].url === '/videos/b.mp4',
  JSON.stringify(refs.refs),
)
check('缺失视频进入 missing', refs.missing.some((m) => m.token === 'asset-missing'), JSON.stringify(refs.missing))

const request = build(baseShot)
check('第一条视频进入 reference_video', request.video?.url === '/videos/a.mp4', JSON.stringify(request.video))
check('第二条视频列在 omittedVideos', request.omittedVideos.length === 1 && request.omittedVideos[0].label.includes('调度B'), JSON.stringify(request.omittedVideos))
// 只有 asset-img 一条画面连线；refImage 按 spec 不再隐式入图，视频另占 video 槽不占图片额度
check('视频不占图片额度', request.refs.length === 1, String(request.refs.length))
check('缺失视频阻塞出片', request.blocking.some((x) => x.code === 'video-asset-missing'), JSON.stringify(request.blocking))
// 正文只由人/Agent 写入：不再拼「@视频1 只参考运动」这类运行时段落；空正文直接阻塞
check(
  '正文不拼运行时视频段落',
  request.prompt === '' && request.blocking.some((x) => x.code === 'shot-prompt-empty'),
  JSON.stringify(request.prompt),
)
check('不再使用旧 3D 白模文案', !/白模|网格|视锥/.test(request.prompt), request.prompt.slice(-160))
check('过期 3D 不再阻塞出片', !request.blocking.some((x) => x.code === 'schedule-stale'), JSON.stringify(request.blocking))

const oldToggle = build({
  ...baseShot,
  refIds: ['asset-img'],
  scheduleVideo: '/videos/old.mp4',
  useScheduleVideoRef: true,
  useScheduleFrames: true,
  scheduleFrames: ['/s1.jpg', '/s2.jpg'],
})
check('旧 3D 开关不再产生视频附件', oldToggle.video === null, JSON.stringify(oldToggle.video))
check('旧 3D 开关不产生视频省略项', oldToggle.omittedVideos.length === 0, JSON.stringify(oldToggle.omittedVideos))
check('旧 3D 关键帧不进入参考图', !oldToggle.refs.some((r) => r.url === '/s1.jpg'), JSON.stringify(oldToggle.refs))
check('旧 3D 开关不影响提示词', !/@视频1/.test(oldToggle.prompt), oldToggle.prompt.slice(-120))

const unsupported = build(baseShot, { key: 'v', model: 'seedance-1-0-pro', supportsVideoRef: false })
check('模型不支持视频参考给警告', unsupported.warnings.some((x) => x.code === 'video-ref-unsupported'), JSON.stringify(unsupported.warnings))

/**
 * 2.x 带参考视频但没声明任务类型时，上游会按提示词判成「视频编辑」，
 * 要求 ratio=adaptive + duration=-1 并整单报参数无效。面板要先给警告。
 */
const noTaskType = build(baseShot, { key: 'v', model: 'doubao-seedance-2-0-260128', supportsVideoRef: true })
check(
  '未声明视频参考任务类型给警告',
  noTaskType.warnings.some((x) => x.code === 'video-ref-task-type-missing'),
  noTaskType.warnings.map((x) => x.code).join(','),
)
const hasTaskType = build(baseShot, {
  key: 'v',
  model: 'doubao-seedance-2-5-260628',
  supportsVideoRef: true,
  videoRefTaskType: 'reference',
})
check(
  '已声明任务类型不警告',
  !hasTaskType.warnings.some((x) => x.code === 'video-ref-task-type-missing'),
  hasTaskType.warnings.map((x) => x.code).join(','),
)

const native = build({ ...baseShot, audioMode: 'native' })
check(
  '原生音频可与视频素材并存',
  !native.blocking.some((x) => x.code === 'native-video-conflict'),
  JSON.stringify(native.blocking),
)
check('原生音频仍带视频附件', native.video?.url === '/videos/a.mp4', JSON.stringify(native.video))
check(
  '原生音频同时带参考图与视频',
  native.refs.length > 0,
  `${native.refs.length} 张`,
)
// 有原生音频能力的模型：native 与视频参考同时在请求里，不再互相排斥
const nativeAudioModel = {
  key: 'v25',
  model: 'seedance-2.5',
  providerKind: 'apimart',
  audioOut: true,
  supportsVideoRef: true,
}
const nativeOk = build({ ...baseShot, audioMode: 'native', videoPrompt: '夜雨街头' }, nativeAudioModel)
check(
  '原生音频 + 视频参考走 native 模式',
  nativeOk.mode === 'native' && nativeOk.video?.url === '/videos/a.mp4',
  `${nativeOk.mode} / ${nativeOk.video?.url}`,
)
check(
  '原生音频 + 视频参考不产生 native 相关阻断',
  !nativeOk.blocking.some((x) => x.code.startsWith('native-')),
  nativeOk.blocking.map((x) => x.code).join(','),
)

const withImages = build({ ...baseShot, refExtras: ['/b.jpg', '/c.jpg', '/d.jpg', '/e.jpg', '/f.jpg'] })
// 1 条连线 + 5 条 refExtras；旧期望 7 是 refImage 还会隐式入图时的口径
check('图片参考不限张数', withImages.refs.length === 6, String(withImages.refs.length))
check('图片与视频并存', withImages.video?.url === '/videos/a.mp4', JSON.stringify(withImages.video))

const onlyV1 = build({ ...baseShot, refIds: ['asset-v1', 'asset-img'] })
const onlyV2 = build({ ...baseShot, refIds: ['asset-v2', 'asset-img'] })
check('更换视频会改变指纹', onlyV1.fingerprint !== onlyV2.fingerprint, `${onlyV1.fingerprint} / ${onlyV2.fingerprint}`)
const toggled = build({
  ...baseShot,
  useScheduleVideoRef: true,
  useScheduleFrames: true,
  scheduleVideo: '/videos/old.mp4',
  scheduleFrames: ['/s1.jpg'],
})
check('旧 3D 字段不改变指纹', request.fingerprint === toggled.fingerprint, `${request.fingerprint} / ${toggled.fingerprint}`)
const noVideo = build({ ...baseShot, refIds: ['asset-img'] })
check('移除视频会改变指纹', request.fingerprint !== noVideo.fingerprint, `${request.fingerprint} / ${noVideo.fingerprint}`)

fs.rmSync(TMP, { recursive: true, force: true })
console.log(bad ? `\n${bad} 项失败` : '\n全部通过')
process.exit(bad ? 1 : 0)
