/**
 * adopt_scene_from_job 与默认 full_host 工具集验收（mock，无需 Blender）。
 * 跑法：node verify-scene3d-adopt.mjs
 */
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { execFileSync } from 'node:child_process'

const root = path.dirname(fileURLToPath(import.meta.url))
const tmp = fs.mkdtempSync(path.join(root, '.verify-scene3d-adopt-'))
const entry = path.join(tmp, 'entry.ts')
fs.writeFileSync(
  entry,
  [
    `export * from ${JSON.stringify(path.join(root, 'src/agent/sceneAgentTools.ts'))}`,
    `export * from ${JSON.stringify(path.join(root, 'src/agent/sceneAgentTypes.ts'))}`,
    '',
  ].join('\n'),
)
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

const CODE = `import bpy
from mathutils import Vector

def build(ctx):
    bpy.ops.mesh.primitive_cone_add(location=(0, 0, 1))
    ctx.camera.location = (5, -5, 4)

def pose(t, mode):
    pass

def dispose():
    pass`

let bad = 0
const check = (name, cond, extra = '') => {
  console.log(`${cond ? '✅' : '❌'} ${name}${extra ? ` | ${extra}` : ''}`)
  if (!cond) bad++
}

const session = lib.createSceneAgentSession()
const files = new Map([['scene/main.py', CODE]])
const hostDeps = () => ({
  getShotContext: () => '镜头 S01',
  runTrial: async () => ({ ok: true }),
  captureFrames: async () => [],
  reviewFrames: async () => ({ passed: true, usedVision: false, items: [] }),
  onDraftCode: () => {},
  agentHost: {
    jobId: 'job-1',
    runBash: async () => ({ exitCode: 0, stdout: '', stderr: '' }),
    readFile: async (p) => {
      if (!files.has(p)) throw new Error(`ENOENT: ${p}`)
      return files.get(p)
    },
    writeFile: async (p, text) => {
      files.set(p, text)
    },
    listDir: async () => [...files.keys()],
  },
})

{
  const { byName } = lib.createSceneAgentTools(hostDeps(), session, [], { agentHostMode: 'full_host' })
  const adopt = byName.get('adopt_scene_from_job')
  check('full_host 注册 adopt', Boolean(adopt))
  const out = await adopt.run({ path: 'scene/main.py' })
  check('adopt 成功', out.ok === true && session.code?.includes('primitive_cone_add'), JSON.stringify(out))
  check('adopt 返回 hash', typeof out.codeHash === 'string' && out.codeHash.length > 0)
}

{
  const s2 = lib.createSceneAgentSession()
  const { byName } = lib.createSceneAgentTools(hostDeps(), s2, [], { agentHostMode: 'restricted' })
  check('restricted 无 adopt', !byName.has('adopt_scene_from_job'))
}

{
  const s3 = lib.createSceneAgentSession()
  const { byName } = lib.createSceneAgentTools(hostDeps(), s3, [], { agentHostMode: 'full_host' })
  const adopt = byName.get('adopt_scene_from_job')
  const badCode = 'import bpy\nimport subprocess\n\ndef build(ctx):\n  pass\n\ndef pose(t, mode):\n  pass\n\ndef dispose():\n  pass'
  files.set('scene/bad.py', badCode)
  const out = await adopt.run({ path: 'scene/bad.py' })
  check('非法代码 adopt 失败', out.ok !== true && !s3.code, JSON.stringify(out).slice(0, 200))
}

fs.rmSync(tmp, { recursive: true, force: true })
console.log(bad ? `\n${bad} 项失败` : '\nadopt 验收通过')
process.exitCode = bad ? 1 : 0
