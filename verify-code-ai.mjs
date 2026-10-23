/**
 * 代码模型编排纯函数回归：上下文、无 base64、成功/失败/取消、无模型、聊天完整代码。
 * 跑法：node verify-code-ai.mjs
 */
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { execFileSync } from 'node:child_process'

const root = path.dirname(fileURLToPath(import.meta.url))
const tmp = fs.mkdtempSync(path.join(root, '.verify-code-ai-'))
const entry = path.join(tmp, 'entry.ts')
fs.writeFileSync(
  entry,
  `export * from ${JSON.stringify(path.join(root, 'src/sceneCodePrompt.ts'))}\n` +
    `export * from ${JSON.stringify(path.join(root, 'src/sceneCodeJob.ts'))}\n` +
    `export * from ${JSON.stringify(path.join(root, 'src/sceneCodeChat.ts'))}\n`,
)
const bundle = path.join(tmp, 'bundle.mjs')
execFileSync(path.join(root, 'node_modules', '.bin', 'esbuild'), [
  entry, '--bundle', '--platform=node', '--format=esm', '--log-level=error', `--outfile=${bundle}`,
])
const lib = await import(bundle)
let bad = 0
const check = (name, cond, extra = '') => {
  console.log(`${cond ? '✅' : '❌'} ${name}${extra ? ` | ${extra}` : ''}`)
  if (!cond) bad++
}

const shot = {
  no: 'S01',
  seconds: 3,
  size: '中景',
  move: '推',
  cast: ['陈默'],
  dialogue: '陈默：别动\n鸦：你听见了吗',
  prompt: '陈默站在井道门口，冷光',
  videoPrompt: '缓慢推近',
  marks: [{ id: 'm', kind: 'rect', x: 0.1, y: 0.2, w: 0.2, h: 0.2, color: '#f00' }],
}
const context = {
  version: 1,
  characterIds: ['chenmo'],
  designIds: ['scene-1'],
  assetUrls: [],
  imageUrls: ['/generated/s01.png'],
  videoUrls: [],
  sceneKeys: ['E01-SC02'],
  text: { prompt: true, videoPrompt: true, dialogue: [1], cast: true, marks: true, sizeMove: true },
  dialogueHash: 'x',
}
const catalog = {
  characters: [], assets: [], scenes: [], props: [], images: [], videos: [],
  text: { prompt: shot.prompt, videoPrompt: shot.videoPrompt, dialogue: [], cast: ['陈默'], sizeMove: '中景', marks: '左侧标注' },
  defaults: context,
}
const asset = {
  payload: { key: 'character:chenmo', kind: 'image', label: '陈默', mime: 'image/png', bytes: new ArrayBuffer(4), width: 16, height: 16 },
  ref: { key: 'character:chenmo', url: '/a.png', kind: 'image', source: 'character', label: '陈默', contentHash: 'abc' },
}
const prompt = lib.buildSceneCodeContext({ shot, context, catalog, assets: [asset], duration: 3, aspect: '16:9' })
check('上下文包含镜头提示词', prompt.includes('陈默站在井道门口'))
check('上下文只含选中的第二句台词', prompt.includes('你听见了吗') && !prompt.includes('别动'))
check('上下文包含素材稳定键', prompt.includes('character:chenmo'))
check('上下文不含 base64', !/data:image\//i.test(prompt))
const code = 'function init(ctx) {}\n// keep this line\nfunction renderAt(t) {}\nfunction dispose() {}'
const withCode = lib.buildSceneCodeContext({ shot, context, catalog, assets: [], currentCode: code, duration: 3, aspect: '16:9' })
check('当前代码保留换行和注释', withCode.includes('// keep this line') && withCode.includes('\n'))
const raw = lib.parseSceneCodeResult({ reply: 'ok', code, motionNote: '推近' })
check('解析完整代码结果', raw.code === code && raw.motionNote === '推近')

const settings = {
  providers: [],
  models: [{ key: 'code', label: 'Code', cap: 'text', provider: 'p', model: 'm' }],
  defaults: { text: 'code' },
  stageModels: { sceneCode: 'code' },
  apiKey: '',
  rules: {},
}
const base = { shot, context, catalog, assets: [asset], duration: 3, aspect: '16:9', settings }
let trialCode = ''
const success = await lib.runSceneCodeJob({
  ...base,
  ask: async (o) => ({ json: { reply: '生成了', code, motionNote: '推近' }, modelKey: o.modelKey, modelLabel: 'Code' }),
  trial: async (c) => { trialCode = c },
})
check('成功生成并用代码模型', success.code === code && success.modelKey === 'code', JSON.stringify(success))
check('成功前执行沙箱试运行', trialCode === code)
let failed = ''
try {
  await lib.runSceneCodeJob({ ...base, ask: async () => ({ json: { reply: '没有代码' } }) })
} catch (e) { failed = e.message }
check('缺 code 失败不返回', /code/.test(failed), failed)
let syntax = ''
try {
  await lib.runSceneCodeJob({ ...base, ask: async () => ({ json: { reply: 'bad', code: 'function init( {' } }) })
} catch (e) { syntax = e.message }
check('语法错误被拒绝', /语法|代码不可用/.test(syntax), syntax)
let noModel = ''
try {
  await lib.runSceneCodeJob({ ...base, settings: { ...settings, models: [], defaults: {}, stageModels: {} }, ask: async () => ({ json: { code } }) })
} catch (e) { noModel = e.message }
check('无代码模型明确提示', /代码文本模型/.test(noModel), noModel)
let cancelled = ''
try {
  await lib.runSceneCodeJob({ ...base, ask: async () => { throw new DOMException('已取消', 'AbortError') } })
} catch (e) { cancelled = e.name }
check('取消原样抛出', cancelled === 'AbortError', cancelled)

let repairCalls = 0
const badRuntime = 'let S;\nfunction init() { S = ctx; }\nfunction renderAt(t) {}\nfunction dispose() {}'
const repaired = await lib.runSceneCodeJob({
  ...base,
  ask: async (o) => {
    repairCalls++
    return { json: { reply: repairCalls === 1 ? '初版' : '已修复', code: repairCalls === 1 ? badRuntime : code } }
  },
  trial: async (c) => { if (c.includes('S = ctx')) throw new Error('ctx is not defined') },
})
check('运行错误修复一次', repairCalls === 2 && repaired.code === code, `calls=${repairCalls}`)
let repairFailed = ''
try {
  await lib.runSceneCodeJob({
    ...base,
    ask: async () => ({ json: { code: badRuntime } }),
    trial: async () => { throw new Error('still broken') },
  })
} catch (e) { repairFailed = e.message }
check('修复仍失败不返回', /still broken/.test(repairFailed), repairFailed)

const chat = await lib.runSceneCodeChat({
  ...base,
  currentCode: code,
  message: '把机位推近',
  history: [{ role: 'user', text: '旧消息' }],
  ask: async (o) => {
    check('聊天使用 chat system', String(o.system).includes('当前镜头'))
    return { json: { reply: '改好', code: code.replace('init(ctx)', 'init(ctx) /* closer */') } }
  },
})
check('聊天返回完整代码', chat.code.includes('/* closer */'))

fs.rmSync(tmp, { recursive: true, force: true })
console.log(bad ? `\n${bad} failed` : '\nall passed')
process.exit(bad ? 1 : 0)
