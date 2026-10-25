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
check('视频不占图片额度', request.refs.length === 2, String(request.refs.length))
check('缺失视频阻塞出片', request.blocking.some((x) => x.code === 'video-asset-missing'), JSON.stringify(request.blocking))
check('提示词只要求参考运动', /@视频1/.test(request.prompt) && /运动、机位与节奏/.test(request.prompt), request.prompt.slice(-160))
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

const native = build({ ...baseShot, audioMode: 'native' })
check('原生音频与视频素材冲突', native.blocking.some((x) => x.code === 'native-video-conflict'), JSON.stringify(native.blocking))

const withImages = build({ ...baseShot, refExtras: ['/b.jpg', '/c.jpg', '/d.jpg', '/e.jpg', '/f.jpg'] })
check('图片仍限 4 张', withImages.refs.length === 4, String(withImages.refs.length))
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
