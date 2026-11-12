import type { ProjectData } from './api'
import type { MediaBrief } from './mediaBrief'
import type { PreparedSceneAsset } from './sceneCodeAssets'
import type { SceneCodeShotHead } from './types'

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

隔离与入口（预演摘要见 job 内 dcc-previs-pack.md；专业流程用 read_file 读 dcc-skills/ 下 blender-* SKILL.md，须仍符合本 ABI）：
- 允许 bpy、math、mathutils、colorsys、random、os 等；禁止 subprocess/socket/urllib/eval/exec 与 bpy.ops.wm·import/export·libraries·app。
- 勿在模块顶层使用 ctx；共享状态放 _state。动画只随 t 变化。
- 可见 mesh 必存在；相机对准主体；素材优先 ctx.asset；勿改渲染分辨率/FPS/引擎。
- 一次性 JSON 输出时不要 Markdown 围栏。

最小结构：import bpy · def build(ctx) · def pose(t, mode) · def dispose()；build 内至少一个可见对象并设置 ctx.camera。`

export type SceneCodePromptInput = {
  shot: SceneCodeShotHead
  project?: ProjectData | null
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

/** 代码生成/聊天共用的上下文：仅运行元数据，不自动注入分镜表或参考选择。 */
export function buildSceneCodeContext(input: SceneCodePromptInput): string {
  const lines: string[] = []
  lines.push(`【渲染引擎】Blender ${input.engineVersion || '4.2+'}（bpy）`)
  lines.push(
    `【镜头】${String(input.shot.no || '')}｜${Number(input.duration || 0).toFixed(1)}s｜${input.aspect}`,
  )
  if (input.assets.length) {
    lines.push('【渲染素材键】')
    for (const a of input.assets) {
      const meta = assetMetaOf(input.assets)[a.ref.key]
      const size = meta?.width && meta?.height ? `｜${meta.width}x${meta.height}` : ''
      lines.push(`- key=${a.ref.key}｜${a.ref.label}${size}`)
      const brief = briefsOf(input.mediaBrief)[a.ref.key]
      if (brief) lines.push(`  brief：${brief}`)
    }
  }

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
