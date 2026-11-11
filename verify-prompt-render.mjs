/**
 * 模板出片提示词：bundle、新鲜渲染、回退兼容
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
    `export * from ${abs('src/promptRenderSkill.ts')}`,
    `export * from ${abs('src/videoPrompt.ts')}`,
    `import renderSkill from ${JSON.stringify(path.join(root, 'skills/seedance-prompt-render/SKILL.md'))}`,
    `export { renderSkill }`,
    `export { parseSkillText } from ${abs('src/skills/parse.ts')}`,
  ].join('\n') + '\n',
)
const bundle = path.join(tmp, 'bundle.mjs')
execFileSync(path.join(root, 'node_modules', '.bin', 'esbuild'), [
  entry,
  '--bundle',
  '--platform=node',
  '--format=esm',
  '--loader:.md=text',
  `--outfile=${bundle}`,
])
const lib = await import(bundle)

let bad = 0
const check = (name, cond, extra = '') => {
  console.log(`${cond ? '✅' : '❌'} ${name}${extra ? ' | ' + extra : ''}`)
  if (!cond) bad++
}

const schedule = { scene: null, blocking: null, duration: 5, ready: false, status: '', reason: '' }
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
  schedule,
})
const bundleJson = lib.buildShotPromptRenderBundle({
  data: shotData,
  nodeId: 'n1',
  nodes,
  characters: [],
  schedule,
  style: '赛博',
  aspect: '16:9',
  request: req,
})
check('bundle kind=shot', bundleJson.kind === 'shot')
check('bundle 含风格', bundleJson.video.visualStyle === '赛博')

const skill = lib.parseSkillText('seedance-prompt-render', lib.renderSkill, 'builtin')
const resolved = await lib.resolveVideoPromptRenderPrompt({ style: '赛博', aspect: '16:9', episode: 1 })
check('设置技能驱动 system', resolved.system.includes(skill.role.slice(0, 20)))
check('templateVersion 含技能 id', resolved.templateVersion.startsWith('seedance-prompt-render@'))
const d2 = lib.formatPromptRenderTemplateVersion({ ...skill, task: skill.task + 'x' })
check('override 改变 version', resolved.templateVersion !== d2)
check(
  'parsePromptRenderResponse',
  lib.parsePromptRenderResponse('正文\n```json\n{"rendered_prompt":"正文","warnings":[]}\n```').rendered_prompt ===
    '正文',
)

const renderedText = '九段模板完整正文'
const withRender = {
  ...shotData,
  videoPromptRendered: renderedText,
  videoPromptRenderMeta: {
    fingerprint: req.fingerprint,
    templateVersion: resolved.templateVersion,
    renderedAt: new Date().toISOString(),
  },
}
const req2 = lib.buildShotVideoRequest({
  data: withRender,
  nodeId: 'n1',
  nodes: [{ id: 'n1', data: withRender }],
  characters: [],
  schedule,
})
check('新鲜渲染逐字使用', req2.prompt === renderedText)
check('textSource=template_render', req2.textSource === 'template_render')
check('渲染不含机械后缀【运镜', !req2.prompt.includes('【运镜与走位】'))

const eff = lib.effectiveVideoPrompt(req2, undefined, {
  text: withRender.videoPromptRendered,
  meta: withRender.videoPromptRenderMeta,
})
check('面板 autoKind=template', eff.autoKind === 'template')

const staleReq = lib.buildShotVideoRequest({
  data: { ...withRender, seconds: 6 },
  nodeId: 'n1',
  nodes: [{ id: 'n1', data: { ...withRender, seconds: 6 } }],
  characters: [],
  schedule,
})
check('秒数变化回退机械', staleReq.textSource !== 'template_render')

if (bad) {
  console.error(`\n${bad} 项失败`)
  process.exit(1)
}
console.log('\n全部通过')
