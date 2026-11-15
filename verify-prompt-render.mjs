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

// ---- 语义层：运动提示词仍是正文首段，其余右侧字段补齐 ----
check('有运动提示词用语义层', req.textSource === 'video_prompt', req.textSource)
check('正文以运动提示词开头', req.prompt.startsWith('镜头缓慢前推'), req.prompt.slice(0, 60))
check('语义层补运镜段', req.prompt.includes('【运镜】') && req.prompt.includes('景别：中景'))
check('语义层补镜头语言术语', /镜头语言：/.test(req.prompt), req.prompt)
check('语义层补台词', req.prompt.includes('【台词】') && req.prompt.includes('别过来'))
check(
  '表演强度/动作/视线/说话进正文',
  req.prompt.includes('【表演方向】') &&
    req.prompt.includes('强度 4') &&
    req.prompt.includes('后退半步') &&
    req.prompt.includes('视线门口') &&
    req.prompt.includes('本镜说话'),
  req.prompt,
)
check(
  '台词表演进正文',
  req.prompt.includes('语速慢') && req.prompt.includes('压低') && req.prompt.includes('重音「走」'),
  req.prompt,
)
check('参考图槽位注记', req.prompt.includes('[图1]=角色「陈默」外观'), req.prompt)
check('正文带全局约束', req.prompt.includes('【约束】') && req.prompt.includes('无字幕'))
check('每段只出现一次', count(req.prompt, '【运镜】') === 1 && count(req.prompt, '【参考】') === 0)

// ---- 脚本层：双空时结构化拼装，且携带同样的字段 ----
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
check('双空走脚本拼装', reqScript.textSource === 'script_assembled')
check('忽略 video_prompt_rendered', !reqScript.prompt.includes('旧九段'))
check('脚本含运镜段', reqScript.prompt.includes('【运镜】'))
check(
  '脚本含表演强度/视线/说话',
  reqScript.prompt.includes('强度 4') && reqScript.prompt.includes('视线门口') && reqScript.prompt.includes('本镜说话'),
  reqScript.prompt,
)
check('脚本含台词表演', reqScript.prompt.includes('语速慢') && reqScript.prompt.includes('重音「走」'))
check('脚本含参考图槽位', reqScript.prompt.includes('[图1]=角色「陈默」外观'))
check(
  '请求与拼装一致',
  reqScript.prompt ===
    lib.shotAutoScriptPrompt({
      data: emptyPrompt,
      nodeId: 'n1',
      nodes: scriptNodes,
      characters: [chen],
      style: '',
      aspect: '16:9',
      request: reqScript,
    }),
  reqScript.prompt.slice(0, 120),
)
check('面板 autoKind=script', lib.effectiveVideoPrompt(reqScript, undefined).autoKind === 'script')

// ---- 手改正文逐字发送，不追加任何自动段落 ----
const manual = lib.effectiveVideoPrompt(reqScript, {
  text: '手写正文，不追加',
  fingerprint: reqScript.fingerprint,
  createdAt: new Date().toISOString(),
})
check('手改逐字发送', manual.text === '手写正文，不追加' && manual.source === 'override')

// ---- 参考视频：@视频1 与 @图像N 同时出现 ----
const videoData = {
  ...shotData,
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
check('参考视频进入正文', reqVideo.mode === 'video' && reqVideo.prompt.includes('@视频1'), reqVideo.prompt)
check('有视频时图片用 @图像N', reqVideo.prompt.includes('@图像1=角色「陈默」外观'), reqVideo.prompt)
check('视频范围约束只出现一次', count(reqVideo.prompt, '@视频1') === 1, String(count(reqVideo.prompt, '@视频1')))

// ---- 原生音频：台词转成声音段，带音色参考 ----
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
check('原生音频声音段进正文', reqNative.prompt.includes('声音：') && reqNative.prompt.includes('陈默说：“别过来。”'), reqNative.prompt)
check('原生音频不重复台词段', !reqNative.prompt.includes('【台词】'), reqNative.prompt)

// ---- assembleShotPromptScript 结构 ----
const scriptDirect = lib.assembleShotPromptScript(bundleJson)
check('assembleShotPromptScript 非空', scriptDirect.length > 20)
check('脚本含结构化段落', scriptDirect.includes('【画面】') || scriptDirect.includes('【运镜】'))

if (bad) {
  console.error(`\n${bad} 项失败`)
  process.exit(1)
}
console.log('\n全部通过')
