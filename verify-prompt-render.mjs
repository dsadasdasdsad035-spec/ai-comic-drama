/**
 * 出片提示词：bundle、脚本拼装、语义层优先级
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

const shotData = {
  no: 'S01',
  seconds: 5,
  size: '中景',
  move: '推',
  dialogue: '陈默：你好。',
  prompt: '雨夜摊位',
  videoPrompt: '镜头缓慢前推',
  cast: ['陈默'],
  refIds: [],
  audioMode: 'off',
  marks: [],
}
const nodes = [{ id: 'n1', data: shotData }]
const req = lib.buildShotVideoRequest({
  data: shotData,
  nodeId: 'n1',
  nodes,
  characters: [],
})
const bundleJson = lib.buildShotPromptRenderBundle({
  data: shotData,
  nodeId: 'n1',
  nodes,
  characters: [],
  style: '赛博',
  aspect: '16:9',
  request: req,
})
check('bundle kind=shot', bundleJson.kind === 'shot')
check('bundle 含风格', bundleJson.video.visualStyle === '赛博')
check('有运动提示词用语义层', req.textSource === 'video_prompt' && req.prompt === '镜头缓慢前推')

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
const reqScript = lib.buildShotVideoRequest({
  data: emptyPrompt,
  nodeId: 'n1',
  nodes: [{ id: 'n1', data: emptyPrompt }],
  characters: [],
})
check('双空走脚本拼装', reqScript.textSource === 'script_assembled')
check('忽略 video_prompt_rendered', !reqScript.prompt.includes('旧九段'))
check('脚本含运镜段', reqScript.prompt.includes('【运镜】'))
check('请求与拼装一致', reqScript.prompt === lib.shotAutoScriptPrompt({
  data: emptyPrompt,
  nodeId: 'n1',
  nodes: [{ id: 'n1', data: emptyPrompt }],
  characters: [],
  style: '',
  aspect: '16:9',
  request: reqScript,
}))
check('面板 autoKind=script', lib.effectiveVideoPrompt(reqScript, undefined).autoKind === 'script')

const scriptDirect = lib.assembleShotPromptScript(bundleJson)
check('assembleShotPromptScript 非空', scriptDirect.length > 20)
check('脚本含结构化段落', scriptDirect.includes('【画面】') || scriptDirect.includes('【运镜】'))

if (bad) {
  console.error(`\n${bad} 项失败`)
  process.exit(1)
}
console.log('\n全部通过')
