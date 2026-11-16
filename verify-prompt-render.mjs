/**
 * 出片提示词：bundle、脚本拼装、语义层优先级、右侧字段全覆盖
 * 跑法：node verify-prompt-render.mjs
 */
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { execFileSync } from 'node:child_process'

const root = path.dirname(fileURLToPath(import.meta.url))
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'verify-prompt-render-'))
const entry = path.join(tmp, 'entry.ts')
const abs = (p) => JSON.stringify(path.join(root, p))
fs.writeFileSync(
  entry,
  [
    `export * from ${abs('src/promptRender.ts')}`,
    `export * from ${abs('src/videoPrompt.ts')}`,
    `export * from ${abs('src/performance.ts')}`,
  ].join('\n') + '\n',
)
const bundle = path.join(tmp, 'bundle.mjs')
execFileSync(path.join(root, 'node_modules', '.bin', 'esbuild'), [
  entry,
  '--bundle',
  '--platform=node',
  '--format=esm',
  `--outfile=${bundle}`,
])
const lib = await import(bundle)

let bad = 0
const check = (name, cond, extra = '') => {
  console.log(`${cond ? '✅' : '❌'} ${name}${extra ? ' | ' + extra : ''}`)
  if (!cond) bad++
}
const count = (text, token) => text.split(token).length - 1

const chen = {
  id: '陈默',
  name: '陈默',
  role: '主角',
  lookCn: '雨衣',
  lookEn: 'weathered coat',
  palette: '冷青',
  keywords: [],
  image: '/generated/chen.jpg',
  voiceSample: { url: '/voices/chen.wav', seconds: 6, stale: false },
}

const shotData = {
  no: 'S01',
  seconds: 5,
  size: '中景',
  move: '推',
  dialogue: '陈默：别过来。',
  prompt: '雨夜摊位，陈默站在灯下',
  videoPrompt: '镜头缓慢前推',
  cast: ['陈默'],
  refIds: ['char-陈默'],
  performance: [
    { character: '陈默', emotion: 'fearful', intensity: 4, action: '后退半步', gaze: '门口', speaks: true },
  ],
  dialogueDelivery: [{ pace: 'slow', volume: 'soft', emphasis: '走' }],
  audioMode: 'off',
  marks: [],
}
const nodes = [{ id: 'n1', data: shotData }]
const req = lib.buildShotVideoRequest({
  data: shotData,
  nodeId: 'n1',
  nodes,
  characters: [chen],
})
const bundleJson = lib.buildShotPromptRenderBundle({
  data: shotData,
  nodeId: 'n1',
  nodes,
  characters: [chen],
  style: '赛博',
  aspect: '16:9',
  request: req,
})
check('bundle kind=shot', bundleJson.kind === 'shot')
check('bundle 含风格', bundleJson.video.visualStyle === '赛博')

// ---- 语义层：正文逐字等于 video_prompt，右侧字段一律不进正文 ----
check('有运动提示词用语义层', req.textSource === 'video_prompt', req.textSource)
check('正文逐字等于 video_prompt', req.prompt === '镜头缓慢前推', req.prompt)
for (const mark of ['【运镜】', '【台词】', '【表演方向】', '声音：', '参考图：', '@视频1', '【约束】']) {
  check(`正文不含 ${mark}`, !req.prompt.includes(mark), req.prompt)
}
check('参考图仍按连线提交', req.refs.length === 1 && req.refs[0].purpose === '人物外观', String(req.refs.length))

// ---- 空正文：阻断而非脚本拼装 ----
const emptyPrompt = {
  ...shotData,
  videoPrompt: '',
  prompt: '',
  videoPromptRendered: '旧九段应被忽略',
  videoPromptRenderMeta: {
    fingerprint: req.fingerprint,
    templateVersion: 'legacy',
    renderedAt: new Date().toISOString(),
  },
}
const scriptNodes = [{ id: 'n1', data: emptyPrompt }]
const reqScript = lib.buildShotVideoRequest({
  data: emptyPrompt,
  nodeId: 'n1',
  nodes: scriptNodes,
  characters: [chen],
})
check('空正文被 shot-prompt-empty 阻断', reqScript.blocking.some((b) => b.code === 'shot-prompt-empty'), JSON.stringify(reqScript.blocking.map((b) => b.code)))
check('空正文请求正文为空', reqScript.prompt === '')
check('忽略 video_prompt_rendered', !reqScript.prompt.includes('旧九段'))
check('面板 autoKind=semantic', lib.effectiveVideoPrompt(reqScript, undefined).autoKind === 'semantic')


const manual = lib.effectiveVideoPrompt(reqScript, {
  text: '手写正文，不追加',
  fingerprint: reqScript.fingerprint,
  createdAt: new Date().toISOString(),
})
check('手改逐字发送', manual.text === '手写正文，不追加' && manual.source === 'override')

// ---- 参考视频：只进槽位，不进正文 ----
const videoData = {
  ...shotData,
  videoPrompt: '雨夜追车，镜头推进',
  refIds: ['char-陈默', 'asset-v'],
}
const videoNodes = [
  { id: 'n1', data: videoData },
  { id: 'asset-v', type: 'asset', position: { x: 0, y: 0 }, data: { kind: 'video', url: '/videos/ref.mp4', title: '运镜参照' } },
]
const reqVideo = lib.buildShotVideoRequest({
  data: videoData,
  nodeId: 'n1',
  nodes: videoNodes,
  characters: [chen],
})
check('参考视频进入槽位', reqVideo.mode === 'video' && reqVideo.video?.label === '视频素材「运镜参照」')
check('参考视频正文零改写', reqVideo.prompt === '雨夜追车，镜头推进', reqVideo.prompt)
check('正文不出现 @视频1', !reqVideo.prompt.includes('@视频1'), reqVideo.prompt)
check('参考图槽位仍是 1 起连续', reqVideo.refs.map((r) => r.index).join(',') === '1', String(reqVideo.refs.length))

// ---- 原生音频：只影响槽位与模式，不写声音段 ----
const nativeData = { ...shotData, audioMode: 'native' }
const nativeNodes = [{ id: 'n1', data: nativeData }]
const reqNative = lib.buildShotVideoRequest({
  data: nativeData,
  nodeId: 'n1',
  nodes: nativeNodes,
  characters: [chen],
  model: { key: 'v', model: 'seedance-2.5', providerKind: 'apimart', audioOut: true },
})
check('原生音频槽位', reqNative.mode === 'native' && reqNative.audio?.character === '陈默')
check('原生音频不进正文', reqNative.prompt === '镜头缓慢前推', reqNative.prompt)
check('正文不含声音段', !reqNative.prompt.includes('声音：'), reqNative.prompt)

if (bad) {
  console.error(`\n${bad} 项失败`)
  process.exit(1)
}
console.log('\n全部通过')
