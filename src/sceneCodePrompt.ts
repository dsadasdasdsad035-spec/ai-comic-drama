import type { ProjectData } from './api'
import type { MediaBrief } from './mediaBrief'
import type { PreparedSceneAsset } from './sceneCodeAssets'
import type { Shot3DContext, ShotData } from './types'
import type { Shot3DContextCatalog } from './shot3dContextCatalog'
import { buildManifest, manifestText } from './contextManifest'

export const SCENE_CODE_ABI = `运行时会提供：
- ctx.scene：bpy 场景；ctx.camera：相机对象；ctx.camera_data：相机数据（焦距/传感器）
- ctx.width / ctx.height / ctx.aspect / ctx.duration（秒）/ ctx.fps / ctx.mode（clean 或 review）
- ctx.shot：当前镜头元数据
- ctx.asset(key)：返回该素材在本机的只读文件路径；不存在时返回 None
- ctx.assets()：返回 [{key,label,kind,path,width,height,...}]

必须定义三个顶层函数：
def build(ctx):    # 建场景、材质、灯光、相机；至少添加一个可见对象
def pose(t, mode): # t 是 0..duration 秒；只改场景状态，不渲染、不写文件
def dispose():     # 释放自定义数据块/节点组/临时贴图

硬约束：
- 只允许 import bpy、math、random、mathutils、colorsys；禁止 os/sys/subprocess/socket/urllib/pathlib/open/eval/exec/compile。
- 禁止 bpy.ops.wm / bpy.ops.export / bpy.ops.import / bpy.data.libraries / bpy.app / bpy.utils / bpy.path。
- 不要在模块顶层引用 ctx 或调用 build(ctx)：宿主加载代码后才调用 build(ctx)，再逐帧调用 pose(t)。需要在 build 和 pose 之间共享的对象请存进模块级 _state。
- 创建可见几何必须有顶点（bpy.ops.mesh.primitive_*_add 或 mesh.from_pydata）；不要用空 mesh 当物体，否则什么都看不见。
- Blender 4.2–6.0 没有 primitive_capsule_add；人物四肢用 primitive_cylinder_add 组合（圆柱两端可再叠 uv_sphere）。
- primitive_cube_add 的 size 只接受数字；要做长方体用 size=1，再设 obj.scale。
- bpy.ops.mesh.primitive_*_add 创建的对象已经自动链接到当前 collection；不要再 link() 同一个对象，否则会报 already in collection。
- 动画必须由 t 决定；不要读墙钟、不要用未固定种子的随机数表达运动；同一 t 必须产生同一画面。
- 素材只通过 ctx.asset(key) 取路径；用 bpy.data.images.load() 载入并接进材质；没有素材时用程序化材质兜底。
- 相机必须朝向主体；相机由宿主创建，代码只需改 ctx.camera.location / rotation_euler / ctx.camera_data.lens。
- 单位是米；默认相机焦距 45mm；画面比例由宿主设置，不要改分辨率或帧率。
- 渲染设置（引擎、采样、分辨率、帧率、输出路径）由宿主拥有，代码 MUST NOT 修改。
- 只输出 JSON，不要 Markdown 围栏。

相机对准目标的常用写法：
from mathutils import Vector
def _look_at(obj, target):
    d = Vector(target) - obj.location
    obj.rotation_euler = d.to_track_quat('-Z', 'Y').to_euler()

素材贴图的常用写法：
img = bpy.data.images.load(path)
tex = mat.node_tree.nodes.new('ShaderNodeTexImage')
tex.image = img
mat.node_tree.links.new(bsdf.inputs['Base Color'], tex.outputs['Color'])

最小可用结构（内容可替换，但结构必须保留）：
import bpy
from mathutils import Vector

_state = {}

def _look_at(obj, target):
    d = Vector(target) - obj.location
    obj.rotation_euler = d.to_track_quat('-Z', 'Y').to_euler()

def build(ctx):
    bpy.ops.mesh.primitive_plane_add(size=12, location=(0, 0, 0))
    bpy.ops.mesh.primitive_cube_add(size=1.2, location=(0, 0, 0.6))
    box = bpy.context.active_object
    mat = bpy.data.materials.new('Subject')
    mat.use_nodes = True
    bsdf = mat.node_tree.nodes.get('Principled BSDF')
    if bsdf:
        bsdf.inputs['Base Color'].default_value = (0.14, 0.55, 0.48, 1)
        bsdf.inputs['Roughness'].default_value = 0.5
    box.data.materials.append(mat)

    key = bpy.data.objects.new('Key', bpy.data.lights.new('Key', type='AREA'))
    key.data.energy = 600
    key.data.size = 4
    ctx.scene.collection.objects.link(key)
    key.location = (4, -5, 6)
    _look_at(key, (0, 0, 1))

    ctx.camera.location = (0, -7, 2.4)
    _look_at(ctx.camera, (0, 0, 1))
    ctx.camera_data.lens = 45
    _state['box'] = box

def pose(t, mode):
    box = _state.get('box')
    if box:
        box.rotation_euler[2] = t * 0.6

def dispose():
    pass`

export type SceneCodePromptInput = {
  shot: ShotData
  project?: ProjectData | null
  context: Shot3DContext
  catalog: Shot3DContextCatalog
  assets: PreparedSceneAsset[]
  mediaBrief?: MediaBrief
  videoBrief?: string
  currentCode?: string
  previousCode?: string
  legacyScene?: unknown
  duration: number
  aspect: string
  /** 本机 Blender 版本；写入提示词，减少 bpy 版本漂移 */
  engineVersion?: string
}

export type SceneCodeResult = {
  reply: string
  code: string
  motionNote?: string
}

const clean = (v: unknown, max = 3000): string =>
  String(v ?? '')
    .replace(/data:image\/[a-z0-9+.-]+;base64,[a-z0-9+/=]+/gi, '[图片已省略]')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, max)

const cleanCode = (v: unknown, max = 16000): string =>
  String(v ?? '')
    .replace(/data:image\/[a-z0-9+.-]+;base64,[a-z0-9+/=]+/gi, '[图片已省略]')
    .trim()
    .slice(0, max)

function briefsOf(mediaBrief?: MediaBrief): Record<string, string> {
  const out: Record<string, string> = {}
  for (const item of mediaBrief?.items ?? []) {
    if (item.key && item.description) out[item.key] = item.description
  }
  return out
}

function assetMetaOf(assets: PreparedSceneAsset[]): Record<string, { width?: number; height?: number }> {
  const out: Record<string, { width?: number; height?: number }> = {}
  for (const a of assets) {
    out[a.ref.key] = {
      ...(a.payload.width ? { width: a.payload.width } : {}),
      ...(a.payload.height ? { height: a.payload.height } : {}),
    }
  }
  return out
}

/** 代码生成/聊天共用的上下文；素材只给稳定键和 brief，不发 base64。 */
export function buildSceneCodeContext(input: SceneCodePromptInput): string {
  const lines: string[] = []
  lines.push(`【渲染引擎】Blender ${input.engineVersion || '4.2+'}（bpy）`)
  const manifest = buildManifest({
    context: input.context,
    catalog: input.catalog,
    shotNo: String(input.shot.no || ''),
    duration: input.duration,
    aspect: input.aspect,
  })
  lines.push(manifestText(manifest, briefsOf(input.mediaBrief), 12000, assetMetaOf(input.assets)))

  if (input.videoBrief) {
    lines.push('【原生视频理解（仅首次生成可用）】')
    lines.push(clean(input.videoBrief, 5000))
  }
  if (input.legacyScene) {
    lines.push('【旧结构化 3D（只作转换参考，不要原样输出 JSON）】')
    lines.push(clean(JSON.stringify(input.legacyScene), 6000))
  }
  if (input.previousCode) {
    lines.push('【上一镜代码（只作风格/空间连续性参考，不要假设有结构化继承）】')
    lines.push('```python\n' + cleanCode(input.previousCode, 12000) + '\n```')
  }
  if (input.currentCode) {
    lines.push('【当前代码（在此基础上改）】')
    lines.push('```python\n' + cleanCode(input.currentCode, 16000) + '\n```')
  }
  return lines.join('\n').slice(0, 28000)
}

export function buildSceneCodeGeneratePrompt(input: SceneCodePromptInput): string {
  return (
    `${buildSceneCodeContext(input)}\n\n` +
    '请生成一段完整的 Blender Python（bpy）调度代码。优先用选中素材做背景/贴图；没有素材就用几何与程序化材质。' +
    '不要输出 JSON 以外的内容。'
  )
}

export function buildSceneCodeChatPrompt(input: SceneCodePromptInput, userMessage: string, history: { role: 'user' | 'assistant'; text: string }[]): string {
  const recent = history
    .slice(-6)
    .map((m) => `${m.role === 'user' ? '用户' : '助手'}：${clean(m.text, 500)}`)
    .join('\n')
  return (
    `${buildSceneCodeContext(input)}\n\n` +
    (recent ? `【最近聊天】\n${recent}\n\n` : '') +
    `【用户新消息】${clean(userMessage, 2000)}\n\n` +
    '请直接修改当前 Blender Python 代码并返回完整新代码；只输出 JSON。'
  )
}

function asObj(v: unknown): Record<string, unknown> | null {
  return v && typeof v === 'object' && !Array.isArray(v) ? (v as Record<string, unknown>) : null
}

/** 解析代码模型输出；代码围栏在 sanitize 阶段再统一去一次。 */
export function parseSceneCodeResult(raw: unknown): SceneCodeResult {
  const o = asObj(raw)
  if (!o) throw new Error('模型没有返回 JSON 对象')
  const code = typeof o.code === 'string' ? o.code : ''
  if (!code.trim()) throw new Error('模型没有返回 code 字段')
  return {
    reply: clean(o.reply, 500) || '已生成新的 3D 代码。',
    code,
    ...(typeof o.motionNote === 'string' && o.motionNote.trim()
      ? { motionNote: clean(o.motionNote, 500) }
      : {}),
  }
}
