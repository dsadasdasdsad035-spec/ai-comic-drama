/**
 * Blender 引擎实测（任务 1.2 / 1.3）。
 *
 * 用法：node scripts/blender/spike.mjs [--smoke]
 * 结果决定默认引擎、代理帧率与采样档位。
 */
import { writeFileSync, mkdirSync } from 'node:fs'
import path from 'node:path'
import { submitRenderJob, getRenderJob } from '../../server/blender.mjs'

const ROOT = path.resolve(import.meta.dirname, '../..')

const SCENE = `import bpy
from mathutils import Vector

_state = {}

def _look_at(obj, target):
    direction = Vector(target) - obj.location
    obj.rotation_euler = direction.to_track_quat('-Z', 'Y').to_euler()

def build(ctx):
    bpy.ops.mesh.primitive_monkey_add(location=(0, 0, 1))
    obj = bpy.context.active_object
    mat = bpy.data.materials.new("Spike")
    mat.use_nodes = True
    bsdf = mat.node_tree.nodes.get("Principled BSDF")
    if bsdf:
        bsdf.inputs["Base Color"].default_value = (0.2, 0.7, 0.6, 1)
        bsdf.inputs["Roughness"].default_value = 0.45
    obj.data.materials.append(mat)

    light_data = bpy.data.lights.new("Key", type='AREA')
    light_data.energy = 900
    light_data.size = 4
    light = bpy.data.objects.new("Key", light_data)
    ctx.scene.collection.objects.link(light)
    light.location = (3, -4, 5)
    _look_at(light, (0, 0, 1))

    ctx.camera.location = (0, -6, 2.2)
    _look_at(ctx.camera, (0, 0, 1))
    ctx.camera_data.lens = 45
    _state["obj"] = obj

def pose(t, mode):
    obj = _state.get("obj")
    if obj:
        obj.rotation_euler[2] = t * 1.2

def dispose():
    pass
`

const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

async function waitJob(id, timeoutMs = 300_000) {
  const start = Date.now()
  for (;;) {
    const job = getRenderJob(id)
    if (!job) throw new Error('作业丢失')
    if (job.status === 'done' || job.status === 'error' || job.status === 'cancelled') return job
    if (Date.now() - start > timeoutMs) throw new Error('等待超时')
    await sleep(200)
  }
}

async function runCase({ engine, width, height, frames, samples }) {
  const fps = 30
  const duration = frames / fps
  const t0 = Date.now()
  const job = await submitRenderJob(
    {
      code: SCENE,
      assets: [],
      width,
      height,
      fps,
      duration,
      tier: 'final',
      engine,
      samples,
      mode: 'clean',
      times: Array.from({ length: frames }, (_, i) => i / fps),
      keyTimes: [0, duration / 2, Math.max(0, duration - 1 / fps)],
    },
    ROOT,
  )
  const done = await waitJob(job.id)
  const wall = Date.now() - t0
  return {
    engine,
    size: `${width}x${height}`,
    frames,
    samples,
    ok: done.status === 'done',
    wallMs: wall,
    perFrameMs: Math.round(wall / frames),
    videoUrl: done.videoUrl,
    frameUrls: done.frameUrls,
    error: done.error,
  }
}

const smoke = process.argv.includes('--smoke')
const cases = smoke
  ? [{ engine: 'workbench', width: 320, height: 180, frames: 2, samples: 4 }]
  : [
      { engine: 'workbench', width: 320, height: 180, frames: 10, samples: 4 },
      { engine: 'workbench', width: 960, height: 540, frames: 10, samples: 4 },
      { engine: 'workbench', width: 1920, height: 1080, frames: 10, samples: 4 },
      { engine: 'eevee', width: 320, height: 180, frames: 10, samples: 8 },
      { engine: 'eevee', width: 960, height: 540, frames: 10, samples: 16 },
      { engine: 'eevee', width: 1920, height: 1080, frames: 10, samples: 32 },
      { engine: 'cycles', width: 320, height: 180, frames: 10, samples: 8 },
      { engine: 'cycles', width: 960, height: 540, frames: 10, samples: 16 },
      { engine: 'cycles', width: 1920, height: 1080, frames: 10, samples: 32 },
    ]

const rows = []
for (const c of cases) {
  process.stdout.write(`▶ ${c.engine} ${c.width}x${c.height} x${c.frames} … `)
  try {
    const row = await runCase(c)
    rows.push(row)
    console.log(row.ok ? `${row.wallMs}ms (${row.perFrameMs}ms/帧)` : `失败：${row.error}`)
  } catch (e) {
    rows.push({ ...c, ok: false, error: e.message })
    console.log(`异常：${e.message}`)
  }
}

if (!smoke) {
  const dir = path.join(ROOT, 'openspec/changes/replace-three-with-blender/evidence')
  mkdirSync(dir, { recursive: true })
  writeFileSync(path.join(dir, 'blender-spike.json'), JSON.stringify({ at: new Date().toISOString(), blender: '5.2.2 LTS', rows }, null, 2))
  console.log('\n结果写入 openspec/changes/replace-three-with-blender/evidence/blender-spike.json')
}
