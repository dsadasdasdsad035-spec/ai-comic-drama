/**
 * 代码契约单测（任务 3.2 / 3.5 / 5.4）：Python 准入与渲染指纹。
 * 用 esbuild 现场打包 TS 模块，避免引入测试框架。
 */
import { build } from 'esbuild'
import path from 'node:path'

const ROOT = path.resolve(import.meta.dirname)
let bad = 0
const check = (name, cond, extra = '') => {
  console.log(`${cond ? '✅' : '❌'} ${name}${extra ? ` | ${extra}` : ''}`)
  if (!cond) bad++
}

async function load(entry) {
  const out = await build({
    entryPoints: [path.join(ROOT, entry)],
    bundle: true,
    format: 'esm',
    platform: 'node',
    write: false,
    logLevel: 'silent',
  })
  const code = out.outputFiles[0].text
  return import(`data:text/javascript;base64,${Buffer.from(code).toString('base64')}`)
}

const { checkSceneCode } = await load('src/sceneCodeSanitize.ts')
const { sceneCodeFingerprint } = await load('src/sceneCodeFingerprint.ts')
const { isSceneCodeFresh } = await load('src/sceneCodeFreshness.ts')
const { isRenderableSceneCode, sceneCodeRuntime } = await load('src/types.ts')
const { buildSceneCodeGeneratePrompt, SCENE_CODE_ABI } = await load('src/sceneCodePrompt.ts')

const prompt = buildSceneCodeGeneratePrompt({
  shot: { no: 'S01', prompt: '陈默站在门口', seconds: 3 },
  context: { version: 1, characterIds: [], designIds: [], assetUrls: [], imageUrls: [], videoUrls: [], sceneKeys: [], text: { prompt: true, videoPrompt: true, dialogue: 'all', cast: true, marks: true, sizeMove: true } },
  catalog: {
    characters: [],
    assets: [],
    scenes: [],
    props: [],
    images: [],
    videos: [],
    text: {
      prompt: '陈默站在门口',
      videoPrompt: '镜头推近',
      dialogue: [],
      cast: ['陈默'],
      sizeMove: '中景 · 推 · 3s',
      marks: '',
    },
    defaults: {},
  },
  assets: [],
  duration: 3,
  aspect: '16:9',
  engineVersion: '5.2.2',
})
check('提示词写明引擎版本', prompt.includes('Blender 5.2.2'))
check('锁定 ABI 含 build/pose', SCENE_CODE_ABI.includes('def build') && SCENE_CODE_ABI.includes('def pose'))
check('提示词不再出现 Three.js', !/Three\.js/i.test(`${prompt}\n${SCENE_CODE_ABI}`))

const GOOD = `import bpy
def build(ctx):
    bpy.ops.mesh.primitive_cube_add()
def pose(t, mode):
    pass
def dispose():
    pass
`
check('合法代码通过', checkSceneCode(GOOD).ok)

check('缺少 build 被拒绝', !checkSceneCode('def pose(t, mode):\n    pass\n').ok)
check('缺少 pose 被拒绝', !checkSceneCode('def build(ctx):\n    pass\n').ok)
check('import os 被拒绝', !checkSceneCode(GOOD.replace('import bpy', 'import bpy\nimport os')).ok)
check('subprocess 被拒绝', !checkSceneCode(GOOD.replace('import bpy', 'import bpy\nfrom subprocess import run')).ok)
check('bpy.ops.wm 被拒绝', !checkSceneCode(GOOD.replace('def pose', 'bpy.ops.wm.save_as_mainfile(filepath="x")\ndef pose')).ok)
check('open() 被拒绝', !checkSceneCode(GOOD.replace('def pose', 'open("/tmp/x", "w")\ndef pose')).ok)
check('eval 被拒绝', !checkSceneCode(GOOD.replace('def pose', 'eval("1")\ndef pose')).ok)
check('超长代码被拒绝', !checkSceneCode(GOOD + '\n# x'.repeat(120000)).ok)

const BODY = `import bpy

def build(ctx):
    bpy.ops.mesh.primitive_cube_add()

def pose(t, mode):
    pass

def dispose():
    pass`
const fencedTail = checkSceneCode('```python\n' + BODY + '\n```\n\n以上是代码。')
check('围栏+尾随说明被清理', fencedTail.ok && !fencedTail.code.includes('```') && fencedTail.code.startsWith('import bpy'), fencedTail.code.slice(0, 30))
const fencedHead = checkSceneCode('这是代码：\n```python\n' + BODY + '\n```')
check('围栏+前置说明被清理', fencedHead.ok && fencedHead.code.startsWith('import bpy'), fencedHead.code.slice(0, 30))
const bareLang = checkSceneCode('python\n' + BODY)
check('裸语言行被去掉', bareLang.ok && bareLang.code.startsWith('import bpy'), bareLang.code.slice(0, 30))
check('未闭合围栏被拒绝', !checkSceneCode('```python\n' + BODY).ok)
const oldJs = 'let S;\nfunction init(ctx) {}\nfunction renderAt(t) {}\ndef build(ctx):\n    pass\ndef pose(t, mode):\n    pass'
const oldCheck = checkSceneCode(oldJs)
check('旧 Three.js 代码被拒绝', !oldCheck.ok && oldCheck.errors.some((e) => e.includes('Three.js')), JSON.stringify(oldCheck.errors))

const codeV1 = { version: 1, abiVersion: 1, code: 'x', codeHash: 'h', source: 'manual', updatedAt: '' }
const codeV2 = {
  version: 2,
  abiVersion: 2,
  runtime: 'blender',
  engineVersion: '5.2.2',
  code: 'x',
  codeHash: 'h',
  source: 'manual',
  updatedAt: '',
}
check('旧 three 代码不可渲染', !isRenderableSceneCode(codeV1) && sceneCodeRuntime(codeV1) === 'three')
check('v2 Blender 代码可渲染', isRenderableSceneCode(codeV2) && sceneCodeRuntime(codeV2) === 'blender')

const assets = [{ key: 'k', kind: 'image', contentHash: 'c' }]
const fp = (engineVersion) =>
  sceneCodeFingerprint({
    codeHash: 'h',
    abiVersion: 2,
    runtime: 'blender',
    engineVersion,
    assets,
    duration: 3,
    aspect: '16:9',
    mode: 'clean',
    fps: 30,
    frames: 90,
  })
const meta = (engineVersion, fingerprint) => ({
  version: 2,
  fingerprint,
  codeHash: 'h',
  abiVersion: 2,
  runtime: 'blender',
  engineVersion,
  assets,
  duration: 3,
  aspect: '16:9',
  width: 960,
  height: 540,
  fps: 30,
  frames: 90,
  tier: 'final',
  mode: 'clean',
  renderedAt: '',
})
const fresh = (engineVersion) =>
  isSceneCodeFresh({
    sceneCode: codeV2,
    meta: meta(engineVersion, fp(engineVersion)),
    seconds: 3,
    aspect: '16:9',
    hasVideo: true,
  })
check('匹配指纹判定为生效', fresh('5.2.2'))
check('引擎版本变化判定为过期', !fresh('5.3.0'))
check('旧 v1 代码判定为过期', !isSceneCodeFresh({
  sceneCode: codeV1,
  meta: { ...meta('5.2.2', fp('5.2.2')), version: 1, abiVersion: 1, runtime: 'three' },
  seconds: 3,
  aspect: '16:9',
  hasVideo: true,
}))
check('时长变化判定为过期', !isSceneCodeFresh({
  sceneCode: codeV2,
  meta: meta('5.2.2', fp('5.2.2')),
  seconds: 6,
  aspect: '16:9',
  hasVideo: true,
}))
check('没有视频判定为过期', !isSceneCodeFresh({
  sceneCode: codeV2,
  meta: meta('5.2.2', fp('5.2.2')),
  seconds: 3,
  aspect: '16:9',
  hasVideo: false,
}))

// ---------------------------------------------------------------- manifest
const { buildManifest, manifestText, manifestSummary } = await load('src/contextManifest.ts')
const catalog = {
  characters: [],
  assets: [],
  props: [],
  videos: [],
  images: [{ key: 'image:u1', category: 'image', kind: 'image', label: '参考图', url: 'u1' }],
  scenes: [
    { key: 'scene:E01-SC01', category: 'scene', kind: 'scene-text', label: 'E01 · SC01 · 井道', subtitle: '地下 · 夜', episode: 1 },
  ],
  text: {
    prompt: '陈默站在门口',
    videoPrompt: '镜头推近',
    dialogue: [
      { index: 0, speaker: '陈默', text: '别动' },
      { index: 1, speaker: '旁白', text: '门开了' },
    ],
    cast: ['陈默'],
    sizeMove: '中景 · 推 · 3.0s',
    marks: '冷光',
  },
  defaults: {},
}
const manifestContext = {
  version: 1,
  characterIds: [],
  designIds: [],
  assetUrls: [],
  imageUrls: ['u1'],
  videoUrls: [],
  sceneKeys: [],
  text: { prompt: true, videoPrompt: false, dialogue: [1], cast: false, marks: false, sizeMove: false },
}
const manifest = buildManifest({ context: manifestContext, catalog, shotNo: 'S01', duration: 3, aspect: '16:9' })
const attachmentText = manifestText(manifest)
check('manifest 只含显式附件', manifest.attachments.length === 3, JSON.stringify(manifest.attachments.map((a) => a.key)))
check('manifest 元数据只有镜号/时长/画幅', manifest.shot.no === 'S01' && manifest.shot.duration === 3 && manifest.shot.aspect === '16:9')
check('manifest 文本含已选 prompt 与台词', attachmentText.includes('画面提示词：陈默站在门口') && attachmentText.includes('旁白：门开了'), attachmentText)
check('manifest 文本不含未选内容', !attachmentText.includes('镜头推近') && !attachmentText.includes('中景') && !attachmentText.includes('冷光') && !attachmentText.includes('E01'), attachmentText)
check('manifest 文本含素材稳定键', attachmentText.includes('key=image:u1') && attachmentText.includes('参考图'), attachmentText)
const summary = manifestSummary(manifest)
check('manifest 摘要计数', summary.counts.image === 1 && summary.counts.text === 2 && summary.counts.video === 0 && summary.attachmentKeys.length === 3, JSON.stringify(summary.counts))
const briefOn = manifestText(manifest, { 'image:u1': '冷光下的短发男人' })
check('brief 默认参与', briefOn.includes('brief：冷光下的短发男人'))
const briefOffManifest = buildManifest({ context: { ...manifestContext, briefOff: ['image:u1'] }, catalog, shotNo: 'S01', duration: 3, aspect: '16:9' })
const briefOffText = manifestText(briefOffManifest, { 'image:u1': '冷光下的短发男人' })
check('briefOff 排除 brief', !briefOffText.includes('冷光下的短发男人'), briefOffText)
const emptyManifest = buildManifest({ context: { ...manifestContext, imageUrls: [], text: { prompt: false, videoPrompt: false, dialogue: [], cast: false, marks: false, sizeMove: false } }, catalog, shotNo: 'S02', duration: 2, aspect: '9:16' })
check('空清单只有镜头头', emptyManifest.attachments.length === 0 && manifestText(emptyManifest).trim() === '【镜头】S02｜2.0s｜9:16', manifestText(emptyManifest))

console.log(bad ? `\n${bad} 项失败` : '\n全部通过')
process.exit(bad ? 1 : 0)
