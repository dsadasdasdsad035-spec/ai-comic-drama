/**
 * 视频验收编排回归：mock render/save/extract/review/persist，不调用真实浏览器或模型。
 * 跑法：node verify-agent-video-acceptance.mjs
 */
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { execFileSync } from 'node:child_process'

const root = path.dirname(fileURLToPath(import.meta.url))
const tmp = fs.mkdtempSync(path.join(root, '.verify-video-'))
const entry = path.join(tmp, 'entry.ts')
fs.writeFileSync(entry, `export * from ${JSON.stringify(path.join(root, 'src/agent/agentVideoAcceptance.ts'))}\nexport * from ${JSON.stringify(path.join(root, 'src/sceneCodePrepare.ts'))}\nexport * from ${JSON.stringify(path.join(root, 'src/sceneCodeFreshness.ts'))}\n`)
const bundle = path.join(tmp, 'bundle.mjs')
execFileSync(path.join(root, 'node_modules', '.bin', 'esbuild'), [
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
  console.log(`${cond ? '✅' : '❌'} ${name}${extra ? ` | ${extra}` : ''}`)
  if (!cond) bad++
}

const input = {
  code: 'import bpy\n\ndef build(ctx):\n    bpy.ops.mesh.primitive_cube_add()\n\ndef pose(t, mode):\n    pass\n\ndef dispose():\n    pass',
  codeHash: 'abcdef1234567890',
  assets: [],
  duration: 4,
  aspect: '16:9',
  requirements: ['山体', '两名人物', '对打'],
  settings: null,
}
const framesFor = (count) =>
  Array.from({ length: count }, (_, i) => ({ t: i, url: `/frames/${i}.jpg` }))
const passReview = () => ({
  passed: true,
  usedVision: true,
  modelKey: 'vision-test',
  items: input.requirements.map((label, i) => ({ key: `req-${i}`, label, ok: true })),
  summary: '全部通过',
})
const failReview = () => ({
  ...passReview(),
  passed: false,
  items: input.requirements.map((label, i) => ({
    key: `req-${i}`,
    label,
    ok: i === 0,
    ...(i === 0 ? {} : { reason: '画面里没有看到' }),
  })),
  summary: '部分未通过',
})
const baseDeps = (over = {}) => {
  const calls = []
  const deps = {
    render: async () => {
      calls.push('render')
      return new Blob(['webm'], { type: 'video/webm' })
    },
    save: async () => {
      calls.push('save')
      return '/videos/test.mp4'
    },
    extract: async (_url, count) => {
      calls.push('extract')
      return { urls: framesFor(count).map((f) => f.url), duration: input.duration }
    },
    review: async (frames) => {
      calls.push('review')
      return passReview()
    },
    persist: async () => {
      calls.push('persist')
    },
    ...over,
  }
  return { deps, calls }
}

check('4 秒镜头 5 帧', lib.videoFrameCount(4) === 5, String(lib.videoFrameCount(4)))
check('8 秒镜头 9 帧', lib.videoFrameCount(8) === 9, String(lib.videoFrameCount(8)))
check('12 秒镜头 9 帧', lib.videoFrameCount(12) === 9, String(lib.videoFrameCount(12)))
check(
  '4 秒帧时间覆盖首尾',
  JSON.stringify(lib.videoFrameTimes(4)) === JSON.stringify([0, 1, 2, 3, 4]),
  JSON.stringify(lib.videoFrameTimes(4)),
)
check(
  '8 秒帧时间包含末帧',
  lib.videoFrameTimes(8)[0] === 0 && lib.videoFrameTimes(8).at(-1) === 8 && lib.videoFrameTimes(8).length === 9,
  JSON.stringify(lib.videoFrameTimes(8)),
)
check(
  '12 秒帧时间均匀',
  lib.videoFrameTimes(12).length === 9 && lib.videoFrameTimes(12).at(-1) === 12 && lib.videoFrameTimes(12)[1] === 1.5,
  JSON.stringify(lib.videoFrameTimes(12)),
)

{
  const { deps, calls } = baseDeps()
  const r = await lib.runVideoAcceptance(input, deps)
  check('通过时状态 passed', r.status === 'passed' && r.saved === true, JSON.stringify(r))
  check('通过时调用顺序正确', calls.join('>') === 'render>save>extract>review>persist', calls.join('>'))
  check('通过时使用 5 帧', r.frames.length === 5, String(r.frames.length))
  check('通过时抽出首尾帧', r.frames[0]?.t === 0 && r.frames.at(-1)?.t === 4, JSON.stringify(r.frames.map((f) => f.t)))
  check('通过摘要包含哈希和 MP4', /abcdef1234/.test(lib.agentVideoSummary(r)) && /已保存/.test(lib.agentVideoSummary(r)), lib.agentVideoSummary(r))
}

{
  let persisted = false
  const { deps } = baseDeps({ review: async () => failReview(), persist: async () => { persisted = true } })
  const r = await lib.runVideoAcceptance(input, deps)
  check('未通过时状态 rejected', r.status === 'rejected' && r.errorCode === 'review_failed', JSON.stringify(r))
  check('未通过时不持久化', persisted === false)
  const text = lib.agentVideoSummary(r)
  check('未通过摘要列出失败项', /未保存/.test(text) && /两名人物/.test(text), text)
}

{
  let persisted = false
  const { deps } = baseDeps({
    review: async () => ({ ...passReview(), passed: false, usedVision: false, needsHumanReview: true, summary: '未配置视觉模型' }),
    persist: async () => { persisted = true },
  })
  const r = await lib.runVideoAcceptance(input, deps)
  check('无视觉模型转人工', r.status === 'needs_human' && r.errorCode === 'vision_unavailable', JSON.stringify(r))
  check('无视觉模型不持久化', persisted === false)
  check('无视觉摘要要求人工', /人工检查/.test(lib.agentVideoSummary(r)), lib.agentVideoSummary(r))
}

{
  let persisted = false
  const { deps } = baseDeps({
    extract: async () => { throw new Error('ffmpeg 抽帧失败') },
    persist: async () => { persisted = true },
  })
  const r = await lib.runVideoAcceptance(input, deps)
  check('抽帧失败保留视频并转人工', r.status === 'needs_human' && r.errorCode === 'extract_failed' && Boolean(r.videoUrl), JSON.stringify(r))
  check('抽帧失败不持久化', persisted === false)
}

{
  const { deps } = baseDeps({ render: async () => { throw new Error('WebGL 崩溃') } })
  const r = await lib.runVideoAcceptance(input, deps)
  check('渲染失败状态正确', r.status === 'failed' && r.errorCode === 'render_failed' && !r.videoUrl, JSON.stringify(r))
}

{
  const { deps } = baseDeps({ persist: async () => { throw new Error('磁盘满') } })
  const r = await lib.runVideoAcceptance(input, deps)
  check('保存失败状态正确', r.status === 'failed' && r.errorCode === 'save_failed' && Boolean(r.videoUrl) && Boolean(r.review), JSON.stringify(r))
  check('保存失败摘要说明未保存', /保存失败/.test(lib.agentVideoSummary(r)), lib.agentVideoSummary(r))
}

{
  const controller = new AbortController()
  let persisted = false
  const { deps } = baseDeps({
    render: async () => {
      await new Promise((r) => setTimeout(r, 80))
      return new Blob(['webm'])
    },
    persist: async () => { persisted = true },
  })
  setTimeout(() => controller.abort(), 10)
  const r = await lib.runVideoAcceptance({ ...input, signal: controller.signal }, deps)
  check('取消状态正确', r.status === 'cancelled' && r.errorCode === 'cancelled', JSON.stringify(r))
  check('取消不持久化', persisted === false)
}

{
  let persisted = false
  const { deps } = baseDeps({
    render: async () => {
      await new Promise((r) => setTimeout(r, 100))
      return new Blob(['webm'])
    },
    persist: async () => { persisted = true },
  })
  const r = await lib.runVideoAcceptance(
    { ...input, limits: { renderMs: 20, totalMs: 100, saveMs: 20, extractMs: 20, reviewMs: 20 } },
    deps,
  )
  check('超时状态正确', r.status === 'timeout' && r.errorCode === 'timeout', JSON.stringify(r))
  check('超时不持久化', persisted === false)
}

{
  const context = {
    version: 1,
    characterIds: [],
    designIds: [],
    assetUrls: [],
    imageUrls: [],
    videoUrls: [],
    sceneKeys: [],
    text: { prompt: false, videoPrompt: false, dialogue: 'all', cast: false, marks: false, sizeMove: false },
    updatedAt: new Date().toISOString(),
  }
  const catalog = {
    characters: [],
    assets: [],
    scenes: [],
    props: [],
    images: [],
    videos: [],
    text: { dialogue: [], cast: [] },
    defaults: context,
  }
  const prepared = await lib.prepareSceneCodeContext({ context, catalog, settings: null })
  check('视频保存上下文使用运行快照', prepared.context === context && prepared.context.sceneKeys.length === 0)
  check('画布出片在有未保存草稿时阻止', lib.shouldBlockCanvasCodeRender('shot-1', true, 'shot-1') === true)
  check('画布出片在其他镜头时不阻止', lib.shouldBlockCanvasCodeRender('shot-1', true, 'shot-2') === false)
  check('画布出片在无草稿时不阻止', lib.shouldBlockCanvasCodeRender('shot-1', false, 'shot-1') === false)
}

console.log(bad === 0 ? '\n全部通过' : `\n${bad} 项失败`)
process.exit(bad === 0 ? 0 : 1)
