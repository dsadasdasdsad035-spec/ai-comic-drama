/**
 * set_scene_code / get_shot_context 回归：提交后上下文必须回报新代码摘要。
 */
import { build } from 'esbuild'
import path from 'node:path'

const ROOT = process.cwd()
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
  return import(`data:text/javascript;base64,${Buffer.from(out.outputFiles[0].text).toString('base64')}`)
}

const { createSceneAgentTools, createSceneAgentSession } = await load('src/agent/sceneAgentTools.ts')

const BASE = `import bpy

def build(ctx):
    bpy.ops.mesh.primitive_cube_add()

def pose(t, mode):
    pass

def dispose():
    pass`

const NEXT = `import bpy

def build(ctx):
    bpy.ops.mesh.primitive_cube_add()
    bpy.ops.mesh.primitive_uv_sphere_add()

def pose(t, mode):
    pass

def dispose():
    pass`

const session = createSceneAgentSession()
session.code = BASE
session.codeHash = 'baseline0001'
session.codeOrigin = 'baseline'

const deps = {
  getShotContext: () => '【镜头】S01｜3.0s｜16:9\n【文本附件】无',
  runTrial: async () => ({ ok: true }),
  captureFrames: async () => [],
  reviewFrames: async () => ({ passed: true, usedVision: true, items: [] }),
  onEvent: () => {},
}
const { byName } = createSceneAgentTools(deps, session)
const getContext = byName.get('get_shot_context')
const setCode = byName.get('set_scene_code')

const first = await getContext.invoke({})
check('基线上下文含旧代码行数', String(first.context).includes('10 行'), String(first.context).slice(-120))

const submitted = await setCode.invoke({ code: NEXT })
check('提交成功并返回新行数', submitted.ok === true && submitted.lineCount === 11, JSON.stringify(submitted))

const second = await getContext.invoke({})
check(
  '提交后上下文显示新代码',
  String(second.context).includes('11 行') && !String(second.context).includes('10 行'),
  String(second.context).slice(-160),
)
check(
  '提交后上下文 hash 更新',
  String(second.context).includes(String(submitted.codeHash || '').slice(0, 10)),
  String(second.context).slice(-160),
)

const invalid = await setCode.invoke({ code: 'let S;\nfunction init(ctx) {}\ndef build(ctx):\n    pass\ndef pose(t, mode):\n    pass' })
check('旧 Three.js 代码提交失败', invalid.ok === false && String(invalid.error || '').includes('Three.js'), JSON.stringify(invalid))

console.log(bad ? `\n${bad} 项失败` : '\n全部通过')
process.exit(bad ? 1 : 0)
